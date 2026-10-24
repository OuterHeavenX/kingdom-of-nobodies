import { markNavDirty } from './NavCache.js';

// Roads are simulation state, not decoration: each is an axis-aligned strip
// with a surface kind that sets how quickly people and carts move along it.
// The river south of town can be crossed only at its ford, or on a bridge
// once one is built.

export const ROAD_KINDS = {
  footpath: { label: 'Footpath', cost: 0.8, color: '#cdbb94' },
  dirt: { label: 'Dirt road', cost: 0.62, color: '#c9b48e' },
  stone: { label: 'Stone road', cost: 0.48, color: '#b9b2a2' },
  bridge: { label: 'Bridge', cost: 0.5, color: '#9c7a52' },
  ford: { label: 'Ford', cost: 3.2, color: '#8fb4c4' },
};

// Terrain movement costs (1 = open grass).
export const TERRAIN_COST = { grass: 1, rough: 1.6, site: 1.4, water: Infinity };

export const RIVER = { zMin: 72, zMax: 77 };
export const WORLD = { min: -96, max: 96 };

// Where the regional roads leave the valley.
export const GATES = {
  west: { x: -95, z: 0, label: 'West Gate', toward: 'greenvale' },
  north: { x: 0, z: -95, label: 'North Gate', toward: 'ironhold' },
  south: { x: 0, z: 95, label: 'South Gate', toward: 'saltmere' },
};

const FOUNDING_ROADS = [
  ['Market Street', 'stone', 0, 0, 74, 3.2],
  ['Hearth Way', 'stone', 0, 0, 3.2, 52],
  ['Cottage Lane', 'dirt', 0, 15, 38, 2.4],
  ['Meadow Path', 'footpath', -24, 15, 2.2, 10],
  ['Timber Path', 'footpath', 21, -4, 2.2, 6],
  ['East Spur', 'dirt', 32, -1, 6, 2.2],
  ['Greenvale Road', 'dirt', -66.5, 0, 59, 2.6],
  ['Ironhold Road', 'dirt', 0, -61, 2.6, 70],
  ['Saltmere Road', 'dirt', 0, 49, 2.6, 46],
  ['Saltmere Road', 'dirt', 0, 86, 2.6, 18],
  ['The Ford', 'ford', 0, (RIVER.zMin + RIVER.zMax) / 2, 3.2, RIVER.zMax - RIVER.zMin],
];

export function foundingRoads() {
  return FOUNDING_ROADS.map(([name, kind, x, z, w, d], i) => ({ id: 'r' + (i + 1), name, kind, x, z, w, d, builtDay: 1 }));
}

/** Add a road; returns it. Keeps ids unique via state.nextId.road. */
export function addRoad(state, { name, kind, x, z, w, d }) {
  state.nextId.road = Math.max(state.nextId.road ?? 0, state.roads.length) + 1;
  const road = { id: 'r' + state.nextId.road, name, kind, x, z, w, d, builtDay: state.day };
  state.roads.push(road);
  markNavDirty(state);
  return road;
}

export const roadRect = (r) => [r.x - r.w / 2, r.z - r.d / 2, r.x + r.w / 2, r.z + r.d / 2];

/** The best road surface at a point, or null. */
export function roadAt(state, x, z) {
  let best = null;
  for (const r of state.roads) {
    if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2 && (!best || ROAD_KINDS[r.kind].cost < ROAD_KINDS[best.kind].cost)) best = r;
  }
  return best;
}

export const inRiver = (z) => z >= RIVER.zMin && z <= RIVER.zMax;

/** Is there a bridge (not just the ford) across the river? */
export const hasBridge = (state) => state.roads.some((r) => r.kind === 'bridge');
