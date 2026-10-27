import { balance, transfer } from '../economy/Transactions.js';
import { qty, removeGoods } from '../economy/Inventory.js';
import { isTrading, BUSINESS_TYPES, wholesalePrice } from '../economy/Businesses.js';
import { record } from '../society/Chronicle.js';
import { byId } from '../core/EntityRegistry.js';
import { GOODS, COUNCIL } from '../core/Config.js';
import { frontOf } from '../property/LandRegistry.js';
import { solidRects } from '../property/Footprints.js';
import { ROAD_KINDS, RIVER, addRoad, roadRect, hasBridge } from './RoadNetwork.js';
import { cellOf, cellX, cellZ, SIZE, CELL, markNavDirty } from './NavigationGrid.js';
import { ensureNavigation } from './Traffic.js';

// Roads are proposed for reasons (a home or shop with no road, a well-worn
// track across the grass, a busy dirt road, caravans wading the ford), approved
// and paid for by the council, and built by the Village Works crew one shift
// at a time. Materials are bought for real: timber from local lumberyards (or
// outside traders), stone only from the council's stores, which trade fills.

// Per unit of length: labour (works-crew shifts add ~3 each) and materials.
export const ROAD_BUILD = {
  footpath: { work: 0.45, timber: 0, stone: 0, coins: 0.6 },
  dirt: { work: 0.9, timber: 0, stone: 0, coins: 1 },
  stone: { work: 1.2, timber: 0, stone: 0.3, coins: 1.5 },
  bridge: { work: 11, timber: 2, stone: 2.4, coins: 8 },
};
const MAX_ACTIVE = 1;
const MAX_PROPOSALS = 6;

// Projects stalled for materials (stone comes only by trade) do not hold up the rest.
export const activeRoadProject = (state) => (state.roadProjects ?? []).find((p) => p.status === 'BUILDING' && !p.waiting) ?? (state.roadProjects ?? []).find((p) => p.status === 'BUILDING') ?? null;

function overlapsRect(a, b) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]; }

/** Solid rectangles off any plot (monuments) that roads must go around; filled by later systems. */
export const roadObstacleHooks = [];

function blocked(state, rect) {
  if (rect[1] < RIVER.zMax && rect[3] > RIVER.zMin) return true;
  if (roadObstacleHooks.some((fn) => (fn(state) ?? []).some((s) => overlapsRect(rect, s)))) return true;
  return state.plots.some((p) => solidRects(p).some((s) => overlapsRect(rect, s)));
}

function alreadyPlanned(state, rect) {
  return (state.roadProjects ?? []).some((p) => p.status !== 'REJECTED' && p.status !== 'COMPLETE' && overlapsRect(roadRect(p), rect));
}

/** Estimate what a road will need. */
export function estimate(kind, w, d) {
  const len = Math.max(w, d);
  const b = ROAD_BUILD[kind];
  return { work: Math.ceil(len * b.work * 10) / 10 + 2, timber: Math.ceil(len * b.timber), stone: Math.ceil(len * b.stone), coins: Math.ceil(len * b.coins) + 4 };
}

function propose(state, spec) {
  state.roadProjects = state.roadProjects ?? [];
  trimRoadRecords(state);
  const open = state.roadProjects.filter((p) => p.status === 'PROPOSED' || p.status === 'BUILDING' || p.status === 'APPROVED');
  if (open.length >= MAX_PROPOSALS && !spec.preApproved) return null;
  const rect = roadRect(spec);
  if (spec.kind !== 'bridge' && (blocked(state, rect) || alreadyPlanned(state, rect))) return null;
  state.nextId.roadProject = (state.nextId.roadProject ?? 0) + 1;
  const need = estimate(spec.kind, spec.w, spec.d);
  const p = { id: 'rp' + state.nextId.roadProject, status: spec.preApproved ? 'APPROVED' : 'PROPOSED', proposedDay: state.day, work: 0, materials: { timber: 0, stone: 0 }, paid: 0, need, ...spec };
  state.roadProjects.push(p);
  record(state, 'construction', `${spec.proposerName ?? 'The council'} proposed ${p.upgradeOf ? 'paving' : 'a new'} ${ROAD_KINDS[spec.kind].label.toLowerCase()}: ${p.name} (${p.reason}).`, { citizens: spec.proposedBy && spec.proposedBy !== 'council' ? [spec.proposedBy] : [] }, 1);
  return p;
}

/** Streets planned (and already approved) by the town planners go through here. */
export const proposeRoad = (state, spec) => propose(state, spec);

/** Called with (state, project) when a road project is finished. */
export const roadCompletionHooks = [];

/** Straight access path from a building's door until it meets a road. */
function accessProposal(state, plot) {
  const door = frontOf(plot, 0, 0.4);
  const dir = { south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0] }[plot.facing ?? 'south'];
  for (let t = 0; t <= 26; t += 1) {
    const x = door.x + dir[0] * t, z = door.z + dir[1] * t;
    if (state.roads.some((r) => { const q = roadRect(r); return x >= q[0] - 0.3 && x <= q[2] + 0.3 && z >= q[1] - 0.3 && z <= q[3] + 0.3; })) {
      if (t < 4) return null; // already close enough to a road
      const len = t + 0.6;
      return dir[0] ? { x: door.x + dir[0] * len / 2, z: door.z, w: len, d: 1.8 } : { x: door.x, z: door.z + dir[1] * len / 2, w: 1.8, d: len };
    }
  }
  return null;
}

/** Longest straight run of well-trodden, road-less cells. */
function desirePath(state) {
  const t = ensureNavigation(state).traffic;
  const threshold = 45;
  const onRoad = (k) => state.roads.some((r) => { const q = roadRect(r); const x = cellX(k), z = cellZ(k); return x >= q[0] - 1 && x <= q[2] + 1 && z >= q[1] - 1 && z <= q[3] + 1; });
  const hot = (k) => (t[k] ?? 0) >= threshold && !onRoad(k);
  let best = null;
  for (const key of Object.keys(t)) {
    const k = Number(key);
    if (!hot(k)) continue;
    const i = k % SIZE, j = Math.floor(k / SIZE);
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      if (hot((j - dj) * SIZE + (i - di))) continue; // only start at the beginning of a run
      let n = 1, uses = t[k];
      while (n < 20 && hot((j + dj * n) * SIZE + (i + di * n))) { uses += t[(j + dj * n) * SIZE + (i + di * n)]; n++; }
      if (n >= 4 && (!best || uses > best.uses)) best = { i, j, di, dj, n, uses };
    }
  }
  if (!best) return null;
  const x0 = cellX(best.j * SIZE + best.i), z0 = cellZ(best.j * SIZE + best.i);
  const len = best.n * CELL;
  return best.di
    ? { x: x0 + (len - CELL) / 2, z: z0, w: len, d: 2.2, uses: Math.round(best.uses) }
    : { x: x0, z: z0 + (len - CELL) / 2, w: 2.2, d: len, uses: Math.round(best.uses) };
}

/** Name a new road after the nearest plot. */
function roadName(state, x, z, suffix) {
  const near = [...state.plots].sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  const base = near ? near.name.replace(/ (Cottage|Field|Yard|Row|Corner|Lane|Commons|Green|Edge|\d+)$/u, '') : 'Hearth';
  const taken = new Set([...state.roads.map((r) => r.name), ...(state.roadProjects ?? []).map((p) => p.name)]);
  for (const name of [`${base} ${suffix}`, `Old ${base} ${suffix}`, `${base} ${suffix} ${state.roads.length + 1}`]) if (!taken.has(name)) return name;
  return `${base} ${suffix} ${state.day}`;
}

/** Every four days: look for roads worth building. */
export function considerRoads(state) {
  if (state.day % 4 !== 0) return;
  state.roadProjects = state.roadProjects ?? [];
  // 1. Homes and shops with no road to their door: their owners petition for a path.
  for (const plot of state.plots) {
    if (!plot.building || plot.building.type === 'ruins' || !(plot.residents?.length || plot.businessId)) continue;
    const rect = accessProposal(state, plot);
    if (!rect) continue;
    const owner = byId(state.citizens, plot.ownerId);
    if (propose(state, { kind: 'footpath', name: `${plot.name} Path`, ...rect, reason: `${plot.name} has no road to its door`, proposedBy: owner?.id ?? 'council', proposerName: owner ? owner.firstName : null })) break;
  }
  // 2. A track worn into the grass becomes a dirt road.
  const desire = desirePath(state);
  if (desire) propose(state, { kind: 'dirt', name: roadName(state, desire.x, desire.z, 'Lane'), x: desire.x, z: desire.z, w: desire.w, d: desire.d, reason: `about ${desire.uses} recent trips crossed open ground here`, proposedBy: 'council' });
  // 3. The busiest dirt road is paved.
  const t = ensureNavigation(state).traffic;
  const busy = state.roads.filter((r) => r.kind === 'dirt').map((r) => {
    const q = roadRect(r);
    let sum = 0, cells = 0;
    for (let x = q[0] + 1; x < q[2]; x += CELL) for (let z = q[1] + 1; z < q[3]; z += CELL) { sum += t[cellOf(x, z)] ?? 0; cells++; }
    return { r, avg: sum / Math.max(1, cells) };
  }).sort((a, b) => b.avg - a.avg)[0];
  const stoneWaiting = state.roadProjects.some((p) => p.status === 'BUILDING' && p.need.stone > p.materials.stone);
  if (busy && busy.avg > 60 && !stoneWaiting && !state.roadProjects.some((p) => p.upgradeOf === busy.r.id && p.status !== 'REJECTED')) {
    propose(state, { kind: 'stone', name: `${busy.r.name} (paving)`, x: busy.r.x, z: busy.r.z, w: busy.r.w, d: busy.r.d, upgradeOf: busy.r.id, reason: `${Math.round(busy.avg)} recent trips per stretch are wearing the dirt into mud`, proposedBy: 'council' });
  }
  // 4. A bridge over the river once enough people and carts wade the ford.
  const ford = state.roads.find((r) => r.kind === 'ford');
  const crossings = (ford ? (t[cellOf(ford.x, ford.z)] ?? 0) : 0) + (state.trade?.fordCrossings ?? 0);
  if (ford && !hasBridge(state) && crossings > 30 && !state.roadProjects.some((p) => p.kind === 'bridge' && p.status !== 'REJECTED')) {
    propose(state, { kind: 'bridge', name: 'Hearth Bridge', x: ford.x, z: ford.z, w: 3.2, d: RIVER.zMax - RIVER.zMin + 3, reason: `${Math.round(crossings)} recent crossings at the ford`, proposedBy: 'council' });
  }
}

/** Daily: the council approves what it can afford, one project at a time. */
export function approveRoads(state) {
  const projects = state.roadProjects ?? [];
  for (const p of projects.filter((x) => x.status === 'PROPOSED' && state.day - x.proposedDay > 24)) {
    p.status = 'REJECTED';
    p.decision = 'Lapsed: the council never found the money.';
  }
  for (const p of projects.filter((x) => x.status === 'BUILDING' && x.waiting)) supply(state, p);
  if (projects.filter((x) => x.status === 'BUILDING' && !x.waiting).length >= MAX_ACTIVE) return;
  // Streets the council has already approved and funded through the town plan go first.
  const queued = projects.find((x) => x.status === 'APPROVED');
  if (queued) {
    queued.status = 'BUILDING';
    queued.startDay = state.day;
    record(state, 'construction', `Work began on ${queued.name} for ${queued.reason}.`, {}, 2);
    return;
  }
  const works = state.government?.policies?.publicWorks ?? true;
  const candidates = projects.filter((x) => x.status === 'PROPOSED').sort((a, b) => (b.proposedBy !== 'council') - (a.proposedBy !== 'council') || a.proposedDay - b.proposedDay);
  for (const p of candidates) {
    const spare = balance(state, 'treasury') - COUNCIL.reserve;
    const budget = p.need.coins + p.need.timber * 5 + p.need.stone * 5;
    if (!works) { p.status = 'REJECTED'; p.decision = 'Rejected: the government has ended public works.'; continue; }
    if (spare < budget) continue;
    p.status = 'BUILDING';
    p.startDay = state.day;
    p.decision = `Approved with a budget of ${budget} coins.`;
    record(state, 'construction', `The council approved ${p.name}${p.proposerName ? `, petitioned by ${p.proposerName}` : ''}, and the Village Works crew will build it.`, { citizens: p.proposedBy !== 'council' ? [p.proposedBy] : [] }, 2);
    break;
  }
}

/** Buy materials for the active project (timber locally, stone from council stores). */
function supply(state, p) {
  const need = (g) => p.need[g] - p.materials[g];
  if (need('stone') > 0) {
    const n = Math.min(need('stone'), qty(state.council.stores ?? {}, 'stone'));
    if (n > 0) { removeGoods(state.council.stores, 'stone', n); p.materials.stone += n; }
  }
  if (need('timber') > 0) {
    const sellers = state.businesses.filter((b) => isTrading(b) && qty(b.inventory, 'timber') > 0 && BUSINESS_TYPES[b.type].sells.includes('timber'));
    for (const s of sellers) {
      const unit = wholesalePrice(s, 'timber') + 1;
      const n = Math.min(need('timber'), qty(s.inventory, 'timber'), Math.floor(balance(state, 'treasury') / unit));
      if (n > 0 && transfer(state, 'treasury', s.id, unit * n, 'construction', `${n} timber for ${p.name}`)) {
        removeGoods(s.inventory, 'timber', n); p.materials.timber += n; p.paid += unit * n;
        s.today.revenue += unit * n; s.totals.revenue += unit * n;
      }
    }
    if (need('timber') > 0 && !sellers.length) {
      const unit = Math.round(GOODS.timber.base * 1.7);
      const n = Math.min(need('timber'), Math.floor(balance(state, 'treasury') / unit));
      if (n > 0 && transfer(state, 'treasury', 'outside', unit * n, 'import', `timber for ${p.name}`)) { p.materials.timber += n; p.paid += unit * n; }
    }
  }
  p.waiting = need('stone') > 0 ? 'Waiting for stone from trade' : need('timber') > 0 ? 'Waiting for timber' : null;
  return !p.waiting;
}

/** A works-crew shift on the active road. Returns true if the shift went to the road. */
export function workOnRoad(state, c) {
  const p = activeRoadProject(state);
  if (!p || !supply(state, p)) return false;
  const site = p.need.coins - Math.min(p.need.coins, p.siteSpent ?? 0);
  if (site > 0) {
    // Gravel, tools and carting: paid by the council to the outside as they are used.
    const part = Math.min(site, Math.ceil(p.need.coins / Math.max(1, p.need.work / 3)));
    if (transfer(state, 'treasury', 'outside', part, 'construction', `Materials for ${p.name}`)) { p.siteSpent = (p.siteSpent ?? 0) + part; p.paid += part; }
  }
  p.work = Math.round((p.work + 3 + (c.skills.building ?? 0) * 2) * 10) / 10;
  p.crew = [...new Set([...(p.crew ?? []), c.id])].slice(-8);
  if (p.work >= p.need.work) completeRoad(state, p);
  return true;
}

function completeRoad(state, p) {
  p.status = 'COMPLETE';
  p.completedDay = state.day;
  if (p.upgradeOf) {
    const r = state.roads.find((x) => x.id === p.upgradeOf);
    if (r) { r.kind = 'stone'; r.pavedDay = state.day; markNavDirty(state); }
  } else {
    addRoad(state, { name: p.name, kind: p.kind, x: p.x, z: p.z, w: p.w, d: p.d });
    // A bridge replaces the ford it was built over.
    if (p.kind === 'bridge') { state.roads = state.roads.filter((r) => r.kind !== 'ford' || Math.abs(r.x - p.x) > 3); markNavDirty(state); }
  }
  for (const fn of roadCompletionHooks) fn(state, p);
  const names = (p.crew ?? []).map((id) => byId(state.citizens, id)?.firstName).filter(Boolean);
  record(state, 'construction', `${p.name} is finished after ${state.day - p.startDay} days of work${names.length ? ` by ${names.join(', ')}` : ''}, costing the council ${p.paid} coins.`, { citizens: p.crew ?? [] }, p.kind === 'bridge' ? 3 : 2);
  trimRoadRecords(state, p);
}

/**
 * Keep the record list bounded: the 30 most recent finished or rejected
 * projects are kept (plus `keep`). Called on completion and on every
 * proposal, so rejections pile up no further when no road is being finished.
 */
function trimRoadRecords(state, keep = null) {
  const done = state.roadProjects.filter((x) => (x.status === 'COMPLETE' || x.status === 'REJECTED') && x !== keep);
  if (done.length > 30) { const drop = new Set(done.slice(0, done.length - 30)); state.roadProjects = state.roadProjects.filter((x) => !drop.has(x)); }
}

/** Where a works-crew member stands while building the active road. */
export function roadWorkSpot(state, rand) {
  const p = activeRoadProject(state);
  if (!p) return null;
  return { x: p.x + (rand() - 0.5) * Math.max(0, p.w - 1), z: p.z + (rand() - 0.5) * Math.max(0, p.d - 1) };
}
