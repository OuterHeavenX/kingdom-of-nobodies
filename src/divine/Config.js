// v0.5.3 — The Hidden Hand. Tunables and fixed data for the player's unseen
// influence, the Mysterious Stone and what villagers make of them.
//
// The defining rule: the player creates possibilities; the citizens create
// the religion, the scepticism, the institutions and the history. Nothing in
// these modules decides what anyone believes. Divine actions change bounded
// simulation numbers; villagers notice outcomes, never causes, and explain
// them with their own worldview.

export const DIVINE = {
  unlockYear: 200,
  // Whispers regenerate with time alone: never from worship, prayer, conversion or believers.
  whispers: { start: 4, max: 12, perDay: 0.25 },
  kept: { prayers: 80, hidden: 400, omens: 30, missions: 30, sites: 12 },
  stone: { halfSize: 0.7, noticeRadius: 7, bounds: 84, roadPad: 1, plotPad: 1.2 },
  // How many seasons a prayer waits for its outcome before it is judged.
  prayerWindowDays: 9,
};

/** The five inscriptions the player may carve. Citizens never receive the English. */
export const INSCRIPTIONS = {
  watcher: { title: 'The Watcher', text: 'Before the first stone was laid, something waited.', seed: 11 },
  question: { title: 'The Question', text: 'Who remembers the beginning when all witnesses are gone?', seed: 23 },
  light: { title: 'The Light', text: 'The unseen is not always absent.', seed: 37 },
  silence: { title: 'The Silence', text: 'Some answers arrive without a voice.', seed: 41 },
  glyphs: { title: 'Only Symbols', text: null, seed: 53 },
};
export const INSCRIPTION_IDS = Object.keys(INSCRIPTIONS);

/**
 * An original, fictional script (it imitates no real alphabet or sacred text).
 * Each glyph is a set of strokes in a unit cell, x right and y down, used both
 * for the panel's drawings and for the carving on the 3D monument.
 */
export const GLYPHS = [
  [[0.5, 0.05, 0.5, 0.95], [0.2, 0.35, 0.8, 0.35], [0.2, 0.7, 0.5, 0.95]],
  [[0.15, 0.15, 0.85, 0.15], [0.85, 0.15, 0.5, 0.9], [0.5, 0.9, 0.15, 0.15]],
  [[0.2, 0.1, 0.2, 0.9], [0.2, 0.5, 0.8, 0.2], [0.2, 0.5, 0.8, 0.8]],
  [[0.1, 0.5, 0.5, 0.1], [0.5, 0.1, 0.9, 0.5], [0.9, 0.5, 0.5, 0.9], [0.5, 0.9, 0.1, 0.5], [0.5, 0.4, 0.5, 0.6]],
  [[0.3, 0.1, 0.3, 0.9], [0.7, 0.1, 0.7, 0.9], [0.3, 0.5, 0.7, 0.5]],
  [[0.15, 0.85, 0.5, 0.15], [0.5, 0.15, 0.85, 0.85], [0.3, 0.6, 0.7, 0.6], [0.5, 0.6, 0.5, 0.95]],
  [[0.2, 0.2, 0.8, 0.2], [0.2, 0.2, 0.2, 0.8], [0.2, 0.8, 0.8, 0.8], [0.55, 0.45, 0.8, 0.45]],
  [[0.5, 0.1, 0.15, 0.5], [0.15, 0.5, 0.5, 0.9], [0.5, 0.1, 0.85, 0.5], [0.5, 0.5, 0.5, 0.5]],
  [[0.1, 0.3, 0.9, 0.3], [0.1, 0.7, 0.9, 0.7], [0.35, 0.1, 0.35, 0.9]],
  [[0.5, 0.05, 0.5, 0.45], [0.15, 0.45, 0.85, 0.45], [0.15, 0.45, 0.15, 0.9], [0.85, 0.45, 0.85, 0.9]],
  [[0.2, 0.15, 0.8, 0.85], [0.8, 0.15, 0.2, 0.85], [0.5, 0.05, 0.5, 0.25]],
  [[0.5, 0.1, 0.5, 0.9], [0.5, 0.3, 0.85, 0.15], [0.5, 0.55, 0.15, 0.4], [0.5, 0.8, 0.85, 0.65]],
];

/** The glyph sequence carved for an inscription: deterministic, five lines of four. */
export function glyphsFor(inscription) {
  const seed = INSCRIPTIONS[inscription]?.seed ?? 7;
  const out = [];
  let h = seed * 2654435761 >>> 0;
  for (let i = 0; i < 20; i++) { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; out.push(h % GLYPHS.length); }
  return out;
}

/**
 * What a villager may conclude about the stone. These are the citizens'
 * explanations; the game never tells them which (if any) is true.
 */
export const INTERPRETATIONS = {
  divine: { label: 'Left by an unseen god', short: 'Divine', icon: '✦', color: '#e8c25a' },
  cosmic: { label: 'Left by beings from beyond the sky', short: 'From beyond', icon: '✧', color: '#8fb6ff' },
  ancient: { label: 'Carved by a forgotten people', short: 'Ancient people', icon: '⌂', color: '#c99a6b' },
  prank: { label: 'An elaborate hoax', short: 'A hoax', icon: '☍', color: '#c96b6b' },
  natural: { label: 'Ordinary, or too little evidence to say', short: 'Undecided', icon: '?', color: '#9aa6ad' },
  indifferent: { label: 'Not worth thinking about', short: 'Indifferent', icon: '·', color: '#6f7a72' },
};
export const INTERPRETATION_IDS = Object.keys(INTERPRETATIONS);

/** Ways of meeting the world for those who keep no tradition (see FaithManager for the traditions). */
export const OUTLOOKS = {
  reason: { label: 'The Path of Reason', theme: 'evidence, inquiry and human responsibility' },
  agnostic: { label: 'Agnostic', theme: 'uncertain whether gods or unseen forces exist' },
  atheist: { label: 'Atheist', theme: 'holds no belief in gods' },
  personal: { label: 'Personal spirituality', theme: 'a private faith, outside any institution' },
};

/** Roles that convictions may lead a villager to take up. Never assigned by the player. */
export const ROLES = {
  preacher: 'Preacher', missionary: 'Missionary', scholar: 'Scholar of the stone', philosopher: 'Travelling philosopher',
  pilgrim: 'Pilgrim', teacher: 'Teacher of beliefs', storyteller: 'Mystic storyteller',
};

/** Voluntary societies (non-church movements). Each has real members, a purse and a history. */
export const SOCIETIES = {
  inquiry: { name: 'Rational Inquiry Society', icon: '⚖', color: '#7fa7c9', theme: 'studying the stone by evidence and method' },
  seekers: { name: 'The Seekers Beyond', icon: '✧', color: '#8fb6ff', theme: 'searching the skies for whoever left the stone' },
  ancestral: { name: 'The Ancestral Circle', icon: '⌂', color: '#d98c5f', theme: 'reading the stone through the old family memory' },
};

/** Improvements to the stone's surroundings, paid for by whoever builds them. */
export const SITE_WORKS = {
  offerings: { label: 'Offerings and flowers', cost: 0, minAge: 1, afterYears: 0 },
  fence: { label: 'A protective fence', cost: 30, minAge: 1, afterYears: 2 },
  lanterns: { label: 'Lanterns', cost: 18, minAge: 1, afterYears: 1 },
  plinth: { label: 'A stone plinth and plaque', cost: 60, minAge: 2, afterYears: 5 },
  pavilion: { label: 'A glass pavilion', cost: 160, minAge: 3, afterYears: 15 },
  observatory: { label: 'A small observatory', cost: 140, minAge: 3, afterYears: 10 },
  museum: { label: 'A museum', cost: 320, minAge: 4, afterYears: 40 },
  garden: { label: 'A garden of contemplation', cost: 120, minAge: 5, afterYears: 20 },
};
