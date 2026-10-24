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
  if (JSON.stringify(s).match(/NaN|Infinity/)) fail(seed, year, 'NaN or Infinity in state');
  return failures - before;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const seed of seeds) {
    const t0 = Date.now();
    const sim = new Simulation(createKingdom(seed));
    const money = totalMoney(sim.state);
    let peak = 0, generations = 1, minPop = Infinity;
    for (let y = 1; y <= years; y++) {
      sim.runDays(DAYS_PER_YEAR);
      const s = sim.state;
      peak = Math.max(peak, s.citizens.length);
      minPop = Math.min(minPop, s.citizens.length);
      for (const c of s.citizens) generations = Math.max(generations, c.generation);
      if (totalMoney(s) !== money) fail(seed, y, `money not conserved (${totalMoney(s)} vs ${money})`);
      if (y % 10 === 0) checkInvariants(s, seed, y);
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
    }));
    if (s.citizens.length < 5) fail(seed, years, 'population collapsed');
    if (s.stats.births < years / 4) fail(seed, years, `too few births (${s.stats.births})`);
  }
  console.log(failures ? `${failures} failure(s)` : 'longevity: all invariants held');
  process.exit(failures ? 1 : 0);
}
