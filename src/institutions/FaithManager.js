import { LIFE, DAYS_PER_YEAR } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { peekRel } from '../citizens/Relationships.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { pairHash } from '../core/Random.js';
import { isNewYear } from '../core/Calendar.js';

// Belief. The village's faith traditions are its own: five old ways of
// meeting the world that grew up in these valleys. A person may be devout,
// casually affiliated, sceptical or hold to none at all. Belief shapes where
// people gather, what they celebrate and whom they turn to in grief; it never
// decides anyone's honesty, intelligence, temper or worth, and nothing in the
// simulation reads it that way.

export const TRADITIONS = {
  furrow: { name: 'The Old Furrow', theme: 'nature and the harvest', season: 2, rite: 'the Sheaf Blessing', color: '#9cbf5a', community: 'Fellowship of the Furrow', interests: { works: 0.1 } },
  hearthkin: { name: 'The Hearthkin', theme: 'ancestors and family memory', season: 3, rite: 'the Night of Names', color: '#d98c5f', community: 'Hearthkin Circle', interests: { welfare: 0.1 } },
  dawn: { name: 'The Dawnlight', theme: 'light and renewal', season: 0, rite: 'the First Light vigil', color: '#f2d38a', community: 'Dawnlight Assembly', interests: { trust: 0.1 } },
  openhand: { name: 'The Open Hand', theme: 'service and charity', season: 3, rite: 'the Winter Table', color: '#e58f9e', community: 'Brotherhood of the Open Hand', interests: { welfare: 0.25 } },
  lantern: { name: 'The Quiet Lantern', theme: 'scholarship and contemplation', season: 1, rite: 'the Long Reading', color: '#88a4e0', community: 'Order of the Quiet Lantern', interests: { education: 0.25 } },
};
export const TRADITION_IDS = Object.keys(TRADITIONS);
export const STANCES = { devout: 'Devout', casual: 'Casually affiliated', skeptical: 'Sceptical', none: 'Holds to no tradition' };

/** A newcomer's (or founder's) belief: leanings from temperament, chance from identity. */
function initialBelief(state, c) {
  const leaning = { furrow: trait(c, 'hardworking') + (c.profession === 'Farmer' ? 0.5 : 0), hearthkin: trait(c, 'loyal') + trait(c, 'stubborn') * 0.3, dawn: trait(c, 'creative') + trait(c, 'friendly') * 0.3, openhand: trait(c, 'generous'), lantern: trait(c, 'curious') };
  const h = (k) => pairHash(c.id, k);
  const tradition = [...TRADITION_IDS].sort((a, b) => (leaning[b] + h(b)) - (leaning[a] + h(a)))[0];
  const r = pairHash(c.id, 'belief');
  const stance = r < 0.28 ? 'devout' : r < 0.7 ? 'casual' : r < 0.86 ? 'skeptical' : 'none';
  return { tradition: stance === 'none' ? null : tradition, stance, devotion: stance === 'devout' ? 0.8 : stance === 'casual' ? 0.45 : stance === 'skeptical' ? 0.15 : 0, since: state.day };
}

/** Children grow up in a parent's tradition, with their own degree of devotion. */
function inheritedBelief(state, c) {
  const parents = c.family.parentIds.map((id) => byId(state.citizens, id) ?? state.archive[id]).filter((p) => p?.belief?.tradition);
  if (!parents.length) return initialBelief(state, c);
  const p = parents[Math.floor(pairHash(c.id, 'parent') * parents.length)];
  const devotion = Math.round(Math.max(0.1, Math.min(0.9, p.belief.devotion * 0.8 + (pairHash(c.id, 'dev') - 0.5) * 0.4)) * 100) / 100;
  return { tradition: p.belief.tradition, stance: devotion > 0.65 ? 'devout' : 'casual', devotion, since: state.day, raised: true };
}

export function beliefOf(state, c) {
  if (!c.belief) c.belief = ageOf(state, c) < LIFE.adultAge ? inheritedBelief(state, c) : initialBelief(state, c);
  return c.belief;
}

export const isAdherent = (c, tradition) => c.belief?.tradition === tradition && (c.belief.stance === 'devout' || c.belief.stance === 'casual');

/**
 * Yearly: faith is personal and changes slowly. Some grow more or less devout,
 * a few take up a close friend's tradition, and those who come of age decide
 * for themselves. Nobody is pressed.
 */
export function evolveBeliefs(state) {
  if (!isNewYear(state.day)) return;
  for (const c of state.citizens) {
    const b = beliefOf(state, c);
    const age = ageOf(state, c);
    const r = pairHash(c.id, 'y' + state.day);
    if (age === LIFE.adultAge && b.raised) {
      delete b.raised;
      if (r < 0.15) { b.stance = 'skeptical'; b.devotion = 0.15; remember(state, c, `Came of age doubting ${TRADITIONS[b.tradition].name}.`, 1, 'life'); }
      continue;
    }
    if (age < LIFE.adultAge) continue;
    // A close friend of another tradition may draw a seeker in.
    const friend = state.citizens.find((o) => o !== c && o.belief?.stance === 'devout' && o.belief.tradition !== b.tradition && (peekRel(state, c.id, o.id)?.friendship ?? 0) > 70);
    if (friend && (b.stance !== 'devout') && r < 0.06 + trait(c, 'curious') * 0.06) {
      const was = b.tradition;
      Object.assign(b, { tradition: friend.belief.tradition, stance: 'casual', devotion: 0.45, since: state.day });
      remember(state, c, `Joined ${TRADITIONS[b.tradition].name} through my friend ${friend.firstName}${was ? `, leaving ${TRADITIONS[was].name}` : ''}.`, 2, 'life');
      continue;
    }
    // Devotion drifts with circumstance: grief and community deepen it, comfort and time may cool it.
    const grief = c.memories.some((m) => m.kind === 'loss' && state.day - m.day < DAYS_PER_YEAR);
    const drift = (grief ? 0.06 : 0) + (c.belief.helpedDay && state.day - c.belief.helpedDay < DAYS_PER_YEAR ? 0.05 : 0) - (r < 0.3 ? 0.04 : 0) + (r > 0.85 ? 0.04 : 0);
    b.devotion = Math.round(Math.max(0, Math.min(1, b.devotion + drift)) * 100) / 100;
    if (b.tradition) b.stance = b.devotion > 0.65 ? 'devout' : b.devotion > 0.25 ? 'casual' : 'skeptical';
    else if (b.devotion > 0.3) { Object.assign(b, initialBelief(state, c), { stance: 'casual', devotion: 0.35 }); }
  }
}

/** How faith colours what someone hopes for from government (Opinion.priorities). Small, by design. */
export function faithInterests(c) {
  if (!c.belief?.tradition || c.belief.stance === 'skeptical') return null;
  const w = c.belief.stance === 'devout' ? 1 : 0.5;
  return Object.fromEntries(Object.entries(TRADITIONS[c.belief.tradition].interests).map(([k, v]) => [k, v * w]));
}

export function affiliationCounts(state) {
  const out = Object.fromEntries([...TRADITION_IDS, 'none'].map((k) => [k, 0]));
  for (const c of state.citizens) { const b = beliefOf(state, c); if (b.tradition && b.stance !== 'skeptical') out[b.tradition]++; else out.none++; }
  return out;
}
