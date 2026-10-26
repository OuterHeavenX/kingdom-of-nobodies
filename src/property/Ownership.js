import { byId } from '../core/EntityRegistry.js';
import { transfer, balance } from '../economy/Transactions.js';
import { plotById, plotValue, plotHistory, buildingLabel } from './LandRegistry.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { createFact } from '../society/Gossip.js';
import { ownerAccount } from '../economy/Marketplace.js';
import { institutionName } from '../institutions/Registry.js';

// Property transfers. A sale is one atomic operation: verify the listing and
// funds, move the money, then move the title. Nothing changes on failure.

const ownerName = (state, id) => (id === 'council' ? 'the council' : byId(state.citizens, id)?.firstName ?? institutionName(state, id) ?? 'nobody');

/** Hold a plot for a buyer while they walk to the land office. */
export function reservePlot(state, plotId, buyerId, ticks = 60) {
  const p = plotById(state, plotId);
  if (!p || p.marketStatus !== 'FOR_SALE') return false;
  if (p.reservedBy && p.reservedBy !== buyerId && p.reservedUntil > state.tick) return false;
  p.reservedBy = buyerId;
  p.reservedUntil = state.tick + ticks;
  return true;
}

/** Called after every completed sale with (state, plot, sellerId, price): liens are settled here. */
export const saleHooks = [];

export function buyPlot(state, plotId, buyerId) {
  const p = plotById(state, plotId);
  if (!p) return { ok: false, reason: 'no such plot' };
  if (p.marketStatus !== 'FOR_SALE') return { ok: false, reason: `${p.name} is not for sale` };
  if (p.ownerId === buyerId) return { ok: false, reason: 'already owned' };
  if (p.reservedBy && p.reservedBy !== buyerId && p.reservedUntil > state.tick) return { ok: false, reason: `${p.name} is reserved` };
  if (p.projectId) return { ok: false, reason: 'work is under way there' };
  const buyerAcct = ownerAccount(buyerId);
  if (balance(state, buyerAcct) < p.price) return { ok: false, reason: 'not enough money' };
  const sellerId = p.ownerId;
  if (!transfer(state, buyerAcct, ownerAccount(sellerId), p.price, 'property', `${p.name} sold`)) return { ok: false, reason: 'payment failed' };
  const price = p.price;
  p.ownerId = buyerId;
  p.acquiredDay = state.day;
  p.boughtFor = price;
  p.marketStatus = 'NOT_FOR_SALE';
  p.reservedBy = null;
  p.reservedUntil = 0;
  p.listedDay = null;
  const what = p.building ? `${p.name} (${p.building.name})` : `the ${p.name} plot`;
  plotHistory(state, p, `Sold by ${ownerName(state, sellerId)} to ${ownerName(state, buyerId)} for ${price} coins.`);
  const buyer = byId(state.citizens, buyerId);
  const seller = byId(state.citizens, sellerId);
  record(state, 'property', `${ownerName(state, buyerId)} purchased ${what} from ${ownerName(state, sellerId)} for ${price} coins.`,
    { citizens: [buyerId, sellerId].filter((id) => id !== 'council'), plot: p.id }, 3);
  if (buyer) {
    remember(state, buyer, `Bought ${what} for ${price} coins.`, 3, 'property');
    buyer.mood = Math.min(100, buyer.mood + 10);
    createFact(state, 'property_bought', buyer.id, `${buyer.firstName} bought ${what}.`, [buyer.id]);
  }
  if (seller) remember(state, seller, `Sold ${what} for ${price} coins.`, 2, 'property');
  for (const fn of saleHooks) fn(state, p, sellerId, price);
  return { ok: true, price };
}

export function listForSale(state, plotId, price = null) {
  const p = plotById(state, plotId);
  if (!p || p.projectId) return false;
  p.price = price ?? plotValue(p);
  p.marketStatus = 'FOR_SALE';
  p.listedDay = state.day;
  plotHistory(state, p, `Listed for sale at ${p.price} coins.`);
  return true;
}

/** Daily: unsold listings slowly come down in price toward 60% of value. */
export function softenListings(state) {
  for (const p of state.plots) {
    if (p.marketStatus !== 'FOR_SALE' || !p.listedDay || p.ownerId === 'council') continue;
    if ((state.day - p.listedDay) % 3 !== 0) continue;
    const floor = Math.round(plotValue(p) * 0.6);
    p.price = Math.max(floor, Math.round(p.price * 0.94));
  }
}

export const ownedPlots = (state, ownerId) => state.plots.filter((p) => p.ownerId === ownerId);
export const describeBuilding = (p) => (p.building ? buildingLabel(p.building.type) : 'Vacant land');
