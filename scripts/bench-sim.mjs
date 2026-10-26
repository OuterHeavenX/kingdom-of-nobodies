// Simulation benchmark: run a kingdom headless and report the cost per tick
// and a hash of the final state. Optimisations must leave the hash unchanged
// (same seed, same years → byte-identical world).
//   node scripts/bench-sim.mjs --seed 1 --years 25
//   node scripts/bench-sim.mjs --from saved-state.json --years 10
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { migrate } from '../src/core/Serialization.js';
import { DAYS_PER_YEAR, TIME } from '../src/core/Config.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const seed = Number(arg('seed', 1)), years = Number(arg('years', 25)), from = arg('from', null);

function fnv(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

const state = from ? migrate(JSON.parse(readFileSync(from, 'utf8'))) : createKingdom(seed);
const sim = new Simulation(state);
const t0 = process.hrtime.bigint();
sim.runDays(years * DAYS_PER_YEAR);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const ticks = years * DAYS_PER_YEAR * TIME.ticksPerDay;
const text = JSON.stringify({ ...sim.state, events: [] });
console.log(JSON.stringify({ seed, from, years, seconds: Math.round(ms / 100) / 10, msPerTick: Math.round((ms / ticks) * 1000) / 1000, population: sim.state.citizens.length, hash: fnv(text), kb: Math.round(text.length / 1024) }));
