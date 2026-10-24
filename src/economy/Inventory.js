// Inventories are plain { good: quantity } objects with non-negative integers.

export const qty = (inv, good) => inv[good] ?? 0;

export function addGoods(inv, good, n) {
  if (!Number.isInteger(n) || n <= 0) return 0;
  inv[good] = qty(inv, good) + n;
  return n;
}

export function removeGoods(inv, good, n) {
  if (!Number.isInteger(n) || n <= 0 || qty(inv, good) < n) return false;
  inv[good] -= n;
  if (inv[good] === 0) delete inv[good];
  return true;
}

export function moveGoods(from, to, good, n) {
  if (!removeGoods(from, good, n)) return false;
  addGoods(to, good, n);
  return true;
}

export const totalUnits = (inv) => Object.values(inv).reduce((s, v) => s + v, 0);
