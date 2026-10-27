import { byId } from '../core/EntityRegistry.js';
import { ECONOMY, GOODS, FOOD_GOODS, TIME } from '../core/Config.js';
import { chance } from '../core/Random.js';
import { transfer, balance } from './Transactions.js';
import { qty, moveGoods, addGoods, removeGoods } from './Inventory.js';
import { BUSINESS_TYPES, isTrading, retailPrice, wholesalePrice } from './Businesses.js';
import { trait } from '../ai/Personality.js';
import { adjust, peekRel } from '../citizens/Relationships.js';
import { perceivedHonesty, bump } from '../society/Reputation.js';
import { createFact } from '../society/Gossip.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { plotById, frontOf } from '../property/LandRegistry.js';

// Retail, wholesale, imports/exports and price discovery.

export const ownerAccount = (ownerId) => (ownerId === 'council' ? 'treasury' : ownerId);
const hour = (state) => state.minute / 60;

export function isOpenNow(state, b) {
  if (!isTrading(b)) return false;
  if ((b.suspendedUntil ?? 0) >= state.day) return false; // licence suspended by the court
  const h = hour(state);
  if (b.type === 'tavern') return h >= 10 && h < TIME.tavernCloseHour;
  return h >= TIME.shopOpenHour && h < TIME.shopCloseHour;
}

export function businessLocation(state, b) {
  return frontOf(plotById(state, b.plotId));
}

const distance = (c, loc) => Math.hypot(c.x - loc.x, c.z - loc.z);

/**
 * Rank where a citizen could buy a good. Preference blends price, distance,
 * perceived honesty of the owner, friendship with the owner and service quality.
 */
export function rankSellers(state, c, good, { forFood = false, memo = null, pool = null } = {}) {
  const offers = [];
  const distanceWeight = state.council.marketplace ? 0.05 : 0.09;
  // The same for every seller: how much this customer minds price, and how hungry they are.
  const priceSensitivity = 1 + trait(c, 'frugal') + (balance(state, c.id) < 10 ? 1 : 0);
  const urgency = forFood ? 1 + Math.max(0, 60 - (c.needs?.hunger ?? 60)) / 20 : 1;
  // `pool` is the open shops not owned by this customer, already filtered in business order.
  for (const b of pool ?? state.businesses) {
    if (!pool && !isOpenNow(state, b)) continue;
    if (!BUSINESS_TYPES[b.type].sells.includes(good) || qty(b.inventory, good) < 1) continue;
    if (!pool && b.ownerId === c.id) continue;
    const price = retailPrice(b, good);
    // Where the shop is and what the customer thinks of its owner do not depend on the good.
    let seller = memo?.get(b);
    if (!seller) {
      const owner = byId(state.citizens, b.ownerId);
      seller = { loc: businessLocation(state, b), honesty: owner ? perceivedHonesty(state, c, owner) : 60, friendship: owner ? peekRel(state, c.id, owner.id)?.friendship ?? 20 : 25 };
      memo?.set(b, seller);
    }
    const { loc, honesty, friendship } = seller;
    const value = forFood ? GOODS[good].food / price : 10 / price;
    const score = value * 10 * priceSensitivity - distance(c, loc) * distanceWeight * urgency + (honesty - 50) * 0.08 +
      (friendship - 20) * 0.04 + b.quality * 3 + (b.licensed ? 1.5 : 0) + (GOODS[good].social ?? 0) * 0.1 * trait(c, 'friendly');
    offers.push({ business: b, good, price, loc, score, honesty });
  }
  return offers.sort((a, b) => b.score - a.score);
}

/** Best affordable food option for a citizen, or null. */
export function bestFoodOffer(state, c, payer = c.id) {
  const money = balance(state, payer);
  // One pass over the businesses (most of a city's history is closed shops), shared by every food good.
  const memo = new Map();
  const pool = state.businesses.filter((b) => isOpenNow(state, b) && b.ownerId !== c.id);
  const all = FOOD_GOODS.flatMap((g) => rankSellers(state, c, g, { forFood: true, memo, pool })).filter((o) => o.price <= money);
  all.sort((a, b) => b.score - a.score);
  if (all[0]) return all[0];
  // Seller of last resort: the council pantry at the Hearth Hall.
  const good = FOOD_GOODS.find((g) => qty(state.council.pantry, g) > 0);
  if (good && money >= ECONOMY.councilPantryPrice + 1) {
    return { business: null, pantry: true, good, price: ECONOMY.councilPantryPrice + 1, loc: frontOf(state.plots[0]), score: 0 };
  }
  // Food assistance: the destitute and hungry are fed from the pantry for free.
  if (good && c.needs.hunger < 40 && foodAssistanceOn(state)) {
    return { business: null, pantry: true, relief: true, good, price: 0, loc: frontOf(state.plots[0]), score: 0 };
  }
  return null;
}

/** Buy one portion from the council pantry; the coins go to the treasury. */
export const foodAssistanceOn = (state) => state.government?.policies?.foodAssistance ?? true;

export function buyFromPantry(state, c, good, payer = c.id, relief = false) {
  if (relief) {
    if (!foodAssistanceOn(state) || !moveGoods(state.council.pantry, c.inventory, good, 1)) return { ok: false };
    state.council.reliefMeals = (state.council.reliefMeals ?? 0) + 1;
    return { ok: true, paid: 0 };
  }
  const price = ECONOMY.councilPantryPrice + 1;
  if (qty(state.council.pantry, good) < 1 || !transfer(state, payer, 'treasury', price, 'purchase', `${good} from the council pantry`)) return { ok: false };
  moveGoods(state.council.pantry, c.inventory, good, 1);
  c.stats.spent += price;
  return { ok: true, paid: price };
}

/** Owners may eat from their own business stock (no money changes hands). */
export function ownStockFood(state, c) {
  const b = state.businesses.find((x) => x.ownerId === c.id && isTrading(x));
  if (!b) return null;
  const good = FOOD_GOODS.find((g) => qty(b.inventory, g) > 0);
  return good ? { business: b, good } : null;
}

/**
 * A citizen buys goods at a business. Dishonest owners sometimes overcharge;
 * the customer may notice, which creates a witnessed rumor and damages trust.
 */
export function buyRetail(state, c, b, good, n = 1, payer = c.id) {
  if (!isOpenNow(state, b) || qty(b.inventory, good) < n) return { ok: false, reason: 'out of stock' };
  let price = retailPrice(b, good) * n;
  const isCitizen = state.citizens.includes(c);
  const owner = byId(state.citizens, b.ownerId);
  let cheated = false;
  if (isCitizen && owner && trait(owner, 'dishonest') > 0 && chance(state, trait(owner, 'dishonest') * 0.35)) {
    price += 1;
    cheated = true;
  }
  if (balance(state, payer) < price) return { ok: false, reason: 'cannot afford' };
  if (!transfer(state, payer, b.id, price, 'purchase', `${n} ${good} at ${b.name}`)) return { ok: false, reason: 'payment failed' };
  moveGoods(b.inventory, c.inventory, good, n);
  b.today.revenue += price;
  b.today.customers++;
  b.totals.revenue += price;
  b.totals.customers++;
  c.stats.spent += price;
  if (owner && isCitizen) {
    adjust(state, c.id, owner.id, { trust: 0.4, friendship: 0.3 });
    if (!cheated && trait(owner, 'honest') > 0) bump(owner, 'honesty', 0.15);
  }
  if (cheated && owner) {
    if (chance(state, 0.35 + trait(c, 'curious') * 0.3)) {
      adjust(state, c.id, owner.id, { trust: -15, friendship: -5 });
      bump(owner, 'honesty', -6);
      remember(state, c, `${owner.firstName} overcharged me at ${b.name}.`, 2, 'grievance');
      createFact(state, 'cheat', owner.id, `${owner.firstName} overcharged ${c.firstName} at ${b.name}.`, [c.id]);
      record(state, 'business', `${c.firstName} caught ${owner.firstName} overcharging at ${b.name}.`, { citizens: [c.id, owner.id], business: b.id }, 2);
    }
  }
  noteSale(state, b, c.firstName, n, good, price, isCitizen ? c.id : null);
  return { ok: true, paid: price, cheated };
}

/** The first sale of a citizen-owned business is a milestone, whichever channel it came through. */
export function noteSale(state, b, buyerName, n, good, price, buyerId = null) {
  if (b.firstSale) return;
  b.firstSale = true;
  const owner = byId(state.citizens, b.ownerId);
  if (!owner) return;
  record(state, 'business', `${b.name} made its first sale: ${n} ${GOODS[good].label.toLowerCase()} to ${buyerName} for ${price} coins.`,
    { citizens: [owner.id, ...(buyerId ? [buyerId] : [])], business: b.id }, 3);
  remember(state, owner, `Made the first sale at ${b.name}.`, 3, 'milestone');
  owner.mood = Math.min(100, owner.mood + 10);
}

/** Businesses buy goods from each other at wholesale prices. */
export function wholesale(state, buyer, seller, good, n) {
  const units = Math.min(n, qty(seller.inventory, good));
  if (units < 1) return 0;
  const unit = wholesalePrice(seller, good);
  const affordable = Math.min(units, Math.floor(balance(state, buyer.id) / unit));
  if (affordable < 1) return 0;
  const cost = unit * affordable;
  if (!transfer(state, buyer.id, seller.id, cost, 'wholesale', `${affordable} ${good}: ${seller.name} → ${buyer.name}`)) return 0;
  moveGoods(seller.inventory, buyer.inventory, good, affordable);
  buyer.today.inputs += cost;
  seller.today.revenue += cost;
  seller.totals.revenue += cost;
  noteSale(state, seller, buyer.name, affordable, good, cost);
  return affordable;
}

/**
 * Producers of a good with stock to spare, cheapest first. Equal prices go to
 * the seller with the least trade today, so the oldest business in the list
 * does not win every tie.
 */
export function suppliersOf(state, good, exclude, minStock = 3) {
  return state.businesses
    .filter((b) => b !== exclude && isTrading(b) && BUSINESS_TYPES[b.type].output === good && qty(b.inventory, good) >= minStock)
    .sort((a, b) => wholesalePrice(a, good) - wholesalePrice(b, good) || a.today.revenue - b.today.revenue);
}

/**
 * Where a business that uses tools buys one: only from those who make or
 * sell tools (smiths, stores), cheapest first. Other tool users are never
 * sellers, so a single tool cannot circle between farms and lumberyards.
 */
export function toolSellers(state, buyer) {
  return state.businesses
    .filter((x) => x !== buyer && isTrading(x) && BUSINESS_TYPES[x.type].sells.includes('tools') && qty(x.inventory, 'tools') > 0)
    .sort((a, b) => wholesalePrice(a, 'tools') - wholesalePrice(b, 'tools') || a.today.revenue - b.today.revenue);
}

/** Keep cash for about two days of wages before spending on stock. */
export function cashReserve(state, b) {
  const wages = b.employees.reduce((s, id) => s + (byId(state.citizens, id)?.employment?.wage ?? 0), 0);
  return wages * 2 + 3;
}

/** Twice a day every business tops up inputs and resale stock. */
export function restockAll(state) {
  for (const b of state.businesses) {
    if (!isTrading(b)) continue;
    const def = BUSINESS_TYPES[b.type];
    const budget = () => balance(state, b.id) - cashReserve(state, b);
    for (const [good, perBatch] of Object.entries(def.inputs)) {
      const target = perBatch * def.batchesPerShift * 3;
      let need = target - qty(b.inventory, good);
      if (need <= 0) continue;
      if (good === 'ore') {
        const n = Math.min(need, Math.floor(budget() / ECONOMY.oreImportPrice));
        if (n > 0 && transfer(state, b.id, 'outside', n * ECONOMY.oreImportPrice, 'import', `${n} ore for ${b.name}`)) {
          addGoods(b.inventory, 'ore', n);
          b.today.inputs += n * ECONOMY.oreImportPrice;
        }
        continue;
      }
      for (const s of suppliersOf(state, good, b)) {
        if (need <= 0 || budget() < wholesalePrice(s, good)) break;
        need -= wholesale(state, b, s, good, Math.min(need, qty(s.inventory, good) - 2));
      }
    }
    if (def.resale) {
      for (const good of def.sells) {
        let need = def.target - qty(b.inventory, good);
        for (const s of suppliersOf(state, good, b)) {
          if (need <= 0 || budget() < wholesalePrice(s, good)) break;
          need -= wholesale(state, b, s, good, Math.min(need, qty(s.inventory, good) - 2));
        }
      }
    }
    if (def.usesTools && qty(b.inventory, 'tools') < 1) {
      const s = toolSellers(state, b)[0];
      if (s && budget() >= wholesalePrice(s, 'tools')) wholesale(state, b, s, 'tools', 1);
    }
  }
}

/**
 * Who buys goods a citizen gathered (berries, salvaged timber)? Stores and
 * food businesses first; the council pantry is the buyer of last resort.
 */
export function sellGathered(state, c, good) {
  const n = qty(c.inventory, good);
  if (n < 1) return { ok: false, units: 0, paid: 0 };
  const offerFor = (b) => Math.max(1, Math.round(GOODS[good].base * ECONOMY.wholesaleFactor * (b.priceMult[good] ?? 1)));
  // The gatherer sells to whoever pays best (ties: the buyer with the least trade today).
  const buyers = state.businesses.filter((b) => isOpenNow(state, b) && BUSINESS_TYPES[b.type].sells.includes(good) &&
    b.ownerId !== c.id && qty(b.inventory, good) < BUSINESS_TYPES[b.type].target * 2)
    .sort((a, b) => offerFor(b) - offerFor(a) || a.today.inputs - b.today.inputs);
  for (const b of buyers) {
    const unit = offerFor(b);
    const units = Math.min(n, Math.floor((balance(state, b.id) - cashReserve(state, b)) / unit));
    if (units < 1) continue;
    transfer(state, b.id, c.id, unit * units, 'sale', `${units} ${good} from ${c.firstName}`);
    moveGoods(c.inventory, b.inventory, good, units);
    b.today.inputs += unit * units;
    c.stats.earned += unit * units;
    c.stats.sales += units;
    return { ok: true, units, paid: unit * units, buyer: b.name };
  }
  if (good === 'berries' || good === 'grain') {
    const room = ECONOMY.councilPantryMax * (state.plots.some((p) => p.building?.type === 'granary') ? 2 : 1) - qty(state.council.pantry, good);
    const units = Math.min(n, room, Math.floor((balance(state, 'treasury') - 20) / ECONOMY.councilPantryPrice));
    if (units > 0 && transfer(state, 'treasury', c.id, units * ECONOMY.councilPantryPrice, 'sale', `${units} ${good} to the council pantry`)) {
      moveGoods(c.inventory, state.council.pantry, good, units);
      c.stats.earned += units * ECONOMY.councilPantryPrice;
      return { ok: true, units, paid: units * ECONOMY.councilPantryPrice, buyer: 'the council pantry' };
    }
  }
  return { ok: false, units: 0, paid: 0 };
}

/** Daily price discovery: scarce goods get dearer, gluts get cheaper, gently. */
export function adjustPrices(b) {
  const def = BUSINESS_TYPES[b.type];
  for (const good of def.sells) {
    const stock = qty(b.inventory, good);
    let m = b.priceMult[good] ?? 1;
    if (stock < def.target * 0.35) m += ECONOMY.priceStepPerDay;
    else if (stock > def.target * 1.4) m -= ECONOMY.priceStepPerDay;
    else m += (1 - m) * 0.25;
    b.priceMult[good] = Math.round(Math.max(ECONOMY.priceMin, Math.min(ECONOMY.priceMax, m)) * 100) / 100;
    b.prices[good] = retailPrice(b, good);
  }
}

/**
 * Every few days a caravan of outside traders visits. It buys surplus goods
 * (money flows into the village) and sells grain to food sellers when the
 * village runs short (money flows out).
 */
export function caravanVisit(state) {
  let bought = 0, sold = 0;
  const slump = (state.season?.recessionUntil ?? 0) > state.day ? 0.5 : 1;
  const hungry = villageFood(state) < state.citizens.length * 4;
  for (const b of state.businesses) {
    if (!isTrading(b)) continue;
    const def = BUSINESS_TYPES[b.type];
    for (const good of def.sells) {
      if (hungry && FOOD_GOODS.includes(good)) continue;
      const surplus = qty(b.inventory, good) - Math.round(def.target * 0.8);
      if (surplus < 1) continue;
      const unit = Math.max(1, Math.round(GOODS[good].base * ECONOMY.caravanBuyFactor * slump));
      const units = Math.min(surplus, ECONOMY.caravanMaxUnitsPerGood, Math.floor(balance(state, 'outside') / unit));
      if (units > 0 && transfer(state, 'outside', b.id, unit * units, 'export', `${units} ${good} sold to the caravan`)) {
        removeGoods(b.inventory, good, units);
        b.today.revenue += unit * units;
        b.totals.revenue += unit * units;
        noteSale(state, b, 'a passing caravan', units, good, unit * units);
        bought += unit * units;
      }
    }
  }
  const foodStock = villageFood(state);
  if (foodStock < state.citizens.length * 4) {
    for (const b of state.businesses) {
      if (!isTrading(b) || !(b.type === 'general_store' || b.type === 'bakery' || b.type === 'tavern')) continue;
      const units = Math.min(8, Math.floor((balance(state, b.id) - cashReserve(state, b)) / ECONOMY.caravanGrainPrice));
      if (units > 0 && transfer(state, b.id, 'outside', units * ECONOMY.caravanGrainPrice, 'import', `${units} grain bought from the caravan`)) {
        addGoods(b.inventory, 'grain', units);
        b.today.inputs += units * ECONOMY.caravanGrainPrice;
        sold += units * ECONOMY.caravanGrainPrice;
      }
    }
  }
  state.lastCaravanDay = state.day;
  if (bought || sold) {
    record(state, 'economy', `A trade caravan visited: it bought ${bought} coins of village goods${sold ? ` and sold ${sold} coins of grain` : ''}.`, {}, 1);
  }
  return { bought, sold };
}

/** Daily: fresh food carried by citizens spoils a little. */
export function spoilCarriedFood(state) {
  for (const c of state.citizens) {
    for (const g of ['berries', 'bread', 'meal']) {
      const n = qty(c.inventory, g);
      const lost = Math.floor(n * (g === 'berries' ? 0.25 : 0.15) * (state.discoveries?.improvedStorage ? 0.5 : 1) * (state.plots.some((p) => p.building?.type === 'granary') ? 0.6 : 1));
      if (lost > 0) removeGoods(c.inventory, g, lost);
    }
  }
}

export function villageFood(state) {
  let n = 0;
  for (const b of state.businesses) if (isTrading(b)) for (const g of FOOD_GOODS) n += qty(b.inventory, g);
  for (const g of FOOD_GOODS) n += qty(state.council.pantry, g);
  for (const c of state.citizens) for (const g of FOOD_GOODS) n += qty(c.inventory, g);
  return n;
}

export function villageWood(state) {
  let n = 0;
  for (const b of state.businesses) if (isTrading(b)) n += qty(b.inventory, 'timber');
  for (const p of state.projects) n += p.materials ?? 0;
  return n;
}
