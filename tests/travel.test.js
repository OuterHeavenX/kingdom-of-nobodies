// Milestone 5 — named foreign citizens, rulers and travel between kingdoms (Phase B, simulation side).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { deserialize, serialize } from '../src/core/Serialization.js';
import { KINGDOMS } from '../src/region/RegionData.js';
import { peopleOf, rulerOf, rulerPriorities, sendTraveller, foreignById, noteVisit, whereabouts } from '../src/region/ForeignCitizenManager.js';
import { caravanPosition } from '../src/trade/Caravans.js';

const fixture = () => deserialize(readFileSync(new URL('./fixtures/m4-save.json', import.meta.url), 'utf8'));

test('every kingdom has a ruler, merchants, a guild master, a faith keeper and residents with stable identities', () => {
  const s = fixture();
  for (const kid of Object.keys(KINGDOMS)) {
    const people = peopleOf(s, kid);
    const roles = new Set(people.map((p) => p.role));
    for (const r of ['ruler', 'merchant', 'guild', 'faith', 'notable', 'craft', 'resident']) assert.ok(roles.has(r), `${kid} has a ${r}`);
    const ruler = rulerOf(s, kid);
    assert.equal(`${ruler.firstName} ${ruler.lastName}`, s.region.settlements[kid].leader.name, 'the named ruler is the kingdom\'s leader');
    assert.ok(rulerPriorities(s, kid).length >= 1);
  }
  const ids = Object.keys(s.foreign.people);
  assert.equal(new Set(ids).size, ids.length);
});

test('named foreign citizens keep their identities across years and reloads; rulers stay consistent', () => {
  const sim = new Simulation(createKingdom(11));
  const s = sim.state;
  const merchant = peopleOf(s, 'greenvale').find((p) => p.role === 'merchant');
  const snapshot = { id: merchant.id, name: `${merchant.firstName} ${merchant.lastName}`, born: merchant.birthDay };
  sim.runDays(12 * 4);
  const back = deserialize(serialize(s));
  const again = foreignById(back, snapshot.id) ?? back.foreign.departed.find((d) => d.id === snapshot.id);
  assert.ok(again, 'the merchant is the same person (or remembered among the departed)');
  if (again.firstName) { assert.equal(`${again.firstName} ${again.lastName}`, snapshot.name); assert.equal(again.birthDay, snapshot.born); }
  for (const kid of Object.keys(KINGDOMS)) {
    const r = rulerOf(back, kid);
    assert.ok(r && r.status === 'alive', `${kid} has a living named ruler`);
    assert.equal(`${r.firstName} ${r.lastName}`, back.region.settlements[kid].leader.name);
  }
});

test('travellers take time on real roads instead of teleporting', () => {
  const s = fixture();
  const sim = new Simulation(s);
  const p = peopleOf(s, 'ironhold', { includeAway: false }).find((x) => x.role === 'resident');
  assert.ok(sendTraveller(s, p, 'saltmere', 'migration'));
  assert.equal(p.location, null, 'on the road, in no kingdom');
  assert.match(whereabouts(s, p), /on the road to Saltmere/);
  const due = p.travel.arriveDay;
  assert.ok(due > s.day, 'arrival takes days');
  sim.runDays(due - s.day - 1);
  assert.equal(p.location, null, 'still travelling the day before');
  sim.runDays(2);
  assert.equal(p.location, 'saltmere');
  assert.equal(p.kingdom, 'saltmere', 'and settled there');
});

test('foreign merchant houses send named merchants with their caravans, who come home with them', () => {
  const sim = new Simulation(createKingdom(5));
  const s = sim.state;
  let led = null;
  for (let d = 0; d < 200 && !led; d++) { sim.runDays(1); led = s.trade.caravans.find((c) => c.leadId && c.status !== 'COMPLETED' && c.status !== 'CANCELLED'); }
  assert.ok(led, 'a caravan is led by a named merchant');
  const m = foreignById(s, led.leadId);
  assert.equal(m.travel.caravanId, led.id);
  assert.ok(Number.isFinite(caravanPosition(led).x));
  for (let d = 0; d < 60 && m.travel; d++) sim.runDays(1);
  assert.equal(m.travel, null, 'the merchant came home when the caravan did');
  assert.equal(m.location, m.kingdom);
  assert.ok(m.trips >= 1);
});

test('visits are recorded and do not change the world', () => {
  const s = fixture();
  const before = JSON.stringify(s.region);
  const v = noteVisit(s, 'ironhold');
  assert.equal(v.count, 1);
  noteVisit(s, 'ironhold');
  assert.equal(s.foreign.visits.ironhold.count, 2);
  assert.equal(JSON.stringify(s.region), before, 'visiting changes nothing in the simulation');
});
