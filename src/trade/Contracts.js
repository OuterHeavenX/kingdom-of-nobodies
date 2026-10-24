import { noteContractShortfall } from '../law/Courts.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { record } from '../society/Chronicle.js';
import { KINGDOMS, HEARTH, COMMODITIES } from '../region/RegionData.js';
import { settlementName } from '../region/RegionManager.js';
import { tariffRate, noteTrade } from '../diplomacy/Diplomacy.js';
import { reserve, release, collect, buyerFor, deliverGoods } from './Markets.js';

// Trade contracts. A contract is agreed before a caravan sets out: the goods
// are reserved at the origin and the buyer's payment is held in escrow, so
// neither can be promised twice. Loading pays the seller; delivery hands the
// goods over, releases escrow to the merchant (less tariffs) and refunds the
// buyer for anything that did not arrive. Every step goes through the ledger
// and each contract can be loaded once and settled once.

export const ESCROW = 'escrow';

/** "Ada's", "the Saltmere merchants'". */
export const possessive = (name) => (name.endsWith('s') ? `${name}'` : `${name}'s`);
export const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export function ensureTrade(state) {
  state.trade = state.trade ?? { contracts: [], caravans: [], cargoLog: [], houses: {}, stats: { deliveries: 0, failures: 0, volume: 0, value: 0, spoiled: 0 }, fordCrossings: 0, merchants: {} };
  if (state.accounts[ESCROW] === undefined) state.accounts[ESCROW] = 0;
  return state.trade;
}

export function logCargo(state, entry) {
  const t = ensureTrade(state);
  t.cargoLog.push({ day: state.day, ...entry });
  if (t.cargoLog.length > 240) t.cargoLog.shift();
}

export const contractById = (state, id) => ensureTrade(state).contracts.find((c) => c.id === id) ?? null;

const partyName = (state, party) => party === 'council' ? 'the council' : KINGDOMS[party]?.name ?? state.businesses.find((b) => b.id === party)?.name ?? party;

/** Agree a contract. Returns the contract or { error }. */
export function createContract(state, { merchant, origin, destination, commodity, qty, buyPrice, sellPrice, reason }) {
  const t = ensureTrade(state);
  if (qty < 1) return { error: 'nothing to trade' };
  const buyer = buyerFor(state, destination, commodity, qty, sellPrice);
  if (!buyer) return { error: `nobody in ${settlementName(destination)} can pay for ${commodity}` };
  const parts = reserve(state, origin, commodity, qty);
  if (!parts) return { error: `${settlementName(origin)} cannot spare ${qty} ${commodity}` };
  const escrow = Math.round(sellPrice * qty);
  if (!transfer(state, buyer.account, ESCROW, escrow, 'escrow', `${partyName(state, buyer.party)} pays into escrow for ${qty} ${commodity}`)) {
    release(state, origin, commodity, parts);
    return { error: 'the buyer cannot cover the price' };
  }
  state.nextId.contract = (state.nextId.contract ?? 0) + 1;
  const c = {
    id: 'tc' + state.nextId.contract, status: 'AGREED', createdDay: state.day,
    merchantId: merchant.id, merchantName: merchant.name, merchantAccount: merchant.account, merchantHome: merchant.home,
    origin, destination, commodity, qty, buyPrice, sellPrice, escrow, parts,
    buyer, buyerName: partyName(state, buyer.party),
    tariffRate: tariffRate(state, destination, merchant.home), transportCost: 0,
    caravanId: null, expectedArrivalTick: null, reason: reason ?? '',
  };
  t.contracts.push(c);
  return c;
}

/** Load at the origin: pay the seller, take the goods. Returns units loaded. */
export function loadContract(state, c, caravan) {
  if (c.status !== 'AGREED') return 0;
  const room = caravan.capacity - Object.values(caravan.cargo).reduce((a, b) => a + b, 0);
  const parts = [];
  let want = Math.min(c.qty, room);
  for (const p of c.parts) { const n = Math.min(p.n, want); if (n > 0) parts.push({ ...p, n }); want -= n; }
  // Anything that will not fit is released at once.
  release(state, c.origin, c.commodity, c.parts.map((p, i) => ({ ...p, n: p.n - (parts[i]?.n ?? 0) })).filter((p) => p.n > 0));
  const n = collect(state, c.origin, c.commodity, parts, c.merchantAccount, c.buyPrice, `${c.merchantName} bought for ${settlementName(c.destination)}`);
  c.parts = [];
  if (n < c.qty) {
    // Refund the buyer for what could not be bought.
    const refund = Math.round(c.sellPrice * (c.qty - n));
    if (refund > 0) transfer(state, ESCROW, c.buyer.account, Math.min(refund, c.escrow), 'refund', `Escrow refund: only ${n} of ${c.qty} ${c.commodity} could be loaded`);
    c.escrow -= Math.min(refund, c.escrow);
    c.qty = n;
  }
  if (n <= 0) { settleCancelled(state, c, 'nothing could be loaded'); return 0; }
  caravan.cargo[c.commodity] = (caravan.cargo[c.commodity] ?? 0) + n;
  c.status = 'IN_TRANSIT';
  c.loadedDay = state.day;
  c.paidSeller = Math.round(c.buyPrice * n);
  logCargo(state, { caravanId: caravan.id, kind: 'load', g: c.commodity, n, at: c.origin, contractId: c.id });
  return n;
}

/** Deliver at the destination. Settles exactly once. Returns units delivered. */
export function deliverContract(state, c, caravan) {
  if (c.status !== 'IN_TRANSIT') return 0;
  const n = Math.min(c.qty, Math.floor(caravan.cargo[c.commodity] ?? 0));
  caravan.cargo[c.commodity] = (caravan.cargo[c.commodity] ?? 0) - n;
  if (caravan.cargo[c.commodity] <= 0) delete caravan.cargo[c.commodity];
  deliverGoods(state, c.destination, c.buyer, c.commodity, n);
  const value = Math.round(c.sellPrice * n);
  const pay = Math.min(value, c.escrow);
  transfer(state, ESCROW, c.merchantAccount, pay, 'trade', `Delivery of ${n} ${c.commodity} to ${c.buyerName}`);
  c.escrow -= pay;
  if (c.escrow > 0) { transfer(state, ESCROW, c.buyer.account, c.escrow, 'refund', `Escrow refund for ${c.qty - n} undelivered ${c.commodity}`); c.escrow = 0; }
  const tariff = Math.round(pay * c.tariffRate);
  const collector = c.destination === HEARTH ? 'treasury' : KINGDOMS[c.destination].account;
  if (tariff > 0) transfer(state, c.merchantAccount, collector, Math.min(tariff, balance(state, c.merchantAccount)), 'tariff', `${settlementName(c.destination)} tariff on ${c.commodity}`);
  c.tariffPaid = tariff;
  c.delivered = n;
  c.revenue = pay;
  c.status = n >= c.qty ? 'DELIVERED' : n > 0 ? 'PARTIAL' : 'FAILED';
  if (n < c.qty) noteContractShortfall(state, c, c.qty - n, (caravan.spoiled?.[c.commodity] ?? 0) > 0 ? 'cargo spoiled on the road' : 'goods sold or lost on the way');
  c.deliveredDay = state.day;
  c.profit = pay - (c.paidSeller ?? 0) - tariff - (c.transportCost ?? 0);
  const t = ensureTrade(state);
  t.stats.deliveries++;
  t.stats.volume += n;
  t.stats.value += pay;
  if (c.destination !== HEARTH) state.region.settlements[c.destination].stats.imports += pay;
  noteTrade(state, c.merchantHome, c.destination, pay);
  if (c.origin !== c.merchantHome) noteTrade(state, c.origin, c.destination, pay / 2);
  logCargo(state, { caravanId: caravan.id, kind: 'deliver', g: c.commodity, n, at: c.destination, contractId: c.id });
  const citizen = byId(state.citizens, c.merchantId);
  const to = c.destination === HEARTH ? `${c.buyerName} in First Hearth` : settlementName(c.destination);
  record(state, 'trade', sentence(`${possessive(c.merchantName)} caravan delivered ${n} ${COMMODITIES[c.commodity].label.toLowerCase()} from ${settlementName(c.origin)} to ${to} for ${pay} coins${tariff ? ` (tariff ${tariff})` : ''}.`), { citizens: citizen ? [citizen.id] : [] }, citizen ? 2 : 1);
  return n;
}

function settleCancelled(state, c, reason) {
  if (c.escrow > 0) transfer(state, ESCROW, c.buyer.account, c.escrow, 'refund', `Escrow refund: contract cancelled (${reason})`);
  c.escrow = 0;
  c.status = 'CANCELLED';
  c.cancelReason = reason;
  c.closedDay = state.day;
  ensureTrade(state).stats.failures++;
}

/**
 * Cancel a contract. Before loading the reservation is released; after
 * loading the buyer is refunded and the cargo stays with the caravan (to be
 * sold elsewhere). Safe to call twice.
 */
export function cancelContract(state, c, reason) {
  if (c.status !== 'AGREED' && c.status !== 'IN_TRANSIT') return;
  if (c.status === 'AGREED') { release(state, c.origin, c.commodity, c.parts); c.parts = []; settleCancelled(state, c, reason); }
  else settleCancelled(state, c, reason);
  record(state, 'trade', `A contract for ${c.qty} ${c.commodity} from ${settlementName(c.origin)} to ${settlementName(c.destination)} was cancelled: ${reason}.`, {}, 1);
}

/** Keep the contract list bounded: old settled contracts are dropped. */
export function pruneContracts(state) {
  const t = ensureTrade(state);
  const live = t.contracts.filter((c) => c.status === 'AGREED' || c.status === 'IN_TRANSIT');
  const done = t.contracts.filter((c) => !(c.status === 'AGREED' || c.status === 'IN_TRANSIT')).slice(-60);
  t.contracts = [...done, ...live].sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
}
