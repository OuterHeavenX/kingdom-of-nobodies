import { balance, transfer } from '../economy/Transactions.js';
import { removeGoods, qty } from '../economy/Inventory.js';
import { isTrading } from '../economy/Businesses.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { chance } from '../core/Random.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { COMMODITIES, HEARTH, KINGDOMS } from '../region/RegionData.js';
import { KINGDOM_IDS, planJourney, settlementName } from '../region/RegionManager.js';
import { foodCover } from '../region/Settlement.js';
import { tariffRate, tradeBlocked, routeAllowed } from '../diplomacy/Diplomacy.js';
import { marketPrice, marketAvailable, marketDemand } from './Markets.js';
import { ensureTrade, createContract, pruneContracts, possessive, sentence } from './Contracts.js';
import { createCaravan, caravanTick, pruneCaravans, CARAVAN } from './Caravans.js';

// Who trades, and why. Merchants of First Hearth (and the merchant houses of
// each kingdom) look for goods that are cheap in one place and wanted in
// another, cost the whole round trip (drovers, tariffs, spoilage), and only
// set out when the margin is worth it. Nobody is forced to trade.

const CART_PRICE = 30;
const nodes = () => [HEARTH, ...KINGDOM_IDS];

/** The best trade a trader could make right now, with the reasons, or null. */
export function bestOpportunity(state, trader) {
  const hoursCache = new Map();
  const hours = (a, b) => {
    if (a === b) return 0;
    const key = a + '>' + b;
    if (!hoursCache.has(key)) hoursCache.set(key, planJourney(state, a, b, { allow: routeAllowed(state, trader.home) })?.hours ?? Infinity);
    return hoursCache.get(key);
  };
  let best = null;
  for (const origin of nodes()) for (const destination of nodes()) {
    if (origin === destination || tradeBlocked(state, origin, destination, trader.home)) continue;
    const leg = hours(origin, destination);
    const trip = hours(trader.home, origin) + leg + hours(destination, trader.home);
    if (!Number.isFinite(trip)) continue;
    for (const g of Object.keys(COMMODITIES)) {
      if ((origin === HEARTH || destination === HEARTH) && !COMMODITIES[g].local) continue;
      const avail = marketAvailable(state, origin, g);
      if (avail < 4) continue;
      const demand = marketDemand(state, destination, g);
      if (demand < 4) continue;
      const buy = Math.round(marketPrice(state, origin, g) * 1.02 * 100) / 100;
      const sell = Math.round(marketPrice(state, destination, g) * 0.95 * 100) / 100;
      if (sell <= buy) continue;
      const qty = Math.min(trader.capacity, avail, demand, Math.floor((trader.funds * 0.85) / buy));
      if (qty < 4) continue;
      const tariff = tariffRate(state, destination, trader.home);
      const transport = Math.round(trip * CARAVAN.coinsPerHour + CARAVAN.fee);
      const spoilage = qty * sell * (COMMODITIES[g].perishable ?? 0) * (leg / 24);
      const profit = qty * sell * (1 - tariff) - qty * buy - transport - spoilage;
      const margin = profit / (qty * buy + transport);
      if (profit < trader.minProfit || margin < trader.minMargin) continue;
      if (!best || profit > best.profit) {
        const k = destination !== HEARTH ? state.region.settlements[destination] : null;
        const shortage = k && COMMODITIES[g].food && k.shortages.food ? `${settlementName(destination)} is short of food` : `${settlementName(destination)} wants ${demand} ${g}`;
        best = {
          origin, destination, commodity: g, qty, buy, sell, profit: Math.round(profit), margin, hours: Math.round(trip),
          factors: [shortage, `${settlementName(origin)} sells at ${buy} a unit, ${settlementName(destination)} pays ${sell}`, `${Math.round(trip)} hours on the road`, ...(tariff ? [`a ${Math.round(tariff * 100)}% tariff`] : []), `expected profit ${Math.round(profit)} coins`],
        };
      }
    }
  }
  return best;
}

/** Turn an opportunity into a contract and a caravan. */
function launch(state, trader, plan) {
  const contract = createContract(state, { merchant: trader, origin: plan.origin, destination: plan.destination, commodity: plan.commodity, qty: plan.qty, buyPrice: plan.buy, sellPrice: plan.sell, reason: plan.factors.join('; ') });
  if (contract.error) return { error: contract.error };
  const stops = [{ at: plan.origin, action: 'load', contracts: [contract.id] }, { at: plan.destination, action: 'unload', contracts: [contract.id] }, { at: trader.home, action: 'home' }];
  const cv = createCaravan(state, { owner: trader, home: trader.home, stops, capacity: trader.capacity });
  const eta = planJourney(state, trader.home, plan.origin, { allow: routeAllowed(state, trader.home) });
  contract.expectedArrivalTick = state.tick + Math.round(((eta?.hours ?? 0) + plan.hours / 2) * 6) + CARAVAN.loadTicks * 2;
  return { contract, caravan: cv };
}

// --- First Hearth's merchants ---------------------------------------------------

function merchantFunds(state, c) {
  const store = state.businesses.find((b) => b.ownerId === c.id && b.type === 'general_store' && isTrading(b));
  if (store && balance(state, store.id) > 90) return { account: store.id, funds: balance(state, store.id) - 50, via: store.name };
  return { account: c.id, funds: balance(state, c.id) - 10, via: null };
}

export function isMerchant(state, c) {
  if (c.away || c.retired || ageOf(state, c) < LIFE.adultAge) return false;
  if (c.profession === 'Merchant') return true;
  if (state.businesses.some((b) => b.ownerId === c.id && b.type === 'general_store' && isTrading(b))) return true;
  return trait(c, 'ambitious') > 0.6 && trait(c, 'riskTaking') > 0.4 && balance(state, c.id) >= 90;
}

function buyCart(state, c, account) {
  const yard = state.businesses.find((b) => b.type === 'lumberyard' && isTrading(b) && qty(b.inventory, 'timber') >= 3);
  const seller = yard ? yard.id : 'outside';
  if (!transfer(state, account, seller, CART_PRICE, 'purchase', `${c.firstName} bought a cart and team${yard ? ` from ${yard.name}` : ''}`)) return false;
  if (yard) removeGoods(yard.inventory, 'timber', 3);
  return true;
}

function localMerchants(state) {
  const t = ensureTrade(state);
  const active = Object.values(t.merchants).filter((m) => m.active).length;
  const limit = Math.min(4, 1 + Math.floor(state.citizens.length / 35));
  if (active >= limit) return;
  for (const c of state.citizens) {
    if (!isMerchant(state, c)) continue;
    const m = t.merchants[c.id] = t.merchants[c.id] ?? { id: c.id, name: `${c.firstName} ${c.lastName}`, cart: false, trips: 0, profit: 0, active: null, lastPlan: null };
    if (m.active || !chance(state, 0.4)) continue;
    const { account, funds, via } = merchantFunds(state, c);
    const cautious = trait(c, 'frugal') + (1 - trait(c, 'riskTaking'));
    const trader = { id: c.id, name: `${c.firstName} ${c.lastName}`, account, home: HEARTH, capacity: CARAVAN.capacityCitizen, funds: funds - (m.cart ? 0 : CART_PRICE), minProfit: 10, minMargin: 0.1 + cautious * 0.08 };
    if (trader.funds < 20) continue;
    const plan = bestOpportunity(state, trader);
    m.lastPlan = plan ? { day: state.day, text: plan.factors.join('; ') } : { day: state.day, text: 'No trade worth the road right now.' };
    if (!plan) continue;
    if (!m.cart && !buyCart(state, c, account)) continue;
    m.cart = true;
    const res = launch(state, trader, plan);
    if (res.error) { m.lastPlan.text = `Gave up: ${res.error}.`; continue; }
    m.active = res.caravan.id;
    m.trips++;
    remember(state, c, `Sent a caravan to carry ${plan.qty} ${plan.commodity} from ${settlementName(plan.origin)} to ${settlementName(plan.destination)}.`, 2, 'career');
    record(state, 'trade', `${c.firstName} ${c.lastName}${via ? ` (${via})` : ''} saw an opportunity: ${plan.factors[0]}. They contracted ${plan.qty} ${COMMODITIES[plan.commodity].label.toLowerCase()} from ${settlementName(plan.origin)} at ${plan.buy} to sell at ${plan.sell}.`, { citizens: [c.id] }, 2);
    if (Object.values(t.merchants).filter((x) => x.active).length >= limit) return;
  }
}

// --- Foreign merchant houses ----------------------------------------------------

function foreignHouses(state) {
  const t = ensureTrade(state);
  for (const id of KINGDOM_IDS) {
    const house = t.houses[id] = t.houses[id] ?? { active: 0, trips: 0 };
    const k = state.region.settlements[id];
    // Hungry kingdoms look harder for food; content ones trade when it pays.
    const urgency = k.shortages.food ? 0.9 : 0.5;
    if (house.active >= 3 || !chance(state, urgency)) continue;
    const funds = balance(state, KINGDOMS[id].account) - 400;
    if (funds < 40) continue;
    // Merchants invited to the Midsummer Fair accept thinner margins to trade with First Hearth.
    const fair = state.culture?.current?.foreignMerchants?.includes(id) && ['PREPARING', 'ACTIVE'].includes(state.culture.current.phase);
    const trader = { id: 'house:' + id, name: `the ${KINGDOMS[id].name} merchants`, account: KINGDOMS[id].account, home: id, capacity: CARAVAN.capacityHouse, funds: Math.min(funds, 900), minProfit: fair ? 6 : 10, minMargin: k.shortages.food ? 0.04 : fair ? 0.05 : 0.1 };
    const plan = bestOpportunity(state, trader);
    if (!plan) continue;
    const res = launch(state, trader, plan);
    if (res.error) continue;
    house.active++;
    house.trips++;
    if (plan.destination === HEARTH || plan.origin === HEARTH) record(state, 'trade', `Merchants of ${KINGDOMS[id].name} contracted to ${plan.destination === HEARTH ? 'bring' : 'buy'} ${plan.qty} ${COMMODITIES[plan.commodity].label.toLowerCase()} ${plan.destination === HEARTH ? 'to' : 'from'} First Hearth.`, {}, 1);
  }
}

/**
 * When a merchant dies or leaves, their caravans' proceeds go to their heir (or the council).
 * `leaving` lists everyone departing with them, who cannot inherit.
 */
export function onMerchantGone(state, c, leaving = []) {
  const t = ensureTrade(state);
  const staying = (id) => (leaving.includes(id) ? null : byId(state.citizens, id));
  const heir = staying(c.family?.spouseId) ?? c.family?.childIds?.map(staying).find((x) => x && ageOf(state, x) >= LIFE.adultAge) ?? null;
  const account = heir ? heir.id : 'treasury';
  for (const cv of t.caravans.filter((x) => x.account === c.id && x.status !== 'COMPLETED')) {
    cv.account = account;
    for (const ct of t.contracts.filter((x) => x.caravanId === cv.id)) ct.merchantAccount = account;
    record(state, 'trade', sentence(`${possessive(cv.ownerName)} caravan will finish its run for ${heir ? heir.firstName : 'the council'}.`), { citizens: heir ? [heir.id] : [] }, 1);
  }
  if (t.merchants[c.id]) t.merchants[c.id].gone = true;
}

/** Per tick: caravans move. */
export function tickTrade(state) {
  const t = state.trade;
  if (!t) return;
  for (const cv of t.caravans) caravanTick(state, cv);
}

/** Daily: merchants plan, houses trade, records stay bounded. */
export function dailyTrade(state) {
  const t = ensureTrade(state);
  localMerchants(state);
  foreignHouses(state);
  for (const [id, m] of Object.entries(t.merchants)) if (m.gone && !m.active) delete t.merchants[id];
  t.fordCrossings = Math.round(t.fordCrossings * 0.95 * 10) / 10;
  pruneContracts(state);
  pruneCaravans(state);
}

export { foodCover };
