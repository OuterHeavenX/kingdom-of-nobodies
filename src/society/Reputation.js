// Public reputation per citizen on five dimensions (0-100). Systems nudge these
// when real events happen; perception adds each observer's beliefs on top.
import { peekRel } from '../citizens/Relationships.js';

const clamp = (v) => Math.max(0, Math.min(100, v));

export function bump(c, dimension, delta) {
  c.reputation[dimension] = clamp(Math.round((c.reputation[dimension] + delta) * 10) / 10);
}

/** Daily: social standing follows how the rest of the village regards this person. */
export function recomputeStanding(state) {
  const all = state.citizens;
  for (const c of all) {
    // Everyone else, in population order (counted rather than copied: this runs for every pair, every day).
    let others = 0;
    for (const o of all) if (o.id !== c.id) others++;
    if (!others) continue;
    let sum = 0, best = 0;
    for (const o of all) {
      if (o.id === c.id) continue;
      const r = peekRel(state, o.id, c.id);
      sum += r ? r.respect * 0.5 + r.friendship * 0.35 + r.trust * 0.15 - r.rivalry * 0.3 : 30;
      const mine = peekRel(state, c.id, o.id);
      if (mine && mine.friendship > best) best = mine.friendship;
    }
    c.social = { bestFriendship: best };
    const target = clamp(sum / others + (c.reputation.generosity - 50) * 0.3);
    c.reputation.standing = clamp(Math.round((c.reputation.standing * 0.8 + target * 0.2) * 10) / 10);
  }
}

const indexes = new WeakMap();
/** Rumour lookup by id, rebuilt only when the rumour list changes. */
export function rumorIndex(state) {
  let entry = indexes.get(state);
  if (!entry || entry.list !== state.rumors || entry.length !== state.rumors.length) {
    entry = { list: state.rumors, length: state.rumors.length, map: new Map(state.rumors.map((r) => [r.id, r])) };
    indexes.set(state, entry);
  }
  return entry.map;
}

/** How honest `observer` believes `subject` to be, including rumours they've heard. */
export function perceivedHonesty(state, observer, subject) {
  let h = subject.reputation.honesty;
  const index = rumorIndex(state);
  for (const [rumorId, belief] of Object.entries(observer.beliefs)) {
    const rumor = index.get(rumorId);
    if (!rumor || rumor.subjectId !== subject.id) continue;
    if (rumor.kind === 'cheat') h -= 28 * belief.confidence;
    if (rumor.kind === 'gift') h += 6 * belief.confidence;
  }
  return clamp(h);
}
