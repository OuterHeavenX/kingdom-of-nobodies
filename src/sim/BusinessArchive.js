import { DAYS_PER_YEAR } from '../core/Config.js';
import { isTrading } from '../economy/Businesses.js';
import { invalidateIds } from '../core/EntityRegistry.js';

// Closed businesses are kept for history, but a long-lived town closes a few
// every year and nearly every system scans state.businesses. Once a business
// has been closed (and compacted) for a decade and nothing live refers to it,
// its record moves to state.businessArchive (keyed by id), where chronicle
// links, biographies and panels can still find it.

export const ARCHIVE_AFTER_DAYS = 10 * DAYS_PER_YEAR;

// Parts of the state that only record history; a business named there may be archived.
const HISTORICAL = new Set(['archive', 'citizens', 'businesses', 'businessArchive', 'chronicle', 'accounts', 'estates', 'relationships', 'ledger', 'yearly', 'history', 'eventLog', 'rumors', 'plots', 'events']);

/** A business by id, whether trading, recently closed or archived. */
export const anyBusiness = (state, id) => state.businesses.find((b) => b.id === id) ?? state.businessArchive?.[id] ?? null;

/** Yearly: move long-closed businesses that nothing live refers to into the archive. */
export function archiveClosedBusinesses(state) {
  const old = state.businesses.filter((b) => !isTrading(b) && b.compact && b.closedDay != null && state.day - b.closedDay >= ARCHIVE_AFTER_DAYS && !(state.accounts[b.id] > 0));
  if (!old.length) return 0;
  // Live references: a plot, a job, or any record outside the purely historical ones (cases, loans, contracts...).
  const live = new Set();
  for (const p of state.plots) if (p.businessId) live.add(p.businessId);
  for (const c of state.citizens) if (c.employment?.businessId) live.add(c.employment.businessId);
  const blob = JSON.stringify(Object.fromEntries(Object.entries(state).filter(([k]) => !HISTORICAL.has(k))));
  for (const m of blob.matchAll(/"(b\d+)"/g)) live.add(m[1]);
  const moving = old.filter((b) => !live.has(b.id));
  if (!moving.length) return 0;
  const ids = new Set(moving.map((b) => b.id));
  state.businessArchive = state.businessArchive ?? {};
  for (const b of moving) {
    state.businessArchive[b.id] = b;
    if (state.accounts[b.id] === 0) delete state.accounts[b.id];
  }
  // In place, so anything holding the list keeps seeing the live one.
  let w = 0;
  for (const b of state.businesses) if (!ids.has(b.id)) state.businesses[w++] = b;
  state.businesses.length = w;
  // The id index is rebuilt only when the length changes; a business opened
  // later the same day would restore the old length and leave it stale.
  invalidateIds(state.businesses);
  return moving.length;
}
