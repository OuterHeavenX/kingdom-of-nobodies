import { isNewSeason } from '../core/Calendar.js';
import { balance, transfer } from '../economy/Transactions.js';
import { isTrading } from '../economy/Businesses.js';
import { record } from '../society/Chronicle.js';
import { CIV } from '../core/Config.js';

// The technology registry. Every technology belongs to an age (the earliest
// it can be adopted), may need other technologies first, and has local needs
// read from the simulation: trades that must be working, people enough to
// support it, buildings that must already stand. The council adopts one at a
// time and pays real coins to the wider world for the engineers, licences
// and machinery. If the treasury cannot pay, the technology waits.

const trading = (state, type) => state.businesses.filter((b) => b.type === type && isTrading(b)).length;
const builtFrom = (state, era) => state.plots.filter((p) => p.building && (p.building.era ?? 1) >= era && p.building.type !== 'ruins').length;
const has = (state, id) => !!state.civ?.tech?.[id];
const pop = (state) => state.citizens.length;

/**
 * `needs(state)` returns null when local conditions are met, or a reason.
 * `unlocks` is descriptive; other systems ask `hasTech(state, id)`.
 */
export const TECHNOLOGIES = [
  // --- Age of Foundations -------------------------------------------------------
  { id: 'timber_framing', name: 'Timber framing', age: 1, cost: 0, requires: [], icon: '🪵', founding: true,
    effect: 'Cottages, farmsteads, workshops and taverns of timber, wattle and thatch.', needs: () => null },
  { id: 'masonry', name: 'Stone masonry', age: 1, cost: 30, requires: ['timber_framing'], icon: '🧱',
    effect: 'Stone-built houses that weather the years more slowly.',
    needs: (s) => (pop(s) < 20 ? 'needs at least 20 villagers' : trading(s, 'blacksmith') < 1 ? 'needs a working smithy for chisels' : null) },
  { id: 'watermills', name: 'Water and wind mills', age: 1, cost: 40, requires: ['masonry'], icon: '🌬️',
    effect: 'Farms and bakeries grind and pump with mill power (+8% output).',
    needs: (s) => (trading(s, 'farm') < 2 ? 'needs two working farms' : null) },
  // --- Industrial Awakening ------------------------------------------------------
  { id: 'brickworks', name: 'Brickworks', age: 2, cost: 60, requires: ['masonry'], icon: '🧱',
    effect: 'Brick townhouses, warehouses and civic buildings (Industrial architecture).',
    needs: (s) => (trading(s, 'lumberyard') + trading(s, 'blacksmith') < 1 ? 'needs a working lumberyard or smithy' : null) },
  { id: 'steam_power', name: 'Steam power', age: 2, cost: 90, requires: ['brickworks'], icon: '🚂',
    effect: 'Factories and steam machinery: rebuilt workshops produce 15% more.',
    needs: (s) => (trading(s, 'blacksmith') < 1 ? 'needs a working smithy to forge boilers' : null) },
  { id: 'gas_lighting', name: 'Gas lighting', age: 2, cost: 70, requires: ['brickworks'], icon: '🕯️',
    effect: 'Gas streetlights and the first local power network (power level 1).', needs: (s) => (pop(s) < 40 ? 'needs a town of 40 people' : null) },
  { id: 'piped_water', name: 'Piped water', age: 2, cost: 80, requires: ['brickworks'], icon: '🚰',
    effect: 'Water mains (water level 2): less disease, and needed for apartments.', needs: (s) => (pop(s) < 50 ? 'needs a town of 50 people' : null) },
  { id: 'railway', name: 'Railways', age: 2, cost: 140, requires: ['steam_power'], icon: '🛤️',
    effect: 'Freight rail to the other kingdoms: caravans travel 35% faster; a railway station (transit level 1).',
    needs: (s) => (pop(s) < 60 ? 'needs a town of 60 people' : builtFrom(s, 2) < 2 ? 'needs two brick-era buildings already standing' : null) },
  { id: 'telegraph', name: 'Telegraph', age: 2, cost: 60, requires: ['railway'], icon: '📡', effect: 'Wires along the railway (communications level 1).', needs: () => null },
  // --- Modern Expansion -----------------------------------------------------------
  { id: 'electricity', name: 'Electric power', age: 3, cost: 160, requires: ['steam_power', 'gas_lighting'], icon: '⚡',
    effect: 'An electric grid (power level 2), electric streetlights and lit windows.', needs: () => null },
  { id: 'reinforced_concrete', name: 'Reinforced concrete', age: 3, cost: 150, requires: ['brickworks', 'electricity'], icon: '🏗️',
    effect: 'Modern architecture: concrete apartments, offices and suburban homes.', needs: (s) => (builtFrom(s, 2) < 4 ? 'needs four industrial-era buildings standing' : null) },
  { id: 'sanitation', name: 'Modern sanitation', age: 3, cost: 120, requires: ['piped_water', 'reinforced_concrete'], icon: '🚿',
    effect: 'Sewers and treatment (water level 3): disease spreads half as easily.', needs: () => null },
  { id: 'automobile', name: 'Motor cars', age: 3, cost: 170, requires: ['electricity'], icon: '🚗',
    effect: 'Cars and lorries: long trips in town are faster, freight 60% faster, asphalt roads.', needs: (s) => ((s.roads?.length ?? 0) < 12 ? 'needs a road network of 12 roads' : null) },
  { id: 'telephone', name: 'Telephone', age: 3, cost: 90, requires: ['telegraph', 'electricity'], icon: '☎️', effect: 'Telephone exchanges (communications level 2).', needs: () => null },
  { id: 'public_transit', name: 'Public buses', age: 3, cost: 120, requires: ['automobile'], icon: '🚌',
    effect: 'Bus routes (transit level 2): needed for high-rise living.', needs: (s) => (pop(s) < 100 ? 'needs a town of 100 people' : null) },
  { id: 'hospital_care', name: 'Modern medicine', age: 3, cost: 130, requires: ['sanitation'], icon: '🏥',
    effect: 'A hospital: infant deaths and disease fall.', needs: (s) => (pop(s) < 90 ? 'needs a town of 90 people' : null) },
  // --- Metropolitan Age -----------------------------------------------------------
  { id: 'steel_glass', name: 'Steel and glass', age: 4, cost: 240, requires: ['reinforced_concrete', 'electricity'], icon: '🏙️',
    effect: 'Glass skyscrapers, condominiums and contemporary homes (Metropolitan architecture).', needs: (s) => (builtFrom(s, 3) < 4 ? 'needs four modern buildings standing' : null) },
  { id: 'digital_networks', name: 'Digital networks', age: 4, cost: 180, requires: ['telephone'], icon: '💻',
    effect: 'Fibre and data (communications level 3): smart buildings and automated traffic.', needs: () => null },
  { id: 'rapid_transit', name: 'Rapid transit', age: 4, cost: 260, requires: ['public_transit', 'steel_glass'], icon: '🚇',
    effect: 'Metro and fast trains (transit level 3): freight twice as fast.', needs: (s) => (pop(s) < 140 ? 'needs a city of 140 people' : null) },
  { id: 'renewables', name: 'Renewable energy', age: 4, cost: 220, requires: ['electricity', 'digital_networks'], icon: '☀️',
    effect: 'Wind and solar power (power level 3).', needs: () => null },
  // --- Age of Tomorrow ----------------------------------------------------------------
  { id: 'smart_materials', name: 'Smart materials', age: 5, cost: 300, requires: ['steel_glass', 'renewables'], icon: '🌿',
    effect: 'Solar glass and living walls: futuristic towers and villas (Tomorrow architecture).', needs: (s) => (builtFrom(s, 4) < 4 ? 'needs four metropolitan buildings standing' : null) },
  { id: 'fusion_grid', name: 'Advanced clean grid', age: 5, cost: 280, requires: ['renewables'], icon: '🔆', effect: 'Storage and clean generation (power level 4).', needs: () => null },
  { id: 'autonomous_vehicles', name: 'Autonomous vehicles', age: 5, cost: 300, requires: ['rapid_transit', 'digital_networks'], icon: '🛸',
    effect: 'Self-driving pods and automated cargo (transit level 4): the fastest trips of all.', needs: () => null },
  { id: 'robotics', name: 'Robotics', age: 5, cost: 260, requires: ['smart_materials', 'digital_networks'], icon: '🤖',
    effect: 'Automated production: rebuilt workshops produce 30% more.', needs: () => null },
  { id: 'smart_infrastructure', name: 'Smart infrastructure', age: 5, cost: 240, requires: ['autonomous_vehicles'], icon: '🛰️',
    effect: 'Intelligent roads and utilities (communications level 4).', needs: () => null },
];

export const TECH_BY_ID = Object.fromEntries(TECHNOLOGIES.map((t) => [t.id, t]));
export const hasTech = (state, id) => has(state, id);

/** Why a technology is not adopted yet (null if it can be adopted now). */
export function techBlocker(state, t) {
  if (has(state, t.id)) return 'adopted';
  if ((state.civ?.age ?? 1) < t.age) return `opens in the ${['', 'Age of Foundations', 'Industrial Awakening', 'Modern Expansion', 'Metropolitan Age', 'Age of Tomorrow'][t.age]}`;
  const missing = t.requires.filter((r) => !has(state, r));
  if (missing.length) return `needs ${missing.map((r) => TECH_BY_ID[r].name).join(' and ')}`;
  const why = t.needs(state);
  if (why) return why;
  if (balance(state, 'treasury') < t.cost + CIV.techReserve) return `the treasury needs ${t.cost + CIV.techReserve} coins (cost ${t.cost} plus a reserve)`;
  return null;
}

/** Adopt a technology (pays the wider world). Returns true on success. */
export function adoptTech(state, t, by = 'the council') {
  if (techBlocker(state, t)) return false;
  if (t.cost && !transfer(state, 'treasury', 'outside', t.cost, 'expense', `Adopting ${t.name}`)) return false;
  state.civ.tech[t.id] = state.day;
  state.civ.techLog.push({ id: t.id, day: state.day, cost: t.cost });
  if (state.civ.techLog.length > 60) state.civ.techLog.shift();
  if (!t.founding) record(state, 'council', `${by === 'the council' ? 'The council' : by} adopted ${t.name} for ${t.cost} coins: ${t.effect}`, {}, 3);
  return true;
}

/** Each new season the council adopts the cheapest technology it can (one a season). */
export function seasonalTechnology(state) {
  if (!isNewSeason(state.day)) return null;
  const last = state.civ.techLog.at(-1);
  if (last && state.day - last.day < CIV.techSpacingDays) return null;
  const open = TECHNOLOGIES.filter((t) => !techBlocker(state, t)).sort((a, b) => a.age - b.age || a.cost - b.cost || a.id.localeCompare(b.id));
  const t = open[0];
  return t && adoptTech(state, t) ? t : null;
}

/** Status of every technology, for the Era & Technology panel. */
export function techStatus(state) {
  return TECHNOLOGIES.map((t) => ({ ...t, adoptedDay: state.civ?.tech?.[t.id] ?? null, blocker: has(state, t.id) ? null : techBlocker(state, t) }));
}
