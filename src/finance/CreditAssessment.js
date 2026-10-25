import { FINANCE, DAYS_PER_YEAR, LIFE } from '../core/Config.js';
import { balance } from '../economy/Transactions.js';
import { isTrading } from '../economy/Businesses.js';
import { recentProfit } from '../economy/EconomyManager.js';
import { plotValue } from '../property/LandRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { ensureFinance, depositOf } from './BankAccounts.js';

// How a bank decides whether to lend. It looks at what a borrower earns and
// how steadily, what they already owe, what they own, how their business is
// doing, how they have repaid before, what security they offer and what the
// village thinks of them. Being rich is not enough: an idle heir with a large
// purse and a record of default is refused, while a steady smith with modest
// savings and a profitable forge is not.

export function creditRecord(state, id) {
  const f = ensureFinance(state);
  return f.credit[id] ?? (f.credit[id] = { onTime: 0, late: 0, defaults: 0, paidOff: 0, bankruptDay: null, restructured: 0 });
}

export const seasonalPayment = (principal, yearlyRate, seasons) => {
  const r = yearlyRate / 4;
  if (r <= 0) return Math.ceil(principal / seasons);
  return Math.ceil((principal * r) / (1 - Math.pow(1 + r, -seasons)));
};

/** Coins a citizen earns per season, estimated from wages, business profit and recent earnings. */
export function seasonalIncome(state, c) {
  let daily = 0;
  if (c.employment?.role === 'worker') daily += c.employment.wage * 0.85;
  const owned = state.businesses.filter((b) => b.ownerId === c.id && isTrading(b));
  for (const b of owned) daily += Math.max(0, recentProfit(b, 6) / 6);
  const days = Math.max(6, Math.min(DAYS_PER_YEAR * 2, state.day - (c.arrivedDay ?? 1)));
  daily = Math.max(daily, (c.stats.earned ?? 0) / days * 0.5);
  return Math.round(daily * 3);
}

export function outstandingDebt(state, id) {
  return ensureFinance(state).loans.filter((l) => l.borrowerId === id && (l.status === 'ACTIVE' || l.status === 'DELINQUENT')).reduce((s, l) => s + l.balance, 0);
}

export function debtService(state, id) {
  return ensureFinance(state).loans.filter((l) => l.borrowerId === id && (l.status === 'ACTIVE' || l.status === 'DELINQUENT')).reduce((s, l) => s + l.payment, 0);
}

/**
 * Assess an application. Returns { approved, score, rate, payment, reasons, collateral }.
 * `collateralPlotId` is a plot the borrower owns and pledges (or will buy with the loan).
 */
export function assessCredit(state, bank, c, amount, { seasons = 8, collateralPlotId = null, purpose = 'general' } = {}) {
  const reasons = [];
  let score = 50;
  const income = seasonalIncome(state, c);
  const rec = creditRecord(state, c.id);
  const debt = outstandingDebt(state, c.id);
  const active = ensureFinance(state).loans.filter((l) => l.borrowerId === c.id && (l.status === 'ACTIVE' || l.status === 'DELINQUENT')).length;
  const assets = balance(state, c.id) + depositOf(state, c.id) + state.plots.filter((p) => p.ownerId === c.id).reduce((s, p) => s + plotValue(p), 0);
  const age = ageOf(state, c);

  // Income and its steadiness.
  const tenure = c.employment ? state.day - (c.employment.since ?? state.day) : 0;
  if (!c.employment) { score -= 25; reasons.push('no regular work'); }
  else if (tenure >= DAYS_PER_YEAR) { score += 12; reasons.push(`steady work for ${Math.floor(tenure / DAYS_PER_YEAR)} year(s)`); }
  else if (tenure < 6) { score -= 8; reasons.push('only just started this job'); }
  // Business profitability.
  const biz = state.businesses.filter((b) => b.ownerId === c.id && isTrading(b));
  for (const b of biz) {
    const p = recentProfit(b, 6);
    if (p > 10) { score += 10; reasons.push(`${b.name} is profitable (${p} coins in six days)`); }
    else if (p < 0) { score -= 12; reasons.push(`${b.name} is losing money`); }
    if (b.status === 'STRUGGLING') { score -= 10; reasons.push(`${b.name} is struggling`); }
  }
  // Repayment history.
  if (rec.bankruptDay && state.day - rec.bankruptDay < DAYS_PER_YEAR * 10) { score -= 60; reasons.push('declared bankrupt within ten years'); }
  if (rec.defaults) { score -= 30 * Math.min(2, rec.defaults); reasons.push(`${rec.defaults} past default(s)`); }
  if (rec.onTime >= 4) { score += Math.min(15, rec.onTime); reasons.push(`${rec.onTime} payments made on time`); }
  if (rec.late) { score -= Math.min(15, rec.late * 3); reasons.push(`${rec.late} late payment(s)`); }
  if (rec.paidOff) { score += 6; reasons.push('has paid off a loan before'); }
  // Existing debts.
  if (active >= FINANCE.maxLoansPerBorrower) { score -= 40; reasons.push('already carries the most loans a bank allows'); }
  else if (debt > 0) { score -= Math.min(15, Math.round(debt / 20)); reasons.push(`already owes ${debt} coins`); }
  // Assets and security.
  const pledged = collateralPlotId ? state.plots.find((p) => p.id === collateralPlotId) : null;
  const security = pledged ? plotValue(pledged) : 0;
  if (security >= amount * 0.7) { score += 12; reasons.push(`secured on ${pledged.name} (worth about ${security})`); }
  else if (pledged) { score += 4; reasons.push(`part-secured on ${pledged.name}`); }
  else reasons.push('unsecured');
  if (assets > amount * 2) { score += 6; reasons.push(`holds assets of about ${assets} coins`); }
  // Character, as the village sees it.
  score += Math.round((c.reputation.reliability - 50) / 4 + (c.reputation.honesty - 50) / 5);
  if (trait(c, 'dishonest') > 0.3) score -= 6;
  if (age >= LIFE.retireAge && seasons > 8) { score -= 10; reasons.push('a long loan late in life'); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const premium = FINANCE.maxRiskPremium * (1 - score / 100) * (pledged ? 0.7 : 1);
  const rate = Math.round((FINANCE.baseLoanRate + premium) * 1000) / 1000;
  const payment = seasonalPayment(amount, rate, seasons);
  const burden = (debtService(state, c.id) + payment) / Math.max(1, income);
  if (burden > 0.55) reasons.push(`repayments would take ${Math.round(burden * 100)}% of income`);
  const lendable = balance(state, bank.id) - Math.ceil(FINANCE.reserveRatio * Object.values(bank.deposits).reduce((a, b) => a + b, 0));
  const approved = score >= 55 && burden <= 0.55 && lendable >= amount && bank.status === 'OPEN' && (bank.kind !== 'guild_credit' || bank.members?.includes(c.id));
  if (lendable < amount) reasons.push(`${bank.name} cannot spare ${amount} coins from its reserves`);
  return { approved, score, rate, payment, seasons, reasons, income, burden: Math.round(burden * 100) / 100, collateralPlotId: pledged?.id ?? null, purpose };
}
