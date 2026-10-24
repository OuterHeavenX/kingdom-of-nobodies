import { COUNCIL, ECONOMY, FOOD_GOODS, GOODS, TIME } from '../core/Config.js';
import { transfer, balance } from '../economy/Transactions.js';
import { qty, moveGoods, addGoods } from '../economy/Inventory.js';
import { isTrading, BUSINESS_TYPES, wholesalePrice } from '../economy/Businesses.js';
import { buyRetail, rankSellers } from '../economy/Marketplace.js';
import { startProject } from '../property/Construction.js';
import { plotById, setBuilding, plotHistory } from '../property/LandRegistry.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { adjust } from '../citizens/Relationships.js';

// Player-facing council actions. Each one spends real treasury money (or sets
// a policy with a trade-off) and changes the simulation through normal systems.

const fail = (reason) => ({ ok: false, message: reason });
const done = (message) => ({ ok: true, message });

export const COUNCIL_ACTIONS = {
  /** Buy food from local sellers and hand it to the hungriest citizens. */
  foodAid(state) {
    const hungry = [...state.citizens].sort((a, b) => a.needs.hunger - b.needs.hunger).slice(0, COUNCIL.foodAidUnits);
    let given = 0, spent = 0;
    const council = { id: 'treasury', inventory: state.council.pantry, x: 0, z: 0, traits: {}, stats: { spent: 0 }, beliefs: {}, firstName: 'The council' };
    for (const c of hungry) {
      let good = FOOD_GOODS.find((g) => qty(state.council.pantry, g) > 0);
      if (!good) {
        const offer = FOOD_GOODS.flatMap((g) => rankSellers(state, council, g, { forFood: true })).sort((a, b) => a.price - b.price)[0];
        if (!offer || balance(state, 'treasury') < offer.price) break;
        const res = buyRetail(state, council, offer.business, offer.good, 1);
        if (!res.ok) break;
        spent += res.paid;
        good = offer.good;
      }
      moveGoods(state.council.pantry, c.inventory, good, 1);
      given++;
      remember(state, c, 'Received food from the council.', 1, 'council');
    }
    if (!given) return fail('No food could be found or afforded.');
    record(state, 'council', `The council handed out ${given} portions of food${spent ? ` (spending ${spent} coins)` : ' from the pantry'}.`, { citizens: hungry.slice(0, given).map((c) => c.id) }, 2);
    return done(`Food delivered to ${given} villagers.`);
  },

  /** Grant coins from the treasury to one citizen. */
  aid(state, citizenId) {
    const c = state.citizens.find((x) => x.id === citizenId);
    if (!c) return fail('Choose a villager first.');
    if (!transfer(state, 'treasury', c.id, COUNCIL.aidAmount, 'aid', `Council aid to ${c.firstName}`)) return fail('The treasury cannot afford it.');
    c.mood = Math.min(100, c.mood + 10);
    remember(state, c, `The council granted me ${COUNCIL.aidAmount} coins.`, 2, 'council');
    record(state, 'council', `The council granted ${c.firstName} ${COUNCIL.aidAmount} coins of aid.`, { citizens: [c.id] }, 1);
    return done(`${c.firstName} received ${COUNCIL.aidAmount} coins.`);
  },

  /** Commission a public cottage on council land, adding beds for newcomers. */
  publicCottage(state) {
    const plot = state.plots.find((p) => p.ownerId === 'council' && p.landType === 'residential' && !p.building && !p.projectId);
    if (!plot) return fail('No free council land for a cottage.');
    if (balance(state, 'treasury') < COUNCIL.publicCottageBudget) return fail(`Needs at least ${COUNCIL.publicCottageBudget} coins in the treasury.`);
    const res = startProject(state, { plotId: plot.id, ownerId: 'council', kind: 'construction', buildingType: 'cottage', purpose: 'civic' });
    if (!res.ok) return fail(res.reason);
    return done(`Builders will be paid from the treasury to raise a cottage on ${plot.name}.`);
  },

  /** One-off investment: a market square that draws more trade and makes travel to shops matter less. */
  marketplace(state) {
    if (state.council.marketplace) return fail('The marketplace already exists.');
    if (!transfer(state, 'treasury', 'outside', COUNCIL.marketplaceCost, 'expense', 'Market square paving and stalls')) return fail(`Needs ${COUNCIL.marketplaceCost} coins.`);
    state.council.marketplace = true;
    record(state, 'council', 'The council established a market square. Caravans will now visit every two days.', {}, 3);
    return done('Market square established.');
  },

  setTax(state, level) {
    if (!Object.hasOwn(ECONOMY.tax, level)) return fail('Unknown tax level.');
    state.council.taxLevel = level;
    record(state, 'council', `The council set the business levy to ${level} (${ECONOMY.tax[level]} coins a day per business).`, {}, 2);
    return done(`Taxes set to ${level}.`);
  },

  /** A festival buys real food from local businesses and gives everyone time together. */
  festival(state) {
    if (state.council.festivalCooldownUntil > state.day) return fail(`The village needs rest. Next festival after day ${state.council.festivalCooldownUntil}.`);
    let budget = Math.min(COUNCIL.festivalBudget, balance(state, 'treasury'));
    if (budget < 10) return fail('The treasury cannot fund a festival.');
    const council = { id: 'treasury', inventory: state.council.pantry, x: 0, z: 0, traits: {}, stats: { spent: 0 }, beliefs: {}, firstName: 'The council' };
    let spent = 0;
    for (const good of ['meal', 'bread', 'grain']) {
      for (const offer of rankSellers(state, council, good, { forFood: true })) {
        while (budget >= offer.price && qty(offer.business.inventory, good) > 0) {
          const res = buyRetail(state, council, offer.business, good, 1);
          if (!res.ok) break;
          budget -= res.paid; spent += res.paid;
        }
      }
    }
    for (const c of state.citizens) {
      const good = FOOD_GOODS.find((g) => qty(state.council.pantry, g) > 0);
      if (good) moveGoods(state.council.pantry, c.inventory, good, 1);
      c.mood = Math.min(100, c.mood + 8);
    }
    state.council.festivalUntil = state.tick + 6 * 8;
    state.council.festivalCooldownUntil = state.day + COUNCIL.festivalCooldownDays;
    record(state, 'council', `The council sponsored a village festival, buying ${spent} coins of food and drink from local businesses.`, {}, 3);
    return done(`Festival begun (spent ${spent} coins on local food).`);
  },

  /** Grant coins to a struggling business to keep it afloat. */
  supportBusiness(state, businessId) {
    const b = state.businesses.find((x) => x.id === businessId);
    if (!b || !isTrading(b)) return fail('Choose an open business.');
    if (!transfer(state, 'treasury', b.id, COUNCIL.businessGrant, 'grant', `Council grant to ${b.name}`)) return fail('The treasury cannot afford it.');
    b.struggleDays = Math.max(0, b.struggleDays - 2);
    const owner = state.citizens.find((c) => c.id === b.ownerId);
    if (owner) remember(state, owner, `The council granted ${b.name} ${COUNCIL.businessGrant} coins.`, 2, 'council');
    record(state, 'council', `The council granted ${b.name} ${COUNCIL.businessGrant} coins to stay afloat.`, { citizens: owner ? [owner.id] : [], business: b.id }, 2);
    return done(`${b.name} received ${COUNCIL.businessGrant} coins.`);
  },
};

/**
 * Daily standing duties the council performs on its own, all paid for with real
 * treasury money that flows back into the village economy:
 *  - keep council-run businesses solvent,
 *  - keep the pantry stocked by buying grain from local farms (or the caravan if none),
 *  - feed citizens who are starving and penniless,
 *  - reinvest a large surplus in public housing.
 */
export function councilDaily(state) {
  for (const b of state.businesses) {
    if (b.ownerId !== 'council' || !isTrading(b)) continue;
    if (balance(state, b.id) < 20 && balance(state, 'treasury') > 50) transfer(state, 'treasury', b.id, 15, 'grant', `Council funding for ${b.name}`);
  }
  restockPantry(state);
  // Standing policy: with a large surplus, back one struggling local business a day.
  if (balance(state, 'treasury') > COUNCIL.reserve + 120) {
    const b = state.businesses.find((x) => x.status === 'STRUGGLING' && x.ownerId !== 'council');
    if (b) COUNCIL_ACTIONS.supportBusiness(state, b.id);
  }
  for (const c of state.citizens) {
    if (balance(state, c.id) >= 3 || c.needs.hunger > 30) continue;
    const good = FOOD_GOODS.find((g) => qty(state.council.pantry, g) > 0);
    if (!good) break;
    moveGoods(state.council.pantry, c.inventory, good, 1);
    remember(state, c, 'The council fed me when I had nothing.', 1, 'council');
  }
  const surplus = balance(state, 'treasury') - COUNCIL.reserve;
  const residents = state.plots.reduce((s, p) => s + p.residents.length, 0);
  const beds = state.plots.reduce((s, p) => s + (p.building?.type === 'hall' ? 8 : p.building?.type === 'cottage' ? 2 : 0), 0);
  if (surplus > COUNCIL.publicCottageBudget && residents >= beds - 1 && !state.projects.some((p) => p.ownerId === 'council')) {
    const res = COUNCIL_ACTIONS.publicCottage(state);
    if (res.ok) record(state, 'council', 'With a healthy treasury, the council commissioned a public cottage for newcomers.', {}, 1);
  }
}

function restockPantry(state) {
  const target = 6 + state.citizens.length;
  let need = target - FOOD_GOODS.reduce((s, g) => s + qty(state.council.pantry, g), 0);
  if (need <= 0 || balance(state, 'treasury') < 40) return;
  const farms = state.businesses.filter((b) => isTrading(b) && b.type === 'farm' && qty(b.inventory, 'grain') > 4);
  for (const f of farms) {
    const unit = wholesalePrice(f, 'grain');
    const n = Math.min(need, qty(f.inventory, 'grain') - 4, Math.floor((balance(state, 'treasury') - 30) / unit));
    if (n > 0 && transfer(state, 'treasury', f.id, unit * n, 'wholesale', `${n} grain for the council pantry`)) {
      moveGoods(f.inventory, state.council.pantry, 'grain', n);
      f.today.revenue += unit * n;
      f.totals.revenue += unit * n;
      need -= n;
    }
  }
  if (need > 0 && !farms.length) {
    const n = Math.min(need, Math.floor((balance(state, 'treasury') - 30) / ECONOMY.caravanGrainPrice));
    if (n > 0 && transfer(state, 'treasury', 'outside', n * ECONOMY.caravanGrainPrice, 'import', `${n} grain imported for the pantry`)) {
      addGoods(state.council.pantry, 'grain', n);
    }
  }
}

export { GOODS, TIME };
