import { LEDGER } from '../core/Config.js';

// All money lives in `state.accounts` as integer coins. Accounts are keyed by
// entity id: 'treasury', 'outside' (traders beyond the valley), citizen ids
// ('c1') and business ids ('b1'). Money only ever moves through transfer(),
// so the total supply is conserved exactly.

export const KINDS = ['wage', 'purchase', 'sale', 'wholesale', 'tax', 'property', 'expense',
  'construction', 'gift', 'aid', 'dividend', 'capital', 'import', 'export', 'liquidation', 'grant', 'immigration'];

export function balance(state, account) {
  return state.accounts[account] ?? 0;
}

export function openAccount(state, account, amount = 0) {
  if (!(account in state.accounts)) state.accounts[account] = 0;
  if (amount) state.accounts[account] += amount;
}

/**
 * Move `amount` coins from one account to another.
 * Returns false (and changes nothing) when the payer cannot afford it.
 */
export function transfer(state, from, to, amount, kind, memo = '') {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  if (from === to) return false;
  if (!(from in state.accounts) || !(to in state.accounts)) return false;
  if (state.accounts[from] < amount) return false;
  state.accounts[from] -= amount;
  state.accounts[to] += amount;
  const tx = { id: ++state.nextId.tx, day: state.day, minute: state.minute, from, to, amount, kind, memo };
  state.ledger.push(tx);
  if (state.ledger.length > LEDGER.max) state.ledger.splice(0, state.ledger.length - LEDGER.max);
  state.ledgerTotals[kind] = (state.ledgerTotals[kind] ?? 0) + amount;
  return true;
}

export function totalMoney(state) {
  return Object.values(state.accounts).reduce((sum, v) => sum + v, 0);
}
