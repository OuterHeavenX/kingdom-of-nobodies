import { CHRONICLE } from '../core/Config.js';

// The Chronicle is the permanent history of the kingdom. Systems call record()
// at the moment they change state, so every entry mirrors a real event.
export const CATEGORIES = ['citizen', 'business', 'property', 'economy', 'relationships', 'construction', 'council', 'region', 'trade', 'diplomacy', 'law', 'culture'];

/**
 * @param {object} refs - stable entity references { citizens:[ids], business, plot }
 * @param {number} importance - 1 (minor) to 3 (milestone); low entries are pruned first
 */
export function record(state, category, text, refs = {}, importance = 1) {
  const entry = {
    id: ++state.nextId.chronicle,
    day: state.day,
    minute: state.minute,
    category,
    text,
    refs: { citizens: refs.citizens ?? [], business: refs.business ?? null, plot: refs.plot ?? null },
    importance,
  };
  state.chronicle.push(entry);
  if (state.chronicle.length > CHRONICLE.max) prune(state);
  state.events?.push({ type: 'chronicle', entry });
  return entry;
}

function prune(state) {
  // Drop the oldest entries in tiers: minor ones first, then routine news,
  // keeping births, deaths, law and diplomacy longer, and milestones longest.
  let excess = state.chronicle.length - CHRONICLE.max + 40;
  const lasting = new Set(['citizen', 'law', 'diplomacy']);
  const tiers = [(e) => e.importance < 2, (e) => e.importance === 2 && !lasting.has(e.category), (e) => e.importance < 3];
  for (const drop of tiers) {
    if (excess <= 0) break;
    state.chronicle = state.chronicle.filter((e) => {
      if (excess > 0 && drop(e)) { excess--; return false; }
      return true;
    });
  }
  if (state.chronicle.length > CHRONICLE.max) state.chronicle.splice(0, state.chronicle.length - CHRONICLE.max);
}

export function filterChronicle(state, { category = null, citizen = null, business = null, plot = null } = {}) {
  return state.chronicle.filter((e) =>
    (!category || e.category === category) &&
    (!citizen || e.refs.citizens.includes(citizen)) &&
    (!business || e.refs.business === business) &&
    (!plot || e.refs.plot === plot));
}
