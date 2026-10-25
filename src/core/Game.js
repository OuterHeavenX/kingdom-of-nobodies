import { Simulation } from '../sim/Simulation.js';
import { createKingdom } from '../sim/Setup.js';
import { GameClock } from './GameClock.js';
import { SaveManager } from './SaveManager.js';
import { World, WebGLUnavailableError } from '../world/World.js';
import { HUD } from '../ui/HUD.js';
import { CloudSaveClient } from '../persistence/CloudSaveClient.js';
import { CloudSync } from '../persistence/CloudSync.js';
import { normalizeSettings } from '../holidays/HolidaySettings.js';
import { ringBells, unlockAudio } from '../ui/Bells.js';
import { AudioManager } from '../audio/AudioManager.js';
import { fireworkHooks } from '../effects/Fireworks.js';

/* global __BUILD__ */
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
const SETTINGS_KEY = 'kingdom-of-nobodies-settings';
const AUTOSAVE_MS = 60000;

// Application wiring: load or create the kingdom, start the renderer and UI,
// run the frame loop and keep the world saved.
export class Game {
  constructor() {
    this.build = BUILD;
    this.saves = new SaveManager(BUILD);
    this.settings = { labels: true, quality: null, ...readSettings() };
    this.settings.holidays = normalizeSettings(this.settings.holidays);
    this.frameTimes = [];
    this.started = false;
    this.dev = (typeof import.meta !== 'undefined' && import.meta.env?.DEV) || /[?&]dev\b/.test(globalThis.location?.search ?? '');
    this.audio = new AudioManager({
      getState: () => this.sim?.state ?? null,
      getWorld: () => this.world,
      isMenu: () => !this.started,
      onNeedsGesture: () => this.hud?.toasts.show('🔈 Tap anywhere to resume sound.', { ms: 5000 }),
    });
    fireworkHooks.burst = (x, y, z, delay) => this.audio.firework(x, y, z, delay);
  }

  /** The title screen's Start / Continue: a tap, so sound may begin if the player wants it. */
  begin({ sound = this.audio.enabled } = {}) {
    if (sound) this.audio.enable();
    this.started = true;
    this.last = performance.now();
  }

  async start(progress = () => {}) {
    progress('Reading your saved kingdom…', 0.45);
    const { state, source, upgradedFrom } = await this.saves.load();
    this.loadSource = source;
    this.upgradedFrom = upgradedFrom ?? null;
    progress(source ? 'Bringing the centuries back to life…' : 'Founding a new kingdom…', 0.65);
    this.sim = new Simulation(state ?? createKingdom(Math.floor(Math.random() * 1e9)));
    this.clock = new GameClock(() => this.sim.step());
    progress('Raising the buildings…', 0.8);
    await new Promise((r) => setTimeout(r, 0));
    this.startWorld();
    progress('Opening the council chamber…', 0.95);
    this.hud = new HUD(this);
    if (this.world) this.world.themes.hooks = { announce: (text) => this.hud.toasts.show(text, { ms: 10000, holiday: true }), bell: () => (this.audio.running ? this.audio.bells() : ringBells()) };
    if (this.world) this.world.setSeeThrough(this.settings.seeThrough);
    if (this.world) this.world.onPick = (kind, id) => (kind === 'memorial' ? this.hud.showMemorial() : this.hud.openDetail(kind, id, { push: false }));
    this.lastChronicle = this.sim.state.nextId.chronicle;
    this.startCloud();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    setInterval(() => this.save(), AUTOSAVE_MS);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saves.saveNow(this.sim.state); });
    window.addEventListener('pagehide', () => this.saves.saveNow(this.sim.state));
    if (source) this.hud.toasts.show(source.includes('Milestone 1') ? 'Your First Hearth village has been brought into the Living Society.' : upgradedFrom ? `Your kingdom joins the Evolution of Civilization: the ${this.sim.state.civ?.age >= 2 ? 'ages its calendar has reached are open' : 'Age of Foundations'}. A copy from before the upgrade is kept on this device.` : `Welcome back. Day ${this.sim.state.day} continues.`, { ms: 10000 });
    if (!state) this.save();
  }

  /** Optional cloud backup: inert unless a service address was configured at build time. */
  startCloud() {
    const client = new CloudSaveClient();
    this.cloud = new CloudSync({ client, build: this.build, getState: () => this.sim.state, setState: (st) => this.replaceState(st), exportBackup: (st) => this.saves.exportFile(st) });
    if (!client.configured) return;
    if (client.captureSession()) this.hud.toasts.show('Signed in for cloud backup. Use Council → Sync to back up or restore.');
    setInterval(() => { if (this.cloud.auto && client.signedIn) this.cloud.syncNow({ allowDownload: false }); }, 5 * 60000);
  }

  cloudSignIn() { if (this.cloud?.client.configured) location.href = this.cloud.client.signInUrl(location.href.split('#')[0]); }

  async cloudSync() {
    await this.save();
    const r = await this.cloud.syncNow();
    const msg = { uploaded: 'Backed up to the cloud.', downloaded: 'Restored the kingdom from the cloud.', 'in-sync': 'Already in step with the cloud.', conflict: 'This device and the cloud hold different kingdoms: choose which to keep in Council.', error: `Cloud sync failed: ${r.error}. Your local save is unchanged.` }[r.action] ?? 'Nothing to sync.';
    this.hud.toasts.show(msg, { bad: r.action === 'error' || r.action === 'conflict', ms: 10000 });
    this.hud.renderSheet(true);
  }

  async cloudResolve(keep) {
    const r = await this.cloud.resolve(keep);
    this.hud.toasts.show(r.action === 'error' ? `Could not complete: ${r.error}` : `Kept ${keep === 'local' ? "this device's" : "the cloud's"} kingdom; ${r.replaced ?? ''}.`, { bad: r.action === 'error', ms: 10000 });
    if (r.action === 'downloaded') await this.save();
    this.hud.renderSheet(true);
  }

  startWorld() {
    const container = document.getElementById('world');
    try {
      this.world = new World(container, this.sim, { quality: this.settings.quality ?? 'high', labels: this.settings.labels, holidays: this.settings.holidays });
      this.world.setLabels(this.settings.labels);
    } catch (e) {
      this.world = null;
      const fallback = document.getElementById('world-fallback');
      fallback.hidden = false;
      fallback.innerHTML = e instanceof WebGLUnavailableError
        ? '<div><strong>3D view unavailable</strong><br>This browser could not start WebGL, so the village can’t be drawn. The simulation is still running — use the tabs below to follow your citizens.</div>'
        : `<div><strong>The 3D view failed to start</strong><br>${String(e.message).replace(/</g, '&lt;')}<br>The simulation keeps running; use the tabs below.</div>`;
      console.error(e);
    }
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    try {
      // The kingdom waits on the title screen until the player starts.
      if (this.started) this.clock.advance(dt);
      this.announce();
      if (this.world) {
        this.world.render(dt, now / 1000);
        this.autoQuality(dt);
        this.adaptResolution(dt);
      }
      this.hud.update(now);
    } catch (e) {
      console.error(e);
      if (!this.errorShown) { this.errorShown = true; this.hud?.toasts.show(`Something went wrong: ${e.message}`, { bad: true, ms: 12000 }); }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Toast milestone chronicle entries as they happen. */
  announce() {
    const s = this.sim.state;
    if (s.nextId.chronicle === this.lastChronicle) return;
    for (const e of s.chronicle) {
      if (e.id <= this.lastChronicle) continue;
      if (e.importance >= 3) this.hud.toasts.show(e.text);
      if (e.importance >= 2) { const p = e.refs?.plot ? s.plots.find((x) => x.id === e.refs.plot) : null; this.audio.onChronicle(e, p ? { x: p.x, z: p.z } : null); }
    }
    this.lastChronicle = s.nextId.chronicle;
  }

  /** If the device struggles during the first seconds and the player has not chosen, switch to battery-saver graphics. */
  autoQuality(dt) {
    if (this.settings.quality || this.qualityChecked) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 240) return;
    this.qualityChecked = true;
    const avg = this.frameTimes.slice(60).reduce((a, b) => a + b, 0) / (this.frameTimes.length - 60);
    if (avg > 1 / 38) { this.world.setQuality('low'); this.hud.toasts.show('Switched to battery-saver graphics for smoother play.'); }
  }

  /**
   * Adaptive resolution: every two seconds, if frames are slow, render a
   * little fewer pixels; when there is headroom, step back up.
   */
  adaptResolution(dt) {
    this.adapt = this.adapt ?? { t: 0, n: 0 };
    this.adapt.t += dt; this.adapt.n++;
    if (this.adapt.t < 2) return;
    const fps = this.adapt.n / this.adapt.t;
    this.fps = Math.round(fps);
    this.adapt = { t: 0, n: 0 };
    if (this.settings.adaptive === false || document.hidden) { this.world.setResolutionScale(1); return; }
    const scale = this.world.resolutionScale ?? 1;
    if (fps < 28 && scale > 0.6) this.world.setResolutionScale(scale - 0.1);
    else if (fps > 55 && scale < 1) this.world.setResolutionScale(scale + 0.1);
  }

  setSetting(key, value) {
    this.settings[key] = value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    if (key === 'labels') this.world?.setLabels(value);
    if (key === 'quality') this.world?.setQuality(value);
    if (key === 'seeThrough') this.world?.setSeeThrough(value);
  }

  /** One of the seasons & celebrations display settings (kept on this device). */
  setHolidaySetting(key, value) {
    const next = normalizeSettings({ ...this.settings.holidays, [key]: value });
    if (key === 'sound' && next.sound) unlockAudio();
    this.setSetting('holidays', next);
    this.world?.themes.setSettings(next);
  }

  async save(announce = false) {
    const ok = await this.saves.save(this.sim.state);
    if (announce) this.hud.toasts.show(ok ? 'Kingdom saved on this device.' : 'Saving is unavailable in this browser.', { bad: !ok });
    return ok;
  }

  lastSavedText() {
    const d = this.saves.lastSaved;
    return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  }

  async newKingdom() {
    await this.saves.clear();
    this.replaceState(createKingdom(Math.floor(Math.random() * 1e9)));
    this.hud.toasts.show('A new kingdom begins. Five strangers light the first hearth.');
    this.save();
  }

  async importSave(file) {
    try {
      const state = await this.saves.importFile(file);
      this.replaceState(state);
      await this.save();
      this.hud.toasts.show(`Imported a kingdom on day ${state.day}.`);
    } catch (e) {
      this.hud.toasts.show(`Import failed: ${e.message}`, { bad: true, ms: 11000 });
    }
  }

  async restoreSnapshot() {
    const state = await this.saves.loadSnapshot();
    if (!state) { this.hud.toasts.show('No recovery snapshot has been taken yet.', { bad: true }); return; }
    this.replaceState(state);
    await this.save();
    this.hud.toasts.show(`Restored the recovery snapshot from day ${state.day}.`);
  }

  replaceState(state) {
    this.sim.state = state;
    state.events = [];
    this.sim.selected = { kind: 'citizen', id: state.citizens[0]?.id ?? null };
    this.lastChronicle = state.nextId.chronicle;
    if (this.world) { this.world.home(); this.world.syncPlots(true); this.world.themes.resetFireworks(); this.world.themes.check(true); }
    this.world?.exitThenNow(false);
    this.hud.setBanner(null);
    this.hud.openTab('citizens');
  }
}

function readSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; }
}
