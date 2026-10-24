import { balance, transfer } from '../economy/Transactions.js';
import { qty, moveGoods } from '../economy/Inventory.js';
import { isTrading, wholesalePrice } from '../economy/Businesses.js';
import { buyRetail, isOpenNow } from '../economy/Marketplace.js';
import { seasonIndex, dayOfSeason, yearOf } from '../core/Calendar.js';
import { COUNCIL, FOOD_GOODS, LIFE } from '../core/Config.js';
import { ageOf } from '../citizens/Citizen.js';
import { byId } from '../core/EntityRegistry.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';

// Four festivals turn the seasons. Each is prepared on the first day of its
// season (the council budgets coins and buys real food from local sellers;
// a sponsoring family may chip in; the Midsummer Fair invites foreign
// merchants) and held on the second day from mid-afternoon into the night.
// Citizens decide for themselves whether to go. Afterwards the village
// remembers who came, what it cost and what it ate.

export const FESTIVALS = [
  { season: 0, name: 'Festival of Renewal', budget: 18, food: 0.6, mood: 5, text: 'the planting season begins with dancing on the green' },
  { season: 1, name: 'Midsummer Fair', budget: 22, food: 0.6, mood: 6, fair: true, text: 'merchants from the kingdoms set up stalls in the square' },
  { season: 2, name: 'Harvest Festival', budget: 28, food: 1.2, mood: 7, text: 'families feast on the year\'s harvest' },
  { season: 3, name: 'Hearthlight Gathering', budget: 16, food: 0.5, mood: 6, text: 'families gather around the great hearth through the long night' },
];
export const FESTIVAL_HOURS = [14, 22];

export function ensureCulture(state) {
  state.culture = state.culture ?? { current: null, history: [], traditions: [], exchange: { exposure: {}, adopted: [] }, sponsors: [] };
  return state.culture;
}

export const festivalFor = (day) => FESTIVALS[seasonIndex(day)];

/** Is a seasonal festival going on right now? */
export function festivalNow(state) {
  const f = state.culture?.current;
  if (!f || f.phase !== 'ACTIVE') return null;
  const h = state.minute / 60;
  return h >= FESTIVAL_HOURS[0] && h < FESTIVAL_HOURS[1] ? f : null;
}

/** Buy food for the feast from local sellers (wholesale), paid from the festival budget. */
function provision(state, f, want) {
  let bought = 0;
  for (const good of ['grain', 'bread', 'meal', 'berries']) {
    for (const b of state.businesses.filter((x) => isTrading(x) && qty(x.inventory, good) > 2)) {
      while (bought < want && f.budget - f.spent >= 1 && qty(b.inventory, good) > 2) {
        const unit = Math.max(1, wholesalePrice(b, good));
        if (f.budget - f.spent < unit || !transfer(state, 'treasury', b.id, unit, 'festival', `${f.name}: ${good} for the feast`)) break;
        moveGoods(b.inventory, f.stock, good, 1);
        b.today.revenue += unit; b.totals.revenue += unit;
        f.spent += unit;
        bought++;
      }
    }
  }
  // The pantry gives what the market cannot.
  for (const good of FOOD_GOODS) while (bought < want && qty(state.council.pantry, good) > 10) { moveGoods(state.council.pantry, f.stock, good, 1); bought++; }
  return bought;
}

/** First day of a season: plan the festival. */
function prepare(state) {
  const culture = ensureCulture(state);
  const def = festivalFor(state.day);
  const traditions = culture.traditions.filter((t) => t.active && t.season === def.season);
  const f = { name: def.name, season: def.season, year: yearOf(state.day), day: state.day + 1, phase: 'PREPARING', budget: 0, spent: 0, stock: {}, attendees: [], fed: 0, sales: 0, sponsor: null, traditions: traditions.map((t) => t.name), foreignMerchants: [] };
  // The council funds what it can spare above its reserve.
  const spare = balance(state, 'treasury') - COUNCIL.reserve * 0.3;
  f.budget = Math.max(0, Math.min(def.budget + state.citizens.length * 0.15, spare));
  // A family tradition (or the richest willing house) sponsors the feast.
  const sponsor = sponsorFor(state, def, traditions);
  if (sponsor) {
    const gift = Math.min(25, Math.floor(balance(state, sponsor.id) * 0.1));
    if (gift >= 5 && transfer(state, sponsor.id, 'treasury', gift, 'festival', `${sponsor.firstName} ${sponsor.lastName} sponsors the ${def.name}`)) {
      f.budget += gift;
      f.sponsor = { id: sponsor.id, house: sponsor.lastName, gift };
      culture.sponsors.push({ year: f.year, season: def.season, house: sponsor.lastName, id: sponsor.id });
      if (culture.sponsors.length > 40) culture.sponsors.shift();
    }
  }
  if (f.budget < 6) {
    f.phase = 'CANCELLED';
    culture.current = f;
    record(state, 'culture', `There will be no ${def.name} this year: the treasury cannot spare the coins.`, {}, 2);
    for (const c of state.citizens) c.mood = Math.max(0, c.mood - 2);
    return;
  }
  const want = Math.ceil(state.citizens.length * def.food);
  const bought = provision(state, f, want);
  f.foodPrepared = bought;
  if (def.fair) for (const id of Object.keys(state.region?.settlements ?? {})) if ((state.diplomacy?.relations?.[['hearth', id].sort().join('|')]?.score ?? 0) > 10) f.foreignMerchants.push(id);
  culture.current = f;
  record(state, 'culture', `The village prepares the ${def.name}: ${f.budget} coins budgeted${f.sponsor ? ` (${f.sponsor.gift} given by the ${f.sponsor.house} family)` : ''}, ${bought} portions of food bought from local sellers${f.foreignMerchants.length ? `, and merchants invited from ${f.foreignMerchants.length} kingdom${f.foreignMerchants.length > 1 ? 's' : ''}` : ''}.`, f.sponsor ? { citizens: [f.sponsor.id] } : {}, 2);
}

function sponsorFor(state, def, traditions) {
  const tradition = traditions.find((t) => t.kind === 'sponsorship');
  if (tradition) {
    const heir = state.citizens.filter((c) => c.lastName === tradition.house && ageOf(state, c) >= LIFE.adultAge).sort((a, b) => balance(state, b.id) - balance(state, a.id))[0];
    if (heir) return heir;
  }
  if (def.season !== 2) return null;
  return state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge && balance(state, c.id) >= 120 && trait(c, 'generous') > 0.3)
    .sort((a, b) => balance(state, b.id) - balance(state, a.id) || a.id.localeCompare(b.id))[0] ?? null;
}

/** How much a citizen wants to go (with reasons), or null if they can't. */
export function attendanceScore(state, c) {
  const f = festivalNow(state);
  if (!f || c.away || (c.health?.sickUntil ?? 0) > state.day) return null;
  const factors = [[`the ${f.name} is on in the square`, 30]];
  factors.push(['I enjoy company', trait(c, 'friendly') * 22 - trait(c, 'shy') * 18]);
  factors.push([`I've been lonely`, (100 - c.needs.social) * 0.3]);
  factors.push(['my spirits', (c.mood - 50) * 0.2]);
  if (c.employment && c.shiftsToday === 0 && state.minute / 60 < 18) factors.push(['I still owe a shift today', -18 * (0.5 + trait(c, 'hardworking'))]);
  const d = Math.hypot(c.x, c.z);
  factors.push(['the walk to the square', -d / 8]);
  if (f.traditions.length) factors.push([`it's ${f.traditions[0]}`, 8]);
  if (c.lastName === f.sponsor?.house) factors.push(['my family sponsors the feast', 20]);
  const score = factors.reduce((t, [, v]) => t + v, 0);
  return { score, factors: factors.filter(([, v]) => Math.abs(v) >= 1) };
}

/** A villager at the festival: company, a share of the feast, perhaps a treat from a stall. */
export function enjoyFestival(state, c) {
  const f = state.culture?.current;
  if (!f || f.phase !== 'ACTIVE') return;
  if (!f.attendees.includes(c.id)) f.attendees.push(c.id);
  const def = FESTIVALS[f.season];
  c.mood = Math.min(100, c.mood + def.mood * 0.5);
  if (c.needs.hunger < 80) {
    const good = FOOD_GOODS.find((g) => qty(f.stock, g) > 0);
    if (good) { moveGoods(f.stock, c.inventory, good, 1); f.fed++; }
  }
  // Market activity: those with coins buy a treat from a stall or the tavern.
  if (balance(state, c.id) > 15 && trait(c, 'frugal') < 0.6) {
    const stall = state.businesses.find((b) => isOpenNow(state, b) && (qty(b.inventory, 'meal') > 0 || qty(b.inventory, 'bread') > 0));
    if (stall) {
      const good = qty(stall.inventory, 'meal') > 0 ? 'meal' : 'bread';
      const res = buyRetail(state, c, stall, good, 1);
      if (res.ok) f.sales += res.paid;
    }
  }
}

/** Daily: prepare on the first day of a season, open on the second, close on the third. */
export function dailyFestivals(state) {
  const culture = ensureCulture(state);
  const d = dayOfSeason(state.day);
  if (d === 1 && (!culture.current || culture.current.day < state.day)) {
    if (culture.current && culture.current.phase !== 'DONE' && culture.current.phase !== 'CANCELLED') conclude(state);
    prepare(state);
  } else if (d === 2 && culture.current?.phase === 'PREPARING' && culture.current.day === state.day) {
    culture.current.phase = 'ACTIVE';
    record(state, 'culture', `The ${culture.current.name} begins this afternoon: ${FESTIVALS[culture.current.season].text}.`, {}, 1);
  } else if (d === 3 && culture.current?.phase === 'ACTIVE') conclude(state);
}

function conclude(state) {
  const culture = ensureCulture(state);
  const f = culture.current;
  f.phase = 'DONE';
  // Leftover feast food goes to the pantry for those in need.
  for (const g of Object.keys(f.stock)) moveGoods(f.stock, state.council.pantry, g, qty(f.stock, g));
  const adults = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge).length;
  const share = f.attendees.length / Math.max(1, state.citizens.length);
  for (const id of f.attendees) { const c = byId(state.citizens, id); if (c) remember(state, c, `Celebrated the ${f.name} in Year ${f.year}.`, 1, 'social'); }
  const entry = { name: f.name, season: f.season, year: f.year, day: f.day, attendance: f.attendees.length, population: state.citizens.length, cost: f.spent, budget: Math.round(f.budget), fed: f.fed, sales: f.sales, sponsor: f.sponsor?.house ?? null, traditions: f.traditions, foreignMerchants: f.foreignMerchants };
  culture.history.push(entry);
  if (culture.history.length > 48) culture.history.shift();
  record(state, 'culture', `The ${f.name} drew ${f.attendees.length} villagers (${Math.round(share * 100)}%); ${f.fed} shared the feast and stalls took ${f.sales} coins. It cost the council ${f.spent} coins.`, {}, f.attendees.length > adults / 2 ? 2 : 1);
  state.stats.festivalAttendance = (state.stats.festivalAttendance ?? 0) + f.attendees.length;
}

