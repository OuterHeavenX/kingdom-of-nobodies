import { FINANCE } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { isTrading } from '../economy/Businesses.js';
import { closeBusiness } from '../economy/EconomyManager.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { bump } from '../society/Reputation.js';
import { plotValue, plotHistory } from '../property/LandRegistry.js';
import { listForSale, saleHooks } from '../property/Ownership.js';
import { ensureLaw, lawInForce } from '../law/LegalCode.js';
import { fileClaim, judgmentHandlers } from '../law/Courts.js';
import { ensureFinance, bankById, raiseCash } from './BankAccounts.js';
import { creditRecord, seasonalIncome } from './CreditAssessment.js';
import { lenderAccount, loanById, clearLien, restructure } from './LoanManager.js';

// When borrowers cannot pay. A bank first offers to restructure a loan once,
// if the borrower still has an income. After that a loan in default goes to
// court under the Debt Recovery Act: the judge orders what the borrower can
// pay now, a forced sale of pledged land (the bank is paid from the proceeds,
// any surplus goes to the borrower), or, when nothing is left, bankruptcy:
// the rest of the debt is written off, the bank takes the loss and the
// borrower's credit is ruined for a decade. Nothing is seized outside a
// judgment, and no loan is ever resolved twice.

function lossFor(state, loan, amount, why) {
  if (amount <= 0) return;
  const bank = bankById(state, loan.bankId);
  if (bank) bank.stats.writtenOff += amount;
  ensureFinance(state).stats.writtenOff += amount;
  loan.writtenOff = (loan.writtenOff ?? 0) + amount;
  loan.history.push({ day: state.day, text: `${amount} coins written off (${why}).` });
}

/** Daily: loans that have missed enough payments are restructured or declared in default. */
export function reviewDelinquencies(state) {
  for (const loan of ensureFinance(state).loans.filter((l) => l.status === 'DELINQUENT' && l.missed >= FINANCE.missedForDefault)) {
    const b = byId(state.citizens, loan.borrowerId);
    if (b && !loan.restructured && seasonalIncome(state, b) >= loan.payment * 0.8) { restructure(state, loan); continue; }
    declareDefault(state, loan);
  }
}

export function declareDefault(state, loan) {
  if (loan.status === 'DEFAULTED' || loan.status === 'COLLECTING' || loan.status === 'WRITTEN_OFF') return null;
  loan.status = 'DEFAULTED';
  loan.defaultDay = state.day;
  const f = ensureFinance(state);
  f.stats.defaults++;
  const b = byId(state.citizens, loan.borrowerId);
  const bank = bankById(state, loan.bankId);
  if (b) {
    creditRecord(state, b.id).defaults++;
    bump(b, 'reliability', -12);
    b.mood = Math.max(0, b.mood - 10);
    remember(state, b, `Defaulted on my loan from ${bank?.name ?? 'the council'}.`, 3, 'grievance');
  }
  loan.history.push({ day: state.day, text: `In default after ${loan.missed} missed payments; ${loan.balance} coins outstanding.` });
  record(state, 'economy', `${b ? `${b.firstName} ${b.lastName}` : loan.borrowerName} defaulted on a loan from ${bank?.name ?? 'the council'}, owing ${loan.balance} coins.`, { citizens: b ? [b.id] : [] }, 2);
  if (!b) { lossFor(state, loan, loan.balance, 'the borrower is gone'); loan.balance = 0; loan.status = 'WRITTEN_OFF'; return loan; }
  fileClaim(state, {
    kind: 'debt', law: lawInForce(state, 'debts') ? 'debts' : 'contracts', claimantId: loan.bankId === 'council' ? 'council' : loan.bankId, defendantId: b.id, amount: loan.balance, loanId: loan.id,
    evidence: [
      { type: 'loan', text: `Loan ${loan.id}: ${loan.principal} coins lent on day ${loan.issuedDay} at ${Math.round(loan.rate * 1000) / 10}% a year, ${loan.payment} due each season.` },
      { type: 'ledger', text: `${loan.paid} coins repaid; ${loan.missed} payments missed; ${loan.balance} outstanding on day ${state.day}.` },
      ...(loan.collateralPlotId ? [{ type: 'registry', text: `Secured on ${state.plots.find((p) => p.id === loan.collateralPlotId)?.name ?? loan.collateralPlotId}.` }] : []),
    ],
  });
  return loan;
}

/** The court's judgment on a debt claim. Called once, by Courts.hearCase. */
judgmentHandlers.debt = (state, c, j, pay) => {
  const loan = loanById(state, c.details.loanId);
  if (!loan || loan.status !== 'DEFAULTED') { j.reason = 'the debt has already been settled'; return; }
  const D = c.defendant;
  const borrower = byId(state.citizens, D.id);
  const lender = lenderAccount(loan);
  raiseCash(state, borrower.id, loan.balance);
  // The borrower's own businesses answer for debts taken out for them.
  const owned = state.businesses.filter((b) => b.ownerId === borrower.id && isTrading(b));
  let recovered = pay(state, { kind: 'citizen', id: borrower.id }, lender, loan.balance, 'repayment', `Court-ordered repayment of ${loan.id}`, j);
  if (recovered < loan.balance && ['premises', 'expansion', 'equipment'].includes(loan.purpose)) {
    for (const b of owned) recovered += pay(state, { kind: 'citizen', id: b.id }, lender, loan.balance - recovered, 'repayment', `${b.name}'s funds toward ${loan.id}`, j);
  }
  loan.balance -= recovered;
  loan.paid += recovered;
  if (loan.balance <= 0) {
    loan.balance = 0; loan.status = 'PAID'; loan.closedDay = state.day; clearLien(state, loan);
    j.outcome = 'debt repaid';
    j.reason = `the loan records show ${c.amount} coins owed; the borrower was ordered to pay and did so in full`;
    return;
  }
  const plot = loan.collateralPlotId ? state.plots.find((p) => p.id === loan.collateralPlotId && p.ownerId === borrower.id && !p.projectId) : null;
  if (plot) {
    loan.status = 'COLLECTING';
    plot.lien = loan.id;
    plot.forcedSale = { loanId: loan.id, caseId: c.id, day: state.day };
    listForSale(state, plot.id, plotValue(plot));
    plotHistory(state, plot, `Ordered sold by the court to repay ${loan.id} (case ${c.id}).`);
    j.outcome = 'forced sale';
    j.reason = `${recovered} coins recovered; ${loan.balance} still owed, so ${plot.name}, pledged as security, is to be sold and the bank paid from the proceeds`;
    remember(state, borrower, `The court ordered ${plot.name} sold to pay my debts.`, 3, 'grievance');
    return;
  }
  // Nothing left to take: bankruptcy.
  const remaining = loan.balance;
  lossFor(state, loan, remaining, 'bankruptcy');
  loan.balance = 0;
  loan.status = 'WRITTEN_OFF';
  loan.closedDay = state.day;
  const rec = creditRecord(state, borrower.id);
  rec.bankruptDay = state.day;
  bump(borrower, 'reliability', -15);
  bump(borrower, 'standing', -8);
  let closed = '';
  for (const b of owned) if (b.status === 'STRUGGLING' && balance(state, b.id) < 5) { closeBusiness(state, b, 'BANKRUPT', 'debts'); closed = `; ${b.name} closed`; }
  j.outcome = 'bankruptcy';
  j.reason = `${recovered} coins recovered and nothing else to take; ${borrower.firstName} was declared bankrupt and ${remaining} coins written off${closed}`;
  remember(state, borrower, 'Was declared bankrupt.', 3, 'grievance');
};

/** A forced (or voluntary) sale of land under a lien pays the lender first. */
saleHooks.push((state, plot, sellerId, price) => {
  if (!plot.lien) return;
  const loan = loanById(state, plot.lien);
  delete plot.lien;
  const forced = plot.forcedSale;
  delete plot.forcedSale;
  if (!loan || loan.balance <= 0 || !['ACTIVE', 'DELINQUENT', 'COLLECTING'].includes(loan.status)) return;
  const owed = loan.balance;
  const n = Math.min(owed, price, balance(state, sellerId === 'council' ? 'treasury' : sellerId));
  if (n > 0 && transfer(state, sellerId === 'council' ? 'treasury' : sellerId, lenderAccount(loan), n, 'repayment', `Proceeds of ${plot.name} toward ${loan.id}`)) { loan.balance -= n; loan.paid += n; }
  // Whoever lived there must find another home.
  if (forced) for (const id of [...plot.residents]) { const r = byId(state.citizens, id); if (r) r.homePlotId = null; }
  if (forced) plot.residents = [];
  if (loan.balance > 0 && loan.status === 'COLLECTING') {
    lossFor(state, loan, loan.balance, 'the sale did not cover the debt');
    loan.balance = 0;
    loan.status = 'WRITTEN_OFF';
  } else if (loan.balance <= 0) loan.status = 'PAID';
  if (loan.balance <= 0) { loan.balance = 0; loan.closedDay = state.day; clearLien(state, loan); }
  loan.history.push({ day: state.day, text: `${plot.name} sold for ${price}; ${n} paid to the lender.` });
  record(state, 'economy', `${plot.name} was sold for ${price} coins${forced ? ' by court order' : ''}; ${n} went to repay ${loan.borrowerName}'s loan.`, { plot: plot.id }, 2);
});

/** Make sure the Debt Recovery Act is on the books once credit exists. */
export function ensureDebtLaw(state) {
  const law = ensureLaw(state);
  if (law.laws.some((l) => l.key === 'debts')) return;
  law.laws.push({ id: 'law-debts', key: 'debts', name: 'Debt Recovery Act', status: 'ACTIVE', enactedDay: state.day, effectiveDay: state.day, proposedBy: 'the council, when the first bank opened' });
  record(state, 'law', 'With a bank now lending in the village, the council adopted the Debt Recovery Act: unpaid loans are recovered through the court, pledged land may be sold, and the destitute may be declared bankrupt.', {}, 2);
}
