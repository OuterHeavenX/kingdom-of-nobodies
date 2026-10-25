import { balance, transfer } from '../economy/Transactions.js';
import { seasonIndex, yearOf } from '../core/Calendar.js';
import { DAYS_PER_YEAR } from '../core/Config.js';
import { nextRandom, pick } from '../core/Random.js';
import { record } from '../society/Chronicle.js';
import { COMMODITIES, FOOD_COMMODITIES, KINGDOMS, FOOD_NEED } from './RegionData.js';

// Neighbouring kingdoms are simulated in aggregate, once a day: production
// (with input chains and seasons), consumption, hunger, population, prices,
// a leader whose stance follows circumstances, and a thin "distant world"
// buffer (overseas and beyond the mountains) that buys gluts cheaply and
// sells in emergencies dearly. Nobody abroad is simulated individually.

// Seasonal production factors [spring, summer, autumn, winter].
const SEASONAL = {
  grain: [0.75, 1.1, 1.45, 0.55], provisions: [0.9, 1.1, 1.2, 0.75], fish: [1, 1.2, 1, 0.65], salt: [0.9, 1.3, 1, 0.6],
  ore: [0.95, 1.05, 1, 0.8], iron: [1, 1, 1, 0.85], stone: [0.9, 1.1, 1, 0.7], tools: [1, 1, 1, 0.9], timber: [1, 1, 1, 0.8], luxuries: [1, 1, 1, 1],
};
export const seasonalFactor = (state, good) => (SEASONAL[good] ?? [1, 1, 1, 1])[seasonIndex(state.day)];

const COVER_DAYS = 8;
// What the lands beyond the region pay for a glut, as a share of the base price:
// worked metal and luxuries travel well; bulk goods hardly pay their carriage.
const EXPORT_FACTOR = { iron: 0.75, tools: 0.75, luxuries: 0.8, salt: 0.6, fish: 0.5, provisions: 0.55, grain: 0.5, ore: 0.5, stone: 0.5, timber: 0.5 };
const PRICE = { min: 0.45, max: 3 };

export function createKingdomState(id, rand) {
  const def = KINGDOMS[id];
  const inventory = Object.fromEntries(Object.keys(COMMODITIES).map((g) => [g, 0]));
  for (const [g, rate] of Object.entries(def.produces)) inventory[g] = Math.round(rate * def.population / 100 * 10);
  for (const [g, rate] of Object.entries(def.needs)) inventory[g] = (inventory[g] ?? 0) + Math.round(rate * def.population / 100 * COVER_DAYS);
  const k = {
    id, name: def.name, population: def.population, growth: 0,
    leader: { name: def.leaders[Math.floor(rand() * def.leaders.length)], title: def.leaderTitle, stance: def.stances[0], since: 1, approval: 62 },
    inventory, reserved: {}, prices: {}, prosperity: 1, hunger: 0, unrestDays: 0,
    tariff: def.stances[0] === 'protectionist' ? 0.15 : 0.08,
    modifiers: [], shortages: {}, history: [], usage: {},
    stats: { imports: 0, exports: 0, overseasIn: 0, overseasOut: 0 },
  };
  for (const g of Object.keys(COMMODITIES)) k.prices[g] = COMMODITIES[g].base;
  return k;
}

export const available = (k, g) => Math.max(0, Math.floor((k.inventory[g] ?? 0) - (k.reserved[g] ?? 0)));

/** Daily food requirement. */
export const foodNeed = (state, k) => (k.population / 100) * FOOD_NEED * (seasonIndex(state.day) === 3 ? 1.15 : 1);

/** How many days the kingdom's food lasts at today's needs. */
export function foodCover(state, k) {
  const stock = FOOD_COMMODITIES.reduce((t, g) => t + (k.inventory[g] ?? 0) - (k.reserved[g] ?? 0), 0);
  return stock / Math.max(0.1, foodNeed(state, k));
}

function modifier(state, k, g) {
  let f = 1;
  for (const m of k.modifiers) if (m.until >= state.day && (!m.goods || m.goods.includes(g))) f *= m.factor;
  return f;
}

function note(state, k, text, importance = 1) {
  k.history.push({ day: state.day, text });
  if (k.history.length > 40) k.history.shift();
  record(state, 'region', `${k.name}: ${text}`, {}, importance);
}

/** One day of life in a neighbouring kingdom. */
export function simulateKingdom(state, k) {
  const def = KINGDOMS[k.id];
  const scale = k.population / 100;
  k.modifiers = k.modifiers.filter((m) => m.until >= state.day);
  // Production, honouring input chains (iron needs ore, tools need iron).
  for (const [g, rate] of Object.entries(def.produces)) {
    let out = rate * scale * seasonalFactor(state, g) * k.prosperity * modifier(state, k, g);
    for (const [input, per] of Object.entries(def.inputs?.[g] ?? {})) out = Math.min(out, available(k, input) / per);
    for (const [input, per] of Object.entries(def.inputs?.[g] ?? {})) k.inventory[input] -= out * per;
    k.inventory[g] = (k.inventory[g] ?? 0) + out;
    k.usage[g] = { ...(k.usage[g] ?? {}), made: out };
  }
  // Ordinary needs.
  for (const [g, rate] of Object.entries(def.needs)) {
    const want = rate * scale;
    const used = Math.min(want, available(k, g));
    k.inventory[g] = (k.inventory[g] ?? 0) - used;
    k.usage[g] = { ...(k.usage[g] ?? {}), used: want };
    if (used < want * 0.5) k.shortages[g] = k.shortages[g] ?? state.day; else delete k.shortages[g];
  }
  // Food, eaten from whatever is most plentiful first.
  let need = foodNeed(state, k);
  const wanted = need;
  for (const g of [...FOOD_COMMODITIES].sort((a, b) => available(k, b) - available(k, a))) {
    const eat = Math.min(need, available(k, g));
    k.inventory[g] -= eat;
    need -= eat;
    k.usage[g] = { ...(k.usage[g] ?? {}), eaten: eat };
  }
  const hunger = wanted > 0 ? need / wanted : 0;
  k.hunger = Math.round((k.hunger * 0.6 + hunger * 0.4) * 1000) / 1000;
  const wasShort = !!k.shortages.food;
  if (foodCover(state, k) < 2.5 || k.hunger > 0.05) k.shortages.food = k.shortages.food ?? state.day; else delete k.shortages.food;
  if (!wasShort && k.shortages.food) note(state, k, `food is running short (about ${Math.max(0, Math.round(foodCover(state, k)))} days left); grain prices are climbing.`, 2);
  if (wasShort && !k.shortages.food) note(state, k, 'food stores have recovered.', 1);
  // Spoilage of perishable food.
  for (const g of FOOD_COMMODITIES) k.inventory[g] = Math.max(0, (k.inventory[g] ?? 0) * (1 - (COMMODITIES[g].perishable ?? 0) * 0.5));
  // Population follows food security, within the land's capacity.
  if (k.hunger > 0.12) k.growth -= k.population * 0.006 * k.hunger;
  else if (k.population < def.capacity) k.growth += k.population * 0.0006 * k.prosperity;
  if (Math.abs(k.growth) >= 1) {
    const n = Math.trunc(k.growth);
    k.population = Math.max(40, k.population + n);
    k.growth -= n;
  }
  k.prosperity = Math.round(Math.max(0.6, Math.min(1.25, k.prosperity * 0.9 + (1.05 - k.hunger * 0.8 - Object.keys(k.shortages).length * 0.04) * 0.1)) * 1000) / 1000;
  updatePrices(state, k);
  distantWorld(state, k);
  leadership(state, k);
  for (const g of Object.keys(k.inventory)) k.inventory[g] = Math.max(0, Math.round(k.inventory[g] * 100) / 100);
}

/** Bounded supply-and-demand prices: scarce goods rise, gluts fall, a step at a time. */
export function updatePrices(state, k) {
  const def = KINGDOMS[k.id];
  for (const g of Object.keys(COMMODITIES)) {
    const base = COMMODITIES[g].base;
    const daily = COMMODITIES[g].food ? foodNeed(state, k) * 0.5 : (def.needs[g] ?? 0) * k.population / 100;
    const made = (def.produces[g] ?? 0) * k.population / 100;
    const stock = available(k, g);
    let target;
    if (daily > 0.05) target = base * Math.pow((daily * COVER_DAYS) / Math.max(0.5, stock), 0.55);
    else if (made > 0) target = base * Math.pow((made * 12) / Math.max(1, stock), 0.4) * 0.85;
    else target = base * 1.2; // neither made nor needed: priced as a curiosity
    target = Math.max(base * PRICE.min, Math.min(base * PRICE.max, target));
    k.prices[g] = Math.round((k.prices[g] + (target - k.prices[g]) * 0.2) * 100) / 100;
  }
}

/**
 * Trade with the lands beyond the region. Large surpluses are sold cheaply,
 * and a kingdom close to famine buys food dearly. Money moves through the
 * ledger with the 'outside' account, so nothing is created.
 */
function distantWorld(state, k) {
  const def = KINGDOMS[k.id];
  const acct = def.account;
  for (const [g, rate] of Object.entries(def.produces)) {
    const glut = available(k, g) - rate * k.population / 100 * 22;
    if (glut < 4) continue;
    const n = Math.floor(glut * 0.25);
    const unit = Math.max(1, Math.round(COMMODITIES[g].base * (EXPORT_FACTOR[g] ?? 0.55)));
    if (n > 0 && balance(state, 'outside') > unit * n && transfer(state, 'outside', acct, unit * n, 'export', `${k.name} sold ${n} ${g} beyond the region`)) {
      k.inventory[g] -= n;
      k.stats.overseasOut += unit * n;
    }
  }
  // A prosperous kingdom does not hoard: coins well above its reserve are spent on
  // goods from distant lands (cloth, wine, building), which keeps money moving
  // through the wider world instead of piling up in one treasury.
  const reserve = 2500 + k.population * 12;
  const excess = balance(state, acct) - reserve;
  if (excess > 50) {
    const spend = Math.floor(excess * 0.02);
    if (spend > 0 && transfer(state, acct, 'outside', spend, 'import', `${k.name} spent ${spend} coins on goods from distant lands`)) k.stats.overseasIn += spend;
  }
  // Distant grain is a last resort: dear, and only when the stores are nearly empty.
  if (foodCover(state, k) < 1) {
    const n = Math.ceil(foodNeed(state, k) * 1.2);
    const unit = Math.round(COMMODITIES.grain.base * 2.2);
    const afford = Math.min(n, Math.floor((balance(state, acct) - 200) / unit));
    if (afford > 0 && transfer(state, acct, 'outside', unit * afford, 'import', `${k.name} bought ${afford} grain from distant lands`)) {
      k.inventory.grain = (k.inventory.grain ?? 0) + afford;
      k.stats.overseasIn += unit * afford;
    }
  }
}

/** Leaders keep office while people are content; stances follow circumstances. */
function leadership(state, k) {
  const def = KINGDOMS[k.id];
  const L = k.leader;
  // Feuds wear on a people: every embargo it imposes or suffers costs the leader support.
  const feuds = (state.diplomacy?.embargoes ?? []).filter((e) => e.status === 'ACTIVE' && (e.by === k.id || e.against === k.id)).length;
  const target = 70 - k.hunger * 120 - Object.keys(k.shortages).length * 6 + (k.prosperity - 1) * 60 - feuds * 9;
  L.approval = Math.round(Math.max(0, Math.min(100, L.approval + (target - L.approval) * 0.08)));
  k.unrestDays = L.approval < 28 ? k.unrestDays + 1 : 0;
  const tenure = state.day - L.since;
  if (k.unrestDays >= 6 || tenure > DAYS_PER_YEAR * 9) {
    const previous = L.name;
    const ousted = k.unrestDays >= 6;
    const others = def.leaders.filter((n) => n !== previous);
    // A hungry or embattled people elects protection; a prosperous one, trade; one tired of feuds, peace.
    const stance = feuds >= 2 ? 'cooperative' : k.hunger > 0.1 || Object.keys(k.shortages).length > 2 ? (nextRandom(state) < 0.6 ? 'protectionist' : 'cooperative') : pick(state, def.stances);
    k.leader = { name: pick(state, others), title: def.leaderTitle, stance, since: state.day, approval: 60 };
    k.unrestDays = 0;
    k.tariff = stance === 'protectionist' ? 0.16 : stance === 'mercantile' ? 0.06 : 0.09;
    note(state, k, `${previous} ${ousted ? 'was driven from office by unrest' : 'stepped down after long service'}; ${k.leader.name} became ${def.leaderTitle} with a ${stance} outlook (Year ${yearOf(state.day)}).`, 2);
  }
}

export { note as kingdomNote };
