// Multigenerational stress test: advances kingdoms by many years without
// rendering and checks every invariant along the way. Usage:
//   node tests/longevity.mjs [years=200] [seeds=1,2,3]
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { totalMoney, balance } from '../src/economy/Transactions.js';
import { DAYS_PER_YEAR } from '../src/core/Config.js';
import { ageOf } from '../src/citizens/Citizen.js';
import { ancestorIds } from '../src/citizens/FamilyTree.js';
import { isTrading } from '../src/economy/Businesses.js';
import { TIME } from '../src/core/Config.js';
import { ESCROW } from '../src/trade/Contracts.js';
import { cargoUnits } from '../src/trade/Caravans.js';
import { validOwner } from '../src/institutions/Registry.js';
import { balanceSheet, financeSummary } from '../src/finance/BankManager.js';
import { MILITARY } from '../src/core/Config.js';
import { affiliationCounts } from '../src/institutions/FaithManager.js';
import { ageForYear } from '../src/civilization/Ages.js';
import { ARCH_TECH, formOf } from '../src/civilization/ArchitectureData.js';
import { hasTech } from '../src/civilization/Technology.js';
import { architectureStats } from '../src/civilization/Architecture.js';
import { densityStats } from '../src/civilization/Density.js';
import { propertyOn } from '../src/civilization/PropertyHistory.js';
import { unmetNeeds } from '../src/civilization/Infrastructure.js';
import { navGrid, cellOf, walkable } from '../src/navigation/NavigationGrid.js';
import { frontOf, plotValue } from '../src/property/LandRegistry.js';
import { yearOf } from '../src/core/Calendar.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { holidayNow } from '../src/culture/Holidays.js';

const years = Number(process.argv[2] ?? 200);
const seeds = (process.argv[3] ?? '1,2,3').split(',').map(Number);
let failures = 0;
const LISTED = new WeakMap(); // listed buildings as first seen, per world
const fail = (seed, year, msg) => { failures++; console.error(`  ✗ seed ${seed} year ${year}: ${msg}`); };

/** Check every multigenerational invariant; returns the number of violations found. */
export function checkInvariants(s, seed, year) {
  const before = failures;
  const ids = new Set();
  for (const c of s.citizens) {
    if (ids.has(c.id)) fail(seed, year, `duplicate citizen id ${c.id}`);
    ids.add(c.id);
    if (s.archive[c.id]) fail(seed, year, `${c.id} is both living and archived`);
    const age = ageOf(s, c);
    if (!(age >= 0)) fail(seed, year, `${c.firstName} has invalid age ${age}`);
    for (const p of c.family.parentIds) {
      if (!s.archive[p] && !s.citizens.some((x) => x.id === p)) fail(seed, year, `${c.firstName} has unknown parent ${p}`);
    }
    if (ancestorIds(s, c.id, 30).has(c.id)) fail(seed, year, `${c.firstName} is their own ancestor`);
    if (c.family.spouseId) {
      const sp = s.citizens.find((x) => x.id === c.family.spouseId);
      if (!sp || sp.family.spouseId !== c.id) fail(seed, year, `${c.firstName}'s marriage is not mutual`);
    }
    if (c.employment && !s.businesses.some((b) => b.id === c.employment.businessId && isTrading(b))) {
      // Employment must point at a trading business (owners and staff alike).
      fail(seed, year, `${c.firstName} employed by non-trading ${c.employment.businessId}`);
    }
  }
  for (const b of s.businesses) for (const e of b.employees) if (!ids.has(e)) fail(seed, year, `${b.name} employs absent ${e}`);
  for (const [k, v] of Object.entries(s.accounts)) if (!Number.isInteger(v) || v < 0) fail(seed, year, `account ${k} = ${v}`);
  const owners = new Map();
  for (const p of s.plots) {
    if (owners.has(p.id)) fail(seed, year, `plot ${p.id} listed twice`);
    owners.set(p.id, p.ownerId);
    if (!validOwner(s, p.ownerId)) fail(seed, year, `plot ${p.name} owned by absent ${p.ownerId}`);
  }
  const gov = s.government;
  for (const e of gov?.elections ?? []) {
    const total = e.candidates.reduce((a, c) => a + c.votes, 0);
    if (total !== e.turnout || total > e.eligible) fail(seed, year, `impossible election result in year ${e.year}`);
    if (e.candidates[0].id !== e.winnerId) fail(seed, year, `election winner is not the top vote-getter`);
  }
  // Milestone 4: goods, escrow, caravans, judgments and state size.
  const stores = [
    ...s.businesses.map((b) => [b.name, b.inventory]), ...s.businesses.map((b) => [`${b.name} (held)`, b.held ?? {}]),
    ...s.citizens.map((c) => [c.firstName, c.inventory]), ['pantry', s.council.pantry], ['council stores', s.council.stores ?? {}],
    ...Object.values(s.region?.settlements ?? {}).flatMap((k) => [[k.name, k.inventory], [`${k.name} (reserved)`, k.reserved]]),
    ...(s.trade?.caravans ?? []).map((cv) => [cv.id, cv.cargo]), ['festival', s.culture?.current?.stock ?? {}],
  ];
  for (const [who, inv] of stores) for (const [g, n] of Object.entries(inv ?? {})) if (!(n >= 0)) fail(seed, year, `${who} holds ${n} ${g}`);
  const live = (s.trade?.contracts ?? []).filter((c) => c.status === 'AGREED' || c.status === 'IN_TRANSIT');
  const escrow = live.reduce((a, c) => a + c.escrow, 0);
  if (balance(s, ESCROW) !== escrow) fail(seed, year, `escrow holds ${balance(s, ESCROW)} but open contracts hold ${escrow}`);
  for (const cv of s.trade?.caravans ?? []) {
    const t = cv.tally ?? { load: 0, deliver: 0, sold: 0, spoil: 0 };
    if (t.load - t.deliver - t.sold - t.spoil !== cargoUnits(cv)) fail(seed, year, `${cv.id} cargo does not add up (${JSON.stringify(t)} vs ${cargoUnits(cv)} aboard)`);
    const ageDays = (s.tick - cv.departTick) / TIME.ticksPerDay;
    if (cv.status !== 'COMPLETED' && cv.status !== 'CANCELLED' && ageDays > 40) fail(seed, year, `${cv.id} frozen in ${cv.status} for ${Math.round(ageDays)} days`);
  }
  const txs = new Set();
  for (const c of s.law?.cases ?? []) {
    if (c.status === 'JUDGED' && !c.judgment?.executedDay) fail(seed, year, `${c.id} judged but never executed`);
    for (const t of c.judgment?.transfers ?? []) { if (txs.has(t.tx)) fail(seed, year, `judgment transaction ${t.tx} executed twice`); txs.add(t.tx); }
  }
  // Milestone 5: banks, loans, institutions, armies, wars, the town plan and foreign people.
  const f = s.finance;
  if (f) {
    for (const b of f.banks) {
      const sh = balanceSheet(s, b);
      if (sh.assets !== sh.liabilities + sh.equity || sh.cash !== balance(s, b.id)) fail(seed, year, `${b.name}'s books do not reconcile`);
      for (const [h, n] of Object.entries(b.deposits)) if (!Number.isInteger(n) || n <= 0) fail(seed, year, `${b.name} owes ${h} an impossible ${n}`);
      if (b.status === 'FAILED' && (Object.keys(b.deposits).length || balance(s, b.id))) fail(seed, year, `failed ${b.name} still holds money or deposits`);
    }
    for (const l of f.loans) {
      if (!Number.isInteger(l.balance) || l.balance < 0) fail(seed, year, `loan ${l.id} has balance ${l.balance}`);
      if (l.balance > l.principal * 3) fail(seed, year, `loan ${l.id} has grown impossibly (${l.balance} on ${l.principal})`);
      if (l.bankId !== 'council' && !f.banks.some((b) => b.id === l.bankId)) fail(seed, year, `loan ${l.id} belongs to an unknown bank`);
      if (['ACTIVE', 'DELINQUENT'].includes(l.status) && l.borrowerId !== 'council' && !ids.has(l.borrowerId)) fail(seed, year, `live loan ${l.id} owed by someone who is gone`);
    }
  }
  for (const g of s.guilds?.list ?? []) if (g.status === 'ACTIVE') for (const id of g.members) if (!ids.has(id)) fail(seed, year, `${g.name} lists absent member ${id}`);
  const m = s.military;
  if (m) {
    for (const w of m.wars) if (w.status === 'ACTIVE' && s.day - w.startDay > MILITARY.maxWarDays + 2) fail(seed, year, `${w.name} has lasted ${s.day - w.startDay} days`);
    for (const a of m.armies) {
      if (a.status === 'DISBANDED') continue;
      const war = m.wars.find((w) => w.id === a.warId);
      if (!war || (war.status !== 'ACTIVE' && s.day - (war.endDay ?? s.day) > 30)) fail(seed, year, `${a.name} is still in the field ${war ? `${s.day - war.endDay} days after the peace` : 'with no war'}`);
      if (!(a.soldiers >= 0) || !(a.supplies >= 0)) fail(seed, year, `${a.name} has impossible numbers`);
    }
    for (const c of s.citizens) if (c.away?.reason === 'militia' && !m.armies.some((a) => a.status !== 'DISBANDED' && a.citizenIds.includes(c.id))) fail(seed, year, `${c.firstName} is away with a militia that no longer exists`);
  }
  if ((s.plots?.length ?? 0) > 420) fail(seed, year, `runaway expansion: ${s.plots.length} plots`);
  for (const kid of Object.keys(s.region?.settlements ?? {})) {
    const named = Object.values(s.foreign?.people ?? {}).filter((p) => p.kingdom === kid && p.status === 'alive');
    if (named.length > 45) fail(seed, year, `${kid} has ${named.length} named people`);
    const r = s.foreign?.people[s.region.settlements[kid].leader.citizenId];
    if (s.foreign && (!r || `${r.firstName} ${r.lastName}` !== s.region.settlements[kid].leader.name)) fail(seed, year, `${kid}'s ruler is not a living named citizen`);
  }
  // v0.5.2: ages, architecture, heritage, access and Then & Now.
  if (s.civ) {
    if (s.civ.age !== ageForYear(yearOf(s.day))) fail(seed, year, `age ${s.civ.age} in year ${yearOf(s.day)}`);
    const grid = navGrid(s);
    for (const p of s.plots) {
      const b = p.building;
      if (!b) continue;
      const era = b.era ?? 1;
      if (era > s.civ.age) fail(seed, year, `${p.name} has architecture from a future age (${era})`);
      if (era >= 2 && !hasTech(s, ARCH_TECH[era]) && b.type !== 'station' && b.type !== 'hospital') fail(seed, year, `${p.name} built in era ${era} without ${ARCH_TECH[era]}`);
      const rec = propertyOn(s, p.id, s.day);
      if (!p.projectId && rec && (rec.t !== b.type || rec.s !== b.seed)) fail(seed, year, `${p.name}'s Then & Now record does not match what stands there`);
      if (era >= 2 && !['farm', 'grounds', 'ruins'].includes(b.type) && !p.projectId) {
        const door = frontOf(p, 0, 1.2);
        if (!walkable(grid, cellOf(door.x, door.z)) && !walkable(grid, cellOf(frontOf(p, 0, 2.2).x, frontOf(p, 0, 2.2).z))) fail(seed, year, `${p.name}'s ${b.style} has no way in`);
      }
    }
    // A listed building is never pulled down or rebuilt (only fire can take it).
    if (!LISTED.has(s)) LISTED.set(s, {});
    const listedSeen = LISTED.get(s);
    for (const id of Object.keys(s.civ.heritage?.listed ?? {})) {
      const p = s.plots.find((x) => x.id === id);
      const now = p?.building ? `${p.building.type}:${p.building.seed}` : 'none';
      if (listedSeen[id] && listedSeen[id] !== now && p?.building?.type !== 'ruins' && listedSeen[id] !== 'none') fail(seed, year, `listed ${p?.name} changed from ${listedSeen[id]} to ${now}`);
      if (p?.building?.type !== 'ruins') listedSeen[id] = now;
    }
  }
  const kb = JSON.stringify(s).length / 1024;
  if (kb > 6000) fail(seed, year, `state has grown to ${Math.round(kb)} KB`);
  if (JSON.stringify(s).match(/NaN|Infinity/)) fail(seed, year, 'NaN or Infinity in state');
  return failures - before;
}

/** Regional, trade, legal and cultural metrics at a point in time. */
export function regional(s, year) {
  const k = Object.values(s.region?.settlements ?? {});
  const t = s.trade ?? { stats: {} };
  const rel = s.diplomacy?.relations ?? {};
  const fest = s.culture?.history ?? [];
  return {
    year, population: s.citizens.length, districts: s.districts?.opened?.length ?? 0,
    kingdoms: Object.fromEntries(k.map((x) => [x.id, { pop: Math.round(x.population), coins: balance(s, `k:${x.id}`), grain: Math.round(x.inventory.grain), prosperity: +x.prosperity.toFixed(2) }])),
    trade: { deliveries: t.stats.deliveries, failures: t.stats.failures, volume: t.stats.volume, value: t.stats.value, spoiled: t.stats.spoiled, activeCaravans: (t.caravans ?? []).filter((c) => c.status !== 'COMPLETED' && c.status !== 'CANCELLED').length },
    relations: Object.fromEntries(Object.entries(rel).filter(([key]) => key.includes('hearth')).map(([key, r]) => [key.replace('hearth', '').replace('|', ''), Math.round(r.score)])),
    treaties: (s.diplomacy?.treaties ?? []).filter((x) => x.status === 'ACTIVE').length, treatiesEver: (s.diplomacy?.treaties ?? []).length,
    embargoes: (s.diplomacy?.embargoes ?? []).filter((x) => x.status === 'ACTIVE').length, embargoesEver: (s.diplomacy?.embargoes ?? []).length,
    roads: (s.roads ?? []).length, roadsBuilt: (s.roads ?? []).filter((r) => r.builtDay).length,
    judgments: s.law?.stats?.judged ?? 0, laws: (s.law?.laws ?? []).filter((l) => l.status === 'ACTIVE').length,
    festivalAttendance: fest.length ? Math.round(fest.slice(-4).reduce((a, f) => a + f.attendance / Math.max(1, f.population), 0) / Math.min(4, fest.length) * 100) : null,
    traditions: (s.culture?.traditions ?? []).filter((x) => x.active).length,
    treasury: balance(s, 'treasury'), widerWorld: balance(s, 'outside'),
    ...milestone5(s),
    civilization: civilization(s),
  };
}

/** v0.5.2 metrics: the city's architecture, density, heritage, technology and transport. */
export function civilization(s) {
  if (!s.civ) return null;
  const a = architectureStats(s);
  const d = densityStats(s);
  const built = s.plots.filter((p) => p.building);
  const tall = built.filter((p) => formOf(p.building.type, p.building.era ?? 1).tall && (p.building.floors ?? 1) >= 7);
  const roads = {};
  for (const r of s.roads) roads[r.kind] = (roads[r.kind] ?? 0) + 1;
  const ageYears = built.map((p) => (s.day - (p.building.rebuiltDay ?? p.building.builtDay ?? 1)) / DAYS_PER_YEAR);
  return {
    age: s.civ.age, technologies: Object.keys(s.civ.tech).length, byEra: a.byEra.slice(1), modernPct: a.modernPct,
    buildingAgeAvg: Math.round(ageYears.reduce((x, y) => x + y, 0) / Math.max(1, ageYears.length)), oldestBuilding: Math.round(Math.max(0, ...ageYears)),
    built: s.civ.stats.built, rebuilt: s.civ.stats.rebuilt, demolitions: (s.civ.stats.rebuilt ?? 0) + Object.values(s.civ.archive).flat().filter((r) => r.k === 'demolished').length,
    skyscrapers: tall.length, tallestFloors: Math.max(0, ...built.map((p) => p.building.floors ?? 1)), apartments: d.apartments, towers: d.towers, mansions: d.mansions,
    rentalBeds: d.rentalBeds, renters: d.renters, evictions: s.civ.stats.evictions,
    listed: Object.keys(s.civ.heritage?.listed ?? {}).length, conservation: s.civ.heritage?.conservation ?? [], disputes: s.civ.heritage?.disputes.length ?? 0,
    landValueAvg: Math.round(built.reduce((x, p) => x + plotValue(p), 0) / Math.max(1, built.length)),
    utilities: Object.fromEntries(Object.entries(s.civ.infra).map(([k, m]) => [k, Math.max(0, ...Object.values(m))])), utilityWorks: s.civ.stats.utilityWorks, upkeep: s.civ.stats.upkeepPaid,
    roads, trips: s.civ.transport.trips, archiveRecords: Object.values(s.civ.archive).reduce((x, l) => x + l.length, 0),
    unservedTall: tall.filter((p) => unmetNeeds(s, p, p.building.type, p.building.era).length).length,
  };
}

/** Milestone 5 metrics at a point in time. */
export function milestone5(s) {
  const fin = s.finance ? financeSummary(s) : null;
  const m = s.military;
  return {
    banking: fin && { banks: fin.banks.filter((b) => b.status !== 'FAILED').length, failures: fin.failures, deposits: fin.deposits, outstanding: fin.outstanding, loans: fin.loans, issued: fin.issued, defaults: fin.defaults, writtenOff: fin.writtenOff },
    guilds: (s.guilds?.list ?? []).filter((g) => g.status === 'ACTIVE').map((g) => `${g.key}:${g.members.length}${g.plotId ? '+hall' : ''}`),
    faith: s.faith ? affiliationCounts(s) : null,
    faithBuildings: (s.faith?.communities ?? []).filter((x) => x.tier).map((x) => `${x.tradition}:${x.tier}`),
    alliances: (s.diplomacy?.treaties ?? []).filter((t) => t.status === 'ACTIVE' && (t.kind === 'defense' || t.kind === 'assistance_mil')).length,
    wars: m?.wars.length ?? 0, activeWars: (m?.wars ?? []).filter((w) => w.status === 'ACTIVE').length, battles: m?.nextId.battle ?? 0, sieges: m?.nextId.siege ?? 0,
    peaceTreaties: (s.diplomacy?.treaties ?? []).filter((t) => t.kind === 'peace' || t.kind === 'ceasefire' || t.kind === 'border').length,
    disputes: (m?.disputes ?? []).map((d) => `${d.id}:${d.status}:${d.controller}`),
    plannedDistricts: Object.values(s.city?.districts ?? {}).filter((d) => d.origin === 'planned').length, plots: s.plots.length,
    developments: (s.city?.developments ?? []).length, foreignNamed: Object.keys(s.foreign?.people ?? {}).length,
    chronicle: s.chronicle.length, refugees: s.citizens.filter((c) => c.refugee).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const seed of seeds) {
    const t0 = Date.now();
    const sim = new Simulation(createKingdom(seed));
    const money = totalMoney(sim.state);
    let peak = 0, generations = 1, minPop = Infinity;
    const series = [];
    for (let y = 1; y <= years; y++) {
      sim.runDays(DAYS_PER_YEAR);
      const s = sim.state;
      peak = Math.max(peak, s.citizens.length);
      minPop = Math.min(minPop, s.citizens.length);
      for (const c of s.citizens) generations = Math.max(generations, c.generation);
      if (totalMoney(s) !== money) fail(seed, y, `money not conserved (${totalMoney(s)} vs ${money})`);
      if (y % 10 === 0) checkInvariants(s, seed, y);
      // Holidays keep happening in every age (checked on the Winter Festival's day each century).
      if (y % 100 === 50) { const h = s.holidays?.log?.filter((e) => e.year >= yearOf(s.day) - 5) ?? []; if (!h.length) fail(seed, y, 'no holiday celebrated in the last five years'); }
      // Save and reload at each age: the architecture and history survive exactly.
      if (y % 100 === 1 && y > 1) {
        const loaded = deserialize(serialize(s, 'longevity'));
        if (JSON.stringify(loaded.civ) !== JSON.stringify(s.civ)) fail(seed, y, 'civilization state changed across a save and reload');
        if (JSON.stringify(loaded.plots) !== JSON.stringify(s.plots)) fail(seed, y, 'plots changed across a save and reload');
      }
      if (y % 25 === 0) series.push(regional(s, y));
      if (y % 25 === 0) { const c = civilization(s); console.log(`  seed ${seed} year ${y}: population ${s.citizens.length}, age ${c?.age}, eras ${c?.byEra.join('/')}, towers ${c?.skyscrapers}, listed ${c?.listed}, state ${(JSON.stringify(s).length / 1024).toFixed(0)} KB, heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MB, ${((Date.now() - t0) / 1000).toFixed(0)}s`); }
    }
    const s = sim.state;
    const dead = Object.values(s.archive).filter((p) => p.status === 'dead');
    const chron = s.chronicle;
    console.log(JSON.stringify({
      seed, years, seconds: Math.round((Date.now() - t0) / 1000),
      peakPopulation: peak, minPopulation: minPop, finalPopulation: s.citizens.length,
      births: s.stats.births, deaths: s.stats.deaths, immigrants: s.stats.immigrants, emigrants: s.stats.emigrants, marriages: s.stats.marriages,
      generations, elections: s.stats.elections,
      businessesCreated: s.businesses.length, businessesClosed: s.businesses.filter((b) => !isTrading(b)).length,
      propertyTransfers: chron.filter((e) => /purchased|Inherited|passed to/.test(e.text)).length + s.estates.length,
      buildingsDestroyed: (s.eventLog ?? []).filter((e) => e.type === 'buildingDestroyed').length + chron.filter((e) => /burned to the ground/.test(e.text)).length,
      fires: s.stats.fires, discoveries: Object.keys(s.discoveries ?? {}).length,
      eras: s.eras.map((e) => e.name), hungerDeaths: dead.filter((p) => p.cause === 'hunger').length,
      founderBiographiesKept: ['Ada', 'Bram', 'Cora', 'Dain', 'Elin'].every((n) => [...s.citizens, ...Object.values(s.archive)].some((p) => p.firstName === n && p.founder)),
      stateKB: Math.round(JSON.stringify(s).length / 1024), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      msPerTick: Math.round(((Date.now() - t0) / (years * DAYS_PER_YEAR * TIME.ticksPerDay)) * 1000) / 1000,
      hungerCauses: dead.filter((p) => p.cause === 'hunger').reduce((m, p) => ({ ...m, [p.hungerCause ?? 'unrecorded']: (m[p.hungerCause ?? 'unrecorded'] ?? 0) + 1 }), {}),
      regional: regional(s, years), every25Years: series,
    }));
    if (s.citizens.length < 5) fail(seed, years, 'population collapsed');
    if (s.stats.births < years / 4) fail(seed, years, `too few births (${s.stats.births})`);
  }
  console.log(failures ? `${failures} failure(s)` : 'longevity: all invariants held');
  process.exit(failures ? 1 : 0);
}
