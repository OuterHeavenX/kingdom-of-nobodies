import { ECONOMY, GOODS } from '../core/Config.js';
import { openAccount } from './Transactions.js';
import { addGoods, removeGoods, qty } from './Inventory.js';

// Business archetypes and their production chains. One "batch" converts
// `inputs` into `output`. A worker shift produces up to `batchesPerShift`
// batches, scaled by worker productivity and limited by available inputs.
export const BUSINESS_TYPES = {
  farm: {
    label: 'Farm', building: 'farm', output: 'grain', outputPerBatch: 1, batchesPerShift: 6,
    inputs: {}, usesTools: true, sells: ['grain'], target: 18, maxStaff: 3, names: ['Fields', 'Farm', 'Acres'],
  },
  lumberyard: {
    label: 'Lumberyard', building: 'lumberyard', output: 'timber', outputPerBatch: 1, batchesPerShift: 3,
    inputs: {}, commons: 'forest', usesTools: true, sells: ['timber'], target: 14, maxStaff: 3, names: ['Lumberyard', 'Sawmill', 'Timber Works'],
  },
  blacksmith: {
    label: 'Blacksmith', building: 'blacksmith', output: 'tools', outputPerBatch: 1, batchesPerShift: 1,
    inputs: { ore: 2 }, sells: ['tools'], target: 4, maxStaff: 2, names: ['Forge', 'Smithy', 'Anvil'],
  },
  bakery: {
    label: 'Bakery', building: 'bakery', output: 'bread', outputPerBatch: 2, batchesPerShift: 3,
    inputs: { grain: 1 }, sells: ['bread'], target: 14, maxStaff: 2, names: ['Bakery', 'Ovens', 'Bread House'],
  },
  tavern: {
    label: 'Tavern', building: 'tavern', output: 'meal', outputPerBatch: 2, batchesPerShift: 2,
    inputs: { grain: 1 }, sells: ['meal'], target: 10, maxStaff: 2, names: ['Tavern', 'Inn', 'Alehouse'],
  },
  general_store: {
    label: 'General Store', building: 'general_store', output: null, batchesPerShift: 0,
    inputs: {}, sells: ['bread', 'grain', 'berries', 'timber', 'tools'], target: 6, maxStaff: 2, names: ['Store', 'Provisions', 'Trading Post'],
    resale: true,
  },
};

export const businessById = (state, id) => state.businesses.find((b) => b.id === id) ?? null;
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
  let batches = Math.floor(def.batchesPerShift * productivity + 0.5);
  const hasTool = def.usesTools && qty(b.inventory, 'tools') > 0;
  if (hasTool) batches = Math.round(batches * ECONOMY.toolBoost);
  const storageCap = def.target * 3;
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
  if (hasTool && made > 0 && ++b.toolWear >= ECONOMY.toolUses) {
    removeGoods(b.inventory, 'tools', 1);
    b.toolWear = 0;
  }
  b.today.produced += made;
  b.totals.produced += made;
  return made;
}

export function businessName(state, type, owner) {
  const def = BUSINESS_TYPES[type];
  const taken = new Set(state.businesses.map((b) => b.name));
  for (const suffix of def.names) {
    const name = owner ? `${owner.firstName}'s ${suffix}` : `Village ${suffix}`;
    if (!taken.has(name)) return name;
  }
  return `${owner ? owner.firstName + "'s" : 'Village'} ${def.label} ${state.nextId.business + 1}`;
}
