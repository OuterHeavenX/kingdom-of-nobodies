import { byId } from '../core/EntityRegistry.js';
import { bedsAt, plotById } from '../property/LandRegistry.js';
import { moveHome } from '../property/Construction.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE } from '../core/Config.js';

// Households and homes. A household is a person plus their spouse and the
// minors in their care. Families living in the communal hall move into a
// council cottage with enough beds when one is free.

export function householdOf(state, c) {
  const members = new Set([c]);
  const spouse = byId(state.citizens, c.family.spouseId);
  if (spouse) members.add(spouse);
  const ours = (x) => x === c || (spouse && x === spouse);
  for (const k of state.citizens) {
    if (ageOf(state, k) >= LIFE.adultAge) continue;
    // A minor belongs to the household caring for them: their guardian's, or,
    // with no living guardian on record, their only living parent's. A parent
    // without custody does not take the child with them.
    const g = k.family.guardianId;
    const guardian = g && g !== 'council' ? byId(state.citizens, g) : null;
    if (guardian ? ours(guardian) : g !== 'council' && parentInCharge(state, k, ours)) members.add(k);
  }
  return [...members];
}

/** With no living guardian on record: the only living parent, or else a parent the child lives with. */
function parentInCharge(state, k, ours) {
  const living = k.family.parentIds.map((id) => byId(state.citizens, id)).filter(Boolean);
  return living.length === 1 ? ours(living[0]) : living.some((p) => ours(p) && p.homePlotId && p.homePlotId === k.homePlotId);
}

export function rehouseFamilies(state) {
  const done = new Set();
  for (const c of state.citizens) {
    if (done.has(c.id) || ageOf(state, c) < LIFE.adultAge) continue;
    const home = plotById(state, c.homePlotId);
    const family = householdOf(state, c);
    const sharingWithStrangers = home?.building?.type === 'cottage' && home.ownerId === 'council' && home.residents.some((id) => !family.some((m) => m.id === id));
    if (home && home.building?.type !== 'hall' && home.building?.type !== 'townhall' && !sharingWithStrangers) continue;
    family.forEach((m) => done.add(m.id));
    if (family.length < 2) continue;
    const free = state.plots.find((p) => p !== home && p.building?.type === 'cottage' && p.constructionStatus === 'COMPLETE' && p.marketStatus !== 'FOR_SALE' &&
      (p.ownerId === 'council' || family.some((m) => m.id === p.ownerId)) && bedsAt(state, p) - p.residents.length >= family.length + (sharingWithStrangers ? 1 : 0) &&
      (!sharingWithStrangers || p.residents.length === 0));
    if (free) for (const m of family) moveHome(state, m, free);
  }
}

export function housingStats(state) {
  const beds = state.plots.reduce((s, p) => s + bedsAt(state, p), 0);
  const residents = state.plots.reduce((s, p) => s + p.residents.length, 0);
  return { beds, residents, homeless: state.citizens.filter((c) => !c.homePlotId).length, free: beds - residents };
}
