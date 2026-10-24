import { navGrid, cellOf, cellX, cellZ, nearestOpen, walkable, SIZE, CELL } from './NavigationGrid.js';
import { ROAD_KINDS } from './RoadNetwork.js';

// A* over the navigation grid (8 directions, no corner cutting), followed by
// cost-aware string pulling so routes are short lists of waypoints that never
// trade a road for open grass. Results are cached per grid version with a hard
// size limit, so repeated trips (home → work) cost nothing.

const MIN_COST = ROAD_KINDS.stone.cost;
const CACHE_MAX = 1500;
const SQRT2 = Math.SQRT2;
const N = SIZE * SIZE;

// Scratch buffers shared by every search (the simulation is single-threaded).
const g = new Float32Array(N);
const came = new Int32Array(N);
const stamp = new Uint32Array(N);
const closed = new Uint32Array(N);
let generation = 0;
const heapCell = new Int32Array(N * 2);
const heapF = new Float32Array(N * 2);

function octile(a, b) {
  const dx = Math.abs((a % SIZE) - (b % SIZE)), dz = Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
  return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * MIN_COST;
}

/** Raw A*: cell list from start to goal, or null when unreachable. */
function astar(cost, start, goal) {
  generation++;
  let size = 0;
  const push = (cell, f) => {
    let i = size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapF[parent] <= f) break;
      heapCell[i] = heapCell[parent]; heapF[i] = heapF[parent]; i = parent;
    }
    heapCell[i] = cell; heapF[i] = f;
  };
  const pop = () => {
    const top = heapCell[0];
    const lastCell = heapCell[--size], lastF = heapF[size];
    let i = 0;
    while (true) {
      let child = 2 * i + 1;
      if (child >= size) break;
      if (child + 1 < size && heapF[child + 1] < heapF[child]) child++;
      if (heapF[child] >= lastF) break;
      heapCell[i] = heapCell[child]; heapF[i] = heapF[child]; i = child;
    }
    heapCell[i] = lastCell; heapF[i] = lastF;
    return top;
  };
  g[start] = 0; stamp[start] = generation; came[start] = -1;
  push(start, octile(start, goal));
  while (size > 0) {
    const cur = pop();
    if (closed[cur] === generation) continue;
    closed[cur] = generation;
    if (cur === goal) {
      const path = [];
      for (let k = cur; k !== -1; k = came[k]) path.push(k);
      return path.reverse();
    }
    const ci = cur % SIZE, cj = (cur - ci) / SIZE;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= SIZE || j >= SIZE) continue;
      const next = j * SIZE + i;
      const c = cost[next];
      if (c === Infinity || closed[next] === generation) continue;
      // No squeezing diagonally between two solid cells.
      if (di && dj && (cost[cj * SIZE + i] === Infinity || cost[j * SIZE + ci] === Infinity)) continue;
      const step = (di && dj ? SQRT2 : 1) * (cost[cur] + c) / 2;
      const tentative = g[cur] + step;
      if (stamp[next] === generation && tentative >= g[next]) continue;
      stamp[next] = generation; g[next] = tentative; came[next] = cur;
      push(next, tentative + octile(next, goal));
    }
  }
  return null;
}

/** Highest cost along a straight segment, or Infinity if it crosses a wall. */
function lineCost(cost, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(d / (CELL * 0.4)));
  let worst = 0;
  for (let s = 0; s <= steps; s++) {
    const k = cellOf(ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps);
    if (k < 0) return Infinity;
    worst = Math.max(worst, cost[k]);
    if (worst === Infinity) return worst;
  }
  return worst;
}

/** Collapse a cell path into a few waypoints without leaving cheaper ground. */
function smooth(cost, cells) {
  const pts = cells.map((k) => [cellX(k), cellZ(k)]);
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1;
    let maxAlong = Math.max(cost[cells[i]], cost[cells[i + 1]]);
    for (let j = i + 2; j < pts.length; j++) {
      maxAlong = Math.max(maxAlong, cost[cells[j]]);
      if (lineCost(cost, pts[i][0], pts[i][1], pts[j][0], pts[j][1]) <= maxAlong + 1e-6) best = j;
      else if (j - best > 3) break;
    }
    out.push(pts[best]);
    i = best;
  }
  return out;
}

/**
 * Plan a route between two world points. Returns { points: [[x,z]...], cells }
 * or { failed: reason }. Start or goal inside a wall snap to the nearest open
 * ground; a goal that cannot be reached at all fails explainably.
 */
export function findPath(state, from, to) {
  const grid = navGrid(state);
  let s = cellOf(from.x, from.z), t = cellOf(to.x, to.z);
  if (s < 0 || t < 0) return { failed: 'outside the valley' };
  s = nearestOpen(grid, s);
  t = nearestOpen(grid, t);
  if (s < 0) return { failed: 'boxed in' };
  if (t < 0) return { failed: 'destination is walled off' };
  const key = s * N + t;
  let entry = grid.cache.get(key);
  if (!entry) {
    const cells = s === t ? [s] : astar(grid.cost, s, t);
    entry = cells ? { cells, points: cells.length > 1 ? smooth(grid.cost, cells) : [[cellX(s), cellZ(s)]] } : { failed: 'no route' };
    if (grid.cache.size >= CACHE_MAX) grid.cache.delete(grid.cache.keys().next().value);
    grid.cache.set(key, entry);
  }
  if (entry.failed) return entry;
  const points = entry.points.slice(1, -1);
  // Keep the first cell centre if walking straight from the exact position would clip a wall.
  const next = points[0] ?? [to.x, to.z];
  if (lineCost(grid.cost, from.x, from.z, next[0], next[1]) === Infinity) points.unshift(entry.points[0]);
  // End exactly at the destination when it is walkable, else at the nearest open cell.
  const goalCentre = [cellX(t), cellZ(t)];
  if (walkable(grid, cellOf(to.x, to.z))) {
    // Re-aiming the last leg at the exact spot must not clip a wall either.
    const prev = points[points.length - 1] ?? [from.x, from.z];
    if (lineCost(grid.cost, prev[0], prev[1], to.x, to.z) === Infinity) points.push(goalCentre);
    points.push([to.x, to.z]);
  } else points.push(goalCentre);
  return { points, cells: entry.cells, version: grid.version };
}

/** Cost of travelling a planned route (for comparisons and tests). */
export function routeCost(state, from, points) {
  const grid = navGrid(state);
  let total = 0, x = from.x, z = from.z;
  for (const [px, pz] of points) {
    const d = Math.hypot(px - x, pz - z);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.4)));
    for (let k = 0; k < steps; k++) total += (d / steps) * grid.cost[cellOf(x + ((px - x) * (k + 0.5)) / steps, z + ((pz - z) * (k + 0.5)) / steps)];
    x = px; z = pz;
  }
  return total;
}

/** Can a straight segment still be walked on the current grid? */
export const segmentClear = (state, ax, az, bx, bz) => lineCost(navGrid(state).cost, ax, az, bx, bz) !== Infinity;
