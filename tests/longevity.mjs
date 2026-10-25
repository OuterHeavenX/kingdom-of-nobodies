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

const years = Number(process.argv[2] ?? 200);
const seeds = (process.argv[3] ?? '1,2,3').split(',').map(Number);
let failures = 0;
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
    if (p.ownerId !== 'council' && !ids.has(p.ownerId)) fail(seed, year, `plot ${p.name} owned by absent ${p.ownerId}`);
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
      if (y % 25 === 0) series.push(regional(s, y));
      if (y % 25 === 0) console.log(`  seed ${seed} year ${y}: population ${s.citizens.length}, archive ${Object.keys(s.archive).length}, state ${(JSON.stringify(s).length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
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
      stateKB: Math.round(JSON.stringify(s).length / 1024),
      hungerCauses: dead.filter((p) => p.cause === 'hunger').reduce((m, p) => ({ ...m, [p.hungerCause ?? 'unrecorded']: (m[p.hungerCause ?? 'unrecorded'] ?? 0) + 1 }), {}),
      regional: regional(s, years), every25Years: series,
    }));
    if (s.citizens.length < 5) fail(seed, years, 'population collapsed');
    if (s.stats.births < years / 4) fail(seed, years, `too few births (${s.stats.births})`);
  }
  console.log(failures ? `${failures} failure(s)` : 'longevity: all invariants held');
  process.exit(failures ? 1 : 0);
}
