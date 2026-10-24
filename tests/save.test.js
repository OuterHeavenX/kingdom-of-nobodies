import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, byName } from './helpers.js';
import { serialize, deserialize, migrateMilestone1 } from '../src/core/Serialization.js';
import { Simulation } from '../src/sim/Simulation.js';
import { rel } from '../src/citizens/Relationships.js';
import { totalMoney } from '../src/economy/Transactions.js';

test('10. relationships, businesses and construction persist through save/load', () => {
  const sim = makeSim(2);
  sim.runDays(20);
  const s = sim.state;
  const ada = byName(s, 'Ada'), elin = byName(s, 'Elin');
  const before = { ...rel(s, ada.id, elin.id) };
  const loaded = deserialize(serialize(s));
  assert.deepEqual(loaded.relationships[`${ada.id}|${elin.id}`], before);
  assert.equal(JSON.stringify({ ...loaded, events: [] }), JSON.stringify({ ...s, events: [] }));
});

test('a reloaded world continues exactly as if it never stopped (mid-construction and trading)', () => {
  const a = makeSim(1);
  a.runDays(14);
  assert.ok(a.state.projects.length > 0 || a.state.chronicle.some((e) => /began/.test(e.text)));
  const b = new Simulation(deserialize(serialize(a.state)));
  a.runDays(10);
  b.runDays(10);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
});

test('damaged save files are rejected instead of loaded', () => {
  const sim = makeSim();
  const text = serialize(sim.state);
  const env = JSON.parse(text);
  env.data = env.data.replace('"day":1', '"day":2');
  assert.throws(() => deserialize(JSON.stringify(env)), /damaged/);
  assert.throws(() => deserialize('{"hello":1}'), /not a Kingdom/);
  assert.throws(() => deserialize('not json'), /not valid JSON/);
});

test('14. Milestone 1 saves migrate safely', () => {
  const m1 = {
    version: 2, day: 6, hour: 14.5, tick: 900, food: 42, wood: 23, gold: 31,
    chronicle: [{ day: 5, message: 'Cottage 1 was constructed. The village is growing.' }, { day: 1, message: 'Five strangers lit the first hearth. Their story begins.' }],
    buildings: [{ id: 1, type: 'hall' }, { id: 11, type: 'cottage', name: 'Cottage 1', x: -17, z: 13 }],
    people: ['Ada', 'Bram', 'Cora', 'Dain', 'Elin'].map((name, id) => ({
      id, name, job: 'Farmer', trait: 'Friendly', hunger: 40 + id, energy: 50, social: 60, mood: 65 + id, x: id, z: -id,
      friendships: id === 0 ? { 4: 3 } : {},
    })),
  };
  const s = deserialize(JSON.stringify(m1));
  assert.equal(s.version, 3);
  assert.equal(s.day, 6);
  assert.deepEqual(s.citizens.map((c) => c.firstName), ['Ada', 'Bram', 'Cora', 'Dain', 'Elin']);
  assert.equal(Math.round(s.citizens[2].needs.hunger), 42);
  assert.equal(Math.round(s.citizens[4].mood), 69);
  assert.ok(s.relationships[`${s.citizens[0].id}|${s.citizens[4].id}`].friendship > 30, 'friendship carried over');
  assert.equal(s.accounts.treasury, makeSim().state.accounts.treasury + 31, 'old treasury carried over');
  assert.ok(s.plots.some((p) => p.building?.type === 'cottage'), 'cottage preserved');
  assert.ok(s.chronicle.some((e) => e.legacy && /Cottage 1/.test(e.text)));
  const money = totalMoney(s);
  const sim = new Simulation(s);
  sim.runDays(5);
  assert.equal(totalMoney(sim.state), money);
  assert.ok(migrateMilestone1({ version: 2, people: [] }).citizens.length === 5, 'tolerates empty data');
});
