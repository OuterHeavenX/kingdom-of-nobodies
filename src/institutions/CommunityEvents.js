import { balance, transfer } from '../economy/Transactions.js';
import { qty, removeGoods, addGoods } from '../economy/Inventory.js';
import { isTrading, BUSINESS_TYPES, retailPrice } from '../economy/Businesses.js';
import { noteSale } from '../economy/Marketplace.js';
import { FOOD_GOODS, GOODS } from '../core/Config.js';
import { plotsForSale, allows, LAND_TYPES } from '../property/LandRegistry.js';

// Shared helpers for institutions that act in the market: buying food for
// charity or supplies, always from a real seller's stock at its posted price.

/**
 * Buy up to `units` of food from village shops into `store`, paid from
 * `account`. Returns { units, cost }. Nothing is bought that is not on a shelf.
 */
export function buyFood(state, account, units, store, buyerName) {
  let got = 0, cost = 0;
  const sellers = state.businesses
    .filter((b) => isTrading(b) && BUSINESS_TYPES[b.type].sells.some((g) => FOOD_GOODS.includes(g)))
    .flatMap((b) => BUSINESS_TYPES[b.type].sells.filter((g) => FOOD_GOODS.includes(g) && qty(b.inventory, g) > 2).map((g) => ({ b, g, unit: retailPrice(b, g), food: GOODS[g].food })))
    .sort((a, b) => a.unit / a.food - b.unit / b.food || a.b.id.localeCompare(b.b.id));
  for (const { b, g, unit } of sellers) {
    if (got >= units) break;
    const n = Math.min(units - got, qty(b.inventory, g) - 2, Math.floor(balance(state, account) / unit));
    if (n < 1) continue;
    if (!transfer(state, account, b.id, unit * n, 'purchase', `${n} ${g} for ${buyerName}`)) continue;
    removeGoods(b.inventory, g, n);
    addGoods(store, g, n);
    b.today.revenue += unit * n;
    b.totals.revenue += unit * n;
    b.today.customers++;
    noteSale(state, b, buyerName, n, g, unit * n);
    got += n; cost += unit * n;
  }
  return { units: got, cost };
}

/** Units of food in a store. */
export const foodIn = (store) => FOOD_GOODS.reduce((s, g) => s + qty(store, g), 0);

/** Take one unit of the most filling food from a store; returns the good or null. */
export function takeFood(store) {
  const g = [...FOOD_GOODS].sort((a, b) => GOODS[b].food - GOODS[a].food).find((x) => qty(store, x) > 0);
  if (!g) return null;
  removeGoods(store, g, 1);
  return g;
}

/**
 * Land for an institution's building: a plot on the market that allows it,
 * or idle civic land the council agrees to sell for public use at its price.
 * Returns the plot, now listed, or null.
 */
export function siteFor(state, buildingType, buyerId) {
  const market = plotsForSale(state, buildingType, buyerId).find((p) => !p.building);
  if (market) return market;
  const civic = state.plots.find((p) => p.ownerId === 'council' && p.landType === 'civic' && !p.building && !p.projectId && allows(p, buildingType) && p.marketStatus === 'NOT_FOR_SALE');
  if (!civic) return null;
  civic.marketStatus = 'FOR_SALE';
  civic.price = LAND_TYPES.civic.base;
  return civic;
}
