import { DAYS_PER_YEAR, LIFE } from '../core/Config.js';
import { nextRandom, pick, chance } from '../core/Random.js';
import { ageOn, yearOf, isNewYear, isNewSeason } from '../core/Calendar.js';
import { record } from '../society/Chronicle.js';
import { KINGDOMS } from './RegionData.js';
import { planJourney } from './RegionManager.js';

// The people of the neighbouring kingdoms. A kingdom's bulk population is
// still simulated in aggregate (Settlement.js), but the people who matter —
// its ruler, merchants, guild masters, faith keepers, notable families,
// craftspeople and a handful of ordinary residents — are persistent named
// individuals with stable ids. They age, marry, have children, change trades,
// rise and fall with their kingdom, take office, travel the real roads and
// die, and the merchant met in Greenvale today is the same person next year.

const NAMES = {
  greenvale: {
    F: ['Maren', 'Tamsin', 'Bryony', 'Elsbeth', 'Willa', 'Ottilie', 'Clover', 'Hesper', 'Nell', 'Rosamund', 'Ivy', 'Marigold'],
    M: ['Orrin', 'Willem', 'Cedric', 'Barnaby', 'Hob', 'Alder', 'Tobias', 'Fen', 'Rowan', 'Ambrose', 'Jory', 'Linus'],
    houses: ['Fallowfield', 'Haybrook', 'Greaves', 'Hollin', 'Thatch', 'Oakes', 'Furrow', 'Meadowgate', 'Barley', 'Sheaf', 'Millward', 'Hedgerow'],
  },
  ironhold: {
    F: ['Dagna', 'Hilde', 'Sigrun', 'Brynja', 'Ragna', 'Gudrun', 'Astrid', 'Thyra', 'Helka', 'Runa', 'Yrsa', 'Solveig'],
    M: ['Brannoc', 'Garrick', 'Tobin', 'Haldor', 'Orm', 'Torvald', 'Ulf', 'Kettil', 'Bjarn', 'Egil', 'Hakon', 'Sten'],
    houses: ['Stonehelm', 'Deepvein', 'Anvilsworth', 'Coldforge', 'Orebrand', 'Slate', 'Ironside', 'Hammerfell', 'Copperhand', 'Granitebrow', 'Flint', 'Emberdeep'],
  },
  saltmere: {
    F: ['Isadora', 'Nerys', 'Odile', 'Marina', 'Coralie', 'Sabela', 'Perla', 'Lisette', 'Delphine', 'Ondine', 'Talia', 'Brisa'],
    M: ['Lucan', 'Marco', 'Pell', 'Tiber', 'Corin', 'Anselm', 'Rafe', 'Silvan', 'Dorian', 'Teodor', 'Benedek', 'Quill'],
    houses: ['Brightwater', 'Vell', 'Saltreeve', 'Tidewell', 'Harrowgate', 'Marr', 'Gullwing', 'Seabrook', 'Kelp', 'Anchorage', 'Spindrift', 'Wavecrest'],
  },
};

const OCCUPATIONS = {
  greenvale: { craft: ['Miller', 'Thatcher', 'Shepherd', 'Cheesemaker', 'Wheelwright'], resident: ['Farmhand', 'Gleaner', 'Drover', 'Orchard keeper'] },
  ironhold: { craft: ['Smelter', 'Stonemason', 'Toolmaker', 'Armourer', 'Assayer'], resident: ['Miner', 'Hauler', 'Quarry hand', 'Charcoal burner'] },
  saltmere: { craft: ['Shipwright', 'Sailmaker', 'Net mender', 'Salt boiler', 'Cooper'], resident: ['Fisher', 'Dock hand', 'Deckhand', 'Oyster gatherer'] },
};
const GUILDS = { greenvale: 'Grain Growers', ironhold: 'Miners and Smiths', saltmere: 'Shipmasters' };
const FAITH = { greenvale: 'The Old Furrow', ironhold: 'The Hearthkin', saltmere: 'The Dawnlight' };
const SKIN = ['#f2cfab', '#e0b48c', '#c68e64', '#9a6844', '#f5d9c0', '#b07a52'];
const HAIR = ['#3b2a1e', '#6b4226', '#a8763e', '#d9b36c', '#2a2a2a', '#8c3b22', '#b8b0a2'];

// The make-up of each kingdom's named people: [role, count].
const ROSTER = [['ruler', 1], ['notable', 3], ['merchant', 4], ['guild', 1], ['faith', 1], ['craft', 5], ['resident', 6]];
export const ROLE_LABEL = { ruler: 'Ruler', notable: 'Notable', merchant: 'Merchant', guild: 'Guild master', faith: 'Faith keeper', craft: 'Craftsperson', resident: 'Resident', child: 'Child' };

export function ensureForeign(state) {
  if (state.foreign) return state.foreign;
  state.foreign = { people: {}, nextId: {}, visits: {}, departed: [], history: [], lastDiplomacy: state.diplomacy?.history?.length ?? 0 };
  for (const kid of Object.keys(KINGDOMS)) populate(state, kid);
  return state.foreign;
}

const rand = (state) => nextRandom(state);

function personality(state) {
  const r = () => Math.round(rand(state) * 100) / 100;
  return { ambition: r(), caution: r(), warmth: r(), pride: r() };
}

function createPerson(state, kid, role, { age = null, sex = null, house = null, parents = [] } = {}) {
  const f = state.foreign;
  f.nextId[kid] = (f.nextId[kid] ?? 0) + 1;
  const id = `f-${kid}-${f.nextId[kid]}`;
  sex = sex ?? (rand(state) < 0.5 ? 'F' : 'M');
  const names = NAMES[kid];
  age = age ?? Math.floor(20 + rand(state) * 40);
  const occ = role === 'ruler' ? KINGDOMS[kid].leaderTitle : role === 'merchant' ? 'Merchant' : role === 'guild' ? `Master of the ${GUILDS[kid]}` : role === 'faith' ? `Keeper of ${FAITH[kid]}` : role === 'notable' ? 'Councillor' : role === 'child' ? 'Child' : pick(state, OCCUPATIONS[kid][role === 'craft' ? 'craft' : 'resident']);
  const p = {
    id, kingdom: kid, firstName: pick(state, names[sex]), lastName: house ?? pick(state, names.houses), sex, birthDay: state.day - age * DAYS_PER_YEAR - Math.floor(rand(state) * DAYS_PER_YEAR),
    role, occupation: occ, personality: personality(state), standing: role === 'ruler' ? 80 : role === 'notable' ? 65 : role === 'merchant' ? 55 : 40 + Math.round(rand(state) * 20),
    wealth: role === 'merchant' || role === 'notable' ? 60 + Math.round(rand(state) * 60) : 15 + Math.round(rand(state) * 30),
    spouseId: null, parentIds: parents, childIds: [], status: 'alive', achievements: [], memories: [], trips: 0, location: kid, travel: null,
    appearance: { skin: pick(state, SKIN), hairColor: pick(state, HAIR), hair: pick(state, ['short', 'long', 'bun', 'braid', 'curly', 'bald']) },
    arrivedDay: state.day,
  };
  f.people[id] = p;
  return p;
}

function populate(state, kid) {
  const k = state.region.settlements[kid];
  for (const [role, n] of ROSTER) for (let i = 0; i < n; i++) {
    const p = createPerson(state, kid, role, role === 'ruler' && k?.leader ? { age: 40 + Math.floor(rand(state) * 15) } : {});
    if (role === 'ruler' && k?.leader) {
      // The ruler the region already knows keeps their name.
      const [first, ...rest] = k.leader.name.split(' ');
      p.firstName = first; p.lastName = rest.join(' ') || p.lastName;
      k.leader.citizenId = p.id;
      p.since = k.leader.since;
    }
  }
  // Some of them are already married households.
  const adults = peopleOf(state, kid).filter((p) => p.role !== 'ruler');
  for (let i = 0; i + 1 < adults.length; i += 3) marry(state, adults[i], adults[i + 1], { quiet: true });
}

export const peopleOf = (state, kid, { includeAway = true } = {}) => Object.values(ensureForeign(state).people).filter((p) => p.status === 'alive' && p.kingdom === kid && (includeAway || p.location === kid));
export const foreignById = (state, id) => ensureForeign(state).people[id] ?? null;
export const foreignAge = (state, p) => ageOn(p.birthDay, state.day);
export const rulerOf = (state, kid) => foreignById(state, state.region.settlements[kid]?.leader?.citizenId);

function marry(state, a, b, { quiet = false } = {}) {
  if (a.spouseId || b.spouseId || a === b) return;
  if (a.sex === b.sex && rand(state) < 0.85) return;
  a.spouseId = b.id; b.spouseId = a.id;
  if (!quiet) {
    remember(a, state, `Married ${b.firstName} ${b.lastName}.`);
    remember(b, state, `Married ${a.firstName} ${a.lastName}.`);
    kingdomStory(state, a.kingdom, `${a.firstName} ${a.lastName} and ${b.firstName} ${b.lastName} were married.`, 1);
  }
}

function remember(p, state, text) {
  p.memories.unshift({ day: state.day, text });
  if (p.memories.length > 8) p.memories.pop();
}

export function achieve(p, state, text) {
  if (!p) return;
  p.achievements.push({ day: state.day, text });
  if (p.achievements.length > 12) p.achievements.splice(1, 1);
}

function kingdomStory(state, kid, text, importance = 1) {
  const k = state.region.settlements[kid];
  k.history.push({ day: state.day, text });
  if (k.history.length > 40) k.history.shift();
  record(state, 'region', `${k.name}: ${text}`, {}, importance);
}

/** A named person dies: their household and their office move on. */
function death(state, p, cause) {
  p.status = 'dead';
  p.deathDay = state.day;
  p.cause = cause;
  const spouse = foreignById(state, p.spouseId);
  if (spouse) { spouse.spouseId = null; remember(spouse, state, `Lost ${p.firstName}.`); }
  const f = state.foreign;
  f.departed.push({ id: p.id, name: `${p.firstName} ${p.lastName}`, kingdom: p.kingdom, role: p.role, occupation: p.occupation, born: p.birthDay, died: state.day, cause, achievements: p.achievements.slice(-3) });
  if (f.departed.length > 60) f.departed.shift();
  delete f.people[p.id];
  for (const c of p.childIds) { const k = foreignById(state, c); if (k) k.parentIds = k.parentIds.filter((x) => x !== p.id); }
  if (p.role !== 'child' && p.role !== 'resident') kingdomStory(state, p.kingdom, `${p.occupation} ${p.firstName} ${p.lastName} died ${cause === 'old age' ? 'in old age' : `of ${cause}`}.`, p.role === 'ruler' ? 2 : 1);
  if (p.role === 'ruler') succession(state, p.kingdom, `${p.firstName} ${p.lastName} died`);
  else backfill(state, p.kingdom, p.role);
}

/** Someone takes up a vacant position: an heir, a promising resident, or a newcomer. */
function backfill(state, kid, role) {
  if (role === 'child' || role === 'ruler') return;
  const want = ROSTER.find(([r]) => r === role)?.[1] ?? 0;
  const have = peopleOf(state, kid).filter((p) => p.role === role).length;
  if (have >= want) return;
  const pool = peopleOf(state, kid, { includeAway: false }).filter((p) => (p.role === 'resident' || p.role === 'craft' || (p.role === 'child' && foreignAge(state, p) >= LIFE.adultAge)) && p.role !== role);
  const promoted = pool.sort((a, b) => b.standing + b.personality.ambition * 20 - (a.standing + a.personality.ambition * 20) || a.id.localeCompare(b.id))[0];
  if (promoted && ['merchant', 'guild', 'faith', 'notable', 'craft'].includes(role)) {
    const was = promoted.occupation;
    const oldRole = promoted.role === 'child' ? null : promoted.role;
    promoted.role = role;
    promoted.occupation = role === 'merchant' ? 'Merchant' : role === 'guild' ? `Master of the ${GUILDS[kid]}` : role === 'faith' ? `Keeper of ${FAITH[kid]}` : role === 'notable' ? 'Councillor' : pick(state, OCCUPATIONS[kid].craft);
    promoted.standing = Math.min(100, promoted.standing + 10);
    achieve(promoted, state, `Became ${promoted.occupation} (formerly ${was})`);
    if (role !== 'craft') kingdomStory(state, kid, `${promoted.firstName} ${promoted.lastName}, once a ${was.toLowerCase()}, became ${promoted.occupation.toLowerCase()}.`, 1);
    if (oldRole) backfill(state, kid, oldRole);
    return;
  }
  createPerson(state, kid, role === 'notable' || role === 'guild' || role === 'faith' || role === 'merchant' ? role : 'resident', { age: 20 + Math.floor(rand(state) * 10) });
}

/** A new ruler is chosen from the kingdom's notable people, according to the kingdom's mood. */
export function succession(state, kid, why, { stance: newStance = null, apply = true } = {}) {
  const k = state.region.settlements[kid];
  const def = KINGDOMS[kid];
  const candidates = peopleOf(state, kid, { includeAway: false }).filter((p) => foreignAge(state, p) >= 28 && ['notable', 'merchant', 'guild'].includes(p.role));
  const stance = newStance ?? k.leader.stance;
  // A hungry kingdom wants a cautious hand; a prosperous one, an ambitious one.
  const fit = (p) => p.standing + (k.hunger > 0.1 ? p.personality.caution : p.personality.ambition) * 30 + (stance === 'cooperative' ? p.personality.warmth : 0) * 15;
  const next = candidates.sort((a, b) => fit(b) - fit(a) || a.id.localeCompare(b.id))[0] ?? createPerson(state, kid, 'notable', { age: 45 });
  const old = rulerOf(state, kid);
  if (old && old.status === 'alive' && old !== next) { old.role = 'notable'; old.occupation = `Former ${def.leaderTitle}`; achieve(old, state, `Served as ${def.leaderTitle} until Year ${yearOf(state.day)}`); }
  const was = next.occupation;
  next.role = 'ruler';
  next.occupation = def.leaderTitle;
  next.since = state.day;
  next.standing = Math.min(100, next.standing + 15);
  achieve(next, state, `Became ${def.leaderTitle} of ${def.name} in Year ${yearOf(state.day)} (${why})`);
  if (apply) { k.leader.citizenId = next.id; k.leader.name = `${next.firstName} ${next.lastName}`; }
  backfill(state, kid, was === 'Merchant' ? 'merchant' : 'notable');
  return next;
}

/** The ruler's political outlook, from their character and the kingdom's circumstances. */
export function rulerPriorities(state, kid) {
  const p = rulerOf(state, kid);
  const k = state.region.settlements[kid];
  if (!p) return [];
  const out = [];
  if (k.hunger > 0.05 || k.shortages.food) out.push('feeding the people');
  if (p.personality.ambition > 0.6) out.push('expanding influence and trade');
  if (p.personality.caution > 0.6) out.push('keeping the peace and the treasury safe');
  if (p.personality.warmth > 0.6) out.push('friendship with neighbours');
  if (p.personality.pride > 0.7) out.push('the kingdom\'s honour and its borders');
  if (k.leader.stance === 'protectionist') out.push('protecting local trades');
  return out.length ? out : ['steady government'];
}

/** A named person sets out for another kingdom on the real roads. */
export function sendTraveller(state, p, to, why) {
  const plan = planJourney(state, p.location, to);
  if (!plan) return false;
  p.travel = { from: p.location, to, departDay: state.day, arriveDay: state.day + Math.max(1, Math.ceil(plan.hours / 24 * 1.4)), why, hours: Math.round(plan.hours) };
  p.location = null;
  return true;
}

function arrivals(state) {
  for (const p of Object.values(state.foreign.people)) {
    if (!p.travel || p.travel.why === 'caravan' || p.status !== 'alive' || state.day < p.travel.arriveDay) continue;
    const { from, to, why } = p.travel;
    p.location = to;
    p.travel = null;
    if (why === 'migration') {
      p.kingdom = to;
      p.arrivedDay = state.day;
      remember(p, state, `Settled in ${KINGDOMS[to].name}, leaving ${KINGDOMS[from]?.name ?? from}.`);
      kingdomStory(state, to, `${p.firstName} ${p.lastName}, a ${p.occupation.toLowerCase()} from ${KINGDOMS[from]?.name ?? from}, arrived to settle.`, 1);
    }
  }
}

/** Yearly life of the named people: age, marriage, children, careers, fortune, migration and death. */
function yearly(state) {
  for (const kid of Object.keys(KINGDOMS)) {
    const k = state.region.settlements[kid];
    const people = peopleOf(state, kid);
    for (const p of people) {
      const age = foreignAge(state, p);
      const yearlyRisk = Math.min(0.9, LIFE.gompertzA * Math.exp(LIFE.gompertzB * age) + (k.hunger > 0.15 ? 0.02 : 0));
      if (chance(state, yearlyRisk)) { death(state, p, age >= 60 ? 'old age' : k.hunger > 0.15 ? 'hunger' : 'a fever'); continue; }
      if (p.role === 'child' && age >= LIFE.adultAge) { p.role = 'resident'; p.occupation = pick(state, OCCUPATIONS[kid].resident); remember(p, state, 'Came of age and took up work.'); }
      // Fortune follows the kingdom; merchants ride its trade.
      const drift = (k.prosperity - 1) * 20 + (p.role === 'merchant' ? (p.trips > 0 ? 6 : -2) : 0) + (p.personality.ambition - 0.5) * 6;
      p.wealth = Math.max(0, Math.round(p.wealth + drift));
      p.standing = Math.max(0, Math.min(100, Math.round(p.standing + drift / 4)));
      // A craftsperson who prospers may turn merchant; a ruined merchant goes back to a trade.
      if (p.role === 'craft' && p.wealth > 110 && p.personality.ambition > 0.6 && peopleOf(state, kid).filter((x) => x.role === 'merchant').length < 6) {
        p.role = 'merchant'; achieve(p, state, `Turned from ${p.occupation.toLowerCase()} to trade`); p.occupation = 'Merchant';
        kingdomStory(state, kid, `${p.firstName} ${p.lastName} has prospered enough to set up as a merchant.`, 1);
      } else if (p.role === 'merchant' && p.wealth < 10) {
        p.role = 'craft'; p.occupation = pick(state, OCCUPATIONS[kid].craft); remember(p, state, 'My trading house failed; I went back to a craft.');
        kingdomStory(state, kid, `${p.firstName} ${p.lastName}'s trading house failed.`, 1);
        backfill(state, kid, 'merchant');
      }
    }
    // Marriages among the unmarried, and children for young couples.
    const single = peopleOf(state, kid, { includeAway: false }).filter((p) => !p.spouseId && foreignAge(state, p) >= 20 && foreignAge(state, p) < 50 && p.role !== 'child');
    for (let i = 0; i + 1 < single.length; i += 2) if (chance(state, 0.25)) marry(state, single[i], single[i + 1]);
    for (const p of peopleOf(state, kid, { includeAway: false })) {
      const sp = foreignById(state, p.spouseId);
      if (!sp || p.sex !== 'F' || foreignAge(state, p) > 42 || p.childIds.length >= 3 || !chance(state, 0.18)) continue;
      if (peopleOf(state, kid).length >= 30) continue;
      const child = createPerson(state, kid, 'child', { age: 0, house: sp.sex === 'M' ? sp.lastName : p.lastName, parents: [p.id, sp.id] });
      p.childIds.push(child.id); sp.childIds.push(child.id);
      remember(p, state, `Our child ${child.firstName} was born.`);
    }
    // Hard times drive people away along the roads; good times draw them.
    if (k.hunger > 0.12 || k.prosperity < 0.8) {
      const leaver = peopleOf(state, kid, { includeAway: false }).find((p) => p.role === 'resident' && !p.spouseId && chance(state, 0.3));
      const dest = Object.keys(KINGDOMS).filter((x) => x !== kid).sort((a, b) => state.region.settlements[b].prosperity - state.region.settlements[a].prosperity)[0];
      if (leaver && dest && sendTraveller(state, leaver, dest, 'migration')) kingdomStory(state, kid, `${leaver.firstName} ${leaver.lastName} left for ${KINGDOMS[dest].name} in search of a better life.`, 1);
    }
    // Keep the roster whole.
    for (const [role] of ROSTER) backfill(state, kid, role);
  }
}

/** Diplomacy that happened under a ruler becomes part of their record. */
function creditRulers(state) {
  const hist = state.diplomacy?.history ?? [];
  const f = state.foreign;
  const fresh = hist.filter((h) => h.day >= (f.lastCreditDay ?? 0) && h.day <= state.day && /signed|peace|alliance|ended the war/.test(h.text));
  f.lastCreditDay = state.day + 1;
  for (const h of fresh) for (const kid of Object.keys(KINGDOMS)) {
    if (h.text.includes(KINGDOMS[kid].name)) achieve(rulerOf(state, kid), state, h.text.length > 110 ? `${h.text.slice(0, 107)}…` : h.text);
  }
}

/** Daily: travellers arrive; each season rulers are credited; each year, life goes on. */
export function dailyForeign(state) {
  ensureForeign(state);
  arrivals(state);
  for (const kid of Object.keys(KINGDOMS)) {
    const k = state.region.settlements[kid];
    // The aggregate leadership model may change rulers; keep the named ruler in step.
    const r = rulerOf(state, kid);
    if (!r || `${r.firstName} ${r.lastName}` !== k.leader.name) {
      if (r && r.status === 'alive') { r.role = 'notable'; r.occupation = `Former ${KINGDOMS[kid].leaderTitle}`; achieve(r, state, `Left office in Year ${yearOf(state.day)}`); }
      succession(state, kid, k.unrestDays ? 'unrest' : 'a change of government');
    }
  }
  if (isNewSeason(state.day)) creditRulers(state);
  if (isNewYear(state.day)) yearly(state);
}

/** The player visits a kingdom: counted, and remembered by the kingdom. */
export function noteVisit(state, kid) {
  const f = ensureForeign(state);
  const v = f.visits[kid] ?? (f.visits[kid] = { count: 0, firstDay: state.day, lastDay: null });
  v.count++;
  v.lastDay = state.day;
  return v;
}

/** A foreign merchant house sends a named merchant with its caravan; they travel with it. */
export function leadMerchant(state, kid) {
  const m = peopleOf(state, kid, { includeAway: false }).filter((p) => p.role === 'merchant').sort((a, b) => a.trips - b.trips || a.id.localeCompare(b.id))[0];
  return m ?? null;
}

export function merchantSetsOut(state, p, cv) {
  p.trips++;
  p.location = null;
  p.travel = { from: p.kingdom, to: p.kingdom, departDay: state.day, arriveDay: null, why: 'caravan', caravanId: cv.id };
  cv.leadId = p.id;
}

/** Called each day for caravans led by named merchants: they come home when the caravan does. */
export function caravanReturns(state) {
  for (const p of Object.values(ensureForeign(state).people)) {
    if (p.travel?.why !== 'caravan') continue;
    const cv = state.trade?.caravans.find((c) => c.id === p.travel.caravanId);
    if (!cv || cv.status === 'COMPLETED' || cv.status === 'CANCELLED') {
      p.location = p.kingdom;
      p.travel = null;
      if (cv?.status === 'COMPLETED') { p.wealth += 8; remember(p, state, `Came home from a trading journey (${cv.id}).`); }
    }
  }
}

/** Where a named person is right now, for the panels. */
export function whereabouts(state, p) {
  if (p.travel?.why === 'caravan') return `travelling with caravan ${p.travel.caravanId}`;
  if (p.travel) return `on the road to ${KINGDOMS[p.travel.to].name} (due ${p.travel.arriveDay - state.day} days)`;
  return `in ${KINGDOMS[p.location]?.name ?? p.location}`;
}
