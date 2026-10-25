import { INSTITUTIONS, LIFE, DAYS_PER_YEAR, FOOD_GOODS } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { isTrading } from '../economy/Businesses.js';
import { addGoods } from '../economy/Inventory.js';
import { ageOf } from '../citizens/Citizen.js';
import { adjust } from '../citizens/Relationships.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { bump } from '../society/Reputation.js';
import { yearOf, isNewSeason, seasonIndex, isNewYear, dayOfSeason } from '../core/Calendar.js';
import { plotHistory, LAND_TYPES } from '../property/LandRegistry.js';
import { buyPlot } from '../property/Ownership.js';
import { startProject, completionHooks } from '../property/Construction.js';
import { raiseCash, spendable } from '../finance/BankAccounts.js';
import { householdOf } from '../population/Housing.js';
import { wealthClass } from '../population/SocialClasses.js';
import { buyFood, foodIn, takeFood, siteFor } from './CommunityEvents.js';
import { TRADITIONS, TRADITION_IDS, beliefOf, isAdherent } from './FaithManager.js';

// Faith communities: the people of one tradition, their gathering place and
// their common purse. Members give what they choose; the community pays for
// candles and upkeep, keeps a store of food for the hungry, consoles the
// bereaved, sponsors learning, helps after disasters, holds its seasonal rite
// and keeps a book of the village's memorable days. Each benefit draws on
// real money and real stores, and the people helped remember who helped them.

export const BUILDINGS = [
  { type: 'shrine', funds: 40, members: 3, upkeep: 1 },
  { type: 'chapel', funds: 160, members: 9, upkeep: 3 },
  { type: 'temple', funds: 380, members: 22, upkeep: 6 },
];

export function ensureFaith(state) {
  if (state.faith) return state.faith;
  state.faith = { communities: [], nextId: 0 };
  for (const c of state.citizens) beliefOf(state, c);
  return state.faith;
}

export const activeCommunities = (state) => ensureFaith(state).communities.filter((f) => f.status === 'ACTIVE');
export const communityOf = (state, c) => (c.belief?.tradition ? activeCommunities(state).find((f) => f.tradition === c.belief.tradition) ?? null : null);
export const membersOf = (state, f) => state.citizens.filter((c) => isAdherent(c, f.tradition));

function note(state, f, text, importance = 1, citizens = []) {
  f.history.push({ day: state.day, text });
  if (f.history.length > 24) f.history.shift();
  return record(state, 'culture', text, { citizens: [...(f.leaderId ? [f.leaderId] : []), ...citizens] }, importance);
}

/** Keep the community's book: memorable days of the village, written down. */
function keepRecords(state, f) {
  const from = state.day - DAYS_PER_YEAR;
  const worthy = state.chronicle.filter((e) => e.day >= from && e.importance >= 3).slice(-3);
  for (const e of worthy) if (!f.book.some((b) => b.id === e.id)) f.book.push({ id: e.id, day: e.day, text: e.text });
  if (f.book.length > 30) f.book.splice(0, f.book.length - 30);
}

function found(state) {
  for (const t of TRADITION_IDS) {
    if (activeCommunities(state).some((f) => f.tradition === t)) continue;
    const members = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge && (beliefOf(state, c), isAdherent(c, t)));
    if (members.length < INSTITUTIONS.faithMinMembers) continue;
    const fs = ensureFaith(state);
    const id = 'fth' + ++fs.nextId;
    state.accounts[id] = 0;
    const f = { id, tradition: t, name: `${TRADITIONS[t].community} of First Hearth`, status: 'ACTIVE', foundedDay: state.day, leaderId: null, plotId: null, tier: null, buildings: [], stores: {}, helped: {}, book: [],
      stats: { donations: 0, meals: 0, families: 0, consolations: 0, rites: 0, schooling: 0, relief: 0, upkeep: 0 }, history: [] };
    fs.communities.push(f);
    chooseLeader(state, f, 'founding');
    note(state, f, `Followers of ${TRADITIONS[t].name} (${TRADITIONS[t].theme}) formed the ${f.name}, ${members.length} strong (Year ${yearOf(state.day)}).`, 2);
  }
}

/** The member most given to the community's life leads it; leadership passes as people age and die. */
function chooseLeader(state, f, why) {
  const pick = membersOf(state, f).filter((c) => ageOf(state, c) >= 25)
    .map((c) => ({ c, s: c.belief.devotion * 50 + c.reputation.standing * 0.5 + c.reputation.generosity * 0.2 + Math.min(20, ageOf(state, c) - 25) * 0.4 + (f.helped[c.id] ? 0 : 2) }))
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id))[0]?.c;
  if (!pick || pick.id === f.leaderId) return;
  const prev = byId(state.citizens, f.leaderId);
  f.leaderId = pick.id;
  bump(pick, 'standing', 3);
  remember(state, pick, `Became the elder of the ${f.name}.`, 3, 'life');
  if (why !== 'founding') note(state, f, `${pick.firstName} ${pick.lastName} now leads the ${f.name}${prev ? `, after ${prev.firstName}` : ''} (${why}).`, 1);
}

/** Seasonal giving: the devout give more, the casual a little; nobody gives what they need to eat. */
function donations(state, f) {
  let total = 0;
  for (const c of membersOf(state, f)) {
    if (ageOf(state, c) < LIFE.adultAge) continue;
    const share = c.belief.stance === 'devout' ? 0.012 : 0.004; // per season (three days)
    const gift = Math.min(15, Math.floor((spendable(state, c.id) - 25) * share));
    if (gift < 1) continue;
    if (balance(state, c.id) < gift) raiseCash(state, c.id, gift);
    if (transfer(state, c.id, f.id, gift, 'donation', `${c.firstName}'s offering to the ${f.name}`)) total += gift;
  }
  f.stats.donations += total;
  return total;
}

/** Candles, repairs and the keeper's stipend. */
function upkeep(state, f) {
  const cost = f.buildings.reduce((s, type) => s + (BUILDINGS.find((b) => b.type === type)?.upkeep ?? 0), 0);
  const n = Math.min(cost, balance(state, f.id));
  if (n > 0 && transfer(state, f.id, 'outside', n, 'expense', `Upkeep of the ${f.name}'s ${f.tier}`)) f.stats.upkeep += n;
  const keeper = byId(state.citizens, f.leaderId);
  if (keeper && f.tier && f.tier !== 'shrine' && balance(state, f.id) > 30) transfer(state, f.id, keeper.id, 2, 'wage', `${keeper.firstName}'s stipend as keeper`);
}

/** Raise the next gathering place once the purse and the congregation allow. */
function considerBuilding(state, f) {
  const next = BUILDINGS[f.tier ? BUILDINGS.findIndex((b) => b.type === f.tier) + 1 : 0];
  if (!next || state.projects.some((p) => p.ownerId === f.id)) return;
  if (membersOf(state, f).length < next.members) return;
  if (balance(state, f.id) < LAND_TYPES.civic.base + next.funds) return;
  const plot = siteFor(state, next.type, f.id);
  if (!plot || balance(state, f.id) < plot.price + next.funds) { if (plot?.ownerId === 'council' && plot.landType === 'civic') plot.marketStatus = 'NOT_FOR_SALE'; return; }
  if (!buyPlot(state, plot.id, f.id).ok) return;
  const res = startProject(state, { plotId: plot.id, ownerId: f.id, kind: 'construction', buildingType: next.type, purpose: 'faith' });
  if (res.ok) note(state, f, `The ${f.name} began building a ${next.type} on ${plot.name}, paid for by its members' offerings.`, 2);
}

completionHooks.faith = (state, plot, project) => {
  const f = activeCommunities(state).find((x) => x.id === project.ownerId);
  if (!f) return;
  f.tier = project.buildingType;
  f.buildings.push(project.buildingType);
  f.plotId = plot.id;
  const label = project.buildingType === 'temple' && f.tradition === 'lantern' ? 'monastery' : project.buildingType;
  plot.building.name = `${TRADITIONS[f.tradition].name.replace(/^The /, '')} ${label[0].toUpperCase()}${label.slice(1)}`;
  plotHistory(state, plot, `The ${f.name}'s ${label} was consecrated.`);
  note(state, f, `The ${f.name} consecrated its ${label} on ${plot.name}.`, 3);
  for (const c of membersOf(state, f)) c.mood = Math.min(100, c.mood + 5);
};

/** Who is struggling: hungry, or in a household with almost nothing. */
function struggling(state) {
  const seen = new Set();
  const out = [];
  for (const c of state.citizens) {
    if (seen.has(c.id)) continue;
    const h = householdOf(state, c);
    h.forEach((m) => seen.add(m.id));
    const hungry = h.some((m) => m.needs.hunger < 40);
    if (hungry || wealthClass(state, c).id === 'struggling') out.push(h);
  }
  return out;
}

/**
 * Charity: food bought from the village's own shops, stored, and given to
 * struggling households. Winter brings the community's charity table; the
 * Open Hand keeps one in every season.
 */
export function charity(state, f, { festival = false } = {}) {
  const needy = struggling(state);
  if (!needy.length) return null;
  const want = needy.reduce((s, h) => s + h.length, 0) * INSTITUTIONS.charityMealUnits;
  // Charity never empties the purse: part is kept for the community's other work and its building fund.
  const budget = Math.min(Math.floor(balance(state, f.id) * (festival ? 0.6 : 0.4)), Math.round(want * 3));
  if (foodIn(f.stores) < want && budget > 3) {
    state.accounts[f.id + ':alms'] = 0;
    transfer(state, f.id, f.id + ':alms', budget, 'transfer', 'alms budget');
    buyFood(state, f.id + ':alms', want - foodIn(f.stores), f.stores, `the ${f.name}`);
    const left = balance(state, f.id + ':alms');
    if (left > 0) transfer(state, f.id + ':alms', f.id, left, 'transfer', 'unspent alms');
    delete state.accounts[f.id + ':alms'];
  }
  let meals = 0, families = 0;
  for (const h of needy) {
    if (!foodIn(f.stores)) break;
    let given = 0;
    for (const m of h) {
      for (let i = 0; i < INSTITUTIONS.charityMealUnits; i++) {
        const g = takeFood(f.stores);
        if (!g) break;
        addGoods(m.inventory, g, 1);
        given++;
      }
    }
    if (!given) continue;
    meals += given; families++;
    const head = h[0];
    f.helped[head.id] = (f.helped[head.id] ?? 0) + 1;
    for (const m of h.filter((x) => ageOf(state, x) >= LIFE.adultAge)) {
      remember(state, m, `The ${f.name} brought food to our household${festival ? ' at the winter charity' : ''}.`, 2, 'kindness');
      if (m.belief) m.belief.helpedDay = state.day;
      if (f.leaderId) adjust(state, m.id, f.leaderId, { friendship: 6, trust: 5, respect: 4 });
    }
  }
  if (!meals) return null;
  f.stats.meals += meals; f.stats.families += families;
  const entry = note(state, f, `${festival ? 'At its winter charity, the' : 'The'} ${f.name} gave ${meals} portions of food to ${families} struggling household${families === 1 ? '' : 's'}, bought from the village's own shops.`, festival ? 3 : 2);
  return { meals, families, entry };
}

/** A death in the village: the community's elder visits the bereaved, and helps a poor family with the costs. */
export function consoleBereaved(state, dead) {
  const kin = [dead.family.spouseId, ...dead.family.childIds, ...dead.family.parentIds].map((id) => byId(state.citizens, id)).filter(Boolean);
  for (const f of activeCommunities(state)) {
    const leader = byId(state.citizens, f.leaderId);
    const ours = kin.filter((k) => isAdherent(k, f.tradition) || isAdherent(dead, f.tradition));
    if (!leader || !ours.length) continue;
    for (const k of ours) {
      k.mood = Math.min(100, k.mood + 6);
      remember(state, k, `${leader.firstName} of the ${f.name} sat with us when ${dead.firstName} died.`, 2, 'kindness');
      adjust(state, k.id, leader.id, { friendship: 4, trust: 3 });
    }
    const poor = ours.find((k) => ageOf(state, k) >= LIFE.adultAge && spendable(state, k.id) < 15);
    if (poor && balance(state, f.id) >= 15 && transfer(state, f.id, poor.id, 5, 'gift', `The ${f.name} helped the ${dead.lastName} family with funeral costs`)) f.helped[poor.id] = (f.helped[poor.id] ?? 0) + 1;
    f.stats.consolations += ours.length;
    if (f.leaderId === dead.id) { f.leaderId = null; chooseLeader(state, f, `${dead.firstName} died`); }
  }
}

/** The tradition's seasonal rite: members gather, spirits lift, a little is spent on candles and bread. */
function rite(state, f) {
  if (seasonIndex(state.day) !== TRADITIONS[f.tradition].season) return;
  const members = membersOf(state, f).filter((c) => !c.away);
  if (members.length < 3) return;
  const cost = Math.min(3, balance(state, f.id));
  if (cost > 0) transfer(state, f.id, 'outside', cost, 'expense', `Candles for ${TRADITIONS[f.tradition].rite}`);
  for (const c of members) { c.mood = Math.min(100, c.mood + (c.belief.stance === 'devout' ? 5 : 3)); c.needs.social = Math.min(100, c.needs.social + 15); }
  f.stats.rites++;
  note(state, f, `The ${f.name} kept ${TRADITIONS[f.tradition].rite}; ${members.length} gathered${f.tier ? ` at the ${f.tier}` : ''}.`, 1);
}

/** The Quiet Lantern sponsors learning; others help when the village school needs it. */
function sponsorLearning(state, f) {
  const school = state.businesses.find((b) => b.type === 'school' && isTrading(b));
  if (!school) return;
  const gift = f.tradition === 'lantern' ? 6 : 0;
  if (gift && balance(state, f.id) > gift + 20 && transfer(state, f.id, school.id, gift, 'gift', `The ${f.name} sponsored the school`)) f.stats.schooling += gift;
}

/** After a fire, the community helps the owner rebuild. */
function disasterRelief(state, f) {
  const fires = (state.eventLog ?? []).filter((e) => e.type === 'buildingDestroyed' && state.day - e.day <= 3 && !(f.relieved ?? []).includes(e.plotId + ':' + e.day));
  for (const e of fires) {
    const plot = state.plots.find((p) => p.id === e.plotId);
    const owner = plot && byId(state.citizens, plot.ownerId);
    f.relieved = [...(f.relieved ?? []), e.plotId + ':' + e.day].slice(-10);
    if (!owner || balance(state, f.id) < 25) continue;
    if (transfer(state, f.id, owner.id, 10, 'gift', `The ${f.name} helped ${owner.firstName} rebuild after the fire`)) {
      f.stats.relief += 10;
      remember(state, owner, `The ${f.name} gave me 10 coins to rebuild after the fire.`, 2, 'kindness');
      note(state, f, `The ${f.name} gave ${owner.firstName} ${owner.lastName} 10 coins to rebuild after the fire on ${plot.name}.`, 1, [owner.id]);
    }
  }
}

/** Daily work of the communities; most of it seasonal. */
export function dailyFaith(state) {
  ensureFaith(state);
  for (const f of activeCommunities(state)) disasterRelief(state, f);
  // The winter charity table is laid on the second day of winter, at the Hearthlight Gathering when there is one.
  if (seasonIndex(state.day) === 3 && dayOfSeason(state.day) === 2) {
    const festival = state.culture?.current?.phase === 'ACTIVE';
    for (const f of activeCommunities(state)) charity(state, f, { festival });
  }
  if (!isNewSeason(state.day)) return;
  found(state);
  const winter = seasonIndex(state.day) === 3;
  for (const f of activeCommunities(state)) {
    if (!membersOf(state, f).length) { f.status = 'DISSOLVED'; note(state, f, `The ${f.name} disbanded; no followers remain.`, 2); const n = balance(state, f.id); if (n > 0) transfer(state, f.id, 'treasury', n, 'grant', `Remaining funds of the ${f.name}`); continue; }
    donations(state, f);
    upkeep(state, f);
    rite(state, f);
    if (!winter && f.tradition === 'openhand') charity(state, f);
    sponsorLearning(state, f);
    considerBuilding(state, f);
    if (!byId(state.citizens, f.leaderId) || isNewYear(state.day)) chooseLeader(state, f, 'the yearly gathering');
    keepRecords(state, f);
  }
}

export { FOOD_GOODS };
