// Public reputation per citizen on five dimensions (0-100). Systems nudge these
// when real events happen; perception adds each observer's beliefs on top.
import { peekRel } from '../citizens/Relationships.js';

const clamp = (v) => Math.max(0, Math.min(100, v));

export function bump(c, dimension, delta) {
  c.reputation[dimension] = clamp(Math.round((c.reputation[dimension] + delta) * 10) / 10);
}

/** Daily: social standing follows how the rest of the village regards this person. */
export function recomputeStanding(state) {
  for (const c of state.citizens) {
    const others = state.citizens.filter((o) => o.id !== c.id);
    if (!others.length) continue;
    let sum = 0;
    for (const o of others) {
      const r = peekRel(state, o.id, c.id);
      sum += r ? r.respect * 0.5 + r.friendship * 0.35 + r.trust * 0.15 - r.rivalry * 0.3 : 30;
    }
    const target = clamp(sum / others.length + (c.reputation.generosity - 50) * 0.3);
    c.reputation.standing = clamp(Math.round((c.reputation.standing * 0.8 + target * 0.2) * 10) / 10);
  }
}

/** How honest `observer` believes `subject` to be, including rumours they've heard. */
export function perceivedHonesty(state, observer, subject) {
  let h = subject.reputation.honesty;
  for (const [rumorId, belief] of Object.entries(observer.beliefs)) {
    const rumor = state.rumors.find((r) => r.id === rumorId);
    if (!rumor || rumor.subjectId !== subject.id) continue;
    if (rumor.kind === 'cheat') h -= 28 * belief.confidence;
    if (rumor.kind === 'gift') h += 6 * belief.confidence;
  }
  return clamp(h);
}
