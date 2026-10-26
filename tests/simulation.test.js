import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, byName, bizByName, totalMoney, badNumbers } from './helpers.js';
import { layOff } from '../src/economy/Employment.js';
import { GameClock } from '../src/core/GameClock.js';
import { TIME } from '../src/core/Config.js';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { isTrading } from '../src/economy/Businesses.js';
import { villageFood } from '../src/economy/Marketplace.js';

test('the five founders keep their identities', () => {
  const { state } = makeSim();
  assert.deepEqual(state.citizens.map((c) => c.firstName), ['Ada', 'Bram', 'Cora', 'Dain', 'Elin']);
  assert.equal(byName(state, 'Bram').profession, 'Woodcutter');
  assert.ok(byName(state, 'Bram').traits.ambitious > 0.8);
});

test('every decision carries an explanation derived from its scoring factors', () => {
  const sim = makeSim();
  sim.runTicks(30);
  for (const c of sim.state.citizens) {
    assert.ok(c.decision.reason.length > 10, `${c.firstName} explains: ${c.decision.reason}`);
    assert.ok(Number.isFinite(c.decision.score));
    assert.ok(c.plan.goal);
  }
});

test('11. chronicle entries reflect real state changes', () => {
  const sim = makeSim(3);
  sim.runDays(45);
  const s = sim.state;
  for (const e of s.chronicle) {
    if (/officially opened/.test(e.text)) {
      const b = s.businesses.find((x) => x.id === e.refs.business);
      assert.ok(b, `business exists for: ${e.text}`);
      assert.ok(e.text.startsWith(b.name));
    }
    if (/purchased/.test(e.text) && e.refs.plot) {
      const plot = s.plots.find((p) => p.id === e.refs.plot);
      assert.ok(plot.history.some((h) => /Sold by/.test(h.text)), `plot history records: ${e.text}`);
    }
  }
  assert.ok(s.chronicle.some((e) => /officially opened/.test(e.text)), 'at least one business opened');
});

test('12. citizens keep making valid decisions after losing their job', () => {
  const sim = makeSim();
  const woodlot = bizByName(sim.state, 'Village Woodlot');
  const fired = layOff(sim.state, woodlot, 'test');
  assert.equal(fired.firstName, 'Bram');
  assert.equal(fired.employment, null);
  sim.runDays(3);
  assert.ok(fired.activity, 'still active');
  assert.ok(fired.decision.day >= 3, 'still deciding');
  const kinds = new Set();
  const s2 = makeSim();
  layOff(s2.state, bizByName(s2.state, 'Village Woodlot'), 'test');
  for (let i = 0; i < 144 * 3; i++) { s2.step(); kinds.add(byName(s2.state, 'Bram').decision.action); }
  assert.ok(kinds.has('seek_job') || kinds.has('forage') || byName(s2.state, 'Bram').employment, `adapted: ${[...kinds].join(',')}`);
});

test('13. the simulation is identical at 1× and 6× speed', () => {
  const a = new Simulation(createKingdom(11));
  const b = new Simulation(createKingdom(11));
  const ca = new GameClock(() => a.step());
  const cb = new GameClock(() => b.step());
  cb.speed = 6;
  // 6× for 10 seconds of frames == 1× for 60 seconds of frames (1/16 s frames are exact in binary).
  for (let i = 0; i < 160; i++) cb.advance(1 / 16);
  for (let i = 0; i < 960; i++) ca.advance(1 / 16);
  assert.equal(a.state.tick, 240);
  assert.equal(a.state.tick, b.state.tick);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
});

test('the simulation is identical at ¼× and 1× speed, and the speed button cycles through ¼×', () => {
  const a = new Simulation(createKingdom(12));
  const b = new Simulation(createKingdom(12));
  const ca = new GameClock(() => a.step());
  const cb = new GameClock(() => b.step());
  cb.speed = 0.25;
  // ¼× for 60 seconds of frames == 1× for 15 seconds of frames.
  for (let i = 0; i < 960; i++) cb.advance(1 / 16);
  for (let i = 0; i < 240; i++) ca.advance(1 / 16);
  assert.equal(b.state.tick, 60, 'one tick a second at ¼×');
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  const clock = new GameClock(() => {});
  const seen = [];
  for (let i = 0; i < 5; i++) { clock.cycleSpeed(); seen.push(clock.speed); }
  assert.deepEqual(seen, [3, 6, 20, 0.25, 1], 'starts at 1×, and ¼× comes after 20×');
});

test('the clock pauses and never silently fast-forwards after a stall', () => {
  let ticks = 0;
  const clock = new GameClock(() => ticks++);
  clock.togglePause();
  clock.advance(5);
  assert.equal(ticks, 0);
  clock.togglePause();
  clock.speed = 6;
  clock.advance(30); // a 30 second freeze
  assert.ok(ticks <= TIME.maxTicksPerFrame);
});

test('100-day kingdom runs without rendering and stays healthy', () => {
  for (const seed of [1, 4, 8]) {
    const sim = new Simulation(createKingdom(seed));
    const money = totalMoney(sim.state);
    let minOpen = Infinity;
    for (let d = 0; d < 100; d++) {
      sim.runDays(1);
      const s = sim.state;
      assert.equal(totalMoney(s), money, `money conserved on day ${s.day}`);
      assert.ok(Object.values(s.accounts).every((v) => Number.isInteger(v) && v >= 0), 'no negative balances');
      for (const b of s.businesses) for (const v of Object.values(b.inventory)) assert.ok(Number.isInteger(v) && v >= 0);
      minOpen = Math.min(minOpen, s.businesses.filter(isTrading).length);
      // Deadlock detection: food must remain obtainable somewhere.
      assert.ok(villageFood(s) > 0 || s.commons.berries > 0, `food exists on day ${s.day}`);
    }
    const s = sim.state;
    assert.deepEqual(badNumbers(s), [], 'no NaN or Infinity');
    assert.ok(minOpen >= 1, 'economy never fully shuts down');
    for (const c of s.citizens) assert.ok(c.decision.day >= 99, `${c.firstName} still making decisions`);
    assert.ok(s.chronicle.some((e) => /officially opened/.test(e.text)), `seed ${seed}: businesses open`);
    assert.ok(s.chronicle.some((e) => /purchased/.test(e.text)), `seed ${seed}: property changes hands`);
    assert.ok(s.citizens.length > 5, 'the village grows');
  }
});

test('across seeds, businesses both open and fail', () => {
  let opened = 0, failed = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = new Simulation(createKingdom(seed));
    sim.runDays(100);
    opened += sim.state.chronicle.filter((e) => /officially opened/.test(e.text)).length;
    failed += sim.state.businesses.filter((b) => b.status === 'CLOSED' || b.status === 'BANKRUPT').length;
  }
  assert.ok(opened > 6);
  assert.ok(failed > 0);
});

test('acceptance: Bram saves, buys land, builds and opens a lumberyard', () => {
  const sim = makeSim(1);
  const bram = byName(sim.state, 'Bram');
  sim.runDays(60);
  const text = sim.state.chronicle.filter((e) => e.refs.citizens.includes(bram.id)).map((e) => e.text).join('\n');
  assert.match(text, /Bram purchased/);
  assert.match(text, /Bram began a lumberyard/);
  assert.match(text, /Bram's Lumberyard officially opened/);
  const yard = sim.state.businesses.find((b) => b.ownerId === bram.id && b.type === 'lumberyard');
  assert.ok(yard.totals.produced > 0, 'it produces timber');
  assert.ok(yard.totals.revenue > 0, 'it sells timber');
  assert.ok(sim.state.ledger.length > 0);
});
