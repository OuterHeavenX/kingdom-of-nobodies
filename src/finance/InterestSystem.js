import { FINANCE } from '../core/Config.js';
import { isNewSeason } from '../core/Calendar.js';
import { ensureFinance } from './BankAccounts.js';
import { isLive, seasonKey } from './LoanManager.js';

// Interest, on game-calendar time. Loans accrue a quarter of their yearly rate
// at the start of each season; deposits earn the bank's deposit rate the same
// way. Each loan and each bank remembers the last season it accrued, so a
// season is never charged twice, however many times the world is saved and
// loaded. All amounts are whole coins.

export function accrueLoan(state, loan) {
  const key = seasonKey(state.day);
  if (!isLive(loan) || loan.accruedSeason >= key || loan.balance <= 0) return 0;
  const interest = Math.max(1, Math.round(loan.balance * loan.rate / 4));
  loan.balance += interest;
  loan.interest += interest;
  loan.accruedSeason = key;
  ensureFinance(state).stats.interest += interest;
  return interest;
}

/**
 * Depositors share in what the bank earns: they are paid the bank's deposit
 * rate, but never more than 70% of the interest its loans earned this season,
 * so savings left idle in the vault cannot drive a bank into the red.
 */
export function accrueDeposits(state, bank, loanIncome = 0) {
  const key = seasonKey(state.day);
  if (bank.status === 'FAILED' || (bank.accruedSeason ?? -1) >= key) return 0;
  bank.accruedSeason = key;
  const held = Object.values(bank.deposits).reduce((a, b) => a + b, 0);
  const rate = Math.min(bank.rates.deposit / 4, held ? (loanIncome * 0.7) / held : 0);
  bank.rates.effective = Math.round(rate * 4 * 1000) / 1000;
  let total = 0;
  for (const [holder, n] of Object.entries(bank.deposits)) {
    if (n < 20) continue;
    const i = Math.floor(n * rate);
    if (i <= 0) continue;
    bank.deposits[holder] = n + i;
    total += i;
  }
  bank.stats.interestPaid += total;
  return total;
}

/** Start of each season: interest on every live loan and every deposit. */
export function seasonalInterest(state) {
  if (!isNewSeason(state.day)) return;
  const f = ensureFinance(state);
  const income = {};
  for (const loan of f.loans) income[loan.bankId] = (income[loan.bankId] ?? 0) + accrueLoan(state, loan);
  for (const bank of f.banks) accrueDeposits(state, bank, income[bank.id] ?? 0);
}

export const depositRateFor = (kind) => (kind === 'savings_house' ? FINANCE.depositRate + 0.01 : kind === 'moneylender' ? 0 : FINANCE.depositRate);
