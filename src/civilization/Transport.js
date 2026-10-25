import { balance } from '../economy/Transactions.js';
import { record } from '../society/Chronicle.js';
import { ROAD_KINDS } from '../navigation/RoadNetwork.js';
import { markNavDirty } from '../navigation/NavCache.js';
import { ensureNavigation } from '../navigation/Traffic.js';
import { hasTech } from './Technology.js';
import { serviceAt } from './Infrastructure.js';
import { CIV } from '../core/Config.js';
import { transfer } from '../economy/Transactions.js';
import { plotById } from '../property/LandRegistry.js';
import { cellX, cellZ } from '../navigation/NavigationGrid.js';

// Transport through the ages. Technologies change how fast people and goods
// actually move: long trips across town are taken by car, bus or autonomous
// pod (the villager follows the same route on the road network, only faster),
// and caravans to the other kingdoms travel by rail, lorry or automated cargo.
// The renderer draws each trip with the vehicle the simulation chose for it.

// Paved surfaces for the motor age (walking cost; lower is faster).
ROAD_KINDS.asphalt = { label: 'Asphalt road', cost: 0.42, color: '#4d5257' };
ROAD_KINDS.smart = { label: 'Smart road', cost: 0.38, color: '#3c4a56' };

export const MODES = {
  walk: { label: 'On foot', icon: '🚶', local: 1 },
  cart: { label: 'Ox cart', icon: '🐂', regional: 1 },
  rail: { label: 'Freight rail', icon: '🚂', regional: 1.35 },
  car: { label: 'Car', icon: '🚗', local: 1.8, regional: 1.6 },
  bus: { label: 'Bus', icon: '🚌', local: 1.5 },
  metro: { label: 'Rapid transit', icon: '🚇', local: 2, regional: 2 },
  pod: { label: 'Autonomous pod', icon: '🛸', local: 2.4, regional: 2.4 },
};

const hasStation = (state) => state.plots.some((p) => p.building?.type === 'station' && p.constructionStatus === 'COMPLETE');

/** The fastest way goods leave the valley now. */
export function freightMode(state) {
  if (hasTech(state, 'autonomous_vehicles')) return 'pod';
  if (hasTech(state, 'rapid_transit') && hasStation(state)) return 'metro';
  if (hasTech(state, 'automobile')) return 'car';
  if (hasTech(state, 'railway') && hasStation(state)) return 'rail';
  return 'cart';
}

/** Multiplier on regional (caravan) travel speed, with the reason. */
export function regionalFactor(state) {
  const m = freightMode(state);
  return { factor: MODES[m].regional ?? 1, why: m === 'cart' ? null : MODES[m].label.toLowerCase() };
}

/**
 * How a villager makes a trip of `length` world units. Short trips are walked.
 * A car needs a household with some savings; buses and rapid transit need the
 * district's transit service; autonomous pods are for everyone.
 */
export function tripMode(state, c, length) {
  if (length < 22 || (state.civ?.age ?? 1) < 3) return 'walk';
  if (hasTech(state, 'autonomous_vehicles')) return 'pod';
  const home = plotById(state, c.homePlotId);
  const transit = home ? serviceAt(state, home, 'transit') : 0;
  if (transit >= 3 && hasTech(state, 'rapid_transit')) return 'metro';
  if (hasTech(state, 'automobile') && (balance(state, c.id) >= 40 || c.employment?.role === 'owner')) return 'car';
  if (transit >= 2 && hasTech(state, 'public_transit')) return 'bus';
  return 'walk';
}

/** Called when a villager plans a route: records the mode and returns the speed factor. */
export function planTrip(state, c, act, points) {
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, z0] = i === 0 ? [c.x, c.z] : points[i - 1];
    length += Math.hypot(points[i][0] - x0, points[i][1] - z0);
  }
  const mode = tripMode(state, c, length);
  if (mode === 'walk') { delete act.vehicle; return 1; }
  act.vehicle = mode;
  const t = state.civ.transport;
  t.trips[mode] = (t.trips[mode] ?? 0) + 1;
  return MODES[mode].local ?? 1;
}

/** Daily: caravans record how they travel; the council paves the busiest roads once there are motor cars. */
export function dailyTransport(state) {
  const mode = freightMode(state);
  for (const cv of state.trade?.caravans ?? []) if (!cv.mode && cv.status !== 'COMPLETED' && cv.status !== 'CANCELLED') cv.mode = mode;
  if (state.day % 3 !== 0) return;
  const target = hasTech(state, 'smart_infrastructure') ? 'smart' : hasTech(state, 'automobile') ? 'asphalt' : null;
  if (!target) return;
  const nav = ensureNavigation(state);
  const candidates = state.roads.filter((r) => !['ford', 'bridge', 'smart', target].includes(r.kind))
    .map((r) => ({ r, traffic: roadTraffic(r, nav) }))
    .sort((a, b) => b.traffic - a.traffic || (b.r.w * b.r.d) - (a.r.w * a.r.d) || a.r.id.localeCompare(b.r.id));
  const pick = candidates[0];
  if (!pick) return;
  const r = pick.r;
  const cost = Math.max(6, Math.round((Math.max(r.w, r.d) / 4) * (target === 'smart' ? 1.6 : 1)));
  if (balance(state, 'treasury') < cost + CIV.utilityReserve) return;
  if (!transfer(state, 'treasury', 'outside', cost, 'construction', `Paving ${r.name}`)) return;
  const was = r.kind;
  r.kind = target;
  r.pavedDay = state.day;
  markNavDirty(state);
  state.civ.transport.paved++;
  if (state.civ.transport.paved <= 3 || state.civ.transport.paved % 10 === 0) record(state, 'construction', `${r.name} was resurfaced from ${ROAD_KINDS[was].label.toLowerCase()} to ${ROAD_KINDS[target].label.toLowerCase()} (${cost} coins).`, {}, 1);
}

/** Recent trips across a road's cells (from the traffic the villagers' own routes recorded). */
function roadTraffic(r, nav) {
  let n = 0;
  for (const [cell, v] of Object.entries(nav.traffic ?? {})) {
    const i = Number(cell);
    if (Math.abs(cellX(i) - r.x) <= r.w / 2 + 1 && Math.abs(cellZ(i) - r.z) <= r.d / 2 + 1) n += v;
  }
  return n;
}

export function transportSummary(state) {
  const t = state.civ?.transport ?? { trips: {}, paved: 0 };
  return { freight: freightMode(state), regional: regionalFactor(state).factor, trips: t.trips, paved: t.paved, roads: state.roads.length, station: hasStation(state) };
}
