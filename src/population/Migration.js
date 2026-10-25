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
import { invalidateIds } from '../core/EntityRegistry.js';
import { ageOn } from '../core/Calendar.js';
import { KINGDOMS, HEARTH } from '../region/RegionData.js';
import { relationScore, noteMigration } from '../diplomacy/Diplomacy.js';

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
  let score = 0.4 + Math.min(0.5, free * 0.05) + openings * (jobless > 2 ? 0.05 : 0.2) + Math.min(0.3, foodPerHead * 0.05) + (mood - 50) / 100 - 1.6 * jobless / Math.max(4, adults.length) - (troubled ? 0.4 : 0);
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
  // Newcomers come from somewhere: most often a kingdom that is struggling.
  const source = sourceKingdom(state);
  const from = source && balance(state, KINGDOMS[source].account) > savings + 300 ? KINGDOMS[source].account : 'outside';
  transfer(state, from, members[0].id, Math.min(savings, balance(state, from)), 'immigration', `${members[0].firstName}'s savings`);
  if (source) {
    const k = state.region.settlements[source];
    k.population = Math.max(40, k.population - members.length);
    noteMigration(state, source, HEARTH, members.length);
    for (const m of members) m.origin = source;
  }
  assignHomes(state);
  state.stats.immigrants += members.length;
  for (const m of members) remember(state, m, 'Arrived in the village to start a new life.', 2, 'milestone');
  const who = size === 1 ? `${members[0].firstName} ${lastName}, a ${members[0].profession.toLowerCase()},` : `The ${lastName} family (${members.map((m) => m.firstName).join(', ')})`;
  record(state, 'citizen', `${who} arrived${source ? ` from ${KINGDOMS[source].name}` : ''} hoping to ${members[0].dream.text.toLowerCase()}.`, { citizens: members.map((m) => m.id) }, 2);
  return members;
}

/** Kingdoms people come from: hungry, poor or badly governed places send more. */
function sourceKingdom(state) {
  if (!state.region) return null;
  const weights = Object.entries(state.region.settlements).filter(([, k]) => k.population > 60)
    .map(([id, k]) => [id, 0.3 + k.hunger * 3 + Math.max(0, 1.15 - k.prosperity) + (k.leader.approval < 40 ? 0.4 : 0)]);
  const total = weights.reduce((t, [, w]) => t + w, 0);
  if (!total) return null;
  let r = nextRandom(state) * total;
  for (const [id, w] of weights) { r -= w; if (r <= 0) return id; }
  return weights[weights.length - 1][0];
}

const kinAbroad = (state, c) => [...c.family.parentIds, ...c.family.childIds, ...c.family.formerSpouseIds].map((id) => state.archive[id]).filter((p) => p?.status === 'emigrated' && p.destination);

/** Where a citizen would go, and how strongly they are drawn there. */
export function bestDestination(state, c) {
  if (!state.region) return null;
  let best = null;
  for (const [id, k] of Object.entries(state.region.settlements)) {
    const relation = relationScore(state, HEARTH, id);
    if (relation < -40) continue;
    const kin = kinAbroad(state, c).filter((p) => p.destination === id).length;
    const pull = (k.prosperity - 1) * 1.2 + (1 - k.hunger) * 0.3 - k.hunger * 1.5 + relation / 200 + kin * 0.45 + (k.leader.approval - 50) / 200 - (k.population >= KINGDOMS[id].capacity ? 0.4 : 0);
    if (!best || pull > best.pull) best = { id, pull, kin };
  }
  return best;
}

/** Daily: hardship pushes people out; better prospects abroad pull them. */
export function maybeEmigrate(state) {
  let leaver = null;
  for (const c of state.citizens) {
    const age = ageOf(state, c);
    if (age < LIFE.adultAge || c.away) continue;
    const struggling = c.mood < 32 && (!c.employment || !c.homePlotId || balance(state, c.id) < 3);
    c.unhappyDays = struggling ? (c.unhappyDays ?? 0) + 1 : 0;
    c.joblessDays = !c.employment && !c.retired ? (c.joblessDays ?? 0) + 1 : 0;
    if (leaver || c.founder || state.government?.leaderId === c.id) continue;
    if (c.unhappyDays >= 6 && chance(state, 0.15)) { leaver = { c, why: 'hard times' }; continue; }
    let push = (c.joblessDays > 5 ? 0.35 : 0) + (!c.homePlotId ? 0.3 : 0) + (c.mood < 45 ? 0.2 : 0) + ((state.government?.approval ?? 60) < 30 ? 0.15 : 0) + (age < 35 ? 0.1 : 0);
    if (push < 0.3) continue;
    // A household with a thriving business or savings has a stake here and
    // does not leave for vague prospects abroad.
    const household = householdOf(state, c);
    if (household.some((m) => state.businesses.some((b) => b.ownerId === m.id && b.status === 'OPEN'))) continue;
    if (household.reduce((t, m) => t + balance(state, m.id), 0) > 90) push -= 0.2;
    if (push < 0.3) continue;
    const dest = bestDestination(state, c);
    if (!dest || dest.pull + push < 0.55) continue;
    if (chance(state, Math.min(0.02, (dest.pull + push) * 0.006))) {
      const why = dest.kin ? 'to be near family' : c.joblessDays > 5 ? 'in search of steady work' : !c.homePlotId ? 'hoping for a home of their own' : 'for a better life';
      leaver = { c, why, dest: dest.id };
    }
  }
  if (leaver) emigrate(state, leaver.c, { why: leaver.why, destination: leaver.dest });
}

/** Seasonal: some who left come home, especially when things have gone badly abroad. */
export function maybeReturn(state) {
  if (!state.region) return null;
  const candidates = Object.values(state.archive).filter((p) => p.status === 'emigrated' && p.destination && !p.diedAbroad && ageOn(p.birthDay, state.day) < 65 && state.day - p.leftDay >= 6);
  for (const p of candidates) {
    const k = state.region.settlements[p.destination];
    const kinHome = [...p.family.parentIds, ...p.family.childIds].some((id) => state.citizens.some((c) => c.id === id));
    const odds = 0.02 + (k.hunger > 0.1 ? 0.12 : 0) + (k.prosperity < 0.85 ? 0.08 : 0) + (kinHome ? 0.05 : 0);
    if (attractiveness(state).score < 0.3 || !chance(state, odds)) continue;
    const group = candidates.filter((x) => x.destination === p.destination && x.leftDay === p.leftDay);
    return returnHome(state, group, k);
  }
  return null;
}

function returnHome(state, records, k) {
  const back = [];
  for (const rec of records) {
    const c = createCitizen(state, {
      firstName: rec.firstName, lastName: rec.lastName, sex: rec.sex, birthDay: rec.birthDay, generation: rec.generation,
      color: rec.color, appearance: rec.appearance, profession: ageOn(rec.birthDay, state.day) < LIFE.adultAge ? 'Child' : rec.profession === 'Child' ? 'Laborer' : rec.profession,
      traits: { ...rec.traits }, dream: { type: 'homestead', text: 'Make a home again where I grew up' }, skills: { ...rec.skills }, founder: rec.founder, legacyTrait: rec.legacyTrait,
      educationLevel: rec.education?.level ?? 0.3, x: -90, z: 0,
    });
    c.id = rec.id; // the same person, the same identity
    c.family = { ...c.family, ...rec.family, parentIds: [...rec.family.parentIds], childIds: [...rec.family.childIds], formerSpouseIds: [...rec.family.formerSpouseIds] };
    c.achievements = [...(rec.achievements ?? [])];
    c.employmentHistory = [...(rec.employmentHistory ?? [])];
    c.bornHere = rec.bornHere;
    c.returnedDay = state.day;
    c.origin = rec.destination;
    delete state.accounts['c' + state.nextId.citizen];
    state.accounts[c.id] = state.accounts[c.id] ?? 0;
    delete state.archive[rec.id];
    back.push(c);
  }
  invalidateIds(state.citizens);
  // Marriages must still be mutual: a spouse who moved on, or did not come back, is a former spouse.
  for (const c of back) {
    const sp = c.family.spouseId;
    const spouse = sp && state.citizens.find((x) => x.id === sp);
    if (sp && (!spouse || spouse.family.spouseId !== c.id)) { c.family.formerSpouseIds.push(sp); c.family.spouseId = null; c.family.partnerId = null; }
    c.romance.partnerId = c.family.spouseId;
  }
  const savings = Math.min(25 * back.length, Math.max(0, balance(state, KINGDOMS[k.id].account) - 300));
  if (savings > 0) transfer(state, KINGDOMS[k.id].account, back[0].id, savings, 'immigration', `${back[0].firstName}'s savings from ${k.name}`);
  k.population = Math.max(40, k.population - back.length);
  noteMigration(state, k.id, HEARTH, back.length);
  state.stats.returned = (state.stats.returned ?? 0) + back.length;
  state.stats.immigrants += back.length;
  assignHomes(state);
  for (const c of back) remember(state, c, `Came home to First Hearth from ${k.name}.`, 3, 'milestone');
  const names = back.map((c) => c.firstName);
  record(state, 'citizen', `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]} ${back[0].lastName} came home from ${k.name}${k.hunger > 0.1 ? ', where food had grown scarce' : ''}.`, { citizens: back.map((c) => c.id) }, 2);
  return back;
}

/** Called for each member of a departing household after their land is sold and before their coins leave. */
export const emigrationHooks = [];

export function emigrate(state, c, { why = 'hard times', destination = null } = {}) {
  destination = destination ?? bestDestination(state, c)?.id ?? null;
  const household = householdOf(state, c);
  for (const m of household) {
    if (m.employment) leaveJob(state, m, 'left the village');
    for (const b of state.businesses.filter((x) => x.ownerId === m.id && isTrading(x))) closeBusiness(state, b, 'CLOSED', 'owner emigrated');
    // Their land is sold to the council if it can pay; otherwise it is left for sale.
    for (const p of state.plots.filter((x) => x.ownerId === m.id)) {
      const price = Math.min(p.price, balance(state, 'treasury') - 20);
      if (price > 0) transfer(state, 'treasury', m.id, price, 'property', `Council bought ${p.name} from ${m.firstName}`);
      // Land is never left with someone who no longer lives here: unpaid, it is forfeited to the council.
      p.ownerId = 'council';
      p.reservedBy = null;
      listForSale(state, p.id);
    }
    for (const fn of emigrationHooks) fn(state, m);
    const coins = balance(state, m.id);
    const to = destination ? KINGDOMS[destination].account : 'outside';
    if (coins > 0) transfer(state, m.id, to, coins, 'emigration', `${m.firstName} took their savings away`);
    const home = plotById(state, m.homePlotId);
    if (home) home.residents = home.residents.filter((id) => id !== m.id);
    for (const key of Object.keys(state.relationships)) if (key.startsWith(m.id + '|') || key.endsWith('|' + m.id)) delete state.relationships[key];
    const rec = archiveCitizen(state, m, 'emigrated', why);
    rec.destination = destination;
  }
  for (const m of household) { onCitizenGone(state, m); onMerchantGone(state, m, household.map((x) => x.id)); }
  const ids = new Set(household.map((m) => m.id));
  state.citizens = state.citizens.filter((x) => !ids.has(x.id));
  for (const m of household) { reassignWards(state, m); delete state.accounts[m.id]; }
  for (const o of state.citizens) {
    if (ids.has(o.romance.partnerId)) { o.romance.partnerId = null; o.family.partnerId = null; }
    if (ids.has(o.romance.courtingId)) o.romance.courtingId = null;
    if (ids.has(o.education.masterId)) o.education.masterId = null;
  }
  state.stats.emigrants += household.length;
  if (destination) {
    const k = state.region.settlements[destination];
    k.population += household.length;
    noteMigration(state, HEARTH, destination, household.length);
  }
  const where = destination ? ` for ${KINGDOMS[destination].name}` : '';
  record(state, 'citizen', `${household.length > 1 ? `The ${c.lastName} household (${household.map((m) => m.firstName).join(', ')})` : `${c.firstName} ${c.lastName}`} left the village${where}, ${why === 'hard times' ? 'after hard times' : why}.`, { citizens: [...ids] }, 2);
  return household;
}

export { FOOD_GOODS };
