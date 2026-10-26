import { RIVER, WORLD, roadRect, ROAD_KINDS } from '../navigation/RoadNetwork.js';
import { solidRects } from '../property/Footprints.js';
import { estimate } from '../navigation/RoadConstruction.js';

// Procedural street planning. A new street branches at right angles from an
// existing road, so it is always connected to the navigation network the
// villagers already walk. Candidates are rejected if the street or any plot
// along it would cross the river, a building, another plot or another road,
// or leave the valley; the survivors are scored by how many households they
// serve, how close they are to the market, and what they cost to build.

export const PLOT_SIZE = { residential: [7, 7], commercial: [8, 7], workshop: [9, 8], farmland: [12, 10], civic: [9, 8] };
const ROAD_W = 2.4;
const BOUND = WORLD.max - 6;
const FOREST = [13, -30, 32, -21];
const LENGTHS = [34, 26, 18];

const overlaps = (a, b, pad = 0) => a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad;
const inBounds = (r) => r[0] > -BOUND && r[2] < BOUND && r[1] > -BOUND && r[3] < BOUND;
const crossesRiver = (r) => r[1] < RIVER.zMax + 1 && r[3] > RIVER.zMin - 1;
const plotRect = (p) => [p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2];

/** Rectangles from later systems that streets and plots must also keep clear of (monuments off any plot). */
export const obstacleHooks = [];

/** Rectangles that new streets and plots must keep clear of. */
export function obstacles(state) {
  const plots = state.plots.map(plotRect);
  const solids = [...state.plots.flatMap((p) => solidRects(p)), ...obstacleHooks.flatMap((fn) => fn(state) ?? [])];
  const roads = state.roads.map(roadRect);
  const reserved = (state.city?.proposals ?? []).filter((p) => p.status === 'PROPOSED' || p.status === 'APPROVED' || p.status === 'BUILDING')
    .flatMap((p) => [roadRect(p.road), ...p.plots.map(plotRect)]);
  const works = (state.roadProjects ?? []).filter((p) => p.status !== 'COMPLETE' && p.status !== 'REJECTED').map(roadRect);
  return { plots: [...plots, ...reserved], solids, roads: [...roads, ...works] };
}

/** Is a proposed street rectangle buildable (connected at `parent`, clear elsewhere)? */
export function streetClear(obs, rect, parent = null) {
  if (!inBounds(rect) || crossesRiver(rect)) return false;
  if (obs.plots.some((p) => overlaps(rect, p, 0.6)) || obs.solids.some((s) => overlaps(rect, s, 0.8))) return false;
  const inner = [rect[0] + 0.25, rect[1] + 0.25, rect[2] - 0.25, rect[3] - 0.25];
  return !obs.roads.some((r) => r !== parent && overlaps(inner, r, 0.2));
}

export function plotClear(obs, rect, street) {
  if (!inBounds(rect) || crossesRiver(rect) || overlaps(rect, FOREST, 1)) return false;
  if (overlaps(rect, street, 0.3)) return false;
  return !obs.plots.some((p) => overlaps(rect, p, 0.8)) && !obs.roads.some((r) => overlaps(rect, r, 0.4)) && !obs.solids.some((s) => overlaps(rect, s, 1));
}

/** The land use of each plot along a new street, from what the town needs. */
function landUses(demand, n, far) {
  const uses = Array(n).fill('residential');
  if (demand.commercialDemand > 1.2 && n >= 3) uses[0] = 'commercial';
  if (demand.commercialDemand > 2 && n >= 6) uses[1] = 'commercial';
  if (demand.workshopDemand > 1 && n >= 5) uses[n - 1] = 'workshop';
  if (far && demand.foodDemand > 1 && n >= 4) uses[n - 1] = 'farmland';
  return uses;
}

/**
 * Candidate streets branching off one road. Each is { road, plots, score, parentId }.
 * Deterministic: candidates are generated in a fixed order.
 */
function candidatesFrom(state, obs, parent, demand) {
  const out = [];
  if (parent.kind === 'ford' || parent.kind === 'bridge') return out;
  const pr = roadRect(parent);
  const horizontal = parent.w >= parent.d;
  const span = horizontal ? parent.w : parent.d;
  if (span < 10) return out;
  for (let t = 5; t <= span - 5; t += 6) {
    for (const side of [-1, 1]) {
      for (const L of LENGTHS) {
        let road;
        if (horizontal) {
          const x = pr[0] + t, z0 = side > 0 ? pr[3] : pr[1] - L;
          road = { x, z: z0 + L / 2, w: ROAD_W, d: L };
        } else {
          const z = pr[1] + t, x0 = side > 0 ? pr[2] : pr[0] - L;
          road = { x: x0 + L / 2, z, w: L, d: ROAD_W };
        }
        road.x = Math.round(road.x * 10) / 10; road.z = Math.round(road.z * 10) / 10;
        const rect = roadRect(road);
        if (!streetClear(obs, rect, pr)) continue;
        const plots = lineStreet(obs, road, !horizontal, side, horizontal ? pr[side > 0 ? 3 : 1] : pr[side > 0 ? 2 : 0], demand);
        if (plots.length < 3) continue;
        const dist = Math.hypot(road.x, road.z);
        const cost = estimate('dirt', road.w, road.d).coins;
        const homes = plots.filter((p) => p.landType === 'residential').length;
        const score = homes * 10 + (plots.length - homes) * 7 - dist * 0.18 - cost * 0.25 + (parent.kind === 'stone' ? 4 : 0);
        out.push({ road, plots, side, score: Math.round(score * 10) / 10, parentId: parent.id, length: L });
        break; // the longest street that fits at this junction
      }
    }
  }
  return out;
}

/** Lay plots along both sides of a street, starting a little way from its junction. */
function lineStreet(obs, road, alongX, side, junction, demand) {
  const slots = [];
  const len = alongX ? road.w : road.d;
  const start = alongX ? road.x - road.w / 2 : road.z - road.d / 2;
  for (let u = 5.5; u <= len - 3.5; u += 9) {
    const along = side > 0 ? start + u : start + len - u;
    for (const s of [-1, 1]) slots.push({ along, s, fromJunction: Math.abs(along - junction) });
  }
  slots.sort((a, b) => a.fromJunction - b.fromJunction || a.s - b.s);
  const far = Math.hypot(road.x, road.z) > 55;
  const uses = landUses(demand, slots.length, far);
  const placed = [];
  for (const [i, slot] of slots.entries()) {
    const landType = uses[i];
    const [w, d] = PLOT_SIZE[landType];
    const off = ROAD_W / 2 + 0.7 + (alongX ? d : w) / 2;
    const p = alongX
      ? { x: slot.along, z: road.z + slot.s * off, w, d, landType, facing: slot.s < 0 ? 'south' : 'north' }
      : { x: road.x + slot.s * off, z: slot.along, w, d, landType, facing: slot.s < 0 ? 'east' : 'west' };
    const rect = plotRect(p);
    if (!plotClear(obs, rect, roadRect(road)) || placed.some((q) => overlaps(rect, plotRect(q), 0.8))) continue;
    placed.push(p);
  }
  return placed;
}

/** The best new street the town could build now, or null when no land is left. */
export function bestStreet(state, demand) {
  const obs = obstacles(state);
  let best = null;
  for (const parent of state.roads) {
    for (const cand of candidatesFrom(state, obs, parent, demand)) {
      if (!best || cand.score > best.score) best = cand;
    }
  }
  return best;
}

/** Shorten a planned street to keep only its first `n` plots (council modification). */
export function trimStreet(plan, n) {
  const keep = plan.plots.slice(0, n);
  const horizontal = plan.road.w > plan.road.d;
  const along = keep.map((p) => (horizontal ? p.x : p.z));
  const parentEdge = horizontal ? (plan.side > 0 ? plan.road.x - plan.road.w / 2 : plan.road.x + plan.road.w / 2) : (plan.side > 0 ? plan.road.z - plan.road.d / 2 : plan.road.z + plan.road.d / 2);
  const reach = Math.max(...along.map((a) => Math.abs(a - parentEdge))) + 4.5;
  const L = Math.min(horizontal ? plan.road.w : plan.road.d, Math.ceil(reach));
  const road = { ...plan.road };
  if (horizontal) { road.w = L; road.x = parentEdge + (plan.side > 0 ? L / 2 : -L / 2); } else { road.d = L; road.z = parentEdge + (plan.side > 0 ? L / 2 : -L / 2); }
  return { ...plan, road, plots: keep };
}

export const STREET_KIND = 'dirt';
export const streetLabel = () => ROAD_KINDS[STREET_KIND].label;
