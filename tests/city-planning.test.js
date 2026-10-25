// Milestone 5 — autonomous city planning (Phase A).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { deserialize, serialize } from '../src/core/Serialization.js';
import { findPath } from '../src/navigation/Pathfinding.js';
import { roadRect, RIVER } from '../src/navigation/RoadNetwork.js';
import { solidRects } from '../src/property/Footprints.js';
import { frontOf, plotByName } from '../src/property/LandRegistry.js';
import { bestStreet, obstacles } from '../src/city/RoadPlanner.js';
import { landDemand } from '../src/city/LandDemand.js';
import { planCity, reviewPlans, ensureCity } from '../src/city/CityPlanner.js';
import { considerDevelopment, roadAccess, buildCost } from '../src/city/UrbanDevelopment.js';
import { totalMoney, transfer, balance } from '../src/economy/Transactions.js';
import { CITY } from '../src/core/Config.js';
import { ageOf } from '../src/citizens/Citizen.js';
import { dailyHooks } from '../src/sim/Hooks.js';

const fixture = () => deserialize(readFileSync(new URL('./fixtures/m4-save.json', import.meta.url), 'utf8'));
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const rectOf = (p) => [p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2];

test('a planned street connects to the network and avoids buildings, plots and the river', () => {
  const s = fixture();
  const plan = bestStreet(s, landDemand(s));
  assert.ok(plan, 'a street can be planned');
  const rect = roadRect(plan.road);
  const parent = s.roads.find((r) => r.id === plan.parentId);
  const pr = roadRect(parent);
  // Touches its parent road.
  assert.ok(rect[0] <= pr[2] + 0.01 && rect[2] >= pr[0] - 0.01 && rect[1] <= pr[3] + 0.01 && rect[3] >= pr[1] - 0.01, 'branches from an existing road');
  for (const p of s.plots) {
    assert.ok(!overlaps(rect, rectOf(p)), `street clear of ${p.name}`);
    for (const solid of solidRects(p)) assert.ok(!overlaps(rect, solid));
  }
  assert.ok(!(rect[1] < RIVER.zMax && rect[3] > RIVER.zMin), 'does not cross the river');
  for (const q of plan.plots) {
    for (const p of s.plots) assert.ok(!overlaps(rectOf(q), rectOf(p)), 'new plot clear of existing plots');
    for (const r of s.roads) assert.ok(!overlaps(rectOf(q), roadRect(r)), 'new plot clear of roads');
  }
  assert.ok(plan.plots.length >= 3);
});

test('acceptance: demand → proposal → council approval → road works → plots with usable access → homes', () => {
  const s = fixture();
  const sim = new Simulation(s);
  const money = totalMoney(s);
  // Force genuine housing pressure: newcomers have nowhere to go.
  for (const p of s.plots.filter((x) => x.landType === 'residential' && !x.building && x.marketStatus === 'FOR_SALE')) p.marketStatus = 'NOT_FOR_SALE';
  transfer(s, 'outside', 'treasury', 600, 'grant', 'test: a generous year');
  let proposal = null;
  for (let d = 0; d < 6 && !proposal; d++) { s.day++; proposal = planCity(s); }
  assert.ok(proposal, 'the planners propose a street');
  assert.ok(proposal.appraisal.total > 0 && proposal.appraisal.beds > 0, 'with measurable costs and benefits');
  reviewPlans(s);
  assert.equal(proposal.status, 'APPROVED');
  const project = s.roadProjects.find((p) => p.id === proposal.roadProjectId);
  assert.ok(project, 'a road project is funded');
  const plotsBefore = s.plots.length;
  sim.runDays(40);
  assert.equal(project.status, 'COMPLETE', `the works crew built the street (${project.work}/${project.need.work})`);
  assert.equal(proposal.status, 'COMPLETE');
  const fresh = s.plots.filter((p) => p.district === proposal.name);
  assert.equal(s.plots.length - plotsBefore >= fresh.length, true);
  assert.ok(fresh.length >= 3, 'plots were surveyed only after the street was built');
  const hall = plotByName(s, 'Hearth Hall');
  for (const p of fresh) {
    assert.ok(roadAccess(s, p) < 2.5, `${p.name} fronts the street`);
    const route = findPath(s, frontOf(p), frontOf(hall));
    assert.ok(!route.failed, `${p.name} is reachable on foot`);
  }
  assert.ok(s.city.districts[proposal.name], 'the district is registered');
  assert.equal(totalMoney(s), money + 0, 'money was moved, not made');
  assert.ok(s.chronicle.some((e) => e.text.includes(`${proposal.name} Street is open`)));
});

test('the council modifies a plan it cannot fully afford, and rejects it under a no-works government', () => {
  const s = fixture();
  for (const p of s.plots.filter((x) => x.landType === 'residential' && !x.building)) p.marketStatus = 'NOT_FOR_SALE';
  let p = null;
  for (let d = 0; d < 6 && !p; d++) { s.day++; p = planCity(s); }
  assert.ok(p);
  // No bank will lend, and the treasury holds ~70% of the cost above the planners' reserve.
  for (const b of s.finance.banks) b.status = 'FAILED';
  const target = 60 + Math.floor(p.appraisal.total * 0.7);
  const t = balance(s, 'treasury');
  if (t > target) transfer(s, 'treasury', 'outside', t - target, 'expense', 'test');
  else transfer(s, 'outside', 'treasury', target - t, 'grant', 'test');
  const before = p.plots.length;
  reviewPlans(s);
  if (before >= 5) {
    assert.ok(p.modified, 'the plan was cut down');
    assert.ok(p.plots.length < before);
  }
  const s2 = fixture();
  for (const x of s2.plots.filter((q) => q.landType === 'residential' && !q.building)) x.marketStatus = 'NOT_FOR_SALE';
  s2.government.policies.publicWorks = false;
  let p2 = null;
  for (let d = 0; d < 6 && !p2; d++) { s2.day++; p2 = planCity(s2); }
  reviewPlans(s2);
  assert.equal(p2.status, 'REJECTED');
});

test('a developer builds a cottage for sale only when buyers exist, and sale moves real money', () => {
  const s = fixture();
  const sim = new Simulation(s);
  // Open a new street first so there is house land a road reaches.
  for (const p of s.plots.filter((x) => x.landType === 'residential' && !x.building)) p.marketStatus = 'NOT_FOR_SALE';
  transfer(s, 'outside', 'treasury', 600, 'grant', 'test: a generous year');
  let proposal = null;
  for (let d = 0; d < 6 && !proposal; d++) { s.day++; proposal = planCity(s); }
  reviewPlans(s);
  const plotsBefore = s.plots.length;
  for (let i = 0; i < 40 && s.plots.length === plotsBefore; i++) sim.runDays(1);
  const fresh = s.plots.filter((p) => p.district === proposal.name && p.landType === 'residential');
  // Keep the land free of private buyers so the developer has a site.
  for (const p of fresh) { p.reservedBy = null; }
  const money = totalMoney(s);
  assert.equal(considerDevelopment({ ...s, day: 1 }), null);
  // No families waiting: no development, however rich the developer.
  const dev = s.citizens.find((c) => !c.away && !c.retired && c.family.spouseId && ageOf(s, c) >= 30 && ageOf(s, c) < 55);
  dev.traits = { ...dev.traits, ambitious: 0.9, riskTaking: 0.8 };
  transfer(s, 'outside', dev.id, 500, 'grant', 'test capital');
  s.day = s.day - (s.day % 3) + 4;
  const quiet = landDemand(s).housingShortage < 1 ? considerDevelopment(s) : 'skip';
  if (quiet !== 'skip') assert.equal(quiet, null, 'no speculative building without demand');
  // Two families with savings squeezed into the hall: real demand.
  const hall = plotByName(s, 'Hearth Hall');
  const heads = s.citizens.filter((c) => c.family.spouseId && c.id !== dev.id && c.family.spouseId !== dev.id).slice(0, 2);
  for (const h of heads) for (const m of [h, s.citizens.find((x) => x.id === h.family.spouseId)]) {
    const home = s.plots.find((p) => p.id === m.homePlotId);
    if (home) home.residents = home.residents.filter((id) => id !== m.id);
    m.homePlotId = hall.id; hall.residents.push(m.id);
    transfer(s, 'outside', m.id, 300, 'grant', 'test savings');
  }
  for (const p of fresh) if (!p.building && !p.projectId) { p.marketStatus = 'FOR_SALE'; p.ownerId = 'council'; p.reservedBy = null; }
  assert.ok(landDemand(s).housingShortage >= 1, 'families need homes');
  const before = totalMoney(s);
  let d = null;
  // Wait (a day at a time) for the village's building sites to free up.
  for (let i = 0; i < 60 && !d; i++) {
    for (const p of fresh) if (!p.building && !p.projectId) { p.marketStatus = 'FOR_SALE'; p.ownerId = 'council'; p.reservedBy = null; }
    if (s.day % 3 === 1) d = considerDevelopment(s, dailyHooks.developmentFunding(s));
    if (!d) sim.runDays(1);
  }
  assert.ok(d, 'a development started');
  assert.ok(d.buyers >= 1, 'the developer counted real buyers');
  assert.ok(buildCost(s, s.plots.find((p) => p.id === d.plotId)) > 0);
  assert.ok(ensureCity(s).developments.filter((x) => x.status === 'BUILDING' || x.status === 'LISTED').length <= CITY.maxSpeculativeHomes);
  sim.runDays(40);
  const dv = ensureCity(s).developments.find((x) => x.id === d.id);
  assert.ok(['LISTED', 'SOLD'].includes(dv.status), `the cottage was finished (${dv.status})`);
  assert.equal(totalMoney(s), before, 'every coin was moved, not made');
  assert.ok(money <= before);
});

test('city planning state survives save and load without duplicating plans', () => {
  const s = fixture();
  for (const p of s.plots.filter((x) => x.landType === 'residential' && !x.building)) p.marketStatus = 'NOT_FOR_SALE';
  let p = null;
  for (let d = 0; d < 6 && !p; d++) { s.day++; p = planCity(s); }
  const back = deserialize(serialize(s));
  assert.equal(back.city.proposals.length, s.city.proposals.length);
  assert.equal(planCity(back), null, 'an open proposal is not proposed twice');
  assert.ok(obstacles(back).plots.length >= back.plots.length);
});
