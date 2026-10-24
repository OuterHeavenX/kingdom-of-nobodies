import { seasonIndex } from '../core/Calendar.js';
import { ECONOMY, GOODS } from '../core/Config.js';
import { openAccount } from './Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { harvestMultiplier } from '../events/Disasters.js';
import { addGoods, removeGoods, qty } from './Inventory.js';

// Business archetypes and their production chains. One "batch" converts
// `inputs` into `output`. A worker shift produces up to `batchesPerShift`
// batches, scaled by worker productivity and limited by available inputs.
// Farming follows the seasons: planting, growth, harvest, winter fallow.
export const FARM_SEASON = [0.85, 1.1, 1.3, 0.7];

export const BUSINESS_TYPES = {
  farm: {
    label: 'Farm', building: 'farm', output: 'grain', outputPerBatch: 1, batchesPerShift: 13,
    inputs: {}, usesTools: true, sells: ['grain'], target: 24, maxStaff: 6, names: ['Fields', 'Farm', 'Acres'],
  },
  lumberyard: {
    label: 'Lumberyard', building: 'lumberyard', output: 'timber', outputPerBatch: 1, batchesPerShift: 3,
    inputs: {}, commons: 'forest', usesTools: true, sells: ['timber'], target: 14, maxStaff: 4, names: ['Lumberyard', 'Sawmill', 'Timber Works'],
  },
  blacksmith: {
    label: 'Blacksmith', building: 'blacksmith', output: 'tools', outputPerBatch: 1, batchesPerShift: 1,
    inputs: { ore: 2 }, sells: ['tools'], target: 4, maxStaff: 3, names: ['Forge', 'Smithy', 'Anvil'],
  },
  bakery: {
    label: 'Bakery', building: 'bakery', output: 'bread', outputPerBatch: 2, batchesPerShift: 3,
    inputs: { grain: 1 }, sells: ['bread'], target: 14, maxStaff: 3, names: ['Bakery', 'Ovens', 'Bread House'],
  },
  tavern: {
    label: 'Tavern', building: 'tavern', output: 'meal', outputPerBatch: 2, batchesPerShift: 2,
    inputs: { grain: 1 }, sells: ['meal'], target: 10, maxStaff: 3, names: ['Tavern', 'Inn', 'Alehouse'],
  },
  general_store: {
    label: 'General Store', building: 'general_store', output: null, batchesPerShift: 0,
    inputs: {}, sells: ['bread', 'grain', 'berries', 'timber', 'tools'], target: 6, maxStaff: 3, names: ['Store', 'Provisions', 'Trading Post'],
    resale: true,
  },
  // A council-funded institution: no sales, teachers paid from the treasury.
  school: {
    label: 'School', building: 'school', output: null, batchesPerShift: 0,
    inputs: {}, sells: [], target: 0, maxStaff: 2, names: ['Village School', 'Schoolhouse'], civic: true,
  },
  // Council-run public works crew: maintains buildings and roads, paid from the treasury.
  works: {
    label: 'Village Works', building: 'hall', output: null, batchesPerShift: 0,
    inputs: {}, sells: [], target: 0, maxStaff: 8, names: ['Village Works'], civic: true,
  },
};

/** Staff a business can employ: bigger premises (upgrades) take more hands. */
export const staffCap = (b) => BUSINESS_TYPES[b.type].maxStaff + ((b.level ?? 1) - 1) * 2;

export const businessById = (state, id) => byId(state.businesses, id);
export const isTrading = (b) => b.status === 'OPEN' || b.status === 'STRUGGLING';

export function createBusiness(state, { type, ownerId, plotId, name }) {
  const def = BUSINESS_TYPES[type];
  const id = 'b' + ++state.nextId.business;
  const prices = {};
  for (const g of def.sells) prices[g] = GOODS[g].base;
  const b = {
    id, type, name, ownerId, plotId,
    inventory: {},
    prices,
    priceMult: Object.fromEntries(def.sells.map((g) => [g, 1])),
    employees: [],
    openings: 0,
    status: 'OPEN',
    foundedDay: state.day,
    closedDay: null,
    quality: 0.5,
    toolWear: 0,
    today: freshLedger(),
    history: [],
    totals: { revenue: 0, expenses: 0, customers: 0, produced: 0 },
    struggleDays: 0,
    unpaidShifts: 0,
    firstSale: false,
  };
  state.businesses.push(b);
  openAccount(state, id, 0);
  return b;
}

export function freshLedger() {
  return { revenue: 0, wages: 0, inputs: 0, tax: 0, other: 0, customers: 0, produced: 0 };
}

export function retailPrice(b, good) {
  return Math.max(1, Math.round(GOODS[good].base * (b.priceMult[good] ?? 1)));
}

export function wholesalePrice(b, good) {
  return Math.max(1, Math.round(retailPrice(b, good) * ECONOMY.wholesaleFactor));
}

/**
 * Run production for one completed worker shift. Inputs are consumed batch by
 * batch; production stops when inputs or the commons run out, or storage is full.
 * Returns the number of output units produced.
 */
export function produce(state, b, productivity) {
  const def = BUSINESS_TYPES[b.type];
  if (!def.output) return 0;
  let perShift = def.batchesPerShift;
  if (b.type === 'farm') perShift *= harvestMultiplier(state) * (state.discoveries?.improvedPlow ? 1.2 : 1) * FARM_SEASON[seasonIndex(state.day)];
  if (b.type === 'bakery' && state.discoveries?.watermill) perShift += 1;
  const plot = state.plots.find((p) => p.id === b.plotId);
  if ((plot?.building?.condition ?? 100) < 60) perShift *= 0.6;
  perShift *= 1 + ((b.level ?? 1) - 1) * 0.15;
  let batches = Math.floor(perShift * productivity + 0.5);
  const hasTool = def.usesTools && qty(b.inventory, 'tools') > 0;
  if (hasTool) batches = Math.round(batches * ECONOMY.toolBoost);
  // Barns hold more at harvest time, so the autumn surplus can be stored for winter.
  const storageCap = def.target * (b.type === 'farm' && seasonIndex(state.day) === 2 ? 4.5 : 3);
  let made = 0;
  for (let i = 0; i < batches; i++) {
    if (qty(b.inventory, def.output) + def.outputPerBatch > storageCap) break;
    if (!Object.entries(def.inputs).every(([g, n]) => qty(b.inventory, g) >= n)) break;
    if (def.commons) {
      if (state.commons[def.commons] < 1) break;
      state.commons[def.commons] -= 1;
    }
    for (const [g, n] of Object.entries(def.inputs)) removeGoods(b.inventory, g, n);
    addGoods(b.inventory, def.output, def.outputPerBatch);
    made += def.outputPerBatch;
  }
  if (hasTool && made > 0 && ++b.toolWear >= ECONOMY.toolUses * (state.discoveries?.betterTools ? 1.5 : 1)) {
    removeGoods(b.inventory, 'tools', 1);
    b.toolWear = 0;
  }
  b.today.produced += made;
  b.totals.produced += made;
  return made;
}

export function businessName(state, type, owner) {
  const def = BUSINESS_TYPES[type];
  const taken = new Set(state.businesses.filter(isTrading).map((b) => b.name));
  for (const suffix of def.names) {
    const name = owner ? `${owner.firstName}'s ${suffix}` : `Village ${suffix}`;
    if (!taken.has(name)) return name;
  }
  return `${owner ? owner.firstName + "'s" : 'Village'} ${def.label} ${state.nextId.business + 1}`;
}
