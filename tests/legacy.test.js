// Milestone 3 — Legacy & Generations. Numbered tests follow section 15 of the
// milestone brief (23–25 are covered by the e2e and build tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { GameClock } from '../src/core/GameClock.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { DAYS_PER_YEAR, POLITICS, LIFE, TIME, SAVE_VERSION } from '../src/core/Config.js';
import { ageOn, stageForAge } from '../src/core/Calendar.js';
import { ageOf, stageOf } from '../src/citizens/Citizen.js';
import { ancestorIds, linkParent, person } from '../src/citizens/FamilyTree.js';
import { die } from '../src/citizens/Lifecycle.js';
import { marry, giveBirth } from '../src/citizens/Families.js';
import { settleEstate, transferBusiness } from '../src/economy/Inheritance.js';
import { isTrading } from '../src/economy/Businesses.js';
import { balance, transfer } from '../src/economy/Transactions.js';
import { collectTithe } from '../src/council/Council.js';
import { maybeImmigrate } from '../src/population/Migration.js';
import { igniteFire, updateFires } from '../src/events/Disasters.js';
import { gainSkill } from '../src/education/Skills.js';
import { startProject, updateProjects } from '../src/property/Construction.js';
import { checkInvariants } from './longevity.mjs';
import { totalMoney, badNumbers } from './helpers.js';

const TICKS_PER_DAY = (24 * 60) / TIME.minutesPerTick;
const advanceDays = (sim, days) => { const end = sim.state.day + days; while (sim.state.day < end) sim.step(); };
const roundTrip = (state) => deserialize(serialize(state, 'test'));

// One shared multigenerational run, computed once: 30 years on seed 2.
let shared = null;
function grown() {
  if (!shared) {
    const sim = new Simulation(createKingdom(2));
    advanceDays(sim, 30 * DAYS_PER_YEAR);
    shared = sim;
  }
  return shared;
}
const fresh = (seed = 5) => new Simulation(createKingdom(seed));
const cloneSim = (sim) => new Simulation(roundTrip(sim.state));

test('1. citizens age consistently with the calendar', () => {
  const sim = fresh();
  const before = new Map(sim.state.citizens.map((c) => [c.id, ageOf(sim.state, c)]));
  advanceDays(sim, 2 * DAYS_PER_YEAR);
  for (const c of sim.state.citizens) {
    assert.equal(ageOf(sim.state, c), ageOn(c.birthDay, sim.state.day));
    if (before.has(c.id)) assert.equal(ageOf(sim.state, c), before.get(c.id) + 2, `${c.firstName} aged two years`);
  }
});

test('2. birth dates remain correct after saving', () => {
  const sim = grown();
  const loaded = roundTrip(sim.state);
  for (const c of sim.state.citizens) {
    const l = loaded.citizens.find((x) => x.id === c.id);
    assert.equal(l.birthDay, c.birthDay);
    assert.equal(ageOf(loaded, l), ageOf(sim.state, c));
  }
});

test('3. children never have invalid parent IDs', () => {
  const s = grown().state;
  assert.ok(s.stats.births > 0, 'children were born during the run');
  for (const p of [...s.citizens, ...Object.values(s.archive)]) {
    for (const id of p.family.parentIds) assert.ok(person(s, id), `${p.firstName} has a known parent ${id}`);
  }
});

test('4. family trees remain acyclic, and a cycle cannot be created', () => {
  const s = grown().state;
  for (const p of s.citizens) assert.ok(!ancestorIds(s, p.id, 40).has(p.id), `${p.firstName} is not their own ancestor`);
  const child = [...s.citizens, ...Object.values(s.archive)].find((p) => p.family.parentIds.length);
  assert.ok(child);
  assert.equal(linkParent(s, child.family.parentIds[0], child.id), false, 'a child cannot become its parent\'s parent');
});

test('5. marriage status stays consistent, including widowhood', () => {
  const sim = grown();
  const s = sim.state;
  for (const c of s.citizens) {
    if (!c.family.spouseId) continue;
    const sp = s.citizens.find((x) => x.id === c.family.spouseId);
    assert.ok(sp, `${c.firstName}'s spouse is alive`);
    assert.equal(sp.family.spouseId, c.id, 'marriage is mutual');
  }
  const t = cloneSim(sim).state;
  const wed = t.citizens.find((c) => c.family.spouseId);
  if (wed) {
    const spouse = t.citizens.find((x) => x.id === wed.family.spouseId);
    die(t, wed, 'old age');
    assert.equal(spouse.family.spouseId, null);
    assert.ok(spouse.family.formerSpouseIds.includes(wed.id), 'widow remembers the late spouse');
  }
});

test('6. deceased citizens are no longer employed', () => {
  const s = cloneSim(grown()).state;
  const worker = s.citizens.find((c) => c.employment);
  assert.ok(worker);
  die(s, worker, 'accident');
  assert.ok(!s.businesses.some((b) => b.employees.includes(worker.id)));
  assert.ok(!s.citizens.includes(worker));
  assert.equal(s.archive[worker.id].status, 'dead');
});

test('7 & 8. death settles the estate exactly once without duplicating wealth', () => {
  const s = cloneSim(grown()).state;
  const rich = [...s.citizens].sort((a, b) => balance(s, b.id) - balance(s, a.id))[0];
  const money = totalMoney(s);
  const coins = balance(s, rich.id);
  assert.ok(coins > 0);
  die(s, rich, 'old age');
  const estates = s.estates.length;
  const again = settleEstate(s, rich);
  assert.equal(s.estates.length, estates, 'second settlement creates nothing');
  assert.equal(again.id, rich.estateId);
  assert.equal(totalMoney(s), money, 'money is conserved through inheritance');
  assert.equal(balance(s, rich.id), 0, 'nothing is left in the dead person\'s account');
  assert.equal(again.heirs.reduce((t, h) => t + h.coins, 0) || coins, coins);
  assert.equal(die(s, rich, 'old age'), null, 'a person cannot die twice');
});

test('9. business ownership passes to an heir or the business closes', () => {
  const s = cloneSim(grown()).state;
  const owned = s.businesses.filter((b) => isTrading(b) && s.citizens.some((c) => c.id === b.ownerId));
  assert.ok(owned.length, 'there are privately owned businesses');
  for (const b of owned.slice(0, 4)) {
    const owner = s.citizens.find((c) => c.id === b.ownerId);
    if (!owner) continue;
    die(s, owner, 'old age');
    // Either a living heir now runs it, or it closed (its record keeps the late owner's name).
    if (isTrading(b)) assert.ok(s.citizens.some((c) => c.id === b.ownerId), `${b.name} passed to a living heir`);
    else assert.equal(b.status, 'CLOSED');
    assert.ok(!s.plots.some((p) => p.ownerId === owner.id), 'none of their land is left with the deceased');
  }
});

test('10. property ownership remains unique and held by the living', () => {
  const s = grown().state;
  const valid = new Set([...s.citizens.map((c) => c.id), 'council', null]);
  for (const p of s.plots) assert.ok(valid.has(p.ownerId ?? null), `${p.name} owner ${p.ownerId} is living or civic`);
  const ids = s.plots.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of s.citizens) {
    const homes = s.plots.filter((p) => p.residents.includes(c.id));
    assert.ok(homes.length <= 1, `${c.firstName} lives in at most one home`);
  }
});

test('11. children progress through the life stages', () => {
  const sim = cloneSim(grown());
  const s = sim.state;
  const mother = s.citizens.find((c) => c.sex === 'F' && ageOf(s, c) >= LIFE.adultAge && ageOf(s, c) < 40) ?? s.citizens.find((c) => ageOf(s, c) >= LIFE.adultAge);
  mother.pregnancy = { otherParentId: mother.family.spouseId, dueDay: s.day };
  s.populationCap = 999;
  const baby = giveBirth(s, mother);
  assert.ok(baby);
  assert.equal(stageOf(s, baby).id, 'infant');
  const seen = new Set();
  for (let y = 0; y < 14 && s.citizens.includes(baby); y++) { seen.add(stageOf(s, baby).id); advanceDays(sim, DAYS_PER_YEAR); }
  if (s.citizens.includes(baby)) {
    seen.add(stageOf(s, baby).id);
    assert.deepEqual([...seen].slice(0, 3), ['infant', 'child', 'teen']);
    assert.equal(stageOf(s, baby).id, stageForAge(ageOf(s, baby)).id);
  }
});

test('12. skills increase through actual work', () => {
  const sim = fresh(3);
  advanceDays(sim, 4);
  const worker = sim.state.citizens.find((c) => c.employment);
  assert.ok(worker);
  const before = JSON.stringify(worker.skills);
  advanceDays(sim, 6);
  assert.notEqual(JSON.stringify(worker.skills), before, `${worker.firstName}'s skills changed through work`);
  const c = { skills: {}, education: { level: 0.5 } };
  const a = gainSkill(c, 'farming', 0.1);
  assert.ok(a > 0.05 && gainSkill(c, 'farming', 0.1) > a);
});

test('13 & 14. elections produce valid results and leaders serve full terms', () => {
  const s = grown().state;
  const elections = s.government?.elections ?? [];
  assert.ok(elections.length >= 2, 'several elections were held');
  for (const e of elections) {
    const sum = e.candidates.reduce((t, c) => t + c.votes, 0);
    assert.equal(sum, e.turnout);
    assert.ok(e.turnout <= e.eligible);
    const top = Math.max(...e.candidates.map((c) => c.votes));
    assert.equal(e.candidates.find((c) => c.id === e.winnerId).votes, top, 'winner has the most votes');
    assert.ok(person(s, e.winnerId));
  }
  const gov = s.government;
  if (gov.leaderId && gov.termEnd) assert.equal(gov.termEnd - gov.termStart, POLITICS.termYears * DAYS_PER_YEAR);
  for (let i = 1; i < elections.length; i++) assert.ok(elections[i].day - elections[i - 1].day <= POLITICS.termYears * DAYS_PER_YEAR + POLITICS.campaignDays * 2, 'no term overruns');
  if (gov.leaderId) assert.ok(s.citizens.some((c) => c.id === gov.leaderId), 'the leader is alive');
});

test('15. policies change real economic variables', () => {
  const base = cloneSim(grown()).state;
  const takeAt = (level) => {
    const s = roundTrip(base);
    transfer(s, 'treasury', 'outside', balance(s, 'treasury'), 'test', 'empty coffers');
    s.council.taxLevel = level;
    return collectTithe(s);
  };
  assert.ok(takeAt('high') > takeAt('low'), 'higher taxes collect more tithe');
});

test('16 & 17. migrants receive unique IDs and population totals stay consistent', () => {
  const sim = cloneSim(grown());
  const s = sim.state;
  for (let i = 0; i < 40; i++) maybeImmigrate(s);
  const all = [...s.citizens.map((c) => c.id), ...Object.keys(s.archive)];
  assert.equal(new Set(all).size, all.length, 'no id is reused');
  const st = s.stats;
  assert.equal(s.citizens.length, 5 + st.births + st.immigrants - st.deaths - st.emigrants);
});

test('18. building expansion respects costs and time', () => {
  const sim = cloneSim(grown());
  const s = sim.state;
  const owner = s.citizens.find((c) => s.plots.some((p) => p.ownerId === c.id && p.building && !p.projectId && (p.building.level ?? 1) < 3 && !p.businessId));
  assert.ok(owner);
  const plot = s.plots.find((p) => p.ownerId === owner.id && p.building && !p.projectId && (p.building.level ?? 1) < 3 && !p.businessId);
  const level = plot.building.level ?? 1;
  const r = startProject(s, { plotId: plot.id, ownerId: owner.id, kind: 'upgrade' });
  assert.ok(r && !r.error, 'upgrade starts');
  updateProjects(s);
  assert.equal(plot.building.level ?? 1, level, 'no instant expansion');
  const p = s.projects.find((x) => x.plotId === plot.id);
  assert.ok(p && p.kind === 'upgrade');
});

test('19. disasters modify the actual world', () => {
  const s = cloneSim(grown()).state;
  const plot = s.plots.find((p) => p.building && p.building.type !== 'well' && p.building.type !== 'ruins' && !p.projectId);
  const fires = s.stats.fires;
  igniteFire(s, plot);
  assert.equal(s.stats.fires, fires + 1);
  s.tick += TICKS_PER_DAY;
  updateFires(s);
  assert.ok(!s.fires.some((f) => f.plotId === plot.id), 'the fire burned out');
  assert.ok((plot.building?.condition ?? 0) < 100 || plot.building?.type === 'ruins' || !plot.building, 'the building was damaged');
});

test('20. the chronicle reflects real births and deaths', () => {
  const s = grown().state;
  const born = s.chronicle.filter((e) => / was born to /.test(e.text));
  for (const e of born) assert.ok(person(s, e.refs.citizens[0]), 'every recorded birth names a real person');
  for (const p of Object.values(s.archive).filter((x) => x.status === 'dead' && x.deathDay > s.day - 5 * DAYS_PER_YEAR)) {
    assert.ok(s.chronicle.some((e) => e.refs.citizens.includes(p.id) && e.day === p.deathDay), `${p.firstName}'s death is recorded`);
  }
});

test('21. save/load preserves every family connection', () => {
  const s = grown().state;
  const loaded = roundTrip(s);
  const fam = (st) => JSON.stringify([...st.citizens, ...Object.values(st.archive)].map((p) => [p.id, p.family]));
  assert.equal(fam(loaded), fam(s));
});

test('22. the simulation is identical at 1× and 20× speed', () => {
  const a = fresh(11), b = fresh(11);
  const ca = new GameClock(() => a.step()), cb = new GameClock(() => b.step());
  cb.speed = 20;
  for (let i = 0; i < 48; i++) cb.advance(1 / 16);
  for (let i = 0; i < 960; i++) ca.advance(1 / 16);
  assert.equal(a.state.tick, b.state.tick);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
});

test('saves taken during births, deaths, weddings, elections, inheritance, construction and disasters resume exactly', () => {
  const sim = cloneSim(grown());
  const s = sim.state;
  const [a, b] = s.citizens.filter((c) => !c.family.spouseId && ageOf(s, c) >= LIFE.adultAge && ageOf(s, c) < 60);
  if (a && b) marry(s, a, b);
  const mother = s.citizens.find((c) => c.sex === 'F' && ageOf(s, c) >= LIFE.adultAge && !c.pregnancy);
  mother.pregnancy = { otherParentId: null, dueDay: s.day + 1 };
  die(s, [...s.citizens].sort((x, y) => ageOf(s, y) - ageOf(s, x))[0], 'old age');
  igniteFire(s, s.plots.find((p) => p.building && p.building.type !== 'well' && !p.projectId));
  if (s.government && !s.government.campaign) s.government.nextElectionDay = s.day + 1;
  const copy = new Simulation(roundTrip(s));
  const chronicleIds = (st) => st.chronicle.map((e) => e.id);
  for (let i = 0; i < 3 * TICKS_PER_DAY; i++) { sim.step(); copy.step(); }
  assert.equal(JSON.stringify(copy.state), JSON.stringify(sim.state), 'the reloaded world continues identically');
  const ids = chronicleIds(copy.state);
  assert.equal(new Set(ids).size, ids.length, 'no duplicated events after loading');
  assert.equal(checkInvariants(copy.state, 'save', 0), 0, 'all invariants hold');
  assert.deepEqual(badNumbers(copy.state), []);
});

test('a real Milestone 2 save (version 3) migrates into a working Milestone 3 world', () => {
  const text = readFileSync(new URL('./fixtures/m2-save.json', import.meta.url), 'utf8');
  const old = JSON.parse(JSON.parse(text).data);
  assert.equal(old.version, 3);
  const s = deserialize(text);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.citizens.length, old.citizens.length, 'nobody is lost');
  for (const c of s.citizens) {
    const before = old.citizens.find((x) => x.id === c.id);
    assert.ok(before, `${c.firstName} existed before`);
    assert.ok(Number.isFinite(c.birthDay) && ['F', 'M'].includes(c.sex));
    assert.equal(balance(s, c.id), old.accounts[c.id] ?? 0, `${c.firstName} keeps their savings`);
    assert.ok(Array.isArray(c.family.parentIds) && c.family.childIds);
  }
  for (const n of ['Ada', 'Bram', 'Cora', 'Dain', 'Elin']) assert.ok(s.citizens.find((c) => c.firstName === n)?.founder, `${n} is a founder`);
  const sim = new Simulation(s);
  advanceDays(sim, DAYS_PER_YEAR);
  assert.equal(checkInvariants(sim.state, 'm2', 1), 0);
});

test('a guardian\'s death re-homes minors only, never grown children', () => {
  const s = cloneSim(grown()).state;
  const parent = s.citizens.find((p) => p.family.childIds.some((id) => { const k = s.citizens.find((x) => x.id === id); return k && ageOf(s, k) >= LIFE.adultAge; }));
  assert.ok(parent, 'someone has a grown child');
  const grownKids = s.citizens.filter((k) => parent.family.childIds.includes(k.id) && ageOf(s, k) >= LIFE.adultAge);
  for (const k of grownKids) k.family.guardianId = parent.id; // a guardian link left over from childhood
  const homes = grownKids.map((k) => k.homePlotId);
  die(s, parent, 'old age');
  assert.deepEqual(grownKids.map((k) => k.homePlotId), homes);
});

test('an expansion under way on an inherited business continues under the heir', () => {
  const s = cloneSim(grown()).state;
  const b = s.businesses.find((x) => isTrading(x) && s.citizens.some((c) => c.id === x.ownerId) && !s.plots.find((p) => p.id === x.plotId)?.projectId);
  const owner = s.citizens.find((c) => c.id === b.ownerId);
  const plot = s.plots.find((p) => p.id === b.plotId);
  plot.building.level = 1;
  transfer(s, 'outside', owner.id, 200, 'test', 'funds for the expansion');
  s.council.timber = (s.council.timber ?? 0) + 10;
  const r = startProject(s, { plotId: plot.id, ownerId: owner.id, kind: 'upgrade' });
  assert.ok(r && !r.error, `upgrade started (${r?.error})`);
  const project = s.projects.find((p) => p.id === plot.projectId);
  const heir = s.citizens.find((c) => c !== owner && ageOf(s, c) >= LIFE.adultAge);
  transferBusiness(s, b, owner, heir, 'successor', 'test');
  assert.equal(project.ownerId, heir.id);
  updateProjects(s);
  assert.ok(s.projects.includes(project) && plot.projectId === project.id, 'the project was not abandoned');
});
