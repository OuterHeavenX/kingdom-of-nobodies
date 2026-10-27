// Regression tests for simulation and citizen fixes: home buyers moving in,
// firefighting, symmetric breakups and divorces, emigration clean-up and
// custody, deterministic outbreaks, read-only gossip, bounded records and
// the guardians' purse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserialize } from '../src/core/Serialization.js';
import { Simulation } from '../src/sim/Simulation.js';
import { EVENTS, SOCIAL, LIFE, DAYS_PER_YEAR, FOOD_GOODS, GOODS } from '../src/core/Config.js';
import { ageOf, createCitizen } from '../src/citizens/Citizen.js';
import { updateCitizen, decide } from '../src/ai/CitizenBrain.js';
import { candidateHooks, generateCandidates } from '../src/ai/DecisionUtility.js';
import { planFor } from '../src/ai/GoalPlanner.js';
import { igniteFire, updateFires, dailyDisasters } from '../src/events/Disasters.js';
import { rel, checkBreakups } from '../src/citizens/Relationships.js';
import { dailyFamilies, divorce, feedInfants } from '../src/citizens/Families.js';
import { emigrate, maybeEmigrate, maybeReturn } from '../src/population/Migration.js';
import { householdOf } from '../src/population/Housing.js';
import { shareGossip } from '../src/society/Gossip.js';
import { balance } from '../src/economy/Transactions.js';
import { addGoods } from '../src/economy/Inventory.js';
import { createBusiness } from '../src/economy/Businesses.js';
import { proposeRoad } from '../src/navigation/RoadConstruction.js';
import { businessDetail } from '../src/ui/BusinessPanel.js';

const FIXTURE = readFileSync(new URL('./fixtures/m5-save.json', import.meta.url), 'utf8');
const town = () => new Simulation(deserialize(FIXTURE));
const adults = (s) => s.citizens.filter((c) => ageOf(s, c) >= LIFE.adultAge && ageOf(s, c) < 60 && !c.away);
const setHour = (s, h) => { s.minute = h * 60; };
const content = (s) => { for (const c of s.citizens) { c.needs = { hunger: 100, energy: 95, social: 100 }; c.health.sickUntil = 0; } };

function spawn(s, { age, firstName = 'Test', parentIds = [], guardianId = null } = {}) {
  const c = createCitizen(s, {
    firstName, lastName: 'Case', age, profession: age < LIFE.adultAge ? 'Child' : 'Laborer', traits: {},
    dream: age < LIFE.adultAge ? { type: 'growing', text: 'Grow up' } : { type: 'wealth', target: 120, text: 'Save 120 coins' },
    parentIds, guardianId, x: 0, z: 0,
  });
  c.familyWish = 0.5;
  return c;
}

/** Mulberry32 advances its state by a constant per draw, so the number of draws between two states is exact. */
function drawsBetween(before, after) {
  const M = 2n ** 32n, k = 0x6d2b79f5n;
  let inv = 1n, base = k, e = M / 2n - 1n; // k^(2^31 - 1) is k's inverse mod 2^32 (k is odd)
  while (e > 0n) { if (e & 1n) inv = (inv * base) % M; base = (base * base) % M; e >>= 1n; }
  const diff = ((BigInt(after) - BigInt(before)) % M + M) % M;
  return Number((diff * inv) % M);
}

test('a buyer of a finished cottage moves the household in', () => {
  const sim = town(), s = sim.state;
  content(s); setHour(s, 10);
  const c = adults(s).find((x) => plotById(s, x.homePlotId)?.ownerId !== x.id);
  const house = s.plots.find((p) => p.building?.type === 'cottage' && p.constructionStatus === 'COMPLETE' && !p.businessId && p.id !== c.homePlotId);
  for (const id of house.residents) { const r = s.citizens.find((x) => x.id === id); if (r) r.homePlotId = null; }
  house.residents = []; house.ownerId = 'council'; house.marketStatus = 'FOR_SALE'; house.price = 40; house.projectId = null;
  s.accounts[c.id] = 500;
  const hook = (state, who) => (who === c ? [{ kind: 'buy_plot', plotId: house.id, home: true, moveIn: true, score: 10000, factors: [['test', 1]] }] : []);
  candidateHooks.propose.push(hook);
  try { c.activity = null; decide(s, c); } finally { candidateHooks.propose.splice(candidateHooks.propose.indexOf(hook), 1); }
  assert.equal(c.activity.kind, 'buy_plot');
  for (let i = 0; i < 300 && c.activity?.kind === 'buy_plot'; i++) updateCitizen(s, c);
  assert.equal(house.ownerId, c.id, 'the cottage was bought');
  assert.equal(c.homePlotId, house.id, 'and the buyer lives there');
  assert.ok(house.residents.includes(c.id));
});

function plotById(s, id) { return s.plots.find((p) => p.id === id) ?? null; }

function fireNear(s, c) {
  const plot = s.plots.find((p) => p.building && !['ruins', 'well'].includes(p.building.type) && !p.projectId);
  c.x = plot.x; c.z = plot.z + plot.d / 2 + 1;
  s.fires = [];
  igniteFire(s, plot);
  return plot;
}

test('an awake neighbour drops what they are doing to fight a fire', () => {
  const sim = town(), s = sim.state;
  content(s); setHour(s, 10);
  const c = adults(s)[0];
  fireNear(s, c);
  c.activity = { kind: 'explore', label: 'Wandering', x: c.x + 40, z: c.z, duration: 50, elapsed: 0, phase: 'travel' };
  updateCitizen(s, c);
  assert.equal(c.activity.kind, 'fight_fire');
});

test('a sleeper next to a fire wakes to fight it', () => {
  const sim = town(), s = sim.state;
  content(s); setHour(s, 2);
  const c = adults(s)[1];
  fireNear(s, c);
  c.needs.energy = 70;
  c.activity = { kind: 'sleep', label: 'Sleeping', x: c.x, z: c.z, duration: 80, elapsed: 5, phase: 'perform' };
  updateCitizen(s, c);
  assert.equal(c.activity.kind, 'fight_fire');
});

test('fires break out through the day, not all at midnight', () => {
  const sim = town(), s = sim.state;
  setHour(s, 0);
  s.fires = [];
  const was = EVENTS.fireDailyPerBuilding;
  EVENTS.fireDailyPerBuilding = 100;
  try { dailyDisasters(s); } finally { EVENTS.fireDailyPerBuilding = was; }
  const burnable = s.plots.filter((p) => p.building && !['ruins', 'well'].includes(p.building.type) && !p.projectId).length;
  assert.ok(burnable > 10);
  assert.ok(s.fires.length < burnable / 2, `only a few fires start at midnight (${s.fires.length} of ${burnable})`);
  const hours = new Set();
  for (let h = 1; h < 24; h++) { setHour(s, h); const n = s.fires.length; updateFires(s); if (s.fires.length > n) hours.add(h); }
  assert.ok(hours.size >= 6, `fires broke out in ${hours.size} different hours`);
});

test('people still fighting a fire count when it is resolved', () => {
  const sim = town(), s = sim.state;
  const c = adults(s)[2];
  const plot = fireNear(s, c);
  c.activity = { kind: 'fight_fire', label: 'Fighting', x: c.x, z: c.z, duration: 5, elapsed: 2, phase: 'perform', plotId: plot.id };
  s.tick += EVENTS.fireDurationTicks;
  updateFires(s);
  assert.ok(c.achievements.some((a) => a.type === 'firefighter'), 'the fighter is credited');
});

test('a burned building leaves ruins of its own era, with a seed', () => {
  const sim = town(), s = sim.state;
  const plot = s.plots.find((p) => p.building && !['ruins', 'well'].includes(p.building.type) && !p.projectId && !p.businessId);
  plot.building.era = 3;
  s.fires = [];
  igniteFire(s, plot);
  s.fires[0].severity = 100;
  plot.building.condition = 1;
  s.tick += EVENTS.fireDurationTicks;
  updateFires(s);
  assert.equal(plot.building.type, 'ruins');
  assert.equal(plot.building.era, 3);
  assert.ok(Number.isInteger(plot.building.seed));
});

/** Two unmarried adults whose ids sort a < b as strings. */
function pair(s) {
  const singles = adults(s).filter((c) => !c.family.spouseId);
  const [a, b] = singles.slice(0, 2).sort((x, y) => (x.id < y.id ? -1 : 1));
  for (const x of s.citizens) for (const y of [a, b]) {
    if (x.romance.partnerId === y.id || x.romance.courtingId === y.id) { x.romance.partnerId = null; x.romance.courtingId = null; x.family.partnerId = null; }
  }
  return [a, b];
}

test('a courtship ends when the second partner (by id) falls out of love', () => {
  const s = town().state;
  const [a, b] = pair(s);
  a.romance.courtingId = b.id; b.romance.courtingId = a.id; a.romance.since = b.romance.since = s.day;
  Object.assign(rel(s, a.id, b.id), { affection: 85, trust: 70, rivalry: 0 });
  Object.assign(rel(s, b.id, a.id), { affection: 5, trust: 70, rivalry: 0 });
  checkBreakups(s);
  assert.equal(a.romance.courtingId, null);
  assert.equal(b.romance.courtingId, null);
});

function marryPair(s) {
  const [a, b] = pair(s);
  for (const [x, y] of [[a, b], [b, a]]) { x.family.spouseId = y.id; x.family.partnerId = y.id; x.romance.partnerId = y.id; x.romance.engagedTo = null; }
  return [a, b];
}

test('a marriage can end over either spouse\'s feelings', () => {
  const s = town().state;
  const [a, b] = marryPair(s);
  Object.assign(rel(s, a.id, b.id), { affection: 90, trust: 80, rivalry: 0 });
  Object.assign(rel(s, b.id, a.id), { affection: 40, trust: 80, rivalry: 90 });
  for (let i = 0; i < 80 && a.family.spouseId; i++) dailyFamilies(s);
  assert.equal(a.family.spouseId, null, 'the rival-minded spouse ends it');
});

test('in a divorce the parent caring for the children keeps the shared home; separate homes are untouched', () => {
  const s = town().state;
  const [a, b] = marryPair(s);
  const home = s.plots.find((p) => p.building?.type === 'cottage');
  home.ownerId = 'council';
  for (const x of [a, b]) { const old = plotById(s, x.homePlotId); if (old) old.residents = old.residents.filter((id) => id !== x.id); x.homePlotId = home.id; home.residents.push(x.id); }
  const kid = spawn(s, { age: 8, parentIds: [a.id, b.id], guardianId: a.id });
  kid.homePlotId = home.id; home.residents.push(kid.id);
  divorce(s, a, b);
  assert.equal(a.homePlotId, home.id, 'the guardian stays');
  assert.equal(b.homePlotId, null, 'the other spouse moves out');

  const [c, d] = marryPair(s);
  const homes = [c.homePlotId, d.homePlotId];
  if (homes[0] && homes[0] !== homes[1]) {
    divorce(s, c, d);
    assert.deepEqual([c.homePlotId, d.homePlotId], homes, 'nobody is evicted from a home they did not share');
  }
});

test('a fiancé(e) left behind by an emigrant is free again', () => {
  const s = town().state;
  const [a, b] = pair(s);
  a.romance.engagedTo = b.id; b.romance.engagedTo = a.id;
  emigrate(s, b, { why: 'test' });
  assert.ok(!s.citizens.includes(b));
  assert.equal(a.romance.engagedTo, null);
});

test('a parent without custody does not take the child away', () => {
  const s = town().state;
  const [p, g] = pair(s);
  const kid = spawn(s, { age: 9, parentIds: [p.id, g.id], guardianId: g.id });
  assert.ok(!householdOf(s, p).includes(kid), 'not in the non-custodial parent\'s household');
  assert.ok(householdOf(s, g).includes(kid), 'in the guardian\'s household');
  emigrate(s, p, { why: 'test' });
  assert.ok(s.citizens.includes(kid), 'the child stays with the guardian');
});

test('the spouse of a founder does not emigrate (and take the founder along)', () => {
  const s = town().state;
  const founder = s.citizens.find((c) => c.founder);
  const old = s.citizens.find((x) => x.id === founder.family.spouseId);
  if (old) old.family.spouseId = old.family.partnerId = old.romance.partnerId = null;
  const c = spawn(s, { age: 30 });
  for (const [x, y] of [[c, founder], [founder, c]]) { x.family.spouseId = y.id; x.family.partnerId = y.id; x.romance.partnerId = y.id; }
  for (const o of s.citizens) if (o !== c) o.away = { reason: 'test' };
  c.mood = 0; c.unhappyDays = 50;
  for (let i = 0; i < 200 && s.citizens.includes(c); i++) maybeEmigrate(s);
  assert.ok(s.citizens.includes(founder), 'the founder is still here');
});

test('only the household that left together comes back together', () => {
  const s = town().state;
  const region = Object.keys(s.region.settlements)[0];
  const [a, b] = pair(s);
  emigrate(s, a, { why: 'test', destination: region });
  emigrate(s, b, { why: 'test', destination: region });
  for (const id of [a.id, b.id]) s.archive[id].leftDay = s.day - 20;
  Object.assign(s.region.settlements[region], { hunger: 0.6, prosperity: 0.5 });
  s.populationCap = 10000;
  let back = null;
  for (let i = 0; i < 400 && !back; i++) back = maybeReturn(s);
  assert.ok(back, 'someone came home');
  assert.equal(back.length, 1, `one household returned (${back.map((c) => c.firstName).join(', ')})`);
});

test('emigrants grow old and die abroad instead of returning forever', () => {
  const s = town().state;
  const region = Object.keys(s.region.settlements)[0];
  const c = spawn(s, { age: 30 });
  emigrate(s, c, { why: 'test', destination: region });
  const rec = s.archive[c.id];
  rec.birthDay = s.day - 64 * DAYS_PER_YEAR; rec.leftDay = s.day - 20;
  s.populationCap = s.citizens.length; // nobody is drawn home
  for (let i = 0; i < 3000 && !rec.diedAbroad; i++) maybeReturn(s);
  assert.equal(rec.diedAbroad, true);
});

test('outbreak victims are drawn with a fixed number of random draws', () => {
  const draws = (immuneShare) => {
    const s = town().state;
    for (const [i, c] of s.citizens.entries()) { c.health.sickUntil = 0; c.health.immuneUntil = i % 10 < immuneShare * 10 ? s.day + 50 : 0; }
    s.season = { ...(s.season ?? {}), outbreak: null };
    s.day = s.day - (s.day % 3) + 1; // not a new season or year
    const was = [EVENTS.diseaseDailyChance, EVENTS.fireDailyPerBuilding];
    EVENTS.diseaseDailyChance = 1000; EVENTS.fireDailyPerBuilding = 0;
    const before = s.rng;
    try { dailyDisasters(s); } finally { [EVENTS.diseaseDailyChance, EVENTS.fireDailyPerBuilding] = was; }
    assert.ok(s.season.outbreak, 'an outbreak began');
    return drawsBetween(before, s.rng);
  };
  assert.equal(draws(0), draws(0.6), 'the draw count does not depend on how many could fall ill');
});

test('gossip does not create relationship records just by looking', () => {
  const s = town().state;
  const [speaker, listener] = adults(s);
  speaker.traits = { ...speaker.traits, jealous: 0.9, dishonest: 0.9 };
  const was = SOCIAL.rumorShareChance;
  SOCIAL.rumorShareChance = 1;
  const before = Object.keys(s.relationships).length;
  try { for (let i = 0; i < 20; i++) shareGossip(s, speaker, listener); } finally { SOCIAL.rumorShareChance = was; }
  const created = Object.keys(s.relationships).length - before;
  assert.ok(created <= 2, `${created} relationship records were created`);
});

test('a critically hungry child is interrupted to eat from the guardian\'s purse', () => {
  const s = town().state;
  content(s); setHour(s, 10);
  const g = adults(s)[0];
  const kid = spawn(s, { age: 10, parentIds: [g.id], guardianId: g.id });
  kid.x = g.x; kid.z = g.z;
  s.accounts[g.id] = 200; s.accounts[kid.id] = 0;
  kid.needs.hunger = 5;
  const act = { kind: 'lessons', label: 'Lessons', x: kid.x + 30, z: kid.z, duration: 18, elapsed: 0, phase: 'travel' };
  kid.activity = act;
  updateCitizen(s, kid);
  assert.notEqual(kid.activity, act, 'the lesson was dropped');
});

test('help for a hungry child goes to the guardian who buys the food', () => {
  const s = town().state;
  content(s); setHour(s, 10);
  const [helper, g] = adults(s).filter((c) => !c.family.spouseId);
  helper.traits = { ...helper.traits, generous: 0.9 };
  s.accounts[helper.id] = 100;
  const kid = spawn(s, { age: 8, parentIds: [g.id], guardianId: g.id });
  for (const c of s.citizens) if (c !== kid) s.accounts[c.id] = Math.max(10, s.accounts[c.id] ?? 0);
  s.accounts[helper.id] = 100; s.accounts[g.id] = 0; s.accounts[kid.id] = 0;
  kid.needs.hunger = 30;
  const help = generateCandidates(s, helper, planFor(s, helper)).find((k) => k.kind === 'help');
  assert.ok(help, 'there is someone to help');
  assert.equal(help.payeeId, g.id);
});

test('feeding a baby books what the guardian actually paid', () => {
  const s = town().state;
  const g = adults(s)[0];
  const baby = spawn(s, { age: 0, parentIds: [g.id], guardianId: g.id });
  for (const f of FOOD_GOODS) { g.inventory[f] = 0; s.council.pantry[f] = 0; }
  for (const b of s.businesses) for (const f of FOOD_GOODS) if (b.inventory[f]) b.inventory[f] = 0;
  const seller = s.businesses.find((b) => b.status === 'OPEN');
  const dear = FOOD_GOODS.find((f) => GOODS[f].base > 3);
  addGoods(seller.inventory, dear, 3);
  s.accounts[g.id] = 50;
  for (const c of s.citizens) if (c !== baby && ageOf(s, c) < 3) c.birthDay = s.day - 5 * DAYS_PER_YEAR;
  const paidBefore = balance(s, g.id), revBefore = seller.today.revenue;
  feedInfants(s);
  const paid = paidBefore - balance(s, g.id);
  assert.ok(paid > 1, `a dear food cost ${paid}`);
  assert.equal(seller.today.revenue - revBefore, paid);
});

test('long-closed businesses move to an archive that panels can still open', () => {
  const sim = town(), s = sim.state;
  const close = (b) => Object.assign(b, { status: 'CLOSED', closedDay: s.day - 20 * DAYS_PER_YEAR, compact: true, employees: [] });
  const b = close(createBusiness(s, { type: 'bakery', ownerId: adults(s)[0].id, plotId: s.plots[1].id, name: 'Old Crust Bakery' }));
  // A closed business still named in a live court case or contract stays where those systems look for it.
  const cited = s.businesses.find((x) => JSON.stringify(s.law ?? {}).includes(`"${x.id}"`));
  if (cited) { for (const p of s.plots) if (p.businessId === cited.id) p.businessId = null; for (const c of s.citizens) if (c.employment?.businessId === cited.id) c.employment = null; close(cited); }
  s.day = Math.ceil((s.day + 1) / DAYS_PER_YEAR) * DAYS_PER_YEAR + 1; // the first day of a year
  sim.startOfDay();
  assert.ok(!s.businesses.some((x) => x.id === b.id), 'no longer scanned with the live businesses');
  assert.ok(businessDetail(sim, b.id).html.includes('Old Crust Bakery'), 'its page still opens');
  if (cited) assert.ok(s.businesses.includes(cited), 'a business named in a live case is kept');
});

test('rejected road proposals do not pile up while no road is finished', () => {
  const s = town().state;
  s.roadProjects = s.roadProjects ?? [];
  for (let i = 0; i < 60; i++) s.roadProjects.push({ id: `rx${i}`, name: `Old Lane ${i}`, status: 'REJECTED', kind: 'dirt', x: 0, z: 0, w: 1, d: 1 });
  proposeRoad(s, { name: 'Test Lane', kind: 'dirt', x: 0, z: 0, w: 2, d: 2, reason: 'test' });
  assert.ok(s.roadProjects.filter((p) => p.status === 'REJECTED').length <= 30);
});


test('sim fixes: after archiving, a business opened the same day is still found by id', async () => {
  const { archiveClosedBusinesses } = await import('../src/sim/BusinessArchive.js');
  const { byId } = await import('../src/core/EntityRegistry.js');
  const { makeSim } = await import('./helpers.js');
  const { state: s } = makeSim(2);
  const long = { id: 'b9001', name: 'Old Shop', status: 'CLOSED', compact: true, closedDay: -1000, employees: [], inventory: {} };
  s.businesses.push(long);
  s.accounts[long.id] = 0;
  assert.equal(byId(s.businesses, long.id), long, 'index built with the old shop');
  assert.equal(archiveClosedBusinesses(s), 1);
  const fresh = { id: 'b9002', name: 'New Shop', status: 'TRADING', employees: [], inventory: {} };
  s.businesses.push(fresh); // back to the length the index was built at
  assert.equal(byId(s.businesses, fresh.id), fresh);
  assert.equal(byId(s.businesses, long.id), null);
});
