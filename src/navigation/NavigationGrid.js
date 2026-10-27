import { solidRects } from '../property/Footprints.js';
import { ROAD_KINDS, TERRAIN_COST, RIVER, WORLD, roadRect } from './RoadNetwork.js';
import { grids, markNavDirty } from './NavCache.js';

export { markNavDirty };

// A coarse walkability grid over the valley (2-unit cells). Buildings are
// solid, the river is water, farm fields and the forest are rough ground and
// roads are cheap. The grid is derived from state, never saved: it is rebuilt
// only when something that affects movement has changed (checked at most once
// per tick, so the simulation stays deterministic across save and load).

export const CELL = 2;
export const SIZE = (WORLD.max - WORLD.min) / CELL; // cells per side
const FOREST = [13, -30, 32, -21];
/** Extra solid rectangles [minX, minZ, maxX, maxZ] from later systems (a monument standing off any plot). */
export const navHooks = { solids: [] };
const extraSolids = (state) => navHooks.solids.flatMap((fn) => fn(state) ?? []);


export const cellOf = (x, z) => {
  const i = Math.floor((x - WORLD.min) / CELL), j = Math.floor((z - WORLD.min) / CELL);
  return i < 0 || j < 0 || i >= SIZE || j >= SIZE ? -1 : j * SIZE + i;
};
export const cellX = (cell) => WORLD.min + ((cell % SIZE) + 0.5) * CELL;
export const cellZ = (cell) => WORLD.min + (Math.floor(cell / SIZE) + 0.5) * CELL;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A cheap fingerprint of everything that changes movement. */
export function navSignature(state) {
  let sig = state.roads.length + ':';
  for (const r of state.roads) sig += r.kind[0];
  for (const p of state.plots) sig += `${p.building?.type ?? ''}${p.building?.level ?? ''}${p.projectId ? '*' : ''}|`;
  for (const r of extraSolids(state)) sig += `#${r.join(',')}`;
  return sig;
}

/** Index range of cells whose centres fall inside [lo, hi] along one axis. */
const span = (lo, hi) => [Math.max(0, Math.ceil((lo - WORLD.min) / CELL - 0.5)), Math.min(SIZE - 1, Math.floor((hi - WORLD.min) / CELL - 0.5))];

function fill(cost, [minX, minZ, maxX, maxZ], value) {
  const [i0, i1] = span(minX, maxX), [j0, j1] = span(minZ, maxZ);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cost[j * SIZE + i] = value;
}

function build(state) {
  const cost = new Float32Array(SIZE * SIZE).fill(TERRAIN_COST.grass);
  fill(cost, FOREST, TERRAIN_COST.rough);
  for (const p of state.plots) {
    if (p.building?.type === 'farm') fill(cost, [p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2], TERRAIN_COST.rough);
    if (p.projectId) fill(cost, [p.x - p.w / 3, p.z - p.d / 3, p.x + p.w / 3, p.z + p.d / 3], TERRAIN_COST.site);
  }
  fill(cost, [WORLD.min, RIVER.zMin, WORLD.max, RIVER.zMax], TERRAIN_COST.water);
  // Roads are cheaper than whatever they cross; only fords and bridges cross water.
  for (const r of state.roads) {
    const c = ROAD_KINDS[r.kind].cost;
    const [minX, minZ, maxX, maxZ] = roadRect(r);
    const [i0, i1] = span(minX - 0.6, maxX + 0.6), [j0, j1] = span(minZ - 0.6, maxZ + 0.6);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * SIZE + i;
      if (cost[k] === Infinity && r.kind !== 'bridge' && r.kind !== 'ford') continue;
      cost[k] = cost[k] === Infinity ? c : Math.min(cost[k], c);
    }
  }
  // Buildings are solid (applied last so a road never makes a wall passable).
  // Any cell a wall touches is blocked (inflate by half a cell), so a route between open cells never clips a corner.
  const pad = CELL / 2;
  for (const p of state.plots) for (const [minX, minZ, maxX, maxZ] of solidRects(p)) fill(cost, [minX - pad, minZ - pad, maxX + pad, maxZ + pad], Infinity);
  for (const [minX, minZ, maxX, maxZ] of extraSolids(state)) fill(cost, [minX - pad / 2, minZ - pad / 2, maxX + pad / 2, maxZ + pad / 2], Infinity);
  return cost;
}

/** The current grid for a state: { cost, version }. Rebuilt lazily when the signature changes. */
export function navGrid(state) {
  let g = grids.get(state);
  if (g && g.tick === state.tick && !g.dirty) return g;
  const sig = navSignature(state);
  if (!g || g.sig !== sig) {
    // The version is a hash of the signature, so it is the same after a reload.
    g = { cost: build(state), sig, version: hash(sig), cache: new Map(), tick: state.tick };
    grids.set(state, g);
  }
  g.tick = state.tick;
  g.dirty = false;
  return g;
}


export const walkable = (g, cell) => cell >= 0 && g.cost[cell] !== Infinity;
export const costAt = (state, x, z) => { const k = cellOf(x, z); return k < 0 ? TERRAIN_COST.grass : navGrid(state).cost[k]; };

/** Nearest walkable cell to a cell (spiral search), or -1. */
export function nearestOpen(g, cell, radius = 6) {
  if (walkable(g, cell)) return cell;
  if (cell < 0) return -1;
  const ci = cell % SIZE, cj = Math.floor(cell / SIZE);
  for (let r = 1; r <= radius; r++) {
    let best = -1, bestD = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) continue;
      const k = j * SIZE + i;
      const d = di * di + dj * dj;
      if (walkable(g, k) && d < bestD) { best = k; bestD = d; }
    }
    if (best >= 0) return best;
  }
  return -1;
}
