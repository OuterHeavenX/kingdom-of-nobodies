import { balance, transfer } from '../economy/Transactions.js';
import { qty, addGoods, removeGoods, moveGoods } from '../economy/Inventory.js';
import { isTrading, BUSINESS_TYPES, businessById, wholesalePrice } from '../economy/Businesses.js';
import { villageFood, noteSale } from '../economy/Marketplace.js';
import { GOODS } from '../core/Config.js';
import { HEARTH, COMMODITIES, KINGDOMS } from '../region/RegionData.js';
import { available, foodNeed } from '../region/Settlement.js';

// One market interface over every settlement. Neighbouring kingdoms trade
// from a single aggregate inventory and account; First Hearth trades through
// its real businesses (farms sell grain, smiths buy ore, shops buy tools) and
// the council (stone for roads, grain for the pantry in hard times). Stock is
// reserved before a caravan sets out, so two contracts can never promise the
// same goods.

const kingdom = (state, sid) => state.region.settlements[sid];

// --- First Hearth -----------------------------------------------------------

const keepBack = (b, g) => Math.round((BUSINESS_TYPES[b.type].target ?? 4) * (BUSINESS_TYPES[b.type].output === g ? 0.7 : 0.4));

/** Local businesses with goods to spare. */
export function hearthSellers(state, g) {
  if (!COMMODITIES[g]?.local) return [];
  return state.businesses.filter((b) => isTrading(b) && (BUSINESS_TYPES[b.type].output === g || (BUSINESS_TYPES[b.type].sells.includes(g) && b.type !== 'general_store')))
    .map((b) => ({ b, n: qty(b.inventory, g) - keepBack(b, g) }))
    .filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.b.id.localeCompare(b.b.id));
}

/** Who in First Hearth wants a good, how much, and who would pay. */
export function hearthBuyers(state, g) {
  const out = [];
  const add = (party, want, account, pantry) => { if (want > 0) out.push({ party, want: Math.floor(want), account, pantry }); };
  const trading = state.businesses.filter((b) => isTrading(b));
  if (g === 'grain') {
    for (const b of trading.filter((x) => BUSINESS_TYPES[x.type].inputs.grain)) add(b.id, 14 - qty(b.inventory, 'grain'), b.id);
    for (const b of trading.filter((x) => x.type === 'general_store')) add(b.id, 10 - qty(b.inventory, 'grain'), b.id);
    const short = state.citizens.length * 7 - villageFood(state);
    if (short > 0) add('council', Math.min(60, short), 'treasury', 'pantry');
  }
  if (g === 'ore') for (const b of trading.filter((x) => x.type === 'blacksmith')) add(b.id, 12 - qty(b.inventory, 'ore'), b.id);
  if (g === 'tools') {
    for (const b of trading.filter((x) => x.type === 'general_store')) add(b.id, 5 - qty(b.inventory, 'tools'), b.id);
    for (const b of trading.filter((x) => BUSINESS_TYPES[x.type].usesTools)) add(b.id, 2 - qty(b.inventory, 'tools'), b.id);
  }
  if (g === 'stone') {
    const waiting = (state.roadProjects ?? []).filter((p) => p.status === 'BUILDING' || p.status === 'PROPOSED').reduce((t, p) => t + Math.max(0, p.need.stone - p.materials.stone), 0);
    add('council', Math.min(60, waiting + (state.law?.courthousePlanned ? 10 : 0) - qty(state.council.stores ?? {}, 'stone')), 'treasury', 'stores');
  }
  if (g === 'timber' && !trading.some((b) => b.type === 'lumberyard' && qty(b.inventory, 'timber') > 3)) {
    for (const b of trading.filter((x) => x.type === 'general_store')) add(b.id, 8 - qty(b.inventory, 'timber'), b.id);
  }
  return out.sort((a, b) => b.want - a.want || String(a.party).localeCompare(String(b.party)));
}

function hearthPrice(state, g) {
  const base = GOODS[g]?.base ?? COMMODITIES[g].base;
  const stock = hearthSellers(state, g).reduce((t, x) => t + x.n, 0);
  const want = hearthBuyers(state, g).reduce((t, x) => t + x.want, 0);
  const sellers = hearthSellers(state, g);
  const quoted = sellers.length ? wholesalePrice(sellers[0].b, g) : base;
  return Math.round(Math.max(base * 0.6, Math.min(base * 2.2, quoted * Math.sqrt((want + 4) / (stock + 4)))) * 100) / 100;
}

// --- Common interface ---------------------------------------------------------

export function marketPrice(state, sid, g) {
  return sid === HEARTH ? hearthPrice(state, g) : kingdom(state, sid).prices[g];
}

export function marketAvailable(state, sid, g) {
  if (sid === HEARTH) return hearthSellers(state, g).reduce((t, x) => t + x.n, 0);
  const k = kingdom(state, sid);
  const def = KINGDOMS[sid];
  // A kingdom keeps back what it needs for itself.
  const own = COMMODITIES[g].food ? foodNeed(state, k) * 4 : (def.needs[g] ?? 0) * k.population / 100 * 5;
  return Math.max(0, Math.floor(available(k, g) - own));
}

export function marketDemand(state, sid, g) {
  if (sid === HEARTH) return hearthBuyers(state, g).reduce((t, x) => t + x.want, 0);
  const k = kingdom(state, sid);
  const def = KINGDOMS[sid];
  const daily = COMMODITIES[g].food ? foodNeed(state, k) / 2 : (def.needs[g] ?? 0) * k.population / 100;
  return Math.max(0, Math.floor(daily * 10 - available(k, g) - incoming(state, sid, g)));
}

/** Goods already on their way to a settlement under contract. */
export function incoming(state, sid, g) {
  return (state.trade?.contracts ?? []).filter((c) => c.destination === sid && c.commodity === g && (c.status === 'AGREED' || c.status === 'IN_TRANSIT')).reduce((t, c) => t + c.qty, 0);
}

/** Reserve stock at the origin. Returns the reservation (list of parties) or null. */
export function reserve(state, sid, g, n) {
  if (n <= 0) return null;
  if (sid !== HEARTH) {
    const k = kingdom(state, sid);
    if (marketAvailable(state, sid, g) < n) return null;
    k.reserved[g] = (k.reserved[g] ?? 0) + n;
    return [{ party: sid, n }];
  }
  const parts = [];
  let left = n;
  for (const { b, n: spare } of hearthSellers(state, g)) {
    if (left <= 0) break;
    const take = Math.min(left, spare);
    // Reserved goods are set aside (still the shop's, not yet paid for) so they cannot be sold twice.
    b.held = b.held ?? {};
    moveGoods(b.inventory, b.held, g, take);
    parts.push({ party: b.id, n: take });
    left -= take;
  }
  if (left > 0) { release(state, sid, g, parts); return null; }
  return parts;
}

export function release(state, sid, g, parts) {
  for (const p of parts ?? []) {
    if (sid === HEARTH) { const b = businessById(state, p.party); if (b?.held) moveGoods(b.held, b.inventory, g, Math.min(p.n, qty(b.held, g))); }
    else { const k = kingdom(state, sid); k.reserved[g] = Math.max(0, (k.reserved[g] ?? 0) - p.n); }
  }
}

/**
 * Collect reserved goods: the payer pays each seller and the goods leave
 * their stock. Returns the number of units actually handed over.
 */
export function collect(state, sid, g, parts, payer, unitPrice, memo) {
  let got = 0;
  for (const p of parts) {
    const seller = sid === HEARTH ? businessById(state, p.party) : null;
    const stock = sid === HEARTH ? (seller && isTrading(seller) ? qty(seller.held ?? {}, g) : 0) : kingdom(state, sid).inventory[g] ?? 0;
    const affordable = Math.floor(balance(state, payer) / unitPrice);
    const n = Math.max(0, Math.min(p.n, Math.floor(stock), affordable));
    // Whatever is not bought goes back on the shelf (or the kingdom's free stock).
    release(state, sid, g, [{ ...p, n: p.n - n }]);
    if (sid !== HEARTH) kingdom(state, sid).reserved[g] = Math.max(0, (kingdom(state, sid).reserved[g] ?? 0) - n);
    if (n <= 0) continue;
    const account = sid === HEARTH ? seller.id : KINGDOMS[sid].account;
    const price = Math.round(unitPrice * n);
    // A kingdom's own merchants take goods from its own stores without paying themselves.
    if (account !== payer && !transfer(state, payer, account, price, 'trade', `${memo} (${n} ${g})`)) continue;
    if (sid === HEARTH) {
      removeGoods(seller.held, g, n);
      seller.today.revenue += price;
      seller.totals.revenue += price;
      noteSale(state, seller, 'a merchant caravan', n, g, price);
    } else {
      kingdom(state, sid).inventory[g] -= n;
      kingdom(state, sid).stats.exports += price;
    }
    got += n;
  }
  return got;
}

/** Choose who will receive (and pay for) a delivery to a settlement. */
export function buyerFor(state, sid, g, n, unitPrice) {
  if (sid !== HEARTH) return { party: sid, account: KINGDOMS[sid].account };
  const b = hearthBuyers(state, g).find((x) => balance(state, x.account) >= Math.min(n, x.want) * unitPrice);
  return b ? { party: b.party, account: b.account, pantry: b.pantry, want: b.want } : null;
}

/** Put delivered goods into the buyer's stock. */
export function deliverGoods(state, sid, buyer, g, n) {
  if (n <= 0) return;
  if (sid !== HEARTH) { kingdom(state, sid).inventory[g] = (kingdom(state, sid).inventory[g] ?? 0) + n; return; }
  if (buyer.party === 'council') {
    const store = buyer.pantry === 'pantry' ? state.council.pantry : (state.council.stores = state.council.stores ?? {});
    addGoods(store, g, n);
    return;
  }
  const b = businessById(state, buyer.party);
  if (b) addGoods(b.inventory, g, n);
  else addGoods(state.council.stores, g, n); // the shop closed meanwhile: the council takes the goods
}

/** Sell goods on the spot (diverted cargo): the market pays what it can at its price. */
export function spotSale(state, sid, g, n, sellerAccount, memo) {
  const unit = Math.max(0.5, marketPrice(state, sid, g) * 0.85);
  const buyer = sid === HEARTH ? buyerFor(state, sid, g, 1, unit) ?? { party: 'council', account: 'treasury', pantry: COMMODITIES[g].food ? 'pantry' : 'stores' } : { party: sid, account: KINGDOMS[sid].account };
  const units = Math.min(n, Math.floor(balance(state, buyer.account) / unit));
  if (units <= 0) return 0;
  const price = Math.round(unit * units);
  if (!transfer(state, buyer.account, sellerAccount, price, 'trade', `${memo} (${units} ${g})`)) return 0;
  deliverGoods(state, sid, buyer, g, units);
  return units;
}
