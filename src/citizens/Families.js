import { byId } from '../core/EntityRegistry.js';
import { LIFE, FAMILY, DAYS_PER_YEAR } from '../core/Config.js';
import { chance, pick, nextRandom } from '../core/Random.js';
import { yearOf } from '../core/Calendar.js';
import { balance, transfer } from '../economy/Transactions.js';
import { qty, moveGoods, removeGoods } from '../economy/Inventory.js';
import { isTrading } from '../economy/Businesses.js';
import { FOOD_GOODS, GOODS } from '../core/Config.js';
import { plotById, bedsAt } from '../property/LandRegistry.js';
import { moveHome } from '../property/Construction.js';
import { rel, adjust } from './Relationships.js';
import { createCitizen, ageOf, achieve } from './Citizen.js';
import { linkParent, areCloseKin } from './FamilyTree.js';
import { inheritTraits, inheritAppearance, randomTunic, familyWish } from './Genetics.js';
import { trait } from '../ai/Personality.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { createFact } from '../society/Gossip.js';

// Engagement, marriage, separation, children and adoption. Couples form
// through the Relationships system (courting → partners); this module takes
// committed partners to marriage and family life, all driven by each
// person's own feelings, temperament and circumstances.

export const NAMES = {
  F: ['Ada', 'Elin', 'Cora', 'Mira', 'Tamsin', 'Isolde', 'Fenna', 'Bryony', 'Edda', 'Maud', 'Sabine', 'Elena', 'Rose', 'Agnes', 'Wren', 'Hilde', 'Ivy', 'Joan', 'Liesl', 'Nell', 'Orla', 'Petra', 'Quinn', 'Rhea', 'Sela', 'Tilda', 'Una', 'Vera', 'Willa', 'Yara', 'Alys', 'Briar', 'Clem', 'Dora', 'Esme', 'Gwen', 'Hazel', 'Ilse', 'Juno', 'Kit'],
  M: ['Bram', 'Dain', 'Hale', 'Osric', 'Wyn', 'Gareth', 'Rowan', 'Aldric', 'Cedric', 'Lorne', 'Piers', 'Tobin', 'Thomas', 'Alaric', 'Bennet', 'Colm', 'Dunstan', 'Edmund', 'Finn', 'Godric', 'Hugh', 'Ivo', 'Jory', 'Kester', 'Leof', 'Merrick', 'Ned', 'Odo', 'Perrin', 'Ralf', 'Simon', 'Tam', 'Ulric', 'Walt', 'Ansel', 'Brom', 'Cael', 'Dirk', 'Emrys', 'Fitz'],
};

const living = (state, id) => byId(state.citizens, id) ?? null;

export function canCourt(state, a, b) {
  return ageOf(state, a) >= LIFE.marriageMinAge && ageOf(state, b) >= LIFE.marriageMinAge &&
    !a.family.spouseId && !b.family.spouseId && !areCloseKin(state, a.id, b.id);
}

/** Daily: partners may become engaged, engaged couples marry, unhappy marriages may end. */
export function dailyFamilies(state) {
  for (const a of state.citizens) {
    const b = living(state, a.romance.partnerId);
    if (!b || a.id > b.id) continue;
    const ab = rel(state, a.id, b.id), ba = rel(state, b.id, a.id);
    if (!a.romance.engagedTo && !a.family.spouseId && state.day - a.romance.since >= FAMILY.engagementAfterDays) {
      const willing = (x, r) => r.affection > 72 && r.trust > 50 && chance(state, 0.15 + trait(x, 'loyal') * 0.2 + trait(x, 'riskTaking') * 0.1 - trait(x, 'stubborn') * 0.05);
      if (willing(a, ab) && willing(b, ba)) {
        a.romance.engagedTo = b.id; b.romance.engagedTo = a.id;
        a.romance.engagedDay = b.romance.engagedDay = state.day;
        record(state, 'relationships', `${a.firstName} and ${b.firstName} are engaged to be married.`, { citizens: [a.id, b.id] }, 2);
        createFact(state, 'engaged', a.id, `${a.firstName} and ${b.firstName} are engaged.`, [a.id, b.id], b.id);
      }
    } else if (a.romance.engagedTo === b.id && b.romance.engagedTo === a.id && !a.family.spouseId && !b.family.spouseId && state.day - a.romance.engagedDay >= FAMILY.weddingAfterDays) {
      marry(state, a, b);
    }
  }
  for (const a of state.citizens) {
    const b = living(state, a.family.spouseId);
    if (!b || a.id > b.id) continue;
    const ab = rel(state, a.id, b.id), ba = rel(state, b.id, a.id);
    if ((Math.min(ab.trust, ba.trust) < FAMILY.divorceTrust || Math.max(ab.rivalry, ba.rivalry) > 60 || Math.min(ab.affection, ba.affection) < 22) && chance(state, 0.2)) divorce(state, a, b);
  }
}

export function marry(state, a, b) {
  // Any other engagement or courtship either of them had is over.
  for (const x of [a, b]) {
    const other = living(state, x.romance.engagedTo) ?? living(state, x.romance.partnerId);
    if (other && other !== a && other !== b) {
      if (other.romance.engagedTo === x.id) other.romance.engagedTo = null;
      if (other.romance.partnerId === x.id) { other.romance.partnerId = null; other.family.partnerId = null; }
    }
  }
  for (const [x, y] of [[a, b], [b, a]]) {
    x.family.spouseId = y.id;
    x.family.partnerId = y.id;
    x.romance.partnerId = y.id;
    x.romance.engagedTo = null;
    x.romance.marriedDay = state.day;
    x.mood = Math.min(100, x.mood + 15);
    remember(state, x, `Married ${y.firstName}.`, 3, 'romance');
    achieve(state, x, 'married', `Married ${y.firstName} ${y.lastName}`, { citizen: y.id });
  }
  // The couple sets up house in whichever home one of them owns, if any.
  const own = [a, b].map((x) => plotById(state, x.homePlotId)).find((p) => p && p.ownerId && (p.ownerId === a.id || p.ownerId === b.id));
  if (own) for (const x of [a, b]) if (x.homePlotId !== own.id && bedsAt(state, own) > own.residents.length) moveHome(state, x, own);
  for (const c of state.citizens) {
    const r = state.relationships[`${c.id}|${a.id}`] ?? state.relationships[`${c.id}|${b.id}`];
    if (r && r.friendship > 50 && c !== a && c !== b) c.mood = Math.min(100, c.mood + 4);
  }
  state.stats.marriages = (state.stats.marriages ?? 0) + 1;
  record(state, 'relationships', `${a.firstName} ${a.lastName} and ${b.firstName} ${b.lastName} were married at the Hearth Hall in Year ${yearOf(state.day)}.`, { citizens: [a.id, b.id] }, 3);
}

export function divorce(state, a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    x.family.spouseId = null; x.family.partnerId = null; x.romance.partnerId = null;
    x.family.formerSpouseIds.push(y.id);
    x.romance.history.push({ with: y.id, endedDay: state.day, divorced: true });
    x.mood = Math.max(0, x.mood - 15);
    adjust(state, x.id, y.id, { affection: -30 });
    remember(state, x, `Separated from ${y.firstName}.`, 3, 'romance');
  }
  // If they share a home, whoever owns it stays; otherwise the parent caring for
  // the children there keeps it, and failing that a coin toss decides. The
  // children stay in their home, in the care of the parent who stays.
  const home = plotById(state, a.homePlotId);
  if (home && b.homePlotId === home.id) {
    const minorsIn = (x) => state.citizens.filter((k) => k.homePlotId === home.id && k.family.guardianId === x.id && ageOf(state, k) < LIFE.adultAge).length;
    const stayer = home.ownerId === a.id ? a : home.ownerId === b.id ? b
      : minorsIn(a) !== minorsIn(b) ? (minorsIn(a) > minorsIn(b) ? a : b) : (chance(state, 0.5) ? a : b);
    const leaver = stayer === a ? b : a;
    home.residents = home.residents.filter((id) => id !== leaver.id);
    leaver.homePlotId = null;
    for (const k of state.citizens) {
      if (k.homePlotId === home.id && k.family.guardianId === leaver.id && k.family.parentIds.includes(stayer.id) && ageOf(state, k) < LIFE.adultAge) k.family.guardianId = stayer.id;
    }
  }
  record(state, 'relationships', `${a.firstName} and ${b.firstName} have divorced.`, { citizens: [a.id, b.id] }, 2);
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

const isMinorChildOf = (state, child, parent) => child.family.parentIds.includes(parent.id) && ageOf(state, child) < LIFE.adultAge;

function householdRoom(state, a) {
  const home = plotById(state, a.homePlotId);
  return home ? bedsAt(state, home) - home.residents.length : 0;
}

/** Would this couple like another child, and can they manage one? */
export function wantsChild(state, a, b) {
  const kids = state.citizens.filter((c) => isMinorChildOf(state, c, a) || isMinorChildOf(state, c, b)).length;
  const desired = Math.round(((a.familyWish ?? 0.5) + (b.familyWish ?? 0.5)) * 2.3);
  if (kids >= Math.min(desired, LIFE.maxChildren)) return 0;
  if (householdRoom(state, a) < 1) return 0;
  const money = balance(state, a.id) + balance(state, b.id);
  if (money < 12 + kids * 8) return 0;
  if (state.citizens.length >= state.populationCap) return 0;
  const r1 = rel(state, a.id, b.id), r2 = rel(state, b.id, a.id);
  if (r1.affection < 55 || r2.affection < 55) return 0;
  return ((a.familyWish ?? 0.5) + (b.familyWish ?? 0.5)) / 2;
}

/** Daily: couples may expect a child, due babies are born, waiting wards may be adopted. */
export function dailyParenthood(state) {
  for (const a of state.citizens) {
    if (a.pregnancy && state.day >= a.pregnancy.dueDay) giveBirth(state, a);
  }
  for (const a of state.citizens) {
    const b = living(state, a.romance.partnerId);
    if (!b || a.id > b.id) continue;
    const wish = wantsChild(state, a, b);
    if (!wish) continue;
    const bearer = [a, b].find((x) => x.sex === 'F' && !x.pregnancy && ageOf(state, x) >= LIFE.fertileFrom && ageOf(state, x) <= LIFE.fertileTo &&
      state.day - (x.lastBirthDay ?? -999) >= LIFE.minDaysBetweenBirths);
    if (bearer) {
      const other = bearer === a ? b : a;
      if (other.sex === 'M' && chance(state, 0.1 * wish)) {
        bearer.pregnancy = { dueDay: state.day + LIFE.pregnancyDays, otherParentId: other.id };
        remember(state, bearer, `Expecting a child with ${other.firstName}.`, 2, 'family');
        remember(state, other, `${bearer.firstName} and I are expecting a child.`, 2, 'family');
        continue;
      }
    }
    // Couples who cannot have children together may adopt a child in the council's care.
    const ward = state.citizens.find((c) => c.family.guardianId === 'council' && ageOf(state, c) < LIFE.adultAge);
    if (ward && chance(state, 0.05 * wish)) adopt(state, a, b, ward);
  }
}

export function giveBirth(state, mother) {
  const father = living(state, mother.pregnancy.otherParentId) ?? state.archive[mother.pregnancy.otherParentId] ?? null;
  mother.pregnancy = null;
  mother.lastBirthDay = state.day;
  if (state.citizens.length >= state.populationCap) return null;
  const sex = nextRandom(state) < 0.5 ? 'F' : 'M';
  const taken = new Set(state.citizens.map((c) => c.firstName));
  const choices = NAMES[sex].filter((n) => !taken.has(n));
  const home = plotById(state, mother.homePlotId);
  const familyName = home?.ownerId === father?.id ? father.lastName : home?.ownerId === mother.id ? mother.lastName : (father && father.birthDay < mother.birthDay ? father.lastName : mother.lastName);
  const child = createCitizen(state, {
    firstName: choices.length ? pick(state, choices) : pick(state, NAMES[sex]),
    lastName: familyName,
    sex,
    birthDay: state.day,
    generation: Math.max(mother.generation ?? 1, father?.generation ?? 1) + 1,
    color: randomTunic(state),
    appearance: inheritAppearance(state, mother, father),
    profession: 'Child',
    traits: inheritTraits(state, mother, father),
    dream: { type: 'growing', text: 'Grow up' },
    guardianId: mother.id,
    educationLevel: 0,
    bornHere: true,
    x: mother.x, z: mother.z,
    skills: {},
  });
  child.familyWish = familyWish(state, child);
  child.needs = { hunger: 90, energy: 90, social: 80 };
  linkParent(state, child.id, mother.id);
  if (father) linkParent(state, child.id, father.id);
  if (home && bedsAt(state, home) > home.residents.length) moveHome(state, child, home);
  else child.homePlotId = mother.homePlotId;
  if (home && !home.residents.includes(child.id)) home.residents.push(child.id);
  for (const p of [mother, father].filter((x) => x && state.citizens.includes(x))) {
    p.mood = Math.min(100, p.mood + 18);
    remember(state, p, `Welcomed ${child.firstName} into the world.`, 3, 'family');
    adjust(state, p.id, child.id, { friendship: 60, trust: 40, affection: 60 });
  }
  state.stats.births++;
  record(state, 'citizen', `${child.firstName} ${child.lastName} was born to ${mother.firstName}${father ? ` and ${father.firstName}` : ''}.`, { citizens: [child.id, mother.id, ...(father ? [father.id] : [])] }, 2);
  return child;
}

export function adopt(state, a, b, child) {
  linkParent(state, child.id, a.id);
  linkParent(state, child.id, b.id);
  child.family.adoptive = true;
  child.family.guardianId = a.id;
  const home = plotById(state, a.homePlotId);
  if (home) moveHome(state, child, home);
  for (const p of [a, b]) { remember(state, p, `Adopted ${child.firstName}.`, 3, 'family'); p.mood = Math.min(100, p.mood + 12); }
  remember(state, child, `Was adopted by ${a.firstName} and ${b.firstName}.`, 3, 'family');
  record(state, 'citizen', `${a.firstName} and ${b.firstName} adopted young ${child.firstName}.`, { citizens: [a.id, b.id, child.id] }, 2);
}

/** Guardian of a minor: explicit guardian, else a living parent. */
export function guardianOf(state, c) {
  const g = living(state, c.family.guardianId);
  if (g) return g;
  for (const p of c.family.parentIds) { const x = living(state, p); if (x) return x; }
  return null;
}

/**
 * Daily care for infants: their guardian provides a portion of food, bought
 * from a local seller (or the council pantry for council wards). Unfed babies
 * go hungry, which raises their risk.
 */
export function feedInfants(state) {
  for (const c of state.citizens) {
    if (ageOf(state, c) >= 3) continue;
    const g = guardianOf(state, c);
    let fed = false;
    const own = g && FOOD_GOODS.find((f) => qty(g.inventory, f) > 0);
    if (own) fed = removeGoods(g.inventory, own, 1);
    if (!fed && g) {
      const seller = state.businesses.filter((b) => isTrading(b) && FOOD_GOODS.some((f) => qty(b.inventory, f) > 0))
        .sort((x, y) => x.id.localeCompare(y.id))[0];
      const good = seller && FOOD_GOODS.find((f) => qty(seller.inventory, f) > 0);
      const price = good ? FAMILY.childCostPerDay * (GOODS[good].base > 3 ? 2 : 1) : 0;
      if (good && transfer(state, g.id, seller.id, price, 'purchase', `food for baby ${c.firstName}`)) {
        removeGoods(seller.inventory, good, 1);
        seller.today.revenue += price; // the books record what was actually paid
        fed = true;
      }
    }
    if (!fed) {
      const pantryGood = FOOD_GOODS.find((f) => qty(state.council.pantry, f) > 0);
      if (pantryGood) fed = removeGoods(state.council.pantry, pantryGood, 1);
    }
    c.needs.hunger = fed ? 90 : Math.max(0, c.needs.hunger - 45);
    c.needs.energy = 90;
    c.needs.social = Math.min(100, c.needs.social + 30);
  }
}

export { moveGoods, DAYS_PER_YEAR };
