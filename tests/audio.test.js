import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, memoryStorage } from './fake-audio.js';
import { AudioManager } from '../src/audio/AudioManager.js';
import { MusicDirector, chooseCue, KINGDOM_TRANSPOSE } from '../src/audio/MusicDirector.js';
import { CUES, cuesForEra, specialCue, renderBar, composeMelody } from '../src/audio/MusicLibrary.js';
import { AudioMixer } from '../src/audio/AudioMixer.js';
import { loadAudio, saveAudio, busGain, DEFAULT_AUDIO, AUDIO_KEY } from '../src/audio/AudioSettings.js';
import { VoicePool, placeSound, COOLDOWNS } from '../src/audio/SpatialAudio.js';
import { ambienceMix } from '../src/audio/AmbientSoundscape.js';
import { SFX, SFX_KINDS } from '../src/audio/SoundEffects.js';
import { VOICES } from '../src/audio/Instruments.js';

const manager = (storage = memoryStorage()) => new AudioManager({ storage, AudioContextClass: FakeAudioContext, getState: () => null, getWorld: () => null });

test('audio: nothing is created or played before the player turns sound on', () => {
  const before = FakeAudioContext.instances.length;
  const a = manager();
  assert.equal(a.ctx, null, 'no audio context at start-up');
  assert.equal(a.enabled, false, 'sound is off by default');
  assert.equal(a.sfx('tap'), false);
  a.tick();
  a.onChronicle({ text: 'The Industrial Awakening begins. Nothing changes by itself', importance: 3 });
  assert.equal(FakeAudioContext.instances.length, before, 'still no context');
});

test('audio: enabling (from a tap) unlocks the context and remembers the choice; disabling silences the master', () => {
  const storage = memoryStorage();
  const a = manager(storage);
  assert.equal(a.enable(), true);
  assert.equal(a.ctx.state, 'running');
  assert.equal(JSON.parse(storage.getItem(AUDIO_KEY)).enabled, true);
  assert.equal(manager(storage).enabled, true, 'a new session remembers sound was on (but still waits for a tap)');
  assert.equal(manager(storage).ctx, null);
  a.disable();
  assert.equal(a.mixer.master.gain.value, 0, 'master ramps to silence');
  assert.equal(loadAudio(storage).enabled, false);
  a.dispose();
});

test('audio: volume sliders and mutes set each bus, and persist on this device only', () => {
  const storage = memoryStorage();
  const a = manager(storage);
  a.enable();
  a.set('music', 0.3);
  a.set('muteAmbience', true);
  assert.equal(a.mixer.bus.music.gain.value, 0.3);
  assert.equal(a.mixer.bus.ambience.gain.value, 0, 'muted bus');
  a.set('master', 0.5);
  assert.equal(a.mixer.master.gain.value, 0.5);
  const saved = loadAudio(storage);
  assert.equal(saved.music, 0.3);
  assert.equal(saved.muteAmbience, true);
  assert.equal(busGain({ ...DEFAULT_AUDIO, enabled: true, reduced: true }, 'sfx'), DEFAULT_AUDIO.sfx * 0.5, 'reduced audio halves effects');
  assert.equal(busGain({ ...DEFAULT_AUDIO, enabled: false }, 'music'), 0);
  assert.equal(saveAudio({ master: 9, music: -2 }, storage), true);
  assert.deepEqual([loadAudio(storage).master, loadAudio(storage).music], [1, 0], 'values are clamped');
  a.dispose();
});

test('audio: every age has at least two original cues, and the special themes exist', () => {
  for (let era = 1; era <= 5; era++) {
    const list = cuesForEra(era);
    assert.ok(list.length >= 2, `era ${era} has ${list.length} cues`);
    assert.ok(list.some((c) => c.mood === 'day') && list.some((c) => c.mood === 'night'), `era ${era} has day and night music`);
  }
  for (const kind of ['menu', 'festival', 'winter', 'newyear', 'war', 'achievement', 'disaster']) assert.ok(specialCue(kind), `${kind} theme`);
  assert.equal(new Set(CUES.map((c) => c.id)).size, CUES.length);
});

test('audio: every cue renders real notes with every instrument, and melodies are composed deterministically', () => {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  for (const cue of CUES) {
    let notes = 0;
    for (let bar = 0; bar < cue.prog.length; bar++) notes += renderBar(ctx, out, cue, bar, bar * 2, 60 / cue.bpm);
    assert.ok(notes > cue.prog.length, `${cue.id} scheduled ${notes} notes`);
    for (const part of cue.parts.filter((p) => p.role === 'melody')) assert.deepEqual(composeMelody(cue, part), composeMelody(cue, part));
  }
  for (const [name, voice] of Object.entries(VOICES)) { const n = ctx.started; voice(ctx, out, 1, 220, 0.5, 0.5); assert.ok(ctx.started > n, `${name} starts sources`); }
  for (const k of SFX_KINDS) { const n = ctx.started; SFX[k](ctx, out, 1); assert.ok(ctx.started > n, `${k} effect makes a sound`); }
});

test('audio: the music follows the age, the hour, war, festivals, New Year, disasters and the kingdom on screen', () => {
  assert.equal(chooseCue({ menu: true }).id, 'title');
  for (let era = 1; era <= 5; era++) {
    assert.equal(CUES.find((c) => c.id === chooseCue({ era, hour: 12 }).id).era, era);
    assert.equal(CUES.find((c) => c.id === chooseCue({ era, hour: 23 }).id).mood, 'night');
  }
  assert.equal(chooseCue({ era: 3, hour: 12, war: true }).id, 'banners-of-war');
  assert.equal(chooseCue({ era: 3, hour: 12, festival: true }).id, 'festival-jig');
  assert.equal(chooseCue({ era: 3, hour: 12, holiday: 'newyear' }).id, 'new-year');
  assert.equal(chooseCue({ era: 3, hour: 12, disaster: true, war: true }).id, 'embers', 'disaster outranks war');
  assert.equal(chooseCue({ era: 2, hour: 23, winter: true }).id, 'winter-lights');
  assert.equal(chooseCue({ era: 2, hour: 12, kingdom: 'ironhold' }).transpose, KINGDOM_TRANSPOSE.ironhold);
  assert.ok(chooseCue({ era: 1, hour: 12, war: true }).urgent);
});

test('audio: cues crossfade instead of cutting, calm cues do not flap, and urgent ones switch at once', () => {
  const ctx = new FakeAudioContext();
  ctx.state = 'running';
  const bus = ctx.createGain();
  const d = new MusicDirector(ctx, bus);
  d.update({ era: 1, hour: 10 });
  const first = d.current;
  assert.equal(first.id, 'hearthsong');
  for (let i = 0; i < 20; i++) { ctx.currentTime += 0.1; d.tick(); }
  assert.ok(d.notes > 0, 'bars are scheduled ahead');
  d.update({ era: 1, hour: 10 });
  assert.equal(d.switches, 1, 'the same moment does not restart the music (no duplicate playback)');
  ctx.currentTime += 1;
  d.update({ era: 1, hour: 23 });
  assert.equal(d.current.id, 'hearthsong', 'a calm change waits for the cue to play a while');
  ctx.currentTime += 30;
  d.update({ era: 1, hour: 23 });
  assert.equal(d.current.id, 'moonlit-commons');
  const fadeOut = first.gain.gain.events.at(-1);
  assert.equal(fadeOut[0], 'linear');
  assert.ok(fadeOut[1] < 0.01 && fadeOut[2] - ctx.currentTime >= 3, 'the old cue fades over seconds');
  assert.equal(d.current.gain.gain.events.at(-1)[0], 'linear', 'the new cue fades in');
  ctx.currentTime += 1;
  d.update({ era: 1, hour: 23, war: true });
  assert.equal(d.current.id, 'banners-of-war', 'war changes the music at once');
  ctx.currentTime += 10;
  d.tick();
  assert.ok(d.fading.length <= 1, 'faded cues are released');
});

test('audio: effects respect cooldowns and a voice limit, and fade with distance and zoom', () => {
  const pool = new VoicePool({ max: 3, cooldowns: COOLDOWNS });
  assert.equal(pool.claim('hammer', 0), true);
  assert.equal(pool.claim('hammer', 0.1), false, 'cooldown');
  assert.equal(pool.claim('hammer', 0.5), true);
  assert.equal(pool.claim('coins', 0.5), true);
  assert.equal(pool.claim('bird', 0.6), false, 'only three at once');
  assert.equal(pool.claim('bird', 3), true, 'voices free up');
  const listener = { x: 0, z: 0, zoom: 30, yaw: 0 };
  const near = placeSound(listener, 3, 0), far = placeSound(listener, 30, 0), outside = placeSound(listener, 80, 0);
  assert.ok(near.gain > far.gain && far.gain > outside.gain && outside.gain === 0);
  assert.ok(placeSound({ ...listener, zoom: 150 }, 3, 0).gain < near.gain, 'zoomed out, details fade into the general ambience');
  assert.ok(near.pan > 0, 'a sound to the right pans right');
});

test('audio: the ambience is the sound of the surroundings and their age', () => {
  const base = { hour: 12, season: 1, weather: 'clear', zoom: 40 };
  const village = ambienceMix({ ...base, era: 1, shops: 3, homes: 6, smithy: 1, forest: 0.5, sites: 1 });
  const city = ambienceMix({ ...base, era: 4, shops: 4, homes: 10, towers: 4, vehicles: 5 });
  const future = ambienceMix({ ...base, era: 5, shops: 3, homes: 10, towers: 4 });
  assert.equal(village.beds.traffic, 0);
  assert.ok(village.events.anvil > 0 && village.events.horse > 0 && village.events.hammer > 0);
  assert.ok(city.beds.traffic > 0.3 && city.events.car > 0 && city.events.horse === 0);
  assert.ok(future.beds.shimmer > 0 && future.events.pod > 0 && future.beds.traffic < city.beds.traffic, 'the future is quieter');
  assert.ok(ambienceMix({ ...base, era: 2, weather: 'rain' }).beds.rain > 0.3);
  assert.ok(ambienceMix({ ...base, era: 2, weather: 'snow', season: 3 }).beds.snowwind > 0.3);
  const night = ambienceMix({ ...base, era: 1, hour: 23, forest: 1 });
  assert.equal(night.events.bird, 0);
  assert.ok(night.events.owl > 0);
});

test('audio: hidden tabs suspend sound and it never restarts by itself; the next tap resumes it', () => {
  const listeners = {};
  globalThis.document = { hidden: false, addEventListener: (k, fn) => { listeners[k] = fn; } };
  globalThis.window = { addEventListener: (k, fn) => { (listeners['w:' + k] ??= []).push(fn); }, removeEventListener: (k, fn) => { listeners['w:' + k] = (listeners['w:' + k] ?? []).filter((f) => f !== fn); } };
  try {
    let asked = 0;
    const a = new AudioManager({ storage: memoryStorage(), AudioContextClass: FakeAudioContext, onNeedsGesture: () => asked++ });
    a.enable();
    assert.equal(a.ctx.state, 'running');
    document.hidden = true;
    listeners.visibilitychange();
    assert.equal(a.ctx.state, 'suspended', 'suspended while hidden');
    assert.equal(a.timer, null, 'the scheduler stops');
    document.hidden = false;
    listeners.visibilitychange();
    assert.equal(a.ctx.state, 'suspended', 'returning does not autoplay');
    assert.equal(asked, 1, 'the player is told a tap will resume sound');
    for (const fn of listeners['w:pointerdown']) fn();
    assert.equal(a.ctx.state, 'running', 'the next tap resumes');
    a.dispose();
  } finally { delete globalThis.document; delete globalThis.window; }
});

test('audio: the mixer measures what is playing (used by the audio test panel)', () => {
  const ctx = new FakeAudioContext();
  const m = new AudioMixer(ctx, { ...DEFAULT_AUDIO, enabled: true });
  assert.ok(m.level() > 0);
  m.dispose();
});
