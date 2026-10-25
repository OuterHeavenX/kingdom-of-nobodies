import { balance, transfer } from '../economy/Transactions.js';

// Deposit accounts. A deposit is cash handed to a bank: the coins move from
// the holder's account to the bank's (its reserves), and the bank records a
// liability to the holder. Nothing is created: the holder's claim is on the
// bank, and they can only take back what the bank actually holds in cash.
// Every movement is kept in a short per-account statement.

export function ensureFinance(state) {
  if (state.finance) return state.finance;
  state.finance = { banks: [], loans: [], credit: {}, nextId: { bank: 0, loan: 0 }, stats: { deposits: 0, withdrawals: 0, issued: 0, repaid: 0, interest: 0, defaults: 0, writtenOff: 0, failures: 0 }, history: [] };
  return state.finance;
}

export const bankById = (state, id) => ensureFinance(state).banks.find((b) => b.id === id) ?? null;
export const openBanks = (state) => ensureFinance(state).banks.filter((b) => b.status !== 'FAILED');

/** What a holder has on deposit at one bank, or across all banks. */
export function depositOf(state, holderId, bankId = null) {
  let n = 0;
  for (const b of ensureFinance(state).banks) if ((!bankId || b.id === bankId) && b.status !== 'FAILED') n += b.deposits[holderId] ?? 0;
  return n;
}

function statement(bank, holderId, entry) {
  const list = bank.statements[holderId] ?? (bank.statements[holderId] = []);
  list.push(entry);
  if (list.length > 12) list.shift();
}

export function deposit(state, bank, holderId, amount, memo = 'Deposit') {
  if (!bank || bank.status === 'FAILED' || !Number.isInteger(amount) || amount <= 0) return false;
  if (!transfer(state, holderId, bank.id, amount, 'deposit', `${memo} at ${bank.name}`)) return false;
  bank.deposits[holderId] = (bank.deposits[holderId] ?? 0) + amount;
  statement(bank, holderId, { day: state.day, kind: 'deposit', amount, balance: bank.deposits[holderId] });
  ensureFinance(state).stats.deposits += amount;
  return true;
}

/**
 * Withdraw up to `amount`. A bank can only pay out the cash it holds; a
 * shortfall is reported so the bank's liquidity trouble is visible.
 * Returns the amount actually paid.
 */
export function withdraw(state, bank, holderId, amount, memo = 'Withdrawal') {
  if (!bank || bank.status === 'FAILED') return 0;
  const owed = bank.deposits[holderId] ?? 0;
  const want = Math.min(amount, owed);
  const paid = Math.min(want, balance(state, bank.id));
  if (paid < want) bank.shortfalls = (bank.shortfalls ?? 0) + 1;
  if (paid <= 0 || !transfer(state, bank.id, holderId, paid, 'withdrawal', `${memo} from ${bank.name}`)) return 0;
  bank.deposits[holderId] = owed - paid;
  if (!bank.deposits[holderId]) delete bank.deposits[holderId];
  statement(bank, holderId, { day: state.day, kind: 'withdrawal', amount: paid, balance: bank.deposits[holderId] ?? 0 });
  ensureFinance(state).stats.withdrawals += paid;
  return paid;
}

/** Withdraw across banks until the holder has `needed` coins in hand. Returns what was withdrawn. */
export function raiseCash(state, holderId, needed) {
  let got = 0;
  for (const bank of openBanks(state)) {
    const short = needed - balance(state, holderId);
    if (short <= 0) break;
    got += withdraw(state, bank, holderId, short);
  }
  return got;
}

/** Cash in hand plus everything on deposit. */
export const spendable = (state, id) => balance(state, id) + depositOf(state, id);

/** Move a holder's deposit claim to someone else (inheritance), without moving cash. */
export function reassignDeposits(state, fromId, toId) {
  for (const b of openBanks(state)) {
    const n = b.deposits[fromId];
    if (!n) continue;
    delete b.deposits[fromId];
    if (toId) b.deposits[toId] = (b.deposits[toId] ?? 0) + n;
    else b.unclaimed = (b.unclaimed ?? 0) + n; // no heir: the claim lapses and the bank's equity absorbs it
    statement(b, toId ?? fromId, { day: state.day, kind: 'inherited', amount: n, balance: toId ? b.deposits[toId] : 0 });
  }
}
