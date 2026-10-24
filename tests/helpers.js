import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { totalMoney } from '../src/economy/Transactions.js';

export const makeSim = (seed = 7) => new Simulation(createKingdom(seed));
export const byName = (state, name) => state.citizens.find((c) => c.firstName === name);
export const bizByName = (state, name) => state.businesses.find((b) => b.name === name);
export { totalMoney };

/** Find any NaN / Infinity anywhere in a JSON-able object. */
export function badNumbers(obj, path = '') {
  const out = [];
  if (typeof obj === 'number' && !Number.isFinite(obj)) out.push(path);
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) out.push(...badNumbers(v, `${path}.${k}`));
  return out;
}

export function setHour(state, hour) { state.minute = hour * 60; }
