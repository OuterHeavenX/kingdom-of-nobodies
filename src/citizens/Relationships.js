import { SOCIAL } from '../core/Config.js';
import { pairHash } from '../core/Random.js';
import { trait } from '../ai/Personality.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';

// Relationships are directional: how `a` feels about `b`. Stored as
// state.relationships['a|b'] = { friendship, trust, affection, rivalry, respect }.
const DIMENSIONS = ['friendship', 'trust', 'affection', 'rivalry', 'respect'];
const clamp = (v) => Math.max(0, Math.min(100, v));

export function rel(state, a, b) {
  const key = a + '|' + b;
  let r = state.relationships[key];
  if (!r) r = state.relationships[key] = { friendship: 20, trust: 45, affection: 10, rivalry: 0, respect: 35 };
  return r;
}

export function peekRel(state, a, b) {
  return state.relationships[a + '|' + b] ?? null;
}

export function adjust(state, a, b, changes) {
  const r = rel(state, a, b);
  for (const [k, v] of Object.entries(changes)) if (DIMENSIONS.includes(k)) r[k] = clamp(Math.round((r[k] + v) * 10) / 10);
  return r;
}

export function adjustBoth(state, a, b, changes) {
  adjust(state, a, b, changes);
  adjust(state, b, a, changes);
}

export function closestRelations(state, id, n = 4) {
  const out = [];
  for (const [key, r] of Object.entries(state.relationships)) {
    const [from, to] = key.split('|');
    if (from !== id) continue;
    out.push({ id: to, ...r, score: r.friendship + r.affection * 0.6 + Math.abs(r.rivalry) * 0.7 });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, n);
}

export function describeRelation(r) {
  if (!r) return 'Strangers';
  if (r.rivalry > 50) return 'Rival';
  if (r.affection > 70) return 'Smitten';
  if (r.friendship > 70) return 'Close friend';
  if (r.friendship > 45) return 'Friend';
  if (r.trust < 25) return 'Distrusted';
  return 'Acquaintance';
}

/** Two citizens spend social time together. Handles friendship, affection and romance. */
export function socialize(state, a, b, intensity = 1) {
  const chemistry = pairHash(a.id, b.id);
  const warmth = (0.6 + trait(a, 'friendly') * 0.5 - trait(a, 'shy') * 0.3) * intensity;
  adjust(state, a.id, b.id, { friendship: SOCIAL.friendGain * warmth, trust: 1.2 * intensity, rivalry: -1 });
  adjust(state, b.id, a.id, { friendship: SOCIAL.friendGain * 0.8 * intensity, trust: 1 * intensity, rivalry: -1 });
  const ab = rel(state, a.id, b.id), ba = rel(state, b.id, a.id);
  if (ab.friendship > 70 && !ab.closeFriend && !ba.closeFriend) {
    ab.closeFriend = ba.closeFriend = true;
    record(state, 'relationships', `${a.firstName} and ${b.firstName} have become close friends.`, { citizens: [a.id, b.id] }, 2);
    remember(state, a, `Became close friends with ${b.firstName}.`, 2, 'social');
    remember(state, b, `Became close friends with ${a.firstName}.`, 2, 'social');
  }
  // Attraction grows only with good chemistry and established friendship.
  if (chemistry > 0.45 && ab.friendship > 45 && canRomance(a, b)) {
    const gain = (chemistry - 0.35) * 9 * intensity;
    adjust(state, a.id, b.id, { affection: gain });
    adjust(state, b.id, a.id, { affection: gain * 0.9 });
  }
  updateRomance(state, a, b, ab, ba);
}

function canRomance(a, b) {
  return a.romance.partnerId === null && b.romance.partnerId === null && Math.abs(a.age - b.age) <= 16 &&
    (a.romance.courtingId === null || a.romance.courtingId === b.id) &&
    (b.romance.courtingId === null || b.romance.courtingId === a.id);
}

function updateRomance(state, a, b, ab, ba) {
  const together = a.romance.courtingId === b.id;
  if (!together && canRomance(a, b) && ab.affection > SOCIAL.courtAffection && ba.affection > SOCIAL.courtAffection) {
    a.romance.courtingId = b.id; b.romance.courtingId = a.id;
    a.romance.since = b.romance.since = state.day;
    record(state, 'relationships', `${a.firstName} and ${b.firstName} have started courting.`, { citizens: [a.id, b.id] }, 2);
    remember(state, a, `Started courting ${b.firstName}.`, 3, 'romance');
    remember(state, b, `Started courting ${a.firstName}.`, 3, 'romance');
    state.events.push({ type: 'rumor', kind: 'courting', subject: a.id, other: b.id });
  } else if (together && state.day - a.romance.since >= SOCIAL.partnerDays &&
    ab.affection > SOCIAL.partnerAffection && ba.affection > SOCIAL.partnerAffection) {
    a.romance.partnerId = b.id; b.romance.partnerId = a.id;
    a.romance.courtingId = b.romance.courtingId = null;
    a.family.partnerId = b.id; b.family.partnerId = a.id;
    record(state, 'relationships', `${a.firstName} and ${b.firstName} are now partners.`, { citizens: [a.id, b.id] }, 3);
    remember(state, a, `Became partners with ${b.firstName}.`, 3, 'romance');
    remember(state, b, `Became partners with ${a.firstName}.`, 3, 'romance');
  }
}

/** Called daily: relationships under strain may end. */
export function checkBreakups(state) {
  for (const a of state.citizens) {
    const otherId = a.romance.partnerId ?? a.romance.courtingId;
    if (!otherId || a.id > otherId) continue;
    const b = state.citizens.find((c) => c.id === otherId);
    if (!b) continue;
    const ab = rel(state, a.id, b.id), ba = rel(state, b.id, a.id);
    if (ab.trust < SOCIAL.breakupTrust || ba.trust < SOCIAL.breakupTrust || ab.rivalry > 55 || ba.rivalry > 55 || ab.affection < 30) {
      const wasPartner = a.romance.partnerId === b.id;
      for (const [x, y] of [[a, b], [b, a]]) {
        x.romance.partnerId = null; x.romance.courtingId = null; x.family.partnerId = null;
        x.romance.history.push({ with: y.id, endedDay: state.day });
        x.mood = Math.max(0, x.mood - 15);
        adjust(state, x.id, y.id, { affection: -25 });
        remember(state, x, `Broke up with ${y.firstName}.`, 3, 'romance');
      }
      record(state, 'relationships', `${a.firstName} and ${b.firstName} have ${wasPartner ? 'separated' : 'stopped courting'}.`, { citizens: [a.id, b.id] }, 2);
      state.events.push({ type: 'rumor', kind: 'breakup', subject: a.id, other: b.id });
    }
  }
}
