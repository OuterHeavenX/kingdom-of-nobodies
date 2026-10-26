// Sound settings live on this device (localStorage), apart from the kingdom's
// save: a reloaded or imported world never changes how loud the game is.

export const AUDIO_KEY = 'kingdom-of-nobodies-audio';

export const DEFAULT_AUDIO = {
  enabled: false, // sound starts only after the player turns it on (browsers require a tap)
  master: 0.8,
  music: 0.55,
  ambience: 0.7,
  sfx: 0.75,
  ui: 0.5,
  muteMusic: false,
  muteAmbience: false,
  muteSfx: false,
  muteUi: false,
  shuffle: false, // pick the age's cues in random order instead of by time of day
  reduced: false, // fewer, quieter one-off sounds; ambience and music only
};

const clamp01 = (v, d) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

export function normalizeAudio(raw = {}) {
  const out = { ...DEFAULT_AUDIO };
  for (const k of ['master', 'music', 'ambience', 'sfx', 'ui']) out[k] = clamp01(Number(raw[k]), DEFAULT_AUDIO[k]);
  for (const k of ['enabled', 'muteMusic', 'muteAmbience', 'muteSfx', 'muteUi', 'shuffle', 'reduced']) out[k] = typeof raw[k] === 'boolean' ? raw[k] : DEFAULT_AUDIO[k];
  return out;
}

export function loadAudio(storage = globalThis.localStorage) {
  try { return normalizeAudio(JSON.parse(storage?.getItem(AUDIO_KEY) ?? '{}') ?? {}); } catch { return { ...DEFAULT_AUDIO }; }
}

export function saveAudio(settings, storage = globalThis.localStorage) {
  try { storage?.setItem(AUDIO_KEY, JSON.stringify(normalizeAudio(settings))); return true; } catch { return false; }
}

/** The effective gain of a bus (0 when muted or sound is off). */
export function busGain(settings, bus) {
  if (!settings.enabled) return 0;
  const mute = { music: settings.muteMusic, ambience: settings.muteAmbience, sfx: settings.muteSfx, ui: settings.muteUi }[bus];
  if (mute) return 0;
  const reduce = settings.reduced && (bus === 'sfx' || bus === 'ui') ? 0.5 : 1;
  return settings[bus] * reduce;
}
