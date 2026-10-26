import { isNewYear, yearOf } from '../core/Calendar.js';
import { CIV, DAYS_PER_YEAR } from '../core/Config.js';
import { hasTech } from './Technology.js';
import { ARCH_TECH, formOf, seedOf, floorsFor, centrality, formLabel } from './ArchitectureData.js';
import { serviceFactor } from './Infrastructure.js';

// The simulation side of architecture: which era new buildings are built in,
// what each building records about itself, and how buildings age.

/** The newest architectural era the town can actually build in: opened by the calendar AND by adopted technology. */
export function buildEra(state) {
  const age = state.civ?.age ?? 1;
  let era = 1;
  for (let e = 2; e <= age; e++) if (hasTech(state, ARCH_TECH[e])) era = e; else break;
  return era;
}

/** The era a given type would be built in now (a type may not exist before its first era). */
export function eraForType(state, type) {
  const e = buildEra(state);
  return formOf(type, e).era;
}

/**
 * Stamp architecture on a building as it is completed. `arch` may fix the era
 * (a rebuild to a chosen era) or carry an older record (a reconstruction).
 */
export function stampBuilding(state, plot, b, arch = null) {
  const era = arch?.era ?? eraForType(state, b.type);
  b.era = era;
  b.seed = arch?.seed ?? seedOf(`${plot.id}:${b.type}:${state.day}:${state.civ?.stats?.built ?? 0}`);
  b.floors = arch?.floors ?? floorsFor(b.type, era, b.seed, plot);
  b.condition = b.condition ?? 100;
  b.style = formLabel(b);
  if (state.civ) state.civ.stats.built++;
}

/** Ageing: buildings lose a little condition each year (newer materials weather more slowly). */
export function yearlyWear(state) {
  if (!isNewYear(state.day)) return;
  for (const p of state.plots) {
    const b = p.building;
    if (!b || b.type === 'ruins' || b.type === 'grounds' || p.projectId) continue;
    const years = (state.day - (b.rebuiltDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR;
    if (years < 20) continue;
    const stone = b.seed % 3 === 1 && (b.era ?? 1) === 1 && hasTech(state, 'masonry');
    const wear = CIV.wearPerYear[b.era ?? 1] * (stone ? 0.6 : 1) * (years > 80 ? 1.4 : 1);
    if ((b.condition ?? 100) > CIV.wearFloor) b.condition = Math.max(CIV.wearFloor, Math.round(((b.condition ?? 100) - wear) * 10) / 10);
  }
}

/** Land in the centre is worth more as the town grows into a city. */
export function landFactor(state, plot) {
  const age = state.civ?.age ?? 1;
  return 1 + (age - 1) * 0.18 * centrality(plot);
}

/** Production bonus of a business's premises, from its architecture and the town's technology. */
export function premisesProductivity(state, b, plot) {
  const bd = plot?.building;
  if (!bd) return 1;
  let f = 1;
  const era = bd.era ?? 1;
  if (['farm', 'bakery'].includes(b.type) && hasTech(state, 'watermills')) f *= 1.08;
  if (['lumberyard', 'blacksmith', 'bakery', 'farm'].includes(b.type)) {
    if (era >= 2 && hasTech(state, 'steam_power')) f *= 1.15;
    if (era >= 5 && hasTech(state, 'robotics')) f *= 1.3;
  }
  return f * serviceFactor(state, plot);
}

/** Extra staff a business can take on in modern premises. */
export const premisesStaff = (plot) => (plot?.building ? formOf(plot.building.type, plot.building.era ?? 1).staff ?? 0 : 0);

/** Statistics for the City Evolution dashboard. */
export function architectureStats(state) {
  const byEra = [0, 0, 0, 0, 0, 0];
  let tallest = null, valuable = null, tall = 0, total = 0, modern = 0;
  for (const p of state.plots) {
    const b = p.building;
    if (!b || b.type === 'ruins' || b.type === 'grounds') continue;
    total++;
    byEra[b.era ?? 1]++;
    if ((b.era ?? 1) >= 2) modern++;
    const f = formOf(b.type, b.era ?? 1);
    if (f.tall && (b.floors ?? 1) >= 7) tall++;
    if (!tallest || (b.floors ?? 1) > (tallest.building.floors ?? 1)) tallest = p;
  }
  return { byEra, total, modern, modernPct: total ? Math.round((modern / total) * 100) : 0, tall, tallest, valuable, year: yearOf(state.day) };
}
