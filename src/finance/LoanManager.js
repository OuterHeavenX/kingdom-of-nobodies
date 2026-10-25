import { FINANCE } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { bump } from '../society/Reputation.js';
import { ensureFinance, bankById, raiseCash } from './BankAccounts.js';
import { assessCredit, creditRecord, seasonalPayment } from './CreditAssessment.js';

// Loans. Issuing a loan moves coins from the bank's reserves to the borrower
// (the bank's cash falls, its loan book rises by the same amount). Interest is
// added once a season by the interest system; repayments move coins back from
// the borrower and reduce the balance. Every payment is listed on the loan.

export const lenderAccount = (loan) => (loan.bankId === 'council' ? 'treasury' : loan.bankId);
export const loanById = (state, id) => ensureFinance(state).loans.find((l) => l.id === id) ?? null;
export const isLive = (l) => l.status === 'ACTIVE' || l.status === 'DELINQUENT';
export const liveLoans = (state) => ensureFinance(state).loans.filter(isLive);
export const loansOf = (state, id) => ensureFinance(state).loans.filter((l) => l.borrowerId === id && isLive(l));

const PURPOSE = {
  premises: 'to buy premises for a new business', home: 'to buy land and build a home', expansion: 'to expand their business',
  development: 'to build a cottage for sale', equipment: 'to buy equipment', caravan: 'to fit out a caravan', general: 'for their needs',
};
export const purposeText = (p) => PURPOSE[p] ?? PURPOSE.general;

function note(loan, state, text) {
  loan.history.push({ day: state.day, text });
  if (loan.history.length > 16) loan.history.splice(1, 1);
}

/**
 * Apply for a loan at the best bank that will lend. Returns { ok, loan, decision }.
 * The decision (with its reasons) is kept even when refused, so players can see why.
 */
export function applyForLoan(state, c, amount, { purpose = 'general', seasons = 8, collateralPlotId = null } = {}) {
  const f = ensureFinance(state);
  amount = Math.ceil(amount);
  if (amount < 5) return { ok: false, decision: null };
  const offers = f.banks.filter((b) => b.status === 'OPEN')
    .map((bank) => ({ bank, d: assessCredit(state, bank, c, amount, { seasons, collateralPlotId, purpose }) }))
    .sort((a, b) => (b.d.approved - a.d.approved) || a.d.rate - b.d.rate || a.bank.id.localeCompare(b.bank.id));
  const best = offers[0];
  c.lastLoanApplication = { day: state.day, amount, purpose, approved: !!best?.d.approved, bank: best?.bank.name ?? null, score: best?.d.score ?? 0, reasons: best?.d.reasons.slice(0, 5) ?? ['no bank in the village'] };
  if (!best || !best.d.approved) return { ok: false, decision: best?.d ?? null };
  return { ok: true, loan: issueLoan(state, best.bank, c, amount, best.d), decision: best.d };
}

export function issueLoan(state, bank, c, amount, d) {
  const f = ensureFinance(state);
  if (!transfer(state, bank.id, c.id, amount, 'loan', `${bank.name} lent ${amount} coins ${purposeText(d.purpose)}`)) return null;
  const loan = {
    id: 'ln' + ++f.nextId.loan, bankId: bank.id, borrowerId: c.id, borrowerName: `${c.firstName} ${c.lastName}`, principal: amount, balance: amount,
    rate: d.rate, termSeasons: d.seasons, payment: d.payment, purpose: d.purpose, collateralPlotId: d.collateralPlotId,
    issuedDay: state.day, nextDueDay: state.day + 3, accruedSeason: seasonKey(state.day), missed: 0, paid: 0, interest: 0, penalties: 0,
    status: 'ACTIVE', score: d.score, history: [],
  };
  note(loan, state, `Issued: ${amount} coins at ${Math.round(d.rate * 1000) / 10}% a year over ${d.seasons} seasons (${d.payment} a season); credit score ${d.score}.`);
  f.loans.push(loan);
  bank.stats.issued += amount;
  f.stats.issued += amount;
  if (loan.collateralPlotId) setLien(state, loan.collateralPlotId, loan.id);
  remember(state, c, `Borrowed ${amount} coins from ${bank.name} ${purposeText(d.purpose)}.`, 2, 'career');
  record(state, 'economy', `${bank.name} lent ${c.firstName} ${c.lastName} ${amount} coins ${purposeText(d.purpose)} at ${Math.round(d.rate * 1000) / 10}% (${d.payment} a season for ${d.seasons} seasons).`, { citizens: [c.id] }, 2);
  return loan;
}

export function setLien(state, plotId, loanId) {
  const p = state.plots.find((x) => x.id === plotId);
  if (p && !p.lien) p.lien = loanId;
}

export function clearLien(state, loan) {
  for (const p of state.plots) if (p.lien === loan.id) delete p.lien;
}

/** Season number used to make interest idempotent: accrued at most once per season. */
export const seasonKey = (day) => Math.floor((day - 1) / 3);

/**
 * A payment is due: the borrower pays from cash, then from savings. A short
 * payment is recorded as missed, with a penalty; enough misses and the bank
 * moves to recover the debt (DebtCollection).
 */
export function collectPayment(state, loan) {
  if (!isLive(loan) || state.day < loan.nextDueDay) return null;
  const council = loan.borrowerId === 'council';
  const borrower = council ? { id: 'treasury', firstName: 'The council', lastName: '', reputation: { reliability: 60 } } : byId(state.citizens, loan.borrowerId);
  const due = Math.min(loan.balance, loan.payment + (loan.arrears ?? 0));
  loan.nextDueDay = state.day + 3;
  if (!borrower) return null;
  if (!council && balance(state, borrower.id) < due) raiseCash(state, borrower.id, due);
  const paid = Math.min(due, balance(state, borrower.id));
  if (paid > 0 && transfer(state, borrower.id, lenderAccount(loan), paid, 'repayment', `${borrower.firstName}'s repayment on ${loan.id}`)) {
    loan.balance -= paid;
    loan.paid += paid;
    ensureFinance(state).stats.repaid += paid;
    const bank = bankById(state, loan.bankId);
    if (bank) bank.stats.repaid += paid;
  }
  const rec = creditRecord(state, borrower.id);
  if (loan.balance <= 0) {
    loan.balance = 0;
    loan.status = 'PAID';
    loan.closedDay = state.day;
    loan.arrears = 0;
    clearLien(state, loan);
    rec.onTime++; rec.paidOff++;
    note(loan, state, `Paid off in full (${loan.paid} coins repaid, ${loan.interest} of it interest).`);
    if (council) return { paid, due };
    bump(borrower, 'reliability', 4);
    remember(state, borrower, `Paid off my loan from ${bankById(state, loan.bankId)?.name ?? 'the council'}.`, 2, 'career');
    record(state, 'economy', `${borrower.firstName} ${borrower.lastName} paid off a ${loan.principal}-coin loan.`, { citizens: [borrower.id] }, 1);
    return { paid, due };
  }
  if (paid >= due) {
    loan.arrears = 0;
    if (loan.missed) loan.missed = Math.max(0, loan.missed - 1);
    if (loan.status === 'DELINQUENT' && !loan.missed) loan.status = 'ACTIVE';
    rec.onTime++;
    return { paid, due };
  }
  // Fell short.
  loan.arrears = due - paid;
  loan.missed++;
  const penalty = Math.max(1, Math.round(loan.payment * FINANCE.penaltyRate));
  loan.balance += penalty;
  loan.penalties += penalty;
  loan.status = 'DELINQUENT';
  rec.late++;
  if (council) return { paid, due, short: due - paid };
  bump(borrower, 'reliability', -3);
  note(loan, state, `Payment of ${due} due; ${paid} paid. Missed ${loan.missed} time(s); a penalty of ${penalty} added.`);
  if (loan.missed === 1) remember(state, borrower, `Could not make my full loan payment (${paid} of ${due}).`, 2, 'grievance');
  return { paid, due, short: due - paid };
}

/**
 * The council borrows to build: a bank lends against the land the works will
 * open, which the council sells to settlers. Approved when the bank can spare
 * the coins and the land is worth more than the loan.
 */
export function municipalLoan(state, amount, { purpose, security, seasons = 8 }) {
  const f = ensureFinance(state);
  amount = Math.ceil(amount);
  const live = f.loans.filter((l) => l.borrowerId === 'council' && isLive(l));
  if (live.length >= 2 || security < amount * 1.2) return null;
  const bank = f.banks.filter((b) => b.status === 'OPEN' && b.kind !== 'guild_credit')
    .map((b) => ({ b, spare: balance(state, b.id) - Math.ceil(FINANCE.reserveRatio * Object.values(b.deposits).reduce((x, y) => x + y, 0)) }))
    .filter((x) => x.spare >= amount).sort((a, b) => (b.b.kind === 'savings_house') - (a.b.kind === 'savings_house') || b.spare - a.spare)[0]?.b;
  if (!bank) return null;
  const rate = FINANCE.baseLoanRate;
  const d = { rate, seasons, payment: seasonalPayment(amount, rate, seasons), purpose, score: 70, collateralPlotId: null };
  if (!transfer(state, bank.id, 'treasury', amount, 'loan', `${bank.name} lent the council ${amount} coins ${purpose}`)) return null;
  const loan = {
    id: 'ln' + ++f.nextId.loan, bankId: bank.id, borrowerId: 'council', borrowerName: 'the council', principal: amount, balance: amount, rate, termSeasons: seasons, payment: d.payment,
    purpose: 'public works', issuedDay: state.day, nextDueDay: state.day + 3, accruedSeason: seasonKey(state.day), missed: 0, paid: 0, interest: 0, penalties: 0, status: 'ACTIVE', score: 70, history: [],
  };
  note(loan, state, `Lent to the council ${purpose}: ${amount} coins over ${seasons} seasons.`);
  f.loans.push(loan);
  bank.stats.issued += amount;
  f.stats.issued += amount;
  record(state, 'economy', `${bank.name} lent the council ${amount} coins ${purpose}, to be repaid from land sales at ${loan.payment} a season.`, {}, 2);
  return loan;
}

/** Restructure once: stretch the remaining balance over a longer term at the same rate. */
export function restructure(state, loan, extraSeasons = 6) {
  const remainingSeasons = Math.max(2, Math.ceil(loan.balance / Math.max(1, loan.payment))) + extraSeasons;
  loan.termSeasons = Math.min(FINANCE.maxTermSeasons + 8, remainingSeasons);
  loan.payment = seasonalPayment(loan.balance, loan.rate, loan.termSeasons);
  loan.restructured = (loan.restructured ?? 0) + 1;
  loan.missed = 0;
  loan.arrears = 0;
  loan.status = 'ACTIVE';
  creditRecord(state, loan.borrowerId).restructured++;
  note(loan, state, `Restructured: ${loan.balance} coins over ${loan.termSeasons} seasons at ${loan.payment} a season.`);
  const b = byId(state.citizens, loan.borrowerId);
  record(state, 'economy', `${bankById(state, loan.bankId)?.name ?? 'The council'} agreed to restructure ${b ? `${b.firstName} ${b.lastName}'s` : 'a'} loan: smaller payments over a longer term.`, { citizens: b ? [b.id] : [] }, 1);
}
