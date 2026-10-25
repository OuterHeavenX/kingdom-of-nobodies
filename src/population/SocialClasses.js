import { balance } from '../economy/Transactions.js';
import { plotValue } from '../property/LandRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE } from '../core/Config.js';
import { depositOf } from '../finance/BankAccounts.js';
import { outstandingDebt } from '../finance/CreditAssessment.js';

// Economic standing is a description of a household's present wealth, not a
// caste: it is recomputed from money, land and business holdings, so people
// rise and fall as their fortunes change.

export const CLASSES = [
  { id: 'struggling', label: 'Struggling', min: -Infinity },
  { id: 'working', label: 'Working', min: 15 },
  { id: 'comfortable', label: 'Comfortable', min: 60 },
  { id: 'wealthy', label: 'Wealthy', min: 160 },
  { id: 'affluent', label: 'Affluent', min: 400 },
];

/** Net worth of a household: both spouses' money, land and business cash. */
export function householdWealth(state, c) {
  let head = c;
  if (ageOf(state, c) < LIFE.adultAge) head = state.citizens.find((x) => x.id === c.family.guardianId) ?? c;
  const members = [head, state.citizens.find((x) => x.id === head.family.spouseId)].filter(Boolean);
  let w = 0;
  for (const m of members) {
    w += balance(state, m.id) + depositOf(state, m.id) - outstandingDebt(state, m.id);
    for (const p of state.plots) if (p.ownerId === m.id) w += plotValue(p);
    for (const b of state.businesses) if (b.ownerId === m.id) w += balance(state, b.id);
  }
  return w;
}

export function wealthClass(state, c) {
  const w = householdWealth(state, c);
  let cls = CLASSES[0];
  for (const k of CLASSES) if (w >= k.min) cls = k;
  return cls;
}

export function classDistribution(state) {
  const out = Object.fromEntries(CLASSES.map((k) => [k.id, 0]));
  for (const c of state.citizens) out[wealthClass(state, c).id]++;
  return out;
}
