import { MILITARY } from '../core/Config.js';
import { seasonIndex } from '../core/Calendar.js';
import { HEARTH, SETTLEMENT_POS, TERRAIN_SPEED, QUALITY_SPEED } from '../region/RegionData.js';
import { planJourney, routeById, routeQuality, routeClosed, settlementName } from '../region/RegionManager.js';

// Armies are bodies of soldiers with a commander, supplies and a destination.
// They march along the regional roads in simulated time, slowed by terrain,
// poor roads, winter and hunger; they never jump from place to place. A
// position is always a route and a distance along it, or a settlement.

export function ensureMilitary(state) {
  if (state.military) return state.military;
  state.military = { forces: {}, armies: [], wars: [], battles: [], sieges: [], disputes: [], aggressions: {}, nextId: { army: 0, war: 0, battle: 0, siege: 0, dispute: 0 }, history: [] };
  return state.military;
}

export const armyById = (state, id) => ensureMilitary(state).armies.find((a) => a.id === id) ?? null;
export const liveArmies = (state) => ensureMilitary(state).armies.filter((a) => a.status !== 'DISBANDED');

/** Marching speed in km/h on a route. */
export function marchSpeed(state, route, army) {
  let v = MILITARY.marchKmh * TERRAIN_SPEED[route.terrain] * QUALITY_SPEED[routeQuality(state, route)];
  if (seasonIndex(state.day) === 3) v *= route.terrain === 'mountain' ? 0.55 : 0.75;
  if (army.supplies <= 0) v *= 0.7;
  if (state.weather?.today?.kind === 'rain' || state.weather?.today?.kind === 'snow') v *= 0.85;
  return Math.max(0.6, v);
}

/**
 * Plan a march to a target: a settlement, or the middle of a route (a field).
 * Returns the legs: [{ route, from, to, km, stopKm }] or null.
 */
export function planMarch(state, from, target) {
  if (target.kind === 'settlement') {
    const plan = planJourney(state, from, target.id);
    return plan ? plan.legs.map((l) => ({ ...l, km: routeById(l.route).km, stopKm: routeById(l.route).km })) : null;
  }
  const route = routeById(target.route);
  const ends = [route.a, route.b];
  let best = null;
  for (const entry of ends) {
    const plan = entry === from ? { legs: [], hours: 0 } : planJourney(state, from, entry);
    if (!plan) continue;
    if (!best || plan.hours < best.hours) best = { ...plan, entry };
  }
  if (!best) return null;
  const legs = best.legs.map((l) => ({ ...l, km: routeById(l.route).km, stopKm: routeById(l.route).km }));
  legs.push({ route: route.id, from: best.entry, to: best.entry === route.a ? route.b : route.a, km: route.km, stopKm: route.km / 2 });
  return legs;
}

export function createArmy(state, { owner, soldiers, commander, training, equipment, morale, supplies, warId, target, citizenIds = [] }) {
  const m = ensureMilitary(state);
  const id = 'ar' + ++m.nextId.army;
  const army = {
    id, owner, name: `${settlementName(owner)} ${citizenIds.length ? 'militia' : 'host'} ${m.nextId.army}`, commander, soldiers, startSoldiers: soldiers,
    training, equipment, morale, supplies, warId, target, citizenIds, status: 'MUSTERING', at: owner, legs: [], legIndex: 0, km: 0,
    musterUntil: state.day + 2, raisedDay: state.day, history: [], costs: 0,
  };
  m.armies.push(army);
  return army;
}

export function note(army, state, text) {
  army.history.push({ day: state.day, text });
  if (army.history.length > 14) army.history.shift();
}

/** Set an army marching toward its target (or home). */
export function orderMarch(state, army, target, why) {
  let legs;
  let startKm = 0;
  const leg = army.legs[army.legIndex];
  if (!army.at && leg) {
    // On the road or in a field: turn back or press on, whichever end of this road serves the target better.
    const route = routeById(leg.route);
    let best = null;
    for (const [end, dist] of [[leg.to, leg.km - army.km], [leg.from, army.km]]) {
      const rest = target.kind === 'settlement' && end === target.id ? [] : planMarch(state, end, target);
      if (!rest) continue;
      const total = dist + rest.reduce((h, l) => h + l.stopKm, 0);
      if (!best || total < best.total) best = { end, rest, total, dist };
    }
    if (best) {
      legs = [{ route: route.id, from: best.end === leg.to ? leg.from : leg.to, to: best.end, km: leg.km, stopKm: leg.km }, ...best.rest];
      startKm = leg.km - best.dist;
    }
    army.field = null;
  } else legs = planMarch(state, army.at ?? army.owner, target);
  if (!legs) { note(army, state, `Could not find an open road to ${describeTarget(state, target)}.`); return false; }
  army.target = target;
  army.legs = legs;
  army.legIndex = 0;
  army.km = startKm;
  army.at = legs.length ? null : army.at;
  army.status = why === 'retreat' ? 'RETREATING' : why === 'home' ? 'RETURNING' : 'MARCHING';
  if (!legs.length) arrive(state, army);
  else note(army, state, `${why === 'retreat' ? 'Retreating' : 'Marching'} toward ${describeTarget(state, target)} by the ${legs.map((l) => routeById(l.route).name).join(', ')}.`);
  return true;
}

export const describeTarget = (state, t) => (!t ? 'nowhere' : t.kind === 'settlement' ? settlementName(t.id) : t.name ?? routeById(t.route)?.name);

function arrive(state, army) {
  const leg = army.legs[army.legIndex];
  if (army.target.kind === 'settlement') {
    army.at = army.target.id;
    army.field = null;
  } else {
    army.at = null;
    army.field = army.target.route;
  }
  army.status = army.status === 'RETREATING' || army.status === 'RETURNING' ? 'HOME' : 'ENCAMPED';
  army.arrivedDay = state.day;
  note(army, state, `Arrived at ${describeTarget(state, army.target)}${leg ? '' : ''}.`);
}

/** Hourly: move every marching army along its road. */
export function marchArmies(state) {
  for (const army of liveArmies(state)) {
    if (!['MARCHING', 'RETREATING', 'RETURNING'].includes(army.status)) continue;
    const leg = army.legs[army.legIndex];
    if (!leg) { arrive(state, army); continue; }
    const route = routeById(leg.route);
    if (routeClosed(state, route) && army.km === 0) continue; // waits at the roadhead for a landslide or flood to clear
    army.km = Math.min(leg.stopKm, Math.round((army.km + marchSpeed(state, route, army)) * 100) / 100);
    if (army.km >= leg.stopKm) {
      if (army.legIndex + 1 < army.legs.length) { army.legIndex++; army.km = 0; army.at = null; }
      else arrive(state, army);
    }
  }
}

/** Map position of an army (km on the 100×100 regional map). */
export function armyPosition(state, army) {
  if (army.at) return { ...(SETTLEMENT_POS[army.at] ?? SETTLEMENT_POS[HEARTH]) };
  const leg = army.legs[army.legIndex] ?? army.legs.at(-1);
  if (!leg) return { ...SETTLEMENT_POS[army.owner] };
  const route = routeById(leg.route);
  let pts = route.points;
  if (leg.from !== route.a) pts = [...pts].reverse();
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
  let want = (army.km / leg.km) * total;
  for (let i = 1; i < pts.length; i++) {
    if (want <= seg[i - 1]) { const t = want / seg[i - 1]; return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t }; }
    want -= seg[i - 1];
  }
  return { x: pts.at(-1)[0], y: pts.at(-1)[1] };
}

/** Where an army is, in words. */
export function armyWhere(state, army) {
  if (army.status === 'MUSTERING') return `mustering at ${settlementName(army.owner)}`;
  if (army.status === 'ENCAMPED') return `encamped at ${describeTarget(state, army.target)}`;
  if (army.status === 'BESIEGING') return `besieging ${settlementName(army.at)}`;
  if (army.at) return `at ${settlementName(army.at)}`;
  const leg = army.legs[army.legIndex];
  return leg ? `on the ${routeById(leg.route).name}, ${Math.round(army.km)} of ${Math.round(leg.stopKm)} km` : 'in the field';
}
