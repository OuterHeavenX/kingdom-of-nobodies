// Deterministic seeded RNG (mulberry32). The generator state lives in the game
// state (`state.rng`) so a saved world continues the same random sequence.

export function nextRandom(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const chance = (state, p) => nextRandom(state) < p;
export const range = (state, a, b) => a + nextRandom(state) * (b - a);
export const intRange = (state, a, b) => Math.floor(range(state, a, b + 1));
export const pick = (state, list) => list[Math.floor(nextRandom(state) * list.length)];

// Stable 0..1 value derived from two ids, used for personality "chemistry".
export function pairHash(a, b) {
  const s = a < b ? a + '|' + b : b + '|' + a;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
