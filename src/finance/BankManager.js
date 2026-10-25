import { FINANCE, LIFE, DAYS_PER_YEAR, ECONOMY } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { isTrading, BUSINESS_TYPES } from '../economy/Businesses.js';
import { recentProfit } from '../economy/EconomyManager.js';
import { cashReserve } from '../economy/Marketplace.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { yearOf, isNewSeason } from '../core/Calendar.js';
import { plotsForSale, plotHistory } from '../property/LandRegistry.js';
import { buyPlot } from '../property/Ownership.js';
import { startProject, completionHooks } from '../property/Construction.js';
import { heirsOf } from '../economy/Inheritance.js';
import { lifecycleHooks } from '../citizens/Lifecycle.js';
import { ensureFinance, deposit, withdraw, depositOf, raiseCash, reassignDeposits, openBanks, bankById, spendable } from './BankAccounts.js';
import { applyForLoan, collectPayment, liveLoans, loansOf, lenderAccount, isLive, setLien, clearLien } from './LoanManager.js';
import { seasonalInterest, depositRateFor } from './InterestSystem.js';
import { reviewDelinquencies, ensureDebtLaw } from './DebtCollection.js';
import { outstandingDebt } from './CreditAssessment.js';

// The village's financial institutions and the daily round of personal
// finance. Banks are founded by citizens with capital, by the council (a
// savings house) or by guilds (credit for their members). Each keeps a real
// balance sheet: cash in its ledger account, a book of loans, deposits owed
// to its customers, and the owners' equity that is what is left over.

export const BANK_KINDS = {
  moneylender: { label: 'Moneylender', deposits: false },
  merchant_bank: { label: 'Merchant bank', deposits: true },
  savings_house: { label: 'Savings house', deposits: true },
  guild_credit: { label: 'Guild credit fund', deposits: true },
};

const ownerAccountOf = (id) => (id === 'council' ? 'treasury' : id);
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/** Assets, liabilities and equity, all in coins. */
export function balanceSheet(state, bank) {
  const cash = balance(state, bank.id);
  const loans = ensureFinance(state).loans.filter((l) => l.bankId === bank.id && (isLive(l) || l.status === 'DEFAULTED' || l.status === 'COLLECTING')).reduce((s, l) => s + l.balance, 0);
  const deposits = sum(bank.deposits);
  return { cash, loans, assets: cash + loans, deposits, liabilities: deposits, equity: cash + loans - deposits, reserveRatio: deposits ? Math.round((cash / deposits) * 100) / 100 : 1 };
}

export function createBank(state, { kind, ownerId, name, capital, members = null }) {
  const f = ensureFinance(state);
  const id = 'bnk' + ++f.nextId.bank;
  state.accounts[id] = 0;
  const bank = {
    id, kind, name, ownerId, foundedDay: state.day, status: 'OPEN', capital: 0, plotId: null,
    deposits: {}, statements: {}, members, rates: { deposit: depositRateFor(kind) },
    stats: { issued: 0, repaid: 0, interestPaid: 0, writtenOff: 0, dividends: 0 }, history: [],
  };
  f.banks.push(bank);
  if (!transfer(state, ownerAccountOf(ownerId), id, capital, 'capital', `Founding capital of ${name}`)) { f.banks.pop(); delete state.accounts[id]; f.nextId.bank--; return null; }
  bank.capital = capital;
  ensureDebtLaw(state);
  bank.history.push({ day: state.day, text: `Founded with ${capital} coins of capital.` });
  return bank;
}

/** Seasonal: new banks open where there is savings to gather and borrowers to serve. */
function considerFounding(state) {
  const f = ensureFinance(state);
  const open = openBanks(state);
  if (state.citizens.length < 22) return null;
  // The council's savings house, once the treasury is comfortable.
  if (!open.some((b) => b.kind === 'savings_house') && balance(state, 'treasury') > 320 && state.citizens.length >= 30) {
    const bank = createBank(state, { kind: 'savings_house', ownerId: 'council', name: 'First Hearth Savings House', capital: FINANCE.savingsHouseCapital });
    if (bank) record(state, 'economy', `The council opened ${bank.name} with ${bank.capital} coins from the treasury, to keep villagers' savings safe and lend to those who will build (Year ${yearOf(state.day)}).`, {}, 3);
    return bank;
  }
  if (open.filter((b) => b.kind === 'moneylender' || b.kind === 'merchant_bank').length >= 2) return null;
  // A citizen with capital and a head for money sets up as a banker.
  const founder = state.citizens
    .filter((c) => ageOf(state, c) >= 25 && !c.away && !c.retired && balance(state, c.id) >= 260 && !open.some((b) => b.ownerId === c.id))
    .map((c) => ({ c, s: trait(c, 'frugal') + trait(c, 'ambitious') + trait(c, 'greedy') * 0.5 + (c.profession === 'Merchant' ? 0.8 : 0) + c.reputation.honesty / 100 + balance(state, c.id) / 1000 }))
    .filter((x) => x.s > 1).sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id))[0]?.c;
  if (!founder) return null;
  const merchant = founder.profession === 'Merchant' || balance(state, founder.id) > 350 || open.some((b) => b.kind === 'moneylender');
  const kind = merchant ? 'merchant_bank' : 'moneylender';
  const capital = Math.min(320, Math.max(FINANCE.bankFoundingCapital, Math.floor(balance(state, founder.id) * 0.3)));
  const name = merchant ? `${founder.lastName} & Company` : `${founder.firstName} ${founder.lastName}, Moneylender`;
  const bank = createBank(state, { kind, ownerId: founder.id, name, capital });
  if (!bank) return null;
  remember(state, founder, `Founded ${bank.name} with ${capital} coins.`, 3, 'milestone');
  record(state, 'economy', `${founder.firstName} ${founder.lastName} founded ${bank.name} with ${capital} coins of their own${BANK_KINDS[kind].deposits ? ', taking deposits and making loans' : ', lending at interest'}.`, { citizens: [founder.id] }, 3);
  f.history.push({ day: state.day, text: `${bank.name} opened.` });
  return bank;
}

/** A bank with room in its books builds a counting house on commercial land. */
function considerPremises(state, bank) {
  if (bank.plotId || bank.status !== 'OPEN' || state.projects.some((p) => p.ownerId === bank.id)) return;
  const sheet = balanceSheet(state, bank);
  const plot = plotsForSale(state, 'bank', bank.id).find((p) => !p.building);
  if (!plot) return;
  const budget = plot.price + 90;
  if (sheet.cash - budget < sheet.deposits * FINANCE.reserveRatio + 40 || sheet.equity < budget + 40) return;
  if (!buyPlot(state, plot.id, bank.id).ok) return;
  const res = startProject(state, { plotId: plot.id, ownerId: bank.id, kind: 'construction', buildingType: 'bank', purpose: 'bank' });
  if (res.ok) { bank.plotId = plot.id; bank.history.push({ day: state.day, text: `Began a counting house on ${plot.name}.` }); }
}

completionHooks.bank = (state, plot, project) => {
  const bank = bankById(state, project.ownerId);
  if (!bank) return;
  plot.building.name = bank.name;
  bank.plotId = plot.id;
  plotHistory(state, plot, `${bank.name} opened its counting house.`);
  record(state, 'construction', `${bank.name} opened its counting house on ${plot.name}.`, { plot: plot.id }, 2);
};

/** Seasonal: a healthy bank pays its owners a share of profit above its capital. */
function dividends(state, bank) {
  const sheet = balanceSheet(state, bank);
  const surplus = sheet.equity - bank.capital * 1.3;
  const spare = sheet.cash - sheet.deposits * FINANCE.reserveRatio - 40;
  const n = Math.floor(Math.min(surplus * 0.25, spare));
  if (n <= 0 || bank.status !== 'OPEN') return;
  const to = ownerAccountOf(bank.ownerId);
  if (!(to in state.accounts)) return;
  if (transfer(state, bank.id, to, n, 'dividend', `Profits of ${bank.name}`)) bank.stats.dividends += n;
}

/**
 * Seasonal health check. A bank whose equity is gone, or that cannot meet
 * withdrawals for two seasons running, fails. Failure is controlled: a
 * healthy bank (the savings house first) takes over its deposits and loans as
 * far as the failed bank's assets cover them; depositors lose only the gap.
 * Without a rescuer, depositors are paid out pro rata and the council
 * collects the remaining loans.
 */
function checkHealth(state, bank) {
  if (bank.status === 'FAILED') return;
  const sheet = balanceSheet(state, bank);
  const illiquid = (bank.shortfalls ?? 0) > 0;
  bank.shortfalls = 0;
  if (sheet.equity < 0 || (illiquid && bank.status === 'TROUBLED')) return failBank(state, bank, sheet.equity < 0 ? 'its losses exceeded its capital' : 'it could not pay depositors two seasons running');
  if (illiquid || sheet.equity < bank.capital * 0.25) {
    if (bank.status !== 'TROUBLED') record(state, 'economy', `${bank.name} is in trouble: ${illiquid ? 'it could not pay out every withdrawal' : 'losses have eaten most of its capital'}.`, {}, 2);
    bank.status = 'TROUBLED';
  } else if (bank.status === 'TROUBLED') { bank.status = 'OPEN'; record(state, 'economy', `${bank.name} has recovered its footing.`, {}, 1); }
}

export function failBank(state, bank, why) {
  const f = ensureFinance(state);
  const sheet = balanceSheet(state, bank);
  const rescuer = openBanks(state).filter((b) => b !== bank && b.status === 'OPEN' && b.kind !== 'moneylender').sort((a, b) => (b.kind === 'savings_house') - (a.kind === 'savings_house') || balanceSheet(state, b).equity - balanceSheet(state, a).equity)[0];
  const recovery = sheet.deposits ? Math.min(1, sheet.assets / sheet.deposits) : 1;
  const holders = Object.entries(bank.deposits);
  const loans = f.loans.filter((l) => l.bankId === bank.id && (isLive(l) || l.status === 'DEFAULTED' || l.status === 'COLLECTING'));
  let lost = 0;
  if (rescuer) {
    // Purchase and assumption: cash and loans move to the rescuer, which honours deposits up to what they cover.
    const cash = balance(state, bank.id);
    if (cash > 0) transfer(state, bank.id, rescuer.id, cash, 'capital', `${rescuer.name} took over ${bank.name}`);
    for (const l of loans) { l.bankId = rescuer.id; l.history.push({ day: state.day, text: `Taken over by ${rescuer.name} when ${bank.name} failed.` }); }
    for (const [h, n] of holders) {
      const kept = Math.floor(n * recovery);
      lost += n - kept;
      if (kept > 0) rescuer.deposits[h] = (rescuer.deposits[h] ?? 0) + kept;
    }
  } else {
    // Liquidation: depositors share the cash; the council collects the loans and pays out what they bring in later is not promised.
    const cash = balance(state, bank.id);
    const total = sum(bank.deposits);
    for (const [h, n] of holders) {
      const share = total ? Math.floor(cash * (n / total)) : 0;
      const paid = Math.min(share, balance(state, bank.id));
      if (paid > 0 && h in state.accounts) transfer(state, bank.id, h, paid, 'withdrawal', `Payout from failed ${bank.name}`);
      lost += n - paid;
    }
    for (const l of loans) { l.bankId = 'council'; l.history.push({ day: state.day, text: `Collected by the council after ${bank.name} failed.` }); }
    const left = balance(state, bank.id);
    if (left > 0) transfer(state, bank.id, 'treasury', left, 'capital', `Residue of ${bank.name}`);
  }
  bank.deposits = {};
  bank.status = 'FAILED';
  bank.failedDay = state.day;
  bank.failure = { why, recovery: Math.round(recovery * 100), lost, rescuer: rescuer?.name ?? null };
  f.stats.failures++;
  for (const [h] of holders) { const c = byId(state.citizens, h); if (c) { c.mood = Math.max(0, c.mood - 12); remember(state, c, `Lost savings when ${bank.name} failed.`, 3, 'grievance'); } }
  if (bank.plotId) { const p = state.plots.find((x) => x.id === bank.plotId); if (p && rescuer) { p.ownerId = rescuer.id; } else if (p) { p.ownerId = 'council'; p.marketStatus = 'FOR_SALE'; } }
  record(state, 'economy', `${bank.name} failed: ${why}. ${rescuer ? `${rescuer.name} took over its accounts` : 'Its cash was shared among depositors'}, who recovered ${Math.round(recovery * 100)}% of their savings (${lost} coins lost).`, {}, 3);
  f.history.push({ day: state.day, text: `${bank.name} failed (${why}).` });
}

// --- Personal finance ---------------------------------------------------------------

/** Which open bank a holder trusts with savings: the savings house, or a banker they think honest. */
function preferredBank(state, c) {
  const open = openBanks(state).filter((b) => b.status === 'OPEN' && BANK_KINDS[b.kind].deposits && (b.kind !== 'guild_credit' || b.members?.includes(c.id)));
  return open.sort((a, b) => (b.kind === 'savings_house') - (a.kind === 'savings_house') || b.rates.deposit - a.rates.deposit || a.id.localeCompare(b.id))[0] ?? null;
}

/** Savers deposit what they do not need; anyone short of cash draws on their savings. */
function personalBanking(state) {
  for (const c of state.citizens) {
    if (ageOf(state, c) < LIFE.adultAge || c.away) continue;
    const cash = balance(state, c.id);
    const saved = depositOf(state, c.id);
    const building = state.projects.some((p) => p.ownerId === c.id);
    if ((cash < 18 || (building && cash < 40)) && saved > 0) { raiseCash(state, c.id, building ? 45 : 30); continue; }
    const threshold = FINANCE.depositAbove - trait(c, 'frugal') * 30 + trait(c, 'riskTaking') * 25;
    const freshLoan = loansOf(state, c.id).some((l) => state.day - l.issuedDay < 12);
    if (cash > threshold && !building && !freshLoan) {
      const bank = preferredBank(state, c);
      if (bank) deposit(state, bank, c.id, cash - FINANCE.cashCushion);
    }
  }
  // Businesses keep their cash in the till: they hire, restock and pay wages from it,
  // and pay surplus out to their owners as dividends, who may bank it.
  for (const b of state.businesses) if (depositOf(state, b.id) > 0) raiseCash(state, b.id, balance(state, b.id) + depositOf(state, b.id));
}

/**
 * Who asks for credit, and why. Applications come from real plans: a would-be
 * shopkeeper short of the price of premises, a family saving for a home, an
 * owner of a profitable business that wants to expand.
 */
function loanApplications(state) {
  if (!openBanks(state).some((b) => b.status === 'OPEN')) return;
  for (const c of state.citizens) {
    if (ageOf(state, c) < LIFE.adultAge || c.away || c.retired) continue;
    if (c.lastLoanApplication && state.day - c.lastLoanApplication.day < 9) continue;
    if (loansOf(state, c.id).length >= FINANCE.maxLoansPerBorrower) continue;
    const appetite = trait(c, 'ambitious') + trait(c, 'riskTaking') - trait(c, 'frugal') * 0.5;
    // 1. Expanding a profitable business.
    const b = state.businesses.find((x) => x.ownerId === c.id && x.status === 'OPEN' && !BUSINESS_TYPES[x.type].civic && (x.level ?? 1) < 3);
    const plot = b && state.plots.find((p) => p.id === b.plotId);
    if (b && plot && !plot.projectId && b.history.length >= 6 && recentProfit(b, 6) > 10) {
      const need = 70 + (b.level ?? 1) * 30 - balance(state, c.id) + 10;
      if (need > 10 && need < 220 && appetite > 0.2) {
        const res = applyForLoan(state, c, need, { purpose: 'expansion', seasons: 12, collateralPlotId: plot.ownerId === c.id && !plot.lien ? plot.id : null });
        if (res.ok) { c.expansionLoan = res.loan.id; continue; }
      }
    }
    // 2. Premises for a new business, or a first home.
    const need = c.plan?.need ?? 0;
    const dream = c.dream?.type;
    const saving = (dream === 'business' && c.venture && !c.venture.businessId && !c.venture.plotId) || (/home|cottage/i.test(c.plan?.goal ?? '') && !(c.homeVenture?.plotId));
    if (saving && need > 8 && c.employment && need <= Math.max(40, spendable(state, c.id) * 1.5) && appetite > -0.2) {
      const owned = state.plots.find((p) => p.ownerId === c.id && !p.lien);
      const res = applyForLoan(state, c, need + 4, { purpose: dream === 'business' ? 'premises' : 'home', seasons: dream === 'business' ? 8 : 12, collateralPlotId: owned?.id ?? null });
      if (res.ok) c.pendingCollateral = res.loan.id; // pledged on the land it buys
    }
  }
}

/** When a borrower buys land with a loan that has no security yet, the land secures it. */
export function pledgeNewLand(state, plot, buyerId) {
  const c = byId(state.citizens, buyerId);
  const loan = c?.pendingCollateral ? ensureFinance(state).loans.find((l) => l.id === c.pendingCollateral) : null;
  if (!loan || !isLive(loan) || loan.collateralPlotId) { if (c) delete c.pendingCollateral; return; }
  loan.collateralPlotId = plot.id;
  setLien(state, plot.id, loan.id);
  loan.history.push({ day: state.day, text: `Secured on ${plot.name}, bought with the loan.` });
  delete c.pendingCollateral;
}

/** A developer short of capital may borrow against the land they mean to build on. */
export function borrowForDevelopment(state, c, amount, plot) {
  const res = applyForLoan(state, c, amount + 5, { purpose: 'development', seasons: 6 });
  if (res.ok) c.pendingCollateral = res.loan.id;
  return res.ok;
}

/** A death: savings are drawn so the estate can settle debts, and what is still owed passes to the heir. */
function onDeath(state, c) {
  const f = ensureFinance(state);
  raiseCash(state, c.id, depositOf(state, c.id) + balance(state, c.id));
  const { spouse, children } = heirsOf(state, c);
  const heir = spouse ?? children.find((h) => ageOf(state, h) >= LIFE.adultAge) ?? null;
  for (const loan of f.loans.filter((l) => l.borrowerId === c.id && (isLive(l) || l.status === 'DEFAULTED'))) {
    const n = Math.min(loan.balance, balance(state, c.id));
    if (n > 0 && transfer(state, c.id, lenderAccount(loan), n, 'repayment', `${c.firstName}'s estate repaying ${loan.id}`)) { loan.balance -= n; loan.paid += n; }
    if (loan.balance <= 0) { loan.balance = 0; loan.status = 'PAID'; loan.closedDay = state.day; clearLien(state, loan); loan.history.push({ day: state.day, text: 'Repaid from the estate.' }); continue; }
    if (heir) {
      loan.borrowerId = heir.id;
      loan.borrowerName = `${heir.firstName} ${heir.lastName}`;
      if (loan.status === 'DEFAULTED') loan.status = 'DELINQUENT';
      loan.history.push({ day: state.day, text: `${heir.firstName} took on the debt with the estate.` });
      remember(state, heir, `Inherited ${c.firstName}'s debt of ${loan.balance} coins.`, 2, 'loss');
    } else {
      const bank = bankById(state, loan.bankId);
      if (bank) bank.stats.writtenOff += loan.balance;
      f.stats.writtenOff += loan.balance;
      loan.history.push({ day: state.day, text: `${loan.balance} written off: the borrower died with no heir.` });
      loan.writtenOff = (loan.writtenOff ?? 0) + loan.balance;
      loan.balance = 0; loan.status = 'WRITTEN_OFF'; loan.closedDay = state.day; clearLien(state, loan);
    }
  }
  // Any savings the bank could not pay out remain a claim the heir inherits.
  reassignDeposits(state, c.id, heir?.id ?? null);
}
lifecycleHooks.death.push(onDeath);

/** Leaving the village: savings are withdrawn and debts settled from what the household takes away. */
export function settleBeforeLeaving(state, c) {
  const f = ensureFinance(state);
  raiseCash(state, c.id, depositOf(state, c.id) + balance(state, c.id));
  for (const loan of f.loans.filter((l) => l.borrowerId === c.id && (isLive(l) || l.status === 'DEFAULTED'))) {
    const n = Math.min(loan.balance, balance(state, c.id));
    if (n > 0 && transfer(state, c.id, lenderAccount(loan), n, 'repayment', `${c.firstName} settling ${loan.id} before leaving`)) { loan.balance -= n; loan.paid += n; }
    if (loan.balance > 0) {
      const bank = bankById(state, loan.bankId);
      if (bank) bank.stats.writtenOff += loan.balance;
      f.stats.writtenOff += loan.balance;
      loan.writtenOff = (loan.writtenOff ?? 0) + loan.balance;
      loan.history.push({ day: state.day, text: `${loan.balance} written off: the borrower left the village.` });
      record(state, 'economy', `${c.firstName} ${c.lastName} left the village owing ${loan.balance} coins to ${bank?.name ?? 'the council'}.`, { citizens: [c.id] }, 2);
    }
    loan.balance = 0; loan.status = loan.writtenOff ? 'WRITTEN_OFF' : 'PAID'; loan.closedDay = state.day; clearLien(state, loan);
  }
  reassignDeposits(state, c.id, null);
}

/** Daily: the whole round of finance. */
export function dailyFinance(state) {
  ensureFinance(state);
  seasonalInterest(state);
  for (const loan of liveLoans(state)) collectPayment(state, loan);
  reviewDelinquencies(state);
  personalBanking(state);
  if (state.day % 2 === 0) loanApplications(state);
  if (isNewSeason(state.day)) {
    considerFounding(state);
    for (const bank of openBanks(state)) { checkHealth(state, bank); if (bank.status !== 'FAILED') { dividends(state, bank); considerPremises(state, bank); } }
  }
  const f = state.finance;
  if (f.loans.length > 160) f.loans = f.loans.filter((l) => isLive(l) || l.status === 'DEFAULTED' || l.status === 'COLLECTING').concat(f.loans.filter((l) => !(isLive(l) || l.status === 'DEFAULTED' || l.status === 'COLLECTING')).slice(-60));
  for (const b of f.banks) for (const k of Object.keys(b.statements)) if (!(k in state.accounts)) delete b.statements[k];
  if (f.history.length > 40) f.history.splice(0, f.history.length - 40);
}

/** Banks pay the village tithe on their equity (what the bank owns outright), from cash they can spare. */
export function bankTithe(state, rate) {
  let total = 0;
  for (const bank of openBanks(state)) {
    const sheet = balanceSheet(state, bank);
    const spare = sheet.cash - Math.ceil(sheet.deposits * FINANCE.reserveRatio);
    const due = Math.min(spare, Math.floor((sheet.equity - ECONOMY.titheFloor) * rate));
    if (due > 0 && transfer(state, bank.id, 'treasury', due, 'tax', `${bank.name}'s tithe`)) total += due;
  }
  return total;
}

/** Totals for the panels and the stress test. */
export function financeSummary(state) {
  const f = ensureFinance(state);
  const banks = f.banks.map((b) => ({ id: b.id, name: b.name, status: b.status, ...balanceSheet(state, b) }));
  const live = liveLoans(state);
  return {
    banks, loans: live.length, outstanding: live.reduce((s, l) => s + l.balance, 0),
    deposits: banks.reduce((s, b) => s + b.deposits, 0), ...f.stats,
    delinquent: live.filter((l) => l.status === 'DELINQUENT').length,
  };
}

export { outstandingDebt, ECONOMY, DAYS_PER_YEAR };
