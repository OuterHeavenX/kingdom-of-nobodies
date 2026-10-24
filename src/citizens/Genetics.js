import { nextRandom } from '../core/Random.js';
import { TRAITS } from '../ai/Personality.js';

// Inherited tendencies. A child's temperament starts as a blend of both
// parents plus individual variation; upbringing and experience shape it later
// (see Education). Appearance inherits hair colour, skin tone and build.
// Nothing here affects intelligence, worth or class.

const OPPOSITES = [['honest', 'dishonest'], ['friendly', 'shy'], ['hardworking', 'lazy'], ['generous', 'greedy'], ['frugal', 'riskTaking']];
const HAIR = ['short', 'long', 'bun', 'curly', 'braid'];
const COLORS = ['#d98c5f', '#8fb3d9', '#c49bd6', '#e0c46c', '#7fcdb0', '#e58f9e', '#9fd07a', '#d6a15f', '#88a4e0', '#f0a2a2', '#a3d4e8'];

export function inheritTraits(state, a, b) {
  const rand = () => nextRandom(state);
  const out = {};
  for (const t of TRAITS) {
    const pa = a?.traits?.[t] ?? 0, pb = b?.traits?.[t] ?? 0;
    const blended = (pa + pb) / 2 * 0.65 + (rand() - 0.35) * 0.45;
    if (blended > 0.32) out[t] = Math.round(Math.min(0.95, blended) * 100) / 100;
  }
  // A temperament all of the child's own.
  if (rand() < 0.5 || Object.keys(out).length < 2) {
    const t = TRAITS[Math.floor(rand() * TRAITS.length)];
    out[t] = Math.round((0.4 + rand() * 0.45) * 100) / 100;
  }
  for (const [x, y] of OPPOSITES) if (out[x] && out[y]) delete out[out[x] >= out[y] ? y : x];
  const top = Object.entries(out).sort((p, q) => q[1] - p[1]).slice(0, 4);
  return Object.fromEntries(top);
}

function blendHex(h1, h2, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(h1), p(h2)];
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function inheritAppearance(state, a, b) {
  const rand = () => nextRandom(state);
  const pa = a?.appearance ?? {}, pb = b?.appearance ?? pa;
  return {
    hair: HAIR[Math.floor(rand() * HAIR.length)],
    hairColor: rand() < 0.5 ? pa.hairColor ?? '#5a3b26' : pb.hairColor ?? '#5a3b26',
    skin: blendHex(pa.skin ?? '#f2cfab', pb.skin ?? '#f2cfab', rand()),
    height: Math.round(((pa.height ?? 1) + (pb.height ?? 1)) / 2 * (0.94 + rand() * 0.12) * 100) / 100,
  };
}

export const randomTunic = (state) => COLORS[Math.floor(nextRandom(state) * COLORS.length)];

/** How much someone wants to raise children (0-1), partly temperament, partly individual. */
export function familyWish(state, c) {
  const t = c.traits;
  return Math.max(0.05, Math.min(1, 0.35 + (t.friendly ?? 0) * 0.25 + (t.generous ?? 0) * 0.2 + (t.loyal ?? 0) * 0.2 - (t.ambitious ?? 0) * 0.1 + (nextRandom(state) - 0.5) * 0.4));
}
