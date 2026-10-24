// Milestone 4 — navigation and roads (brief items 1–6, plus road building).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { findPath, routeCost } from '../src/navigation/Pathfinding.js';
import { navGrid, markNavDirty } from '../src/navigation/NavigationGrid.js';
import { addRoad, RIVER } from '../src/navigation/RoadNetwork.js';
import { solidRects } from '../src/property/Footprints.js';
import { plotByName } from '../src/property/LandRegistry.js';
import { considerRoads, approveRoads, workOnRoad, estimate } from '../src/navigation/RoadConstruction.js';
import { balance, transfer } from '../src/economy/Transactions.js';
import { addGoods } from '../src/economy/Inventory.js';

const fresh = (seed = 3) => new Simulation(createKingdom(seed));

/** Sample every leg of a route; return the first point inside a solid building, if any. */
function wallHit(state, from, points) {
  let x = from.x, z = from.z;
  for (const [px, pz] of points) {
    for (let t = 0; t <= 1; t += 0.02) {
      const sx = x + (px - x) * t, sz = z + (pz - z) * t;
      for (const p of state.plots) for (const [a, b, c, d] of solidRects(p)) if (sx > a + 0.05 && sx < c - 0.05 && sz > b + 0.05 && sz < d - 0.05) return { sx, sz, plot: p.name };
    }
    x = px; z = pz;
  }
  return null;
}

test('1. routes go around buildings, never through them', () => {
  const s = fresh().state;
  const hall = plotByName(s, 'Hearth Hall');
  const [minX, minZ, maxX, maxZ] = solidRects(hall)[0];
  const from = { x: (minX + maxX) / 2, z: minZ - 2 }, to = { x: (minX + maxX) / 2, z: maxZ + 2 };
  const route = findPath(s, from, to);
  assert.ok(!route.failed);
  assert.ok(route.points.length >= 2, 'the route bends around the hall');
  assert.equal(wallHit(s, from, route.points), null);
  // And in a running village, nobody travelling is ever inside a wall.
  const sim = fresh(1);
  for (let i = 0; i < 4 * 144; i++) {
    sim.step();
    for (const c of sim.state.citizens) {
      if (c.activity?.phase !== 'travel' || !c.activity.path) continue;
      assert.equal(wallHit(sim.state, c, c.activity.path.slice(c.activity.wp)), null, `${c.firstName}'s route stays outside buildings`);
    }
  }
});

test('2. roads reduce travel costs', () => {
  const s = fresh().state;
  const from = { x: -60, z: -50 }, to = { x: 60, z: -50 };
  const before = routeCost(s, from, findPath(s, from, to).points);
  markNavDirty(s);
  addRoad(s, { name: 'Test Road', kind: 'stone', x: 0, z: -50, w: 124, d: 2.4 });
  const after = routeCost(s, from, findPath(s, from, to).points);
  assert.ok(after < before * 0.6, `paved route is cheaper (${after.toFixed(1)} vs ${before.toFixed(1)})`);
});

test('3. paths update when obstacles appear or are demolished', () => {
  const s = fresh().state;
  const plot = plotByName(s, 'North Lane');
  const from = { x: plot.x - 7, z: plot.z }, to = { x: plot.x + 7, z: plot.z };
  const open = findPath(s, from, to);
  assert.equal(open.points.length, 1, 'open ground: a straight line');
  plot.building = { type: 'tavern', level: 1, condition: 100 };
  markNavDirty(s);
  const around = findPath(s, from, to);
  assert.ok(around.points.length > 1, 'a new building forces a detour');
  assert.equal(wallHit(s, from, around.points), null);
  plot.building = null;
  markNavDirty(s);
  assert.equal(findPath(s, from, to).points.length, 1, 'demolition reopens the straight line');
});

test('4. unreachable destinations fail safely and nobody freezes', () => {
  const sim = fresh();
  const s = sim.state;
  assert.ok(findPath(s, { x: 0, z: 0 }, { x: 400, z: 0 }).failed);
  const c = s.citizens[0];
  c.activity = { kind: 'explore', label: 'Wandering', x: 400, z: 0, duration: 4, elapsed: 0, phase: 'travel' };
  sim.step();
  assert.notEqual(c.activity?.x, 400, 'the impossible trip was abandoned and a new choice made');
  assert.equal(s.navigation.failures, 1);
  assert.match(s.navigation.recentFailures[0].reason, /valley/);
});

test('5. the river is crossed only at the ford or a bridge', () => {
  const s = fresh().state;
  const north = { x: 20, z: RIVER.zMin - 4 }, south = { x: 20, z: RIVER.zMax + 4 };
  const viaFord = findPath(s, north, south);
  assert.ok(!viaFord.failed, 'the ford connects the banks');
  assert.ok(viaFord.points.some(([x]) => Math.abs(x) < 3), 'the route uses the ford');
  const fordCost = routeCost(s, north, viaFord.points);
  s.roads = s.roads.filter((r) => r.kind !== 'ford');
  markNavDirty(s);
  assert.ok(findPath(s, north, south).failed, 'without a crossing the banks are cut off');
  addRoad(s, { name: 'Bridge', kind: 'bridge', x: 20, z: (RIVER.zMin + RIVER.zMax) / 2, w: 3.2, d: RIVER.zMax - RIVER.zMin + 2 });
  const viaBridge = findPath(s, north, south);
  assert.ok(!viaBridge.failed);
  assert.ok(routeCost(s, north, viaBridge.points) < fordCost, 'the bridge is quicker than wading');
});

test('6. navigation stays valid after save and load', () => {
  const sim = fresh(1);
  sim.runDays(3);
  const s = sim.state;
  const loaded = deserialize(serialize(s, 'test'));
  assert.equal(navGrid(loaded).version, navGrid(s).version, 'the same town gives the same grid');
  assert.deepEqual(loaded.roads, s.roads);
  const copy = new Simulation(loaded);
  for (let i = 0; i < 200; i++) { sim.step(); copy.step(); }
  assert.equal(JSON.stringify(copy.state.citizens.map((c) => [c.x, c.z])), JSON.stringify(sim.state.citizens.map((c) => [c.x, c.z])));
});

test('roads are proposed for reasons, approved, paid for and built over several shifts', () => {
  const sim = fresh(1);
  const s = sim.state;
  // A cottage far from any road: its owner petitions for a path.
  const plot = plotByName(s, 'Forge Yard');
  plot.building = { type: 'cottage', level: 1, condition: 100 };
  plot.residents = [s.citizens[0].id];
  s.day = 4;
  considerRoads(s);
  const p = s.roadProjects.find((x) => x.name.startsWith('Forge Yard'));
  assert.ok(p, 'a path was proposed');
  assert.match(p.reason, /no road to its door/);
  transfer(s, 'outside', 'treasury', 400, 'test', 'funds');
  approveRoads(s);
  assert.equal(p.status, 'BUILDING');
  const treasury = balance(s, 'treasury');
  const worker = s.citizens[1];
  let shifts = 0;
  while (p.status === 'BUILDING' && shifts < 50) { workOnRoad(s, worker); shifts++; }
  assert.equal(p.status, 'COMPLETE');
  assert.ok(shifts >= 3, `took ${shifts} shifts, not one`);
  assert.ok(balance(s, 'treasury') < treasury, 'the council paid for it');
  assert.ok(s.roads.some((r) => r.name === p.name), 'the road now exists');
  // Stone roads wait for stone, which only trade brings.
  const need = estimate('stone', 20, 2.4);
  assert.ok(need.stone > 0);
  addGoods(s.council.stores, 'stone', need.stone);
});
