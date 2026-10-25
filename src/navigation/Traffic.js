import { cellOf, SIZE } from './NavigationGrid.js';

// Lightweight traffic. Every planned trip adds to a per-cell usage count that
// fades daily; it drives road proposals and shows where people really walk.
// Crowding is estimated once per tick from how many travellers share a cell,
// and slows them modestly instead of simulating a crowd.

export function ensureNavigation(state) {
  state.navigation = state.navigation ?? { traffic: {}, routes: 0, failures: 0, recentFailures: [] };
  return state.navigation;
}

/** Record a planned route's cells as demand. */
export function recordTrip(state, cells) {
  const nav = ensureNavigation(state);
  const t = nav.traffic;
  for (let i = 0; i < cells.length; i += 1) t[cells[i]] = (t[cells[i]] ?? 0) + 1;
  nav.routes++;
}

/** Daily fade so traffic reflects recent habits. */
export function decayTraffic(state) {
  const t = ensureNavigation(state).traffic;
  for (const k of Object.keys(t)) {
    const v = Math.round(t[k] * 0.85 * 10) / 10;
    if (v < 0.5) delete t[k]; else t[k] = v;
  }
}

/** Travellers per cell this tick (computed once per tick, not saved). */
const occupancy = new WeakMap();
export function crowdFactor(state, x, z) {
  let o = occupancy.get(state);
  if (!o || o.tick !== state.tick) {
    const counts = new Map();
    for (const c of state.citizens) if (c.activity?.phase === 'travel') { const k = cellOf(c.x, c.z); counts.set(k, (counts.get(k) ?? 0) + 1); }
    o = { tick: state.tick, counts };
    occupancy.set(state, o);
  }
  const n = o.counts.get(cellOf(x, z)) ?? 0;
  return n > 4 ? 1 / (1 + 0.08 * (n - 4)) : 1;
}

/** The busiest cells, for proposals and the UI. */
export function busiestCells(state, limit = 40) {
  return Object.entries(ensureNavigation(state).traffic).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, v]) => ({ cell: Number(k), uses: v, i: Number(k) % SIZE, j: Math.floor(Number(k) / SIZE) }));
}
