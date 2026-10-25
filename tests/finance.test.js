// Milestone 5 — banking, credit and loans (Phase C).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { deserialize, serialize } from '../src/core/Serialization.js';
import { totalMoney, transfer, balance } from '../src/economy/Transactions.js';
import { isTrading } from '../src/economy/Businesses.js';
import { ensureFinance, deposit, withdraw, depositOf } from '../src/finance/BankAccounts.js';
import { createBank, balanceSheet, failBank, financeSummary } from '../src/finance/BankManager.js';
import { applyForLoan, collectPayment, loansOf } from '../src/finance/LoanManager.js';
import { assessCredit, creditRecord } from '../src/finance/CreditAssessment.js';
import { seasonalInterest } from '../src/finance/InterestSystem.js';
import { declareDefault, reviewDelinquencies } from '../src/finance/DebtCollection.js';
import { hearCase } from '../src/law/Courts.js';
import { ageOf } from '../src/citizens/Citizen.js';

const fixture = () => deserialize(readFileSync(new URL('./fixtures/m4-save.json', import.meta.url), 'utf8'));
const adults = (s) => s.citizens.filter((c) => ageOf(s, c) >= 25 && ageOf(s, c) < 55 && !c.retired && !c.away);

function withBank(s, kind = 'merchant_bank', capital = 300) {
  const founder = adults(s)[0];
  transfer(s, 'outside', founder.id, capital + 10, 'grant', 'test capital');
  return { bank: createBank(s, { kind, ownerId: founder.id, name: 'Test Bank', capital }), founder };
}

/** A steady, profitable shopkeeper: the blacksmith of the acceptance scenario. */
function steadySmith(s) {
  const b = s.businesses.find((x) => x.type === 'blacksmith' && isTrading(x) && s.citizens.some((c) => c.id === x.ownerId)) ?? s.businesses.find((x) => isTrading(x) && x.ownerId !== 'council' && s.citizens.some((c) => c.id === x.ownerId));
  const owner = s.citizens.find((c) => c.id === b.ownerId);
  owner.employment.since = s.day - 30;
  owner.reputation.reliability = 70; owner.reputation.honesty = 65;
  b.status = 'OPEN'; b.level = 1;
  b.history = Array.from({ length: 8 }, (_, i) => ({ day: s.day - 8 + i, revenue: 20, expenses: 12, profit: 8, customers: 4, produced: 2, cash: 30 }));
  const extra = balance(s, owner.id) - 20;
  if (extra > 0) transfer(s, owner.id, 'outside', extra, 'expense', 'test: spent savings');
  return { b, owner };
}

test('deposits and withdrawals move real coins and keep the books balanced', () => {
  const s = fixture();
  const money = totalMoney(s);
  const { bank } = withBank(s);
  const saver = adults(s)[1];
  transfer(s, 'outside', saver.id, 200, 'grant', 'test');
  const before = balanceSheet(s, bank);
  assert.ok(deposit(s, bank, saver.id, 150));
  const after = balanceSheet(s, bank);
  assert.equal(after.cash - before.cash, 150);
  assert.equal(after.deposits - before.deposits, 150);
  assert.equal(after.equity, before.equity, 'a deposit does not change the bank\'s equity');
  assert.equal(depositOf(s, saver.id), 150);
  assert.equal(totalMoney(s), money, 'deposits create no money');
  assert.equal(withdraw(s, bank, saver.id, 500), 150, 'cannot withdraw more than was deposited');
  assert.equal(depositOf(s, saver.id), 0);
  // A bank short of cash pays only what it holds.
  deposit(s, bank, saver.id, 100);
  transfer(s, bank.id, 'outside', balance(s, bank.id) - 30, 'expense', 'test: the vault is robbed');
  assert.equal(withdraw(s, bank, saver.id, 100), 30);
  assert.equal(depositOf(s, saver.id), 70, 'the rest stays owed');
  assert.equal(after.assets, after.liabilities + after.equity);
  // The summary reports what is on deposit now, not every coin ever deposited.
  const sum = financeSummary(s);
  assert.equal(sum.deposits, balanceSheet(s, bank).deposits);
  assert.equal(sum.depositedEver, 250);
});

test('credit assessment weighs income, history and security — wealth alone is not enough', () => {
  const s = fixture();
  const { bank } = withBank(s, 'merchant_bank', 600);
  const { owner } = steadySmith(s);
  const ok = assessCredit(s, bank, owner, 60, { seasons: 8, collateralPlotId: s.plots.find((p) => p.ownerId === owner.id)?.id });
  assert.ok(ok.approved, `the steady smith is approved (${ok.score}: ${ok.reasons.join('; ')})`);
  const heir = adults(s).find((c) => c !== owner && !s.businesses.some((b) => b.ownerId === c.id));
  if (heir.employment) heir.employment = null;
  transfer(s, 'outside', heir.id, 2000, 'grant', 'test: a large inheritance');
  creditRecord(s, heir.id).defaults = 2;
  const no = assessCredit(s, bank, heir, 60, { seasons: 8 });
  assert.equal(no.approved, false, `a rich idler with two defaults is refused (${no.score})`);
  assert.ok(no.reasons.some((r) => /default/.test(r)));
  assert.ok(ok.rate < 0.25 && ok.rate >= 0.08);
});

test('acceptance: the blacksmith borrows to expand, the loan is accounted for and repaid over time', () => {
  const s = fixture();
  const sim = new Simulation(s);
  const { bank } = withBank(s, 'merchant_bank', 600);
  const { b, owner } = steadySmith(s);
  const money = totalMoney(s);
  const cashBefore = balanceSheet(s, bank).cash;
  const res = applyForLoan(s, owner, 90, { purpose: 'expansion', seasons: 12, collateralPlotId: s.plots.find((p) => p.id === b.plotId && p.ownerId === owner.id)?.id ?? null });
  assert.ok(res.ok, `approved: ${res.decision?.reasons.join('; ')}`);
  const loan = res.loan;
  assert.equal(balanceSheet(s, bank).cash, cashBefore - 90, 'the bank paid out the principal');
  assert.equal(balanceSheet(s, bank).loans, 90, 'and holds the loan as an asset');
  assert.equal(totalMoney(s), money);
  // The owner now has the means to expand; the business plans it.
  sim.runDays(2);
  const plot = s.plots.find((p) => p.id === b.plotId);
  assert.ok(plot.projectId || (b.level ?? 1) > 1 || balance(s, owner.id) < 90, 'the money went into the expansion');
  // Payments over time reduce the debt.
  const start = loan.balance;
  for (let i = 0; i < 4; i++) { transfer(s, 'outside', owner.id, loan.payment + 5, 'grant', 'test: steady trade'); s.day = loan.nextDueDay; collectPayment(s, loan); }
  assert.ok(loan.paid >= loan.payment * 3, 'payments were collected');
  assert.ok(loan.balance < start + loan.interest, 'the outstanding balance fell');
  assert.ok(creditRecord(s, owner.id).onTime >= 3);
});

test('interest accrues once per season, on whole coins, and never twice across save/load', () => {
  const s = fixture();
  const { bank } = withBank(s, 'merchant_bank', 600);
  const { owner } = steadySmith(s);
  const { loan } = applyForLoan(s, owner, 80, { purpose: 'equipment', seasons: 8 });
  assert.ok(loan);
  while ((s.day - 1) % 3 !== 0) s.day++;
  s.day += 3;
  seasonalInterest(s);
  const once = loan.balance;
  assert.equal(once, 80 + Math.max(1, Math.round(80 * loan.rate / 4)));
  seasonalInterest(s);
  assert.equal(loan.balance, once, 'calling again in the same season adds nothing');
  const back = deserialize(serialize(s));
  seasonalInterest(back);
  assert.equal(back.finance.loans.find((l) => l.id === loan.id).balance, once, 'nor does reloading');
  assert.ok(Number.isInteger(once));
  assert.equal(balanceSheet(back, back.finance.banks[0]).loans, once);
});

test('a default is restructured once, then recovered through the court exactly once', () => {
  const s = fixture();
  const { bank } = withBank(s, 'merchant_bank', 600);
  const { owner } = steadySmith(s);
  const pledge = s.plots.find((p) => p.ownerId === owner.id);
  const { loan } = applyForLoan(s, owner, 70, { purpose: 'premises', seasons: 8, collateralPlotId: pledge?.id ?? null });
  assert.ok(loan);
  // The borrower's money runs out.
  const drain = () => { const n = balance(s, owner.id); if (n > 0) transfer(s, owner.id, 'outside', n, 'expense', 'test: hard times'); for (const bk of s.finance.banks) delete bk.deposits[owner.id]; };
  for (let i = 0; i < 3; i++) { drain(); s.day = loan.nextDueDay; collectPayment(s, loan); }
  assert.equal(loan.status, 'DELINQUENT');
  assert.equal(loan.missed, 3);
  // Still earning: the bank restructures rather than calling in the debt.
  reviewDelinquencies(s);
  assert.equal(loan.restructured, 1, 'restructured once');
  assert.equal(loan.status, 'ACTIVE');
  owner.employment = null; // then the income goes too
  for (const biz of s.businesses.filter((x) => x.ownerId === owner.id)) biz.history = [];
  for (let i = 0; i < 3; i++) { drain(); s.day = loan.nextDueDay; collectPayment(s, loan); }
  reviewDelinquencies(s);
  assert.equal(loan.status, 'DEFAULTED');
  const claim = s.law.claims.find((c) => c.loanId === loan.id);
  assert.ok(claim, 'the bank filed a claim');
  const sim = new Simulation(s);
  sim.runDays(3);
  const kase = s.law.cases.find((c) => c.details.loanId === loan.id);
  assert.ok(kase, 'the court took the case');
  if (kase.status !== 'JUDGED') hearCase(s, kase);
  const j = kase.judgment;
  assert.ok(['forced sale', 'bankruptcy', 'debt repaid'].includes(j.outcome), j.reason);
  const transfers = j.transfers.length;
  hearCase(s, kase);
  assert.equal(kase.judgment.transfers.length, transfers, 'a judgment executes once');
  assert.ok(['COLLECTING', 'WRITTEN_OFF', 'PAID'].includes(loan.status));
  if (j.outcome === 'forced sale') assert.equal(s.plots.find((p) => p.id === pledge.id).marketStatus, 'FOR_SALE');
  if (j.outcome === 'bankruptcy') assert.ok(creditRecord(s, owner.id).bankruptDay);
  assert.equal(declareDefault(s, loan), null, 'a resolved loan cannot default twice');
});

test('a failed bank is resolved in a controlled way: a rescuer honours deposits as far as assets allow', () => {
  const s = fixture();
  const money = totalMoney(s);
  const { bank } = withBank(s, 'merchant_bank', 200);
  transfer(s, 'outside', 'treasury', 400, 'grant', 'test');
  const house = createBank(s, { kind: 'savings_house', ownerId: 'council', name: 'Test Savings House', capital: 300 });
  const savers = adults(s).slice(2, 6);
  for (const c of savers) { transfer(s, 'outside', c.id, 100, 'grant', 'test'); deposit(s, bank, c.id, 100); }
  // A great loss: most of the vault is gone.
  transfer(s, bank.id, 'outside', balance(s, bank.id) - 150, 'expense', 'test: a ruinous loss');
  const sheet = balanceSheet(s, bank);
  assert.ok(sheet.equity < 0);
  failBank(s, bank, 'test');
  assert.equal(bank.status, 'FAILED');
  assert.ok(bank.failure.recovery > 0 && bank.failure.recovery < 100);
  for (const c of savers) assert.ok(depositOf(s, c.id) > 0 && depositOf(s, c.id) < 100, 'savers keep part of their savings at the rescuer');
  assert.equal(balance(s, bank.id), 0);
  assert.ok(balanceSheet(s, house).equity >= 300 - 1, 'the rescuer is not ruined');
  assert.equal(totalMoney(s), money, 'no coins created or destroyed');
});

test('a running village founds banks, lends and keeps every bank balance sheet consistent', () => {
  const s = fixture();
  const sim = new Simulation(s);
  const money = totalMoney(s);
  transfer(s, 'outside', 'treasury', 300, 'grant', 'test');
  sim.runDays(12 * 6);
  const f = financeSummary(s);
  assert.ok(f.banks.length >= 1, 'a bank opened');
  for (const b of s.finance.banks) {
    const sh = balanceSheet(s, b);
    assert.equal(sh.assets, sh.liabilities + sh.equity);
    assert.equal(sh.cash, balance(s, b.id));
    for (const v of Object.values(b.deposits)) assert.ok(Number.isInteger(v) && v > 0);
  }
  for (const l of s.finance.loans) { assert.ok(Number.isInteger(l.balance) && l.balance >= 0); assert.ok(l.paid >= 0); }
  assert.equal(totalMoney(s), money);
  // Saving and reloading never repeats a loan or a payment.
  const back = deserialize(serialize(s));
  const a = new Simulation(s), b2 = new Simulation(back);
  a.runDays(6); b2.runDays(6);
  assert.equal(JSON.stringify(back.finance), JSON.stringify(s.finance), 'a reloaded world continues the same books');
  assert.equal(loansOf(s, 'nobody').length, 0);
  assert.equal(ensureFinance(s).loans.length, new Set(ensureFinance(s).loans.map((l) => l.id)).size);
});
