import { launchExpedition } from '../region/Exploration.js';
import { sendGift } from '../diplomacy/Diplomacy.js';
import { leaveJob } from '../economy/Employment.js';
import { needsCourthouse } from '../law/Courts.js';
import { byId } from '../core/EntityRegistry.js';
import { COUNCIL, ECONOMY, FOOD_GOODS, GOODS, TIME } from '../core/Config.js';
import { transfer, balance } from '../economy/Transactions.js';
import { qty, moveGoods, addGoods } from '../economy/Inventory.js';
import { isTrading, BUSINESS_TYPES, wholesalePrice, createBusiness, businessName } from '../economy/Businesses.js';
import { buyRetail, rankSellers } from '../economy/Marketplace.js';
import { startProject } from '../property/Construction.js';
import { plotById, setBuilding, plotHistory, bedsAt, allows, BUILDING_INFO } from '../property/LandRegistry.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { adjust } from '../citizens/Relationships.js';

// Player-facing council actions. Each one spends real treasury money (or sets
// a policy with a trade-off) and changes the simulation through normal systems.

const fail = (reason) => ({ ok: false, message: reason });
const done = (message) => ({ ok: true, message });

export const COUNCIL_ACTIONS = {
  /** Pay for a scouting party to map the region. */
  scout(state) {
    const res = launchExpedition(state, { reason: 'the council, at your request,' });
    return res.ok ? done(res.message) : fail(res.message);
  },

  /** Send a diplomatic gift to a kingdom. */
  gift(state, kingdomId) {
    const res = sendGift(state, kingdomId);
    return res.ok ? done(res.message) : fail(res.message);
  },

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
    const c = byId(state.citizens, citizenId);
    if (!c) return fail('Choose a villager first.');
    if (!transfer(state, 'treasury', c.id, COUNCIL.aidAmount, 'aid', `Council aid to ${c.firstName}`)) return fail('The treasury cannot afford it.');
    c.mood = Math.min(100, c.mood + 10);
    remember(state, c, `The council granted me ${COUNCIL.aidAmount} coins.`, 2, 'council');
    record(state, 'council', `The council granted ${c.firstName} ${COUNCIL.aidAmount} coins of aid.`, { citizens: [c.id] }, 1);
    return done(`${c.firstName} received ${COUNCIL.aidAmount} coins.`);
  },

  /** Commission a public cottage on council land, adding beds for newcomers. */
  publicCottage(state) {
    const plot = state.plots.find((p) => p.ownerId === 'council' && p.landType === 'residential' && !p.building && !p.projectId && !(p.reservedBy && p.reservedUntil > state.tick));
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
    if (state.government?.leaderId) return fail(`Taxes are now set by the elected ${state.government.title}.`);
    state.council.taxLevel = level;
    if (state.government) state.government.policies.taxLevel = level;
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
    const owner = byId(state.citizens, b.ownerId);
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
/** The tithe: a small daily levy on personal savings above a floor, scaled by tax policy. */
export function collectTithe(state) {
  const rate = ECONOMY.tithe[state.council.taxLevel] ?? ECONOMY.tithe.normal;
  let total = 0;
  if (balance(state, 'treasury') > ECONOMY.treasuryComfort) return 0; // coffers are full: no tithe today
  for (const c of state.citizens) {
    const due = Math.floor((balance(state, c.id) - ECONOMY.titheFloor) * rate);
    if (due > 0 && transfer(state, c.id, 'treasury', due, 'tax', `${c.firstName}'s tithe`)) total += due;
  }
  return total;
}

/**
 * Public infrastructure as the town grows, paid from the treasury through
 * ordinary construction: a well (fire and fever protection), a granary
 * (larger pantry, less spoilage) and, for a growing town, a Town Hall that
 * replaces the old Hearth Hall.
 */
export function councilInfrastructure(state) {
  if (state.day % 4 !== 0 || state.projects.some((p) => p.ownerId === 'council' && ['well', 'granary', 'townhall', 'courthouse'].includes(p.buildingType))) return;
  const t = balance(state, 'treasury');
  const pop = state.citizens.length;
  const have = (type) => state.plots.some((p) => p.building?.type === type);
  const civicLand = () => state.plots.find((p) => p.ownerId === 'council' && !p.building && !p.projectId && p.landType === 'civic');
  let plan = null;
  if (pop >= 18 && !have('well') && t > 80) plan = { buildingType: 'well', plot: civicLand() };
  else if (pop >= 30 && !have('granary') && t > 150) plan = { buildingType: 'granary', plot: civicLand() };
  else if (needsCourthouse(state) && pop >= 25 && !have('courthouse') && t > 120) plan = { buildingType: 'courthouse', plot: civicLand() };
  else if (pop >= 45 && !have('townhall') && t > 220) plan = { buildingType: 'townhall', plot: state.plots.find((p) => p.building?.type === 'hall' && !p.projectId), refit: true };
  else if (pop >= 60 && state.plots.filter((p) => p.building?.type === 'well').length < 2 && t > 160) plan = { buildingType: 'well', plot: civicLand() };
  if (!plan?.plot) return;
  const res = startProject(state, { plotId: plan.plot.id, ownerId: 'council', kind: plan.refit ? 'refit' : 'construction', buildingType: plan.buildingType, purpose: 'civic' });
  if (res.ok) record(state, 'council', `The council commissioned a ${BUILDING_INFO[plan.buildingType].label.toLowerCase()} on ${plan.plot.name}.`, { plot: plan.plot.id }, 2);
}

export function councilDaily(state) {
  collectTithe(state);
  trimWorksCrew(state);
  for (const b of state.businesses) {
    if (b.ownerId !== 'council' || !isTrading(b)) continue;
    if (balance(state, b.id) < 20 && balance(state, 'treasury') > 50) transfer(state, 'treasury', b.id, 15, 'grant', `Council funding for ${b.name}`);
  }
  restockPantry(state);
  fundPublicWorks(state);
  for (const type of ['farm', 'lumberyard']) ensureEssential(state, type);
  // Standing policy: with a large surplus, back one struggling local business a day.
  if (balance(state, 'treasury') > COUNCIL.reserve + 120) {
    const b = state.businesses.find((x) => x.status === 'STRUGGLING' && x.ownerId !== 'council' && state.day - (x.lastGrantDay ?? -99) >= 12 &&
      x.history.slice(-6).reduce((t, h) => t + h.customers, 0) >= 3);
    if (b) { b.lastGrantDay = state.day; COUNCIL_ACTIONS.supportBusiness(state, b.id); }
  }
  for (const c of state.citizens) {
    if (balance(state, c.id) >= 3 || c.needs.hunger > 30) continue;
    const good = FOOD_GOODS.find((g) => qty(state.council.pantry, g) > 0);
    if (!good) break;
    moveGoods(state.council.pantry, c.inventory, good, 1);
    remember(state, c, 'The council fed me when I had nothing.', 1, 'council');
  }
  const surplus = balance(state, 'treasury') - COUNCIL.reserve;
  // Standing policy: a large surplus funds a founding grant for a would-be business owner.
  if (surplus > 150) {
    const hopeful = state.citizens.filter((c) => c.dream.type === 'business' && !c.venture?.businessId && (c.plan?.need ?? 0) > 0 && c.stats.earned > 0)
      .sort((a, b) => (a.plan.need - b.plan.need) || a.id.localeCompare(b.id))[0];
    if (hopeful) {
      const amount = Math.min(hopeful.plan.need, 40);
      if (transfer(state, 'treasury', hopeful.id, amount, 'grant', `Founding grant to ${hopeful.firstName}`)) {
        remember(state, hopeful, `The council granted me ${amount} coins to start my business.`, 2, 'council');
        record(state, 'council', `The council gave ${hopeful.firstName} a founding grant of ${amount} coins.`, { citizens: [hopeful.id] }, 1);
      }
    }
  }
  const residents = state.plots.reduce((s, p) => s + p.residents.length, 0);
  const beds = state.plots.reduce((s, p) => s + bedsAt(state, p), 0);
  // Housing programme: while families or homeless residents wait, keep up to
  // three public cottages under construction (if the treasury and land allow).
  const waiting = state.citizens.filter((c) => !c.homePlotId || (c.family.spouseId && plotById(state, c.homePlotId)?.building?.type === 'hall')).length;
  const housingPolicy = state.government?.policies?.housingSupport ?? true;
  const building = state.projects.filter((p) => p.ownerId === 'council' && p.buildingType === 'cottage').length;
  if (housingPolicy && surplus > COUNCIL.publicCottageBudget && (residents >= beds - 2 || waiting > 0) && building < Math.min(3, 1 + Math.floor(waiting / 3))) {
    const res = COUNCIL_ACTIONS.publicCottage(state);
    if (res.ok) record(state, 'council', `The council commissioned a public cottage (${waiting} villagers waiting for homes).`, {}, 1);
  }
}

/**
 * Essential services: if no farm (or lumberyard) is operating, the council
 * takes over an idle one, buying the land from its owner and funding it, so a
 * death or bankruptcy cannot starve the village. If none exists, it builds one.
 */
function ensureEssential(state, type) {
  const running = state.businesses.filter((b) => b.type === type && isTrading(b)).length;
  const wanted = type === 'farm' ? Math.max(1, Math.ceil(state.citizens.length / 11)) : 1;
  if (running >= wanted) return;
  if (balance(state, 'treasury') < 50) return;
  const building = BUSINESS_TYPES[type].building;
  const idle = state.plots.find((p) => p.building?.type === building && p.constructionStatus === 'COMPLETE' && !p.businessId && !p.projectId);
  if (idle) {
    if (idle.ownerId !== 'council') {
      const price = Math.min(idle.price, balance(state, 'treasury') - 30);
      const seller = idle.ownerId;
      if (price < 1 || !transfer(state, 'treasury', seller, price, 'property', `Council bought ${idle.name}`)) return;
      idle.ownerId = 'council';
      plotHistory(state, idle, `Bought by the council for ${price} coins to keep the village supplied.`);
    }
    idle.marketStatus = 'NOT_FOR_SALE';
    const b = createBusiness(state, { type, ownerId: 'council', plotId: idle.id, name: businessName(state, type, null) });
    idle.businessId = b.id;
    idle.building.name = b.name;
    transfer(state, 'treasury', b.id, 25, 'grant', `Starting funds for ${b.name}`);
    b.openings = 2;
    record(state, 'council', `To keep the village ${type === 'farm' ? 'fed' : 'supplied with timber'}, the council reopened ${idle.name} as ${b.name}.`, { business: b.id, plot: idle.id }, 3);
    return;
  }
  const land = state.plots.find((p) => p.ownerId === 'council' && !p.building && !p.projectId && allows(p, building));
  if (land && !state.projects.some((p) => p.ownerId === 'council' && p.buildingType === building)) {
    startProject(state, { plotId: land.id, ownerId: 'council', kind: 'construction', buildingType: building, purpose: 'council_business', businessType: type });
  }
}

/**
 * When many adults are out of work, the council funds the Village Works crew
 * (wages from the treasury) to maintain buildings. With full employment the
 * crew shrinks as funding stops.
 */
function fundPublicWorks(state) {
  const works = state.businesses.find((b) => b.type === 'works');
  if (!works) return;
  const adults = state.citizens.filter((c) => c.birthDay <= state.day - 18 * 12);
  const idle = adults.filter((c) => !c.employment && !c.retired && c.profession !== 'Builder').length;
  const policyOn = state.government?.policies?.publicWorks ?? true;
  if (!policyOn || idle / Math.max(1, adults.length) < 0.15) return;
  const want = Math.min(idle + works.employees.length, 8) * 12 - balance(state, works.id);
  const amount = Math.min(want, balance(state, 'treasury') - 40);
  if (amount > 0) transfer(state, 'treasury', works.id, amount, 'grant', 'Wages for the Village Works crew');
}

/** The crew is cut back to what the council can actually pay for two shifts a day. */
function trimWorksCrew(state) {
  const works = state.businesses.find((b) => b.type === 'works');
  if (!works?.employees.length) return;
  const funds = balance(state, works.id) + Math.max(0, balance(state, 'treasury') - COUNCIL.reserve / 2);
  const wage = 5;
  const affordable = Math.floor(funds / (wage * 2 * 2));
  while (works.employees.length > Math.max(0, affordable)) {
    const c = byId(state.citizens, works.employees[works.employees.length - 1]);
    if (!c) { works.employees.pop(); continue; }
    leaveJob(state, c, 'the council could not fund the post');
    remember(state, c, 'Lost my place on the works crew when the council ran short of money.', 2, 'career');
  }
}

function restockPantry(state) {
  const target = 6 + state.citizens.length;
  let need = target - FOOD_GOODS.reduce((s, g) => s + qty(state.council.pantry, g), 0);
  if (need <= 0 || balance(state, 'treasury') < 15) return;
  const farms = state.businesses.filter((b) => isTrading(b) && b.type === 'farm' && qty(b.inventory, 'grain') > 4);
  for (const f of farms) {
    const unit = wholesalePrice(f, 'grain');
    const n = Math.min(need, qty(f.inventory, 'grain') - 4, Math.floor((balance(state, 'treasury') - 10) / unit));
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
