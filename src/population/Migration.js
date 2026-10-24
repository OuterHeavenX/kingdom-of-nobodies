import { POPULATION, LIFE, FOOD_GOODS } from '../core/Config.js';
import { chance, intRange, pick, nextRandom } from '../core/Random.js';
import { transfer, balance } from '../economy/Transactions.js';
import { isTrading, BUSINESS_TYPES } from '../economy/Businesses.js';
import { closeBusiness } from '../economy/EconomyManager.js';
import { leaveJob } from '../economy/Employment.js';
import { listForSale } from '../property/Ownership.js';
import { plotById, bedsAt } from '../property/LandRegistry.js';
import { randomTraits } from '../ai/Personality.js';
import { createCitizen, ageOf } from '../citizens/Citizen.js';
import { NAMES } from '../citizens/Families.js';
import { familyWish, inheritTraits, inheritAppearance, randomTunic } from '../citizens/Genetics.js';
import { linkParent } from '../citizens/FamilyTree.js';
import { reassignWards } from '../citizens/Lifecycle.js';
import { householdOf } from './Housing.js';
import { onCitizenGone } from '../politics/Government.js';
import { onMerchantGone } from '../trade/TradeManager.js';
import { publicBeds } from './Expansion.js';
import { assignHomes } from '../citizens/CitizenManager.js';
import { archiveCitizen } from '../history/Archive.js';
import { villageFood } from '../economy/Marketplace.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';

// People arrive and leave for reasons. Newcomers weigh beds, work, food,
// happiness and recent troubles before settling; residents who are miserable,
// jobless or homeless for long enough may leave, taking their household and
// savings with them.

const LAST = ['Fletcher', 'Hearn', 'Marsh', 'Cooper', 'Vane', 'Dunmore', 'Reed', 'Stroud', 'Penrose', 'Kettle', 'Ashby', 'Wren', 'Thatcher', 'Mercer', 'Garrow', 'Blythe', 'Corbin', 'Hollis', 'Lark', 'Pell', 'Quarry', 'Rook', 'Sallow', 'Tull'];
const HAIR = ['short', 'long', 'bun', 'bald', 'braid', 'curly'];
const HAIR_COLORS = ['#3b2a1e', '#6b4226', '#a8763e', '#d9b36c', '#2a2a2a', '#8c3b22'];
const SKIN = ['#f2cfab', '#e0b48c', '#c68e64', '#9a6844', '#f5d9c0'];

/** How appealing the village looks to outsiders right now (0 = not at all). */
export function attractiveness(state) {
  const pop = state.citizens.length;
  if (pop >= state.populationCap) return { score: 0, reasons: ['the village is full'] };
  const free = publicBeds(state) - state.citizens.filter((c) => !c.homePlotId).length;
  if (free < 1) return { score: 0, reasons: ['no beds'] };
  const adults = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge);
  const jobless = adults.filter((c) => !c.employment && !c.retired && c.profession !== 'Builder' && c.profession !== 'Forager').length;
  const openings = state.businesses.filter((b) => isTrading(b) && b.openings > 0).length;
  const foodPerHead = villageFood(state) / Math.max(1, pop);
  const mood = state.citizens.reduce((s, c) => s + c.mood, 0) / Math.max(1, pop);
  const troubled = (state.season?.troubledUntil ?? 0) > state.day;
  let score = 0.4 + Math.min(0.5, free * 0.05) + openings * 0.2 + Math.min(0.3, foodPerHead * 0.05) + (mood - 50) / 100 - jobless / Math.max(4, adults.length) - (troubled ? 0.4 : 0);
  if (pop < 12) score += 0.3; // a tiny hamlet needs hands
  return { score: Math.max(0, score), free };
}

function neededTrade(state) {
  const open = (type) => state.businesses.some((b) => b.type === type && isTrading(b));
  const planned = (type) => state.citizens.some((c) => c.dream.type === 'business' && c.dream.businessType === type && !c.dream.fulfilledDay);
  for (const [type, prof] of [['farm', 'Farmer'], ['bakery', 'Baker'], ['blacksmith', 'Blacksmith'], ['general_store', 'Merchant'], ['tavern', 'Innkeeper'], ['lumberyard', 'Woodcutter']]) {
    if (!open(type) && !planned(type)) return { profession: prof, dream: { type: 'business', businessType: type, text: `Open a ${BUSINESS_TYPES[type].label.toLowerCase()}` } };
  }
  const hiring = state.businesses.find((b) => isTrading(b) && b.openings > 0 && !BUSINESS_TYPES[b.type].civic);
  const prof = hiring ? { farm: 'Farmer', lumberyard: 'Woodcutter', bakery: 'Baker', blacksmith: 'Blacksmith', general_store: 'Merchant', tavern: 'Innkeeper', school: 'Teacher' }[hiring.type] ?? 'Laborer' : (state.citizens.filter((c) => c.profession === 'Builder').length < Math.max(2, state.projects.length) ? 'Builder' : pick(state, ['Laborer', 'Farmer', 'Laborer']));
  return { profession: prof, dream: pick(state, [{ type: 'homestead', text: 'Build a home of my own' }, { type: 'wealth', target: 120, text: 'Save 120 coins' }, { type: 'partner', text: 'Find a life partner' }, { type: 'respected', text: 'Be respected by everyone' }]) };
}

function newPerson(state, { sex, age, lastName, profession, dream, parents = [] }) {
  const taken = new Set(state.citizens.map((c) => c.firstName));
  const pool = NAMES[sex].filter((n) => !taken.has(n));
  const child = parents.length > 0;
  const c = createCitizen(state, {
    firstName: pool.length ? pick(state, pool) : pick(state, NAMES[sex]),
    lastName, sex, age,
    color: randomTunic(state),
    appearance: child ? inheritAppearance(state, parents[0], parents[1]) : { hair: pick(state, HAIR), hairColor: pick(state, HAIR_COLORS), skin: pick(state, SKIN), height: 0.94 + nextRandom(state) * 0.12 },
    profession: child ? 'Child' : profession,
    traits: child ? inheritTraits(state, parents[0], parents[1]) : randomTraits(() => nextRandom(state)),
    dream: child ? { type: 'growing', text: 'Grow up' } : dream,
    educationLevel: child ? 0.1 + age * 0.02 : 0.2 + nextRandom(state) * 0.4,
    x: -70, z: 0,
  });
  c.familyWish = familyWish(state, c);
  for (const p of parents) linkParent(state, c.id, p.id);
  if (child) c.family.guardianId = parents[0].id;
  return c;
}

/** Daily: perhaps a household arrives. */
export function maybeImmigrate(state) {
  const { score, free } = attractiveness(state);
  if (!chance(state, Math.min(0.4, score * 0.14))) return null;
  const need = neededTrade(state);
  const lastName = pick(state, LAST);
  const roll = nextRandom(state);
  const size = roll < 0.5 || free < 2 ? 1 : roll < 0.8 || free < 3 ? 2 : Math.min(free, 2 + intRange(state, 1, 2));
  const firstSex = nextRandom(state) < 0.5 ? 'F' : 'M';
  const members = [newPerson(state, { sex: firstSex, age: nextRandom(state) < 0.8 ? intRange(state, 18, 32) : intRange(state, 33, 46), lastName, profession: need.profession, dream: need.dream })];
  if (size >= 2) {
    const sameSex = members[0].attraction === 'same';
    const other = newPerson(state, { sex: sameSex ? firstSex : (firstSex === 'F' ? 'M' : 'F'), age: Math.max(18, ageOf(state, members[0]) + intRange(state, -4, 4)), lastName, profession: pick(state, ['Laborer', 'Farmer', need.profession]), dream: { type: 'homestead', text: 'Raise a family in a home of my own' } });
    for (const [x, y] of [[members[0], other], [other, members[0]]]) {
      x.family.spouseId = y.id; x.family.partnerId = y.id; x.romance.partnerId = y.id; x.romance.marriedDay = state.day; x.romance.since = state.day;
    }
    other.attraction = members[0].attraction;
    members.push(other);
    for (let i = 2; i < size; i++) members.push(newPerson(state, { sex: nextRandom(state) < 0.5 ? 'F' : 'M', age: intRange(state, 1, Math.min(14, ageOf(state, members[0]) - 18)), lastName, parents: [members[0], other] }));
  }
  const savings = intRange(state, POPULATION.immigrantMinCoins, POPULATION.immigrantMaxCoins) * (size > 1 ? 2 : 1);
  transfer(state, 'outside', members[0].id, Math.min(savings, balance(state, 'outside')), 'immigration', `${members[0].firstName}'s savings`);
  assignHomes(state);
  state.stats.immigrants += members.length;
  for (const m of members) remember(state, m, 'Arrived in the village to start a new life.', 2, 'milestone');
  const who = size === 1 ? `${members[0].firstName} ${lastName}, a ${members[0].profession.toLowerCase()},` : `The ${lastName} family (${members.map((m) => m.firstName).join(', ')})`;
  record(state, 'citizen', `${who} arrived hoping to ${members[0].dream.text.toLowerCase()}.`, { citizens: members.map((m) => m.id) }, 2);
  return members;
}

/** Daily: track unhappiness; a household whose head has suffered long enough may leave. */
export function maybeEmigrate(state) {
  for (const c of state.citizens) {
    const age = ageOf(state, c);
    if (age < LIFE.adultAge) continue;
    const struggling = c.mood < 32 && (!c.employment || !c.homePlotId || balance(state, c.id) < 3);
    c.unhappyDays = struggling ? (c.unhappyDays ?? 0) + 1 : 0;
  }
  const leaver = state.citizens.find((c) => c.unhappyDays >= 6 && !c.founder && chance(state, 0.15));
  if (leaver) emigrate(state, leaver);
}

export function emigrate(state, c) {
  const household = householdOf(state, c);
  for (const m of household) {
    if (m.employment) leaveJob(state, m, 'left the village');
    for (const b of state.businesses.filter((x) => x.ownerId === m.id && isTrading(x))) closeBusiness(state, b, 'CLOSED');
    // Their land is sold to the council if it can pay; otherwise it is left for sale.
    for (const p of state.plots.filter((x) => x.ownerId === m.id)) {
      const price = Math.min(p.price, balance(state, 'treasury') - 20);
      if (price > 0 && transfer(state, 'treasury', m.id, price, 'property', `Council bought ${p.name} from ${m.firstName}`)) p.ownerId = 'council';
      listForSale(state, p.id);
    }
    const coins = balance(state, m.id);
    if (coins > 0) transfer(state, m.id, 'outside', coins, 'emigration', `${m.firstName} took their savings away`);
    const home = plotById(state, m.homePlotId);
    if (home) home.residents = home.residents.filter((id) => id !== m.id);
    for (const key of Object.keys(state.relationships)) if (key.startsWith(m.id + '|') || key.endsWith('|' + m.id)) delete state.relationships[key];
    archiveCitizen(state, m, 'emigrated', 'hard times');
  }
  for (const m of household) { onCitizenGone(state, m); onMerchantGone(state, m); }
  const ids = new Set(household.map((m) => m.id));
  state.citizens = state.citizens.filter((x) => !ids.has(x.id));
  for (const m of household) { reassignWards(state, m); delete state.accounts[m.id]; }
  for (const o of state.citizens) {
    if (ids.has(o.romance.partnerId)) { o.romance.partnerId = null; o.family.partnerId = null; }
    if (ids.has(o.romance.courtingId)) o.romance.courtingId = null;
    if (ids.has(o.education.masterId)) o.education.masterId = null;
  }
  state.stats.emigrants += household.length;
  record(state, 'citizen', `${household.length > 1 ? `The ${c.lastName} household (${household.map((m) => m.firstName).join(', ')})` : `${c.firstName} ${c.lastName}`} left the village after hard times.`, { citizens: [...ids] }, 2);
  return household;
}

export { FOOD_GOODS };
