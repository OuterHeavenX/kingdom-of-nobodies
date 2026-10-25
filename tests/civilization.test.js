import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, byName, totalMoney, badNumbers } from './helpers.js';
import { DAYS_PER_YEAR, SAVE_VERSION } from '../src/core/Config.js';
import { yearOf, firstDayOfYear } from '../src/core/Calendar.js';
import { serialize, deserialize, migrate } from '../src/core/Serialization.js';
import { balance } from '../src/economy/Transactions.js';
import { addGoods } from '../src/economy/Inventory.js';
import { plotByName, bedsAt, setBuilding } from '../src/property/LandRegistry.js';
import { solidRects, buildingDims } from '../src/property/Footprints.js';
import { startProject, addWork, updateProjects, projectById, canStart } from '../src/property/Construction.js';
import { ageForYear, AGES } from '../src/civilization/Ages.js';
import { TECHNOLOGIES, TECH_BY_ID, techBlocker, adoptTech, seasonalTechnology, hasTech } from '../src/civilization/Technology.js';
import { unmetNeeds, maxLevel, serviceFactor } from '../src/civilization/Infrastructure.js';
import { buildEra } from '../src/civilization/Architecture.js';
import { rebuildStages, rebuildCost } from '../src/civilization/Modernization.js';
import { heritageVeto, heritageScore, applyForPlanning } from '../src/civilization/Heritage.js';
import { propertyOn, propertyTimeline, ownerChain, recordPropertyChanges } from '../src/civilization/PropertyHistory.js';
import { planTrip, regionalFactor, freightMode } from '../src/civilization/Transport.js';
import { rentalHousing, acquirable } from '../src/civilization/Density.js';
import { FORMS, formOf, dimsOf, zoneOf } from '../src/civilization/ArchitectureData.js';
import { villageSites } from '../src/holidays/DecorationSpawner.js';
import { navGrid, cellOf, walkable } from '../src/navigation/NavigationGrid.js';
import { frontOf } from '../src/property/LandRegistry.js';

/** Move a world forward by whole years without ageing anyone (birth dates move with it). For tests only. */
function advanceCalendar(state, years) {
  const d = years * DAYS_PER_YEAR;
  state.day += d;
  for (const c of state.citizens) c.birthDay += d;
}

const adoptAll = (s, upTo) => { for (const t of TECHNOLOGIES) if (t.age <= upTo) s.civ.tech[t.id] = s.day; };
const fill = (s, n = 5000) => { s.accounts.outside -= n; s.accounts.treasury += n; };

test('civ: the five ages open on schedule, by the calendar alone', () => {
  assert.deepEqual([1, 100, 101, 200, 201, 300, 301, 400, 401, 500].map(ageForYear), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  assert.equal(AGES.length, 5);
  const sim = makeSim(3);
  const s = sim.state;
  assert.equal(s.civ.age, 1);
  advanceCalendar(s, 99);
  s.day = firstDayOfYear(101) - 1;
  const eras = s.plots.map((p) => p.building && `${p.building.type}:${p.building.era}:${p.building.seed}`);
  const money = totalMoney(s);
  sim.runDays(2);
  assert.equal(yearOf(s.day), 101);
  assert.equal(s.civ.age, 2, 'Year 101 opens the Industrial Awakening');
  assert.ok(s.chronicle.some((e) => /Industrial Awakening begins/.test(e.text)));
  assert.deepEqual(s.plots.map((p) => p.building && `${p.building.type}:${p.building.era}:${p.building.seed}`).slice(0, eras.length), eras, 'no building changed by itself');
  assert.equal(totalMoney(s), money);
});

test('civ: technology needs its age, its prerequisites, real local conditions and the money to pay for it', () => {
  const { state: s } = makeSim(4);
  const brick = TECH_BY_ID.brickworks;
  assert.match(techBlocker(s, brick), /opens in/);
  s.civ.age = 2;
  assert.match(techBlocker(s, brick), /needs Stone masonry/);
  s.civ.tech.masonry = 1;
  s.accounts.outside += s.accounts.treasury; s.accounts.treasury = 0;
  assert.match(techBlocker(s, brick), /treasury needs/);
  fill(s, 500);
  assert.equal(techBlocker(s, brick), null);
  const money = totalMoney(s), outside = balance(s, 'outside');
  assert.equal(adoptTech(s, brick), true);
  assert.equal(balance(s, 'outside') - outside, brick.cost, 'paid to the wider world');
  assert.equal(totalMoney(s), money);
  assert.equal(hasTech(s, 'brickworks'), true);
  assert.equal(buildEra(s), 2, 'brick architecture is now buildable');
  // Railways need a real town: people and brick buildings already standing.
  s.civ.tech.steam_power = 1;
  assert.match(techBlocker(s, TECH_BY_ID.railway), /needs a town of 60|brick-era/);
  // One adoption per season at most.
  s.day = firstDayOfYear(2);
  const n = Object.keys(s.civ.tech).length;
  seasonalTechnology(s); seasonalTechnology(s);
  assert.ok(Object.keys(s.civ.tech).length <= n + 1);
});

test('civ: a merchant rebuilds an old timber workshop as a brick factory through real demolition and construction', () => {
  const { state: s } = makeSim(5);
  s.civ.age = 2; adoptAll(s, 2);
  const plot = plotByName(s, 'Timber Edge');
  const bram = byName(s, 'Bram');
  plot.ownerId = bram.id;
  s.accounts.outside -= 400; s.accounts[bram.id] += 400;
  const biz = s.businesses.find((b) => b.plotId === plot.id);
  const money = totalMoney(s);
  const stages = rebuildStages('lumberyard', 2);
  assert.equal(stages[0].name, 'DEMOLISHING');
  assert.ok(rebuildCost(stages) > 40);
  const res = startProject(s, { plotId: plot.id, ownerId: bram.id, kind: 'rebuild', buildingType: 'lumberyard', stages, targetEra: 2 });
  assert.ok(res.ok, res.reason);
  addGoods(s.businesses.find((b) => b.type === 'lumberyard').inventory, 'timber', 40);
  s.day += 2; // the work happens after the founding records
  const seen = new Set();
  let shifts = 0, wasCleared = false;
  const cora = byName(s, 'Cora');
  while (projectById(s, res.project.id) && shifts < 400) {
    updateProjects(s);
    addWork(s, res.project, cora);
    seen.add(plot.constructionStatus);
    if (!plot.building) wasCleared = true;
    recordPropertyChanges(s);
    shifts++;
  }
  assert.ok(!projectById(s, res.project.id), `finished in ${shifts} shifts`);
  for (const st of ['DEMOLISHING', 'FOUNDATION', 'FRAME', 'ROOF', 'FINISHING']) assert.ok(seen.has(st), `passed ${st}`);
  assert.ok(wasCleared, 'the old building really came down first');
  assert.equal(plot.building.type, 'lumberyard');
  assert.equal(plot.building.era, 2);
  assert.equal(plot.building.style, 'Brick sawmill');
  assert.equal(plot.businessId, biz.id, 'the business survives on its rebuilt premises');
  assert.ok(res.project.materialsPaid > 0 && res.project.labourPaid > 0, 'materials and labour were paid');
  assert.equal(totalMoney(s), money, 'no coin created or lost');
  const kinds = propertyTimeline(s, plot.id).map((r) => r.k);
  assert.ok(kinds.includes('demolished') && kinds.includes('built'), `history kept: ${kinds.join(', ')}`);
  assert.equal(propertyOn(s, plot.id, 1).e, 1, 'Then & Now still knows the timber workshop of Year 1');
});

test('civ: modern buildings stand where the navigation grid and decorations expect them', () => {
  const { state: s } = makeSim(6);
  const plot = plotByName(s, 'North Lane');
  setBuilding(s, plot, 'general_store', null, { era: 4, seed: 7, floors: 3 });
  const dm = buildingDims(plot);
  assert.ok(dm.w <= plot.w && dm.d <= plot.d, 'fits its plot');
  const [r] = solidRects(plot);
  assert.ok(r[2] - r[0] > 3.5, 'the larger modern footprint blocks the path');
  const door = frontOf(plot, 0, 1.2);
  assert.ok(walkable(navGrid(s), cellOf(door.x, door.z)), 'the front door is reachable');
  const sites = villageSites(s);
  for (const [x, z] of [...sites.homes, ...sites.yards]) assert.ok(!(x > r[0] && x < r[2] && z > r[1] && z < r[3]), 'no decoration inside the building');
});

test('civ: towers need utilities and transit, the centre, and land consolidated legally', () => {
  const { state: s } = makeSim(7);
  s.civ.age = 4; adoptAll(s, 4);
  const plot = plotByName(s, 'Willow Cottage');
  assert.equal(zoneOf(plot), 'core');
  assert.ok(unmetNeeds(s, plot, 'tower', 4).length >= 2, 'no power, mains or transit yet');
  for (const net of ['power', 'water', 'transit']) s.civ.infra[net][plot.district] = maxLevel(s, net);
  assert.deepEqual(unmetNeeds(s, plot, 'tower', 4), []);
  assert.ok(formOf('tower', 4).tall && FORMS.tower[2] === null, 'no skyscrapers in the industrial age');
  // A lived-in home cannot be bought out from under its family.
  assert.ok(plot.residents.length === 0 || acquirable(s, plot, byName(s, 'Ada').id) === null);
  // A building without the services it needs works at reduced capacity.
  setBuilding(s, plot, 'tower', null, { era: 4, seed: 3, floors: 20 });
  s.civ.infra.transit[plot.district] = 0;
  assert.ok(serviceFactor(s, plot) < 1);
  plot.building.serviceFactor = serviceFactor(s, plot);
  assert.ok(bedsAt(s, plot) < formOf('tower', 4).beds);
  assert.ok(dimsOf(plot.building, plot).h > 40, 'twenty storeys');
});

test('civ: listed buildings and conservation areas are protected; contested schemes go to the council', () => {
  const { state: s } = makeSim(8);
  s.civ.age = 2; adoptAll(s, 2);
  const hall = plotByName(s, 'Hearth Hall');
  s.civ.heritage.listed[hall.id] = { day: 1, why: 'test' };
  assert.match(heritageVeto(s, hall, 'rebuild'), /listed/);
  assert.equal(canStart(s, hall, 'council', 'rebuild', 'hall'), `${hall.name} is a listed historic building`);
  assert.equal(heritageVeto(s, hall, 'repair'), null, 'repairs are allowed');
  const cottage = plotByName(s, 'Brook Cottage');
  setBuilding(s, cottage, 'cottage');
  cottage.building.builtDay = 1;
  advanceCalendar(s, 90);
  s.civ.heritage.conservation.push('Old Town');
  assert.match(heritageVeto(s, cottage, 'rebuild'), /conservation area/);
  assert.match(heritageVeto(s, plotByName(s, 'Mill Row'), 'construction', 'tower') ?? '', /no towers/);
  assert.ok(heritageScore(s, hall).score >= 40, 'the founders\' hall matters');
  // A scheme that would pull down an important building becomes a dispute when villagers care.
  s.civ.heritage.listed = {};
  for (const c of s.citizens) c.traits.loyal = 1;
  const app = applyForPlanning(s, { kind: 'scheme', type: 'apartment', era: 2, applicantId: byName(s, 'Bram').id, plotIds: [hall.id], annexId: null, cost: { total: 1 } });
  assert.equal(app.status, 'DISPUTED');
  assert.ok(s.chronicle.some((e) => /planning dispute/.test(e.text)));
});

test('civ: transport makes long trips and freight faster once the technology exists', () => {
  const { state: s } = makeSim(9);
  const c = s.citizens[0];
  const act = {};
  assert.equal(planTrip(s, c, act, [[60, 0]]), 1, 'medieval villagers walk');
  s.civ.age = 3; adoptAll(s, 3);
  s.accounts.outside -= 100; s.accounts[c.id] += 100;
  assert.ok(planTrip(s, c, act, [[60, 0]]) > 1);
  assert.equal(act.vehicle, 'car');
  assert.equal(planTrip(s, c, {}, [[c.x + 5, c.z]]), 1, 'short trips are still walked');
  assert.equal(freightMode(s), 'car');
  assert.ok(regionalFactor(s).factor > 1);
});

test('civ: rented flats charge real rent to the owner, and council flats never evict', () => {
  const { state: s } = makeSim(10);
  s.civ.age = 3;
  const plot = plotByName(s, 'Elm Cottage');
  const dev = byName(s, 'Dain');
  plot.ownerId = dev.id;
  setBuilding(s, plot, 'apartment', null, { era: 3, seed: 2, floors: 5 });
  plot.building.rental = true;
  const tenant = byName(s, 'Elin');
  const hall = s.plots.find((p) => p.building?.type === 'hall');
  if (tenant.homePlotId !== hall.id) { const old = s.plots.find((p) => p.id === tenant.homePlotId); if (old) old.residents = old.residents.filter((x) => x !== tenant.id); tenant.homePlotId = hall.id; hall.residents.push(tenant.id); }
  const money = totalMoney(s);
  rentalHousing(s);
  assert.equal(tenant.homePlotId, plot.id, 'a working household moves out of the hall into a flat');
  const before = balance(s, dev.id);
  rentalHousing(s);
  const households = new Set(plot.residents.map((id) => s.citizens.find((c) => c.id === id)?.family.spouseId ?? id)).size;
  assert.ok(balance(s, dev.id) > before && balance(s, dev.id) <= before + households, 'a coin a day per household reaches the landlord');
  assert.equal(totalMoney(s), money);
});

test('civ: a v7 save migrates to v8 with its buildings as Age of Foundations architecture and nothing else changed', () => {
  const sim = makeSim(11);
  sim.runDays(30);
  const s = JSON.parse(serialize(sim.state, 'test'));
  const data = JSON.parse(s.data);
  delete data.civ;
  for (const p of data.plots) if (p.building) { delete p.building.era; delete p.building.seed; delete p.building.floors; delete p.building.style; }
  data.version = 7;
  const money = totalMoney(data);
  const people = data.citizens.length;
  const out = migrate(data);
  assert.equal(out.version, SAVE_VERSION);
  assert.equal(out.civ.age, 1);
  assert.ok(out.plots.filter((p) => p.building).every((p) => p.building.era === 1 && Number.isInteger(p.building.seed)));
  assert.equal(totalMoney(out), money);
  assert.equal(out.citizens.length, people);
  assert.ok(out.migrationNotes.some((n) => n.version === 8));
  assert.deepEqual(badNumbers(out), []);
});

test('civ: architecture, utilities and Then & Now history survive a save and reload exactly', () => {
  const sim = makeSim(12);
  const s = sim.state;
  s.civ.age = 3; adoptAll(s, 3);
  s.civ.infra.power['Old Town'] = 2;
  const plot = plotByName(s, 'Crossroads Corner');
  setBuilding(s, plot, 'general_store', 'Corner Emporium', { era: 3, seed: 99, floors: 2 });
  recordPropertyChanges(s);
  const loaded = deserialize(serialize(s, 'test'));
  for (const key of ['civ']) assert.deepEqual(loaded[key], s[key]);
  const p2 = loaded.plots.find((p) => p.id === plot.id);
  assert.deepEqual(p2.building, plot.building);
  assert.deepEqual(propertyOn(loaded, plot.id, s.day), propertyOn(s, plot.id, s.day), 'the same reconstruction after reload');
  assert.deepEqual(propertyOn(loaded, plot.id, 1), propertyOn(s, plot.id, 1));
  assert.ok(ownerChain(loaded, plot.id).length >= 1);
});

test('civ: forms are complete for every building type and era they exist in', () => {
  for (const [type, list] of Object.entries(FORMS)) {
    assert.equal(list.length, 6, type);
    for (let e = 1; e <= 5; e++) if (list[e]) { assert.ok(list[e].labels.length >= 1); assert.ok(list[e].floors[0] <= list[e].floors[1]); }
  }
});
