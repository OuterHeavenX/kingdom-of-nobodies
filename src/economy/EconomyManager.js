import { byId } from '../core/EntityRegistry.js';
import { ECONOMY, GOODS } from '../core/Config.js';
import { transfer, balance } from './Transactions.js';
import { qty, removeGoods, addGoods } from './Inventory.js';
import { BUSINESS_TYPES, isTrading, freshLedger } from './Businesses.js';
import { adjustPrices, cashReserve, ownerAccount } from './Marketplace.js';
import { layOff, leaveJob, updateOpenings, wageBill } from './Employment.js';
import { listForSale } from '../property/Ownership.js';
import { startProject } from '../property/Construction.js';
import { plotById, plotHistory } from '../property/LandRegistry.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { bump } from '../society/Reputation.js';
import { createFact } from '../society/Gossip.js';

// End-of-day bookkeeping: taxes, profit and loss, dividends, prices, staffing,
// and the business life cycle OPEN → STRUGGLING → CLOSED/BANKRUPT.

export function closeDay(state) {
  const taxPerBusiness = Math.max(0, ECONOMY.tax[state.council.taxLevel] - (state.government?.policies?.reducedFees ? 1 : 0));
  for (const b of state.businesses) {
    if (!isTrading(b)) continue;
    const startup = state.day - b.foundedDay < 4;
    if (b.ownerId !== 'council' && !startup) {
      const tax = Math.min(taxPerBusiness, balance(state, b.id));
      if (tax > 0 && transfer(state, b.id, 'treasury', tax, 'tax', `Daily levy on ${b.name}`)) b.today.tax += tax;
    }
    const t = b.today;
    const expenses = t.wages + t.inputs + t.tax + t.other;
    const profit = t.revenue - expenses;
    b.totals.expenses += expenses;
    b.history.push({ day: state.day, revenue: t.revenue, expenses, profit, customers: t.customers, produced: t.produced, cash: balance(state, b.id) });
    if (b.history.length > 14) b.history.shift();
    b.quality = Math.max(0.1, Math.min(1, b.quality + (t.customers > 0 ? 0.02 : -0.01)));
    if (!BUSINESS_TYPES[b.type].civic) payDividend(state, b);
    considerUpgrade(state, b);
    adjustPrices(b);
    updateLifecycle(state, b, startup);
    if (isTrading(b)) updateOpenings(state, b);
    const owner = byId(state.citizens, b.ownerId);
    if (owner) bump(owner, 'competence', profit > 0 ? 0.8 : profit < 0 ? -0.6 : 0);
    b.today = freshLedger();
  }
}

function payDividend(state, b) {
  const excess = balance(state, b.id) - cashReserve(state, b) - 45;
  if (excess <= 4) return;
  const amount = Math.floor(excess * ECONOMY.dividendShare);
  if (amount > 0) transfer(state, b.id, ownerAccount(b.ownerId), amount, 'dividend', `Profits from ${b.name}`);
}

/** A thriving business whose owner can afford it expands its premises (real timber and builders' wages). */
function considerUpgrade(state, b) {
  const owner = byId(state.citizens, b.ownerId);
  const plot = plotById(state, b.plotId);
  if (!owner || !plot?.building || plot.projectId || (b.level ?? 1) >= 3 || b.status !== 'OPEN') return;
  if (b.history.length < 6 || recentProfit(b, 6) <= 10 || balance(state, owner.id) < 70 + (b.level ?? 1) * 30) return;
  if (state.projects.length >= ECONOMY.maxActiveProjects + 2) return;
  const res = startProject(state, { plotId: plot.id, ownerId: owner.id, kind: 'upgrade' });
  if (res.ok) remember(state, owner, `Began expanding ${b.name}.`, 2, 'career');
}

export function recentProfit(b, days = 3) {
  return b.history.slice(-days).reduce((s, h) => s + h.profit, 0);
}

function updateLifecycle(state, b, startup) {
  if (startup || BUSINESS_TYPES[b.type].civic) return;
  const cash = balance(state, b.id);
  const losing = recentProfit(b, 3) < 0;
  const noTrade = b.history.slice(-3).every((h) => h.revenue === 0);
  const strained = (losing && cash < cashReserve(state, b) + 5) || b.unpaidShifts > 0 || noTrade;
  b.unpaidShifts = 0;
  if (b.status === 'OPEN' && strained) {
    b.status = 'STRUGGLING';
    b.struggleDays = 0;
    record(state, 'business', `${b.name} is struggling: ${noTrade ? 'no customers for days' : 'losses are mounting'}.`, { citizens: owners(b), business: b.id }, 1);
  } else if (b.status === 'STRUGGLING') {
    if (!strained && recentProfit(b, 3) > 0) {
      b.status = 'OPEN';
      b.struggleDays = 0;
      record(state, 'business', `${b.name} has recovered and is trading well again.`, { citizens: owners(b), business: b.id }, 2);
      return;
    }
    b.struggleDays++;
    if (b.employees.length && cash < wageBill(state, b) * 2) layOff(state, b, 'losses');
    const councilCanCarry = b.ownerId === 'council' && balance(state, 'treasury') > 40;
    if (b.struggleDays >= ECONOMY.closeAfterStruggleDays && !councilCanCarry) closeBusiness(state, b, cash <= 3 ? 'BANKRUPT' : 'CLOSED');
  }
}

const owners = (b) => (b.ownerId === 'council' ? [] : [b.ownerId]);

/**
 * Close a business permanently. It stops trading, staff are released, stock is
 * sold off to traders, remaining cash returns to the owner and the property is
 * put up for sale (the building stays standing until a new owner decides).
 */
export function closeBusiness(state, b, status = 'CLOSED') {
  // Goods set aside for a caravan go back into stock before anything is sold off.
  for (const [g, n] of Object.entries(b.held ?? {})) if (n > 0) addGoods(b.inventory, g, n);
  b.held = {};
  b.status = status;
  b.closedDay = state.day;
  b.openings = 0;
  for (const id of [...b.employees]) {
    const c = byId(state.citizens, id);
    if (!c) continue;
    leaveJob(state, c, `${b.name} closed`);
    c.mood = Math.max(0, c.mood - 12);
    remember(state, c, `Lost my job when ${b.name} closed.`, 3, 'career');
  }
  b.employees = [];
  let liquidated = 0;
  for (const [good, n] of Object.entries({ ...b.inventory })) {
    const unit = Math.max(1, Math.round((GOODS[good]?.base ?? 1) * ECONOMY.liquidationFactor));
    const units = Math.min(n, Math.floor(balance(state, 'outside') / unit));
    if (units > 0 && transfer(state, 'outside', b.id, unit * units, 'liquidation', `${units} ${good} from ${b.name}`)) {
      liquidated += unit * units;
    }
    removeGoods(b.inventory, good, n);
  }
  const cash = balance(state, b.id);
  if (cash > 0) transfer(state, b.id, ownerAccount(b.ownerId), cash, 'liquidation', `Remaining funds of ${b.name}`);
  const plot = plotById(state, b.plotId);
  plot.businessId = null;
  if (plot.building) plot.building.name = `Empty ${plot.building.name.replace(/^Empty /, '')}`;
  plotHistory(state, plot, `${b.name} ${status === 'BANKRUPT' ? 'went bankrupt' : 'closed its doors'}.`);
  listForSale(state, plot.id, Math.round(plot.price ? Math.max(plot.price * 0.9, 20) : 30));
  const owner = byId(state.citizens, b.ownerId);
  if (owner) {
    if (owner.employment?.businessId === b.id) leaveJob(state, owner, `${b.name} closed`);
    owner.mood = Math.max(0, owner.mood - 25);
    bump(owner, 'competence', status === 'BANKRUPT' ? -15 : -8);
    remember(state, owner, `${b.name} ${status === 'BANKRUPT' ? 'went bankrupt' : 'closed'}.`, 3, 'milestone');
    if (owner.venture?.businessId === b.id) owner.venture = { failedDay: state.day, type: b.type };
    createFact(state, 'bankrupt', owner.id, `${b.name} went under.`, [owner.id, ...b.employees]);
  }
  record(state, 'business', `${b.name} ${status === 'BANKRUPT' ? 'went bankrupt' : 'closed permanently'} after repeated losses. ${plot.name} is now for sale.`,
    { citizens: owners(b), business: b.id, plot: plot.id }, 3);
  return { liquidated };
}

export function economySnapshot(state) {
  const trading = state.businesses.filter(isTrading);
  const wallets = state.citizens.reduce((s, c) => s + balance(state, c.id), 0);
  const businessCash = state.businesses.reduce((s, b) => s + balance(state, b.id), 0);
  return {
    treasury: balance(state, 'treasury'),
    wallets,
    businessCash,
    outside: balance(state, 'outside'),
    open: trading.length,
    employed: state.citizens.filter((c) => c.employment).length,
    unemployed: state.citizens.filter((c) => !c.employment && c.profession !== 'Builder' && c.profession !== 'Forager').length,
    totals: { ...state.ledgerTotals },
    goods: Object.fromEntries(Object.keys(GOODS).map((g) => [g, trading.reduce((s, b) => s + qty(b.inventory, g), 0)])),
  };
}

export { BUSINESS_TYPES };
