import { loadAudio, saveAudio, normalizeAudio } from './AudioSettings.js';
import { AudioMixer } from './AudioMixer.js';
import { MusicDirector } from './MusicDirector.js';
import { AmbientSoundscape, ambienceMix } from './AmbientSoundscape.js';
import { SFX } from './SoundEffects.js';
import { placeSound, VoicePool, COOLDOWNS } from './SpatialAudio.js';
import { VOICES, midiHz } from './Instruments.js';
import { seasonIndex } from '../core/Calendar.js';

// The audio manager. Nothing is created and nothing can sound until the
// player taps "Enable sound" (browsers, and iPhones especially, require a
// gesture). One scheduler drives the music, the ambience and the world's
// sounds; the context is suspended when the game is hidden and resumed only
// by the player's next tap, so the game never starts playing by itself.

const TICK_MS = 100;
const WORLD_EVERY = 5; // ticks between reading the world

const HOLIDAY_MUSIC = { newyear: 'newyear', winter: 'winter' };

export class AudioManager {
  constructor({ getState = () => null, getWorld = () => null, isMenu = () => false, storage = globalThis.localStorage, AudioContextClass = null, onNeedsGesture = null } = {}) {
    this.getState = getState;
    this.getWorld = getWorld;
    this.isMenu = isMenu;
    this.storage = storage;
    this.AC = AudioContextClass ?? globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
    this.settings = loadAudio(storage);
    this.ctx = null;
    this.timer = null;
    this.ticks = 0;
    this.pool = new VoicePool({ max: 8, cooldowns: COOLDOWNS });
    this.needsGesture = false;
    this.onNeedsGesture = onNeedsGesture;
    this.lastEnv = null;
    this.lastHour = null;
    this.supported = !!this.AC;
  }

  get enabled() { return this.settings.enabled; }
  get running() { return this.ctx?.state === 'running'; }

  /** Turn sound on. Must be called from a tap or click. */
  enable() {
    if (!this.AC) return false;
    if (!this.ctx) this.create();
    this.settings = normalizeAudio({ ...this.settings, enabled: true });
    saveAudio(this.settings, this.storage);
    this.resume();
    this.mixer.apply(this.settings);
    this.start();
    return true;
  }

  disable() {
    this.settings = normalizeAudio({ ...this.settings, enabled: false });
    saveAudio(this.settings, this.storage);
    if (this.ctx) { this.mixer.apply(this.settings, 0.3); this.director.stop(); this.ambience.stop(); setTimeout(() => { if (!this.settings.enabled) this.ctx?.suspend?.(); }, 600); }
    this.stopTimer();
  }

  create() {
    this.ctx = new this.AC({ latencyHint: 'playback' });
    this.mixer = new AudioMixer(this.ctx, { ...this.settings, enabled: true });
    this.director = new MusicDirector(this.ctx, this.mixer.bus.music);
    this.ambience = new AmbientSoundscape(this.ctx, this.mixer.bus.ambience);
    // iOS unlocks audio output only after a sound is started inside the gesture.
    try {
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    } catch { /* not needed elsewhere */ }
    this.ctx.onstatechange = () => {
      // iOS reports 'interrupted' for calls and Siri; the next tap brings sound back.
      if (this.ctx.state !== 'running' && this.settings.enabled && !document.hidden) this.askForGesture();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.onVisibility());
      window.addEventListener('pagehide', () => this.ctx?.suspend?.());
    }
  }

  resume() { try { const p = this.ctx?.resume?.(); p?.catch?.(() => {}); } catch { /* ignore */ } this.needsGesture = false; }

  onVisibility() {
    if (!this.ctx) return;
    if (document.hidden) { this.ctx.suspend?.(); this.stopTimer(); return; }
    // Back from the background: wait for the player's next tap before sounding again.
    if (this.settings.enabled) this.askForGesture();
  }

  askForGesture() {
    if (this.needsGesture) return;
    this.needsGesture = true;
    this.onNeedsGesture?.();
    const once = () => { window.removeEventListener('pointerdown', once, true); if (this.settings.enabled) { this.resume(); this.start(); } };
    window.addEventListener('pointerdown', once, true);
  }

  /** A tap anywhere while sound is on and waiting (after returning to the game). */
  gesture() { if (this.settings.enabled && this.ctx && this.ctx.state !== 'running') { this.resume(); this.start(); } }

  start() {
    if (this.timer || !this.ctx) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  set(key, value) {
    this.settings = normalizeAudio({ ...this.settings, [key]: value });
    saveAudio(this.settings, this.storage);
    if (this.ctx) this.mixer.apply(this.settings);
    if (key === 'shuffle' && this.ctx) this.director.rotation++;
  }

  /** The single scheduler: music, ambience and (every half second) what the world sounds like. */
  tick() {
    if (!this.ctx || this.ctx.state !== 'running' || !this.settings.enabled) return;
    if (this.ticks++ % WORLD_EVERY === 0) this.listen();
    this.director.tick();
    if (this.director.wantsRotation()) this.director.update(this.musicContext());
    this.ambience.tick((kind) => this.worldSound(kind), this.settings.reduced);
  }

  /** Read the world: choose music and mix the ambience for what the camera sees. */
  listen() {
    const ctx = this.musicContext();
    this.director.update(ctx);
    const e = this.environment();
    if (e) { this.lastEnv = e; this.ambience.update(ambienceMix(e)); }
    // A town bell at noon where there is a chapel or temple, in the older ages.
    const s = this.getState();
    // Near the stone at night, now and then, a soft whisper of air.
    const st = s?.divine?.stone;
    if (st && e && Math.hypot(e.x - st.x, e.z - st.z) < 28 && (e.hour >= 20 || e.hour < 5) && Math.random() < 0.08) this.sfx('whisper', { x: st.x, z: st.z }, 'ambience');
    if (s && e && e.faith && e.era <= 2) {
      const hour = Math.floor(s.minute / 60);
      if (hour === 12 && this.lastHour !== 12) this.sfx('townbell', e.faithAt);
      this.lastHour = hour;
    }
  }

  musicContext() {
    const s = this.getState();
    const w = this.getWorld();
    if (this.isMenu() || !s) return { menu: true };
    const holiday = w?.themes?.status?.holiday?.id ?? null;
    // War music while First Hearth itself is at war (as a belligerent or a called-in ally).
    const war = (s.military?.wars ?? []).some((x) => x.status === 'ACTIVE' && (x.attackers?.includes('hearth') || x.defenders?.includes('hearth')));
    return {
      era: s.civ?.age ?? 1, hour: (w?.visualHour?.() ?? s.minute / 60), war,
      festival: s.culture?.current?.phase === 'ACTIVE',
      disaster: (s.fires ?? []).length > 0,
      holiday: holiday ? HOLIDAY_MUSIC[holiday] ?? 'festival' : null,
      winter: seasonIndex(s.day) === 3,
      kingdom: w?.mode === 'kingdom' ? w.awayId : 'hearth',
      shuffle: this.settings.shuffle,
    };
  }

  /** What is around the point the camera looks at. */
  environment() {
    const s = this.getState();
    const w = this.getWorld();
    if (!s) return null;
    const t = w?.controls?.target ?? { x: 0, z: 0 };
    const zoom = w ? w.camera.position.distanceTo(w.controls.target) : 70;
    const yaw = w?.controls?.getAzimuthalAngle?.() ?? 0;
    const today = s.weather?.today ?? { kind: 'clear', intensity: 0.5 };
    const base = { zoom, yaw, x: t.x, z: t.z, hour: (w?.visualHour?.() ?? s.minute / 60), season: seasonIndex(s.day), weather: today.kind, intensity: today.intensity, age: s.civ?.age ?? 1 };
    if (w && w.mode !== 'village') return { ...base, era: s.civ?.age ?? 1, shops: 3, homes: 8, crowd: 8, forest: 0.3, farms: w.awayId === 'greenvale' ? 3 : 0, industrial: w.awayId === 'ironhold' ? 2 : 0 };
    const R = 22 + zoom * 0.2;
    const c = { farms: 0, workshops: 0, industrial: 0, shops: 0, homes: 0, towers: 0, sites: 0, station: 0, faith: 0, smithy: 0, lumber: 0 };
    let eraSum = 0, eraN = 0, faithAt = null, nearSite = null;
    for (const p of s.plots) {
      if (Math.hypot(p.x - t.x, p.z - t.z) > R) continue;
      if (p.projectId) { c.sites++; nearSite = nearSite ?? p; }
      const b = p.building;
      if (!b) continue;
      const era = b.era ?? 1;
      eraSum += era; eraN++;
      if (b.type === 'farm') c.farms++;
      else if (b.type === 'lumberyard') { c.workshops++; c.lumber++; if (era >= 2) c.industrial++; }
      else if (b.type === 'blacksmith') { c.workshops++; c.smithy++; if (era >= 2) c.industrial++; }
      else if (['bakery', 'general_store', 'tavern', 'stall', 'market'].includes(b.type)) c.shops++;
      else if (['cottage', 'apartment', 'mansion'].includes(b.type)) c.homes++;
      else if (b.type === 'tower' || (b.floors ?? 1) >= 7) c.towers++;
      if (b.type === 'station') c.station++;
      if (['chapel', 'temple'].includes(b.type)) { c.faith++; faithAt = faithAt ?? p; }
    }
    if (Math.hypot(t.x, t.z) < 12 && s.council?.marketplace) c.shops += 2;
    const forest = Math.max(Math.max(0, 1 - Math.hypot(t.x - 23, t.z + 27) / 22), Math.hypot(t.x, t.z) > 72 ? 0.7 : 0);
    const crowd = s.citizens.filter((x) => Math.hypot(x.x - t.x, x.z - t.z) < R * 0.7).length;
    return { ...base, ...c, era: eraN ? Math.round(eraSum / eraN) : s.civ?.age ?? 1, forest, crowd, vehicles: w?.vehicles?.count ?? 0, faithAt, nearSite };
  }

  /** An ambient one-off near the listener (or at the building site that makes it). */
  worldSound(kind) {
    const e = this.lastEnv;
    if (!e) return;
    const at = kind === 'hammer' && e.nearSite ? { x: e.nearSite.x, z: e.nearSite.z } : { x: e.x + (Math.random() - 0.5) * 30, z: e.z + (Math.random() - 0.5) * 30 };
    this.sfx(kind, at, 'sfx');
  }

  /** Play an effect. `at` = { x, z } places it in the world; without it, it is centred. */
  sfx(kind, at = null, bus = 'sfx') {
    if (!this.ctx || this.ctx.state !== 'running' || !this.settings.enabled || !SFX[kind]) return false;
    const now = this.ctx.currentTime;
    if (!this.pool.claim(kind, now, kind === 'crash' || kind === 'townbell' ? 3 : 1.2)) return false;
    let gain = 1, pan = 0;
    if (at && this.lastEnv) {
      const p = placeSound(this.lastEnv, at.x, at.z);
      gain = p.gain; pan = p.pan;
      if (gain < 0.03) return false;
    }
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let pn = null;
    if (this.ctx.createStereoPanner) { pn = this.ctx.createStereoPanner(); pn.pan.value = pan; g.connect(pn); pn.connect(this.mixer.bus[bus]); } else g.connect(this.mixer.bus[bus]);
    SFX[kind](this.ctx, g, now + 0.02);
    // Both nodes are let go once the effect has rung out (a panner left connected to the bus would never be freed).
    setTimeout(() => { try { g.disconnect(); pn?.disconnect(); } catch { /* ignore */ } }, 4000);
    return true;
  }

  ui(kind = 'tap') { return this.sfx(kind, null, 'ui'); }

  /** Something happened in the kingdom (a chronicle entry): sound it if it is worth hearing. */
  onChronicle(entry, plotAt = null) {
    if (!this.running) return;
    const t = entry.text;
    if (/begins\. .*Nothing changes by itself|first [A-Z][a-z]+ building|skyline has changed/.test(t)) { this.director.stinger('triumph'); return; }
    if (/demolished|taken down|cleared the old/.test(t)) this.sfx('crash', plotAt);
    else if (/finished|completed|is finished|opened:/.test(t) && entry.category === 'construction') this.sfx('hammer', plotAt);
    else if (/officially opened|purchased|sold .* for/.test(t)) this.sfx('coins', plotAt);
    else if (/caught fire|is ablaze|fire broke out/i.test(t)) this.sfx('crash', plotAt);
    else if (/festival|celebrat/i.test(t) && entry.importance >= 2) this.sfx('cheer', plotAt);
    else if (/standing stone/.test(t) && entry.importance >= 3) { this.sfx('discovery'); this.motif(); }
    else if (/consecrated/.test(t)) this.sfx('templebell', plotAt);
    else if (/vigil|gathered at|prayed at the stone|pilgrimage|preached/.test(t)) this.sfx('chime', plotAt);
    if (entry.importance >= 3) this.ui('notify');
  }

  /**
   * v0.5.3: the Hidden Hand's sounds. `motif` is a short phrase in the voice
   * of the age (flute, harp and bells; piano and strings; orchestral; ambient
   * synthesizers), played sparingly on the music bus; the rest are effects.
   * Silent unless the player has turned sound on; volume and mutes apply.
   */
  hiddenHand(kind = 'motif', at = null) {
    if (!this.running) return false;
    if (kind === 'blessing') return this.sfx('blessing', at, 'ui');
    if (kind === 'omen') return this.sfx('omen');
    if (kind === 'tone') return this.sfx('omen', at);
    if (kind === 'stone') { this.sfx('discovery'); return this.motif(true); }
    return this.motif();
  }

  /** The Hidden Hand's motif, at most once every half minute (unless `force`). */
  motif(force = false) {
    const now = this.ctx.currentTime;
    if (!force && now - (this.lastMotif ?? -99) < 30) return false;
    this.lastMotif = now;
    const era = this.getState()?.civ?.age ?? 1;
    const voices = [null, ['flute', 'harp', 'bell'], ['piano', 'strings', 'bell'], ['strings', 'cello', 'harp'], ['pad', 'strings', 'epiano'], ['synth', 'pad', 'bell']][Math.max(1, Math.min(5, era))];
    const out = this.ctx.createGain();
    out.gain.value = this.settings.reduced ? 0.5 : 0.8;
    out.connect(this.mixer.bus.music);
    const t = now + 0.05;
    // A rising question that never quite resolves.
    [[62, 0, 1.2], [65, 0.55, 1.1], [69, 1.1, 1.4], [72, 1.8, 1.8], [70, 2.7, 2.6]].forEach(([m, d, len]) => VOICES[voices[0]](this.ctx, out, t + d, midiHz(m), len, 0.32));
    VOICES[voices[1]](this.ctx, out, t, midiHz(50), 4.2, 0.18);
    VOICES[voices[1]](this.ctx, out, t + 1.8, midiHz(46), 3.4, 0.16);
    VOICES[voices[2]](this.ctx, out, t + 2.7, midiHz(86), 2.4, 0.12);
    setTimeout(() => { try { out.disconnect(); } catch { /* ignore */ } }, 9000);
    return true;
  }

  /** A firework shell over (x, z), bursting in `delay` seconds. */
  firework(x, y, z, delay) {
    if (!this.running) return;
    const at = { x, z };
    this.sfx('launch', at);
    setTimeout(() => this.sfx('boom', at), Math.max(0, delay) * 1000);
  }

  /** New Year's bells through the mixer. */
  bells(strokes = 4) {
    if (!this.running) return false;
    for (let i = 0; i < strokes; i++) VOICES.bell(this.ctx, this.mixer.bus.sfx, this.ctx.currentTime + 0.05 + i * 1.3, midiHz(i % 2 ? 62 : 67), 1, 0.7);
    return true;
  }

  /** For the audio test panel and tests. */
  stats() {
    return {
      supported: this.supported, enabled: this.settings.enabled, state: this.ctx?.state ?? 'not started', music: this.director?.playing ?? null,
      notes: this.director?.notes ?? 0, switches: this.director?.switches ?? 0, sfxPlayed: this.pool.played, sfxSkipped: this.pool.skipped,
      level: this.ctx ? this.mixer.level() : 0, needsGesture: this.needsGesture,
    };
  }

  dispose() {
    this.stopTimer();
    try { this.mixer?.dispose(); this.ctx?.close?.(); } catch { /* ignore */ }
    this.ctx = null;
  }
}
