import { roadWeather } from '../events/Weather.js';
import { transfer, balance } from '../economy/Transactions.js';
import { seasonIndex } from '../core/Calendar.js';
import { chance, pick, nextRandom, intRange } from '../core/Random.js';
import { record } from '../society/Chronicle.js';
import { hasBridge } from '../navigation/RoadNetwork.js';
import { HEARTH, KINGDOMS, ROUTES, LANDMARKS, SETTLEMENT_POS, TERRAIN_SPEED, QUALITY_SPEED, CART_KMH } from './RegionData.js';
import { createKingdomState, simulateKingdom, kingdomNote } from './Settlement.js';

// The region beyond the valley: three kingdoms, the roads between them, what
// First Hearth knows of the map, and the weather and troubles of the roads.

const FOG = 10; // the map is a 10 × 10 grid of 10 km cells

export const KINGDOM_IDS = Object.keys(KINGDOMS);
export const settlementName = (id) => (id === HEARTH ? 'First Hearth' : KINGDOMS[id]?.name ?? id);
export const kingdomAccount = (id) => KINGDOMS[id]?.account;

/** Create the region (new games and Milestone 3 saves alike). */
export function ensureRegion(state) {
  if (state.region) return state.region;
  const rand = () => nextRandom(state);
  const settlements = {};
  const funds = { greenvale: 3200, ironhold: 4200, saltmere: 5200 };
  for (const id of KINGDOM_IDS) {
    settlements[id] = createKingdomState(id, rand);
    settlements[id].leader.since = state.day;
    state.accounts[KINGDOMS[id].account] = 0;
    transfer(state, 'outside', KINGDOMS[id].account, Math.min(funds[id], balance(state, 'outside') - 1000), 'founding', `${KINGDOMS[id].name}'s merchants and treasury`);
  }
  state.region = {
    settlements,
    fog: '0'.repeat(FOG * FOG),
    discovered: { routes: ROUTES.filter((r) => !r.hidden).map((r) => r.id), landmarks: LANDMARKS.filter((l) => !l.hidden).map((l) => l.id) },
    closures: [],
    expeditions: [],
    history: [],
    quarry: null,
  };
  // Merchants have always known the main roads: reveal them and the kingdoms.
  for (const r of ROUTES.filter((x) => !x.hidden)) for (const [x, y] of r.points) reveal(state, x, y, 2);
  for (const p of Object.values(SETTLEMENT_POS)) reveal(state, p.x, p.y, 6);
  return state.region;
}

/** Mark map cells within a radius (km) as explored. */
export function reveal(state, x, y, radius) {
  const r = state.region;
  const cells = r.fog.split('');
  let found = 0;
  for (let j = 0; j < FOG; j++) for (let i = 0; i < FOG; i++) {
    if (Math.hypot(i * 10 + 5 - x, j * 10 + 5 - y) <= radius + 5 && cells[j * FOG + i] === '0') { cells[j * FOG + i] = '1'; found++; }
  }
  r.fog = cells.join('');
  return found;
}
export const isExplored = (state, x, y) => state.region.fog[Math.min(FOG - 1, Math.floor(y / 10)) * FOG + Math.min(FOG - 1, Math.floor(x / 10))] === '1';
export const exploredShare = (state) => state.region.fog.split('').filter((c) => c === '1').length / (FOG * FOG);

export const routeById = (id) => ROUTES.find((r) => r.id === id);
export const routeKnown = (state, route) => state.region.discovered.routes.includes(route.id);

/** Why a route cannot be used right now (null if it can). */
export function routeClosed(state, route) {
  const c = state.region.closures.find((x) => x.routeId === route.id && x.until >= state.day && x.closed);
  if (c) return c.reason;
  if (route.crossing && (state.region.floodUntil ?? 0) >= state.day && !hasBridge(state)) return 'the ford is flooded';
  return null;
}

/** Travel speed on a route in km per hour, with the reasons it is slower than usual. */
export function routeSpeed(state, route, load = 0) {
  const why = [];
  let speed = CART_KMH * TERRAIN_SPEED[route.terrain] * QUALITY_SPEED[routeQuality(state, route)];
  if (seasonIndex(state.day) === 3) { speed *= route.terrain === 'mountain' ? 0.6 : 0.78; why.push('winter roads'); }
  for (const c of state.region.closures) if (c.routeId === route.id && c.until >= state.day && !c.closed) { speed *= c.factor; why.push(c.reason); }
  speed *= 1 - 0.25 * Math.min(1, load);
  const w = roadWeather(state);
  if (w < 1) { speed *= w; why.push(state.weather.today.kind === 'snow' ? 'snow on the roads' : state.weather.today.kind === 'fog' ? 'fog' : 'rain'); }
  return { speed: Math.max(0.6, speed), why };
}

export function routeQuality(state, route) {
  if (route.id === 'river-road' && state.region.discovered.landmarks.includes('shepherds-bridge')) return 'stone';
  return route.quality;
}

/** Hours to cross a route, including the river crossing at First Hearth. */
export function routeHours(state, route, load = 0) {
  let hours = route.km / routeSpeed(state, route, load).speed;
  if (route.crossing && !hasBridge(state)) hours += 1.5; // unloading and wading at the ford
  return hours;
}

/** Shortest open route between two settlements by travel time (Dijkstra over 4 nodes). */
export function planJourney(state, from, to, { allow = () => true } = {}) {
  const nodes = [HEARTH, ...KINGDOM_IDS];
  const dist = Object.fromEntries(nodes.map((n) => [n, Infinity]));
  const via = {};
  dist[from] = 0;
  const open = new Set(nodes);
  while (open.size) {
    const cur = [...open].sort((a, b) => dist[a] - dist[b])[0];
    open.delete(cur);
    if (dist[cur] === Infinity || cur === to) break;
    for (const r of ROUTES) {
      if (r.a !== cur && r.b !== cur) continue;
      if (!routeKnown(state, r) || routeClosed(state, r) || !allow(r)) continue;
      const next = r.a === cur ? r.b : r.a;
      const d = dist[cur] + routeHours(state, r);
      if (d < dist[next]) { dist[next] = d; via[next] = { from: cur, route: r.id }; }
    }
  }
  if (dist[to] === Infinity) return null;
  const legs = [];
  for (let n = to; n !== from; n = via[n].from) legs.unshift({ route: via[n].route, from: via[n].from, to: n });
  return { legs, hours: dist[to] };
}

/** Daily regional events: weather, closures, harvests and mines. All have real effects. */
export function regionalEvents(state) {
  const r = state.region;
  r.closures = r.closures.filter((c) => c.until >= state.day);
  const season = seasonIndex(state.day);
  const say = (text, importance = 2) => {
    r.history.push({ day: state.day, text });
    if (r.history.length > 60) r.history.shift();
    record(state, 'region', text, {}, importance);
  };
  if (chance(state, [0.04, 0.03, 0.08, 0.1][season])) {
    const route = pick(state, ROUTES.filter((x) => routeKnown(state, x)));
    const days = intRange(state, 1, 2);
    r.closures.push({ routeId: route.id, until: state.day + days, factor: 0.45, reason: 'storms', closed: false });
    say(`Storms are slowing travel on the ${route.name}.`, 1);
  }
  if (chance(state, [0.035, 0.01, 0.015, 0.03][season])) {
    const route = pick(state, ROUTES.filter((x) => x.terrain === 'mountain' && routeKnown(state, x)));
    if (route && !r.closures.some((c) => c.routeId === route.id && c.closed)) {
      r.closures.push({ routeId: route.id, until: state.day + intRange(state, 2, 4), reason: 'a landslide', closed: true });
      say(`A landslide has closed the ${route.name}; caravans must wait or go around.`);
    }
  }
  if (season === 0 && chance(state, 0.06) && (r.floodUntil ?? 0) < state.day) {
    r.floodUntil = state.day + intRange(state, 1, 2);
    say(hasBridge(state) ? 'The Hearth river is in spate, but carts cross safely on the bridge.' : 'Spring floods have made the ford at First Hearth impassable.');
  }
  const kingdoms = r.settlements;
  if ((season === 1 || season === 2) && chance(state, 0.012)) {
    kingdoms.greenvale.modifiers.push({ goods: ['grain', 'provisions'], factor: 0.5, until: state.day + 6, why: 'a poor harvest' });
    kingdomNote(state, kingdoms.greenvale, 'blight has ruined part of the harvest; grain will be scarce this season.', 2);
  }
  if (chance(state, 0.006)) {
    kingdoms.ironhold.modifiers.push({ goods: ['ore', 'stone', 'iron'], factor: 0.5, until: state.day + 6, why: 'a mine collapse' });
    kingdoms.ironhold.population = Math.max(40, kingdoms.ironhold.population - intRange(state, 2, 6));
    kingdoms.ironhold.leader.approval = Math.max(0, kingdoms.ironhold.leader.approval - 10);
    kingdomNote(state, kingdoms.ironhold, 'a gallery collapsed in the deep mines; miners died and output has halved.', 2);
  }
  if (chance(state, 0.01)) {
    const good = chance(state, 0.5);
    kingdoms.saltmere.modifiers.push({ goods: ['fish'], factor: good ? 1.6 : 0.5, until: state.day + 5, why: good ? 'a great shoal' : 'empty seas' });
    kingdomNote(state, kingdoms.saltmere, good ? 'the fleets came home heavy with a great shoal.' : 'the fishing fleets are coming home empty.', 1);
  }
  if (chance(state, 0.004)) {
    const k = kingdoms[pick(state, KINGDOM_IDS)];
    const lost = Math.round(k.population * 0.03);
    k.population -= lost;
    kingdomNote(state, k, `a fever has carried off about ${lost} people.`, 2);
  }
}

/** Daily: everything that happens beyond the valley. */
export function dailyRegion(state) {
  ensureRegion(state);
  for (const id of KINGDOM_IDS) simulateKingdom(state, state.region.settlements[id]);
  regionalEvents(state);
}
