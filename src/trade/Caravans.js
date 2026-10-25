import { balance, transfer } from '../economy/Transactions.js';
import { seasonIndex } from '../core/Calendar.js';
import { TIME } from '../core/Config.js';
import { record } from '../society/Chronicle.js';
import { COMMODITIES, HEARTH, SETTLEMENT_POS, KINGDOMS } from '../region/RegionData.js';
import { planJourney, routeById, routeClosed, routeSpeed, settlementName } from '../region/RegionManager.js';
import { routeAllowed, tradeBlocked, transitFee } from '../diplomacy/Diplomacy.js';
import { ensureTrade, contractById, loadContract, deliverContract, cancelContract, logCargo, possessive, sentence } from './Contracts.js';
import { spotSale } from './Markets.js';

// Caravans are carts with drovers, a capacity, a route and a schedule. They
// move by simulation time along the regional roads (slower in winter, in
// storms, when heavily laden), wait out landslides and floods, re-route when
// a road stays closed, and lose perishable cargo on long hot journeys. Every
// unit loaded is accounted for: delivered, sold, spoiled, or still aboard.

export const CARAVAN = { capacityCitizen: 36, capacityHouse: 50, loadTicks: 6, coinsPerHour: 0.3, fee: 2, waitDays: 3 };
const HOURS_PER_TICK = TIME.minutesPerTick / 60;

export const caravanById = (state, id) => ensureTrade(state).caravans.find((c) => c.id === id) ?? null;
export const cargoUnits = (cv) => Object.values(cv.cargo).reduce((a, b) => a + b, 0);

/** Create a caravan with a list of stops ({ at, action: 'load'|'unload'|'home', contracts }). */
export function createCaravan(state, { owner, home, stops, capacity }) {
  const t = ensureTrade(state);
  state.nextId.caravan = (state.nextId.caravan ?? 0) + 1;
  const cv = {
    id: 'cv' + state.nextId.caravan, ownerId: owner.id, ownerName: owner.name, account: owner.account, home,
    status: 'PLANNING', at: home, leg: null, journey: [], stops, stopIndex: 0, cargo: {}, capacity,
    departTick: state.tick, waitingSince: null, timer: 0, costs: 0, spoilAcc: {}, spoiled: {}, log: [],
  };
  t.caravans.push(cv);
  for (const s of stops) for (const id of s.contracts ?? []) { const c = contractById(state, id); if (c) c.caravanId = cv.id; }
  return cv;
}

function note(cv, state, text) {
  cv.log.push({ tick: state.tick, day: state.day, text });
  if (cv.log.length > 12) cv.log.shift();
}

/** Where a caravan is on the regional map (km coordinates). */
export function caravanPosition(cv) {
  if (!cv.leg) return { ...(SETTLEMENT_POS[cv.at] ?? SETTLEMENT_POS[HEARTH]) };
  const route = routeById(cv.leg.route);
  let pts = route.points;
  if (route.a !== cv.leg.from) pts = [...pts].reverse();
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let d = (cv.leg.progress / cv.leg.km) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? Math.min(1, d / lengths[i]) : 0;
      return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f };
    }
    d -= lengths[i];
  }
  return { ...SETTLEMENT_POS[cv.at ?? HEARTH] };
}

/** Hours left until the caravan reaches its next stop (estimate). */
export function hoursToNextStop(state, cv) {
  let h = 0;
  if (cv.leg) h += (cv.leg.km - cv.leg.progress) / routeSpeed(state, routeById(cv.leg.route), cargoUnits(cv) / cv.capacity).speed;
  for (const leg of cv.journey) h += routeById(leg.route).km / routeSpeed(state, routeById(leg.route)).speed;
  return h;
}

function startLeg(state, cv, leg) {
  const route = routeById(leg.route);
  cv.leg = { ...leg, km: route.km, progress: 0 };
  cv.at = null;
  cv.status = cargoUnits(cv) > 0 ? 'TRAVELING' : cv.stops[cv.stopIndex]?.action === 'home' ? 'RETURNING' : 'TRAVELING';
  // Drovers and animals are paid per hour of road.
  const hours = route.km / routeSpeed(state, route, cargoUnits(cv) / cv.capacity).speed;
  const cost = Math.max(1, Math.round(hours * CARAVAN.coinsPerHour));
  const paid = Math.min(cost, balance(state, cv.account));
  if (paid > 0 && transfer(state, cv.account, 'outside', paid, 'transport', `Drovers for ${possessive(cv.ownerName)} caravan on the ${route.name}`)) cv.costs += paid;
  const live = liveContracts(state, cv);
  for (const c of live) c.transportCost = (c.transportCost ?? 0) + paid / Math.max(1, live.length);
  if (route.crossing) ensureTrade(state).fordCrossings += 1;
  const fee = transitFee(state, route, cv.home);
  if (fee && transfer(state, cv.account, KINGDOMS[route.territory].account, Math.min(fee, balance(state, cv.account)), 'tariff', `Transit toll on the ${route.name}`)) cv.costs += fee;
  note(cv, state, `Set out on the ${route.name} towards ${settlementName(leg.to)}.`);
}

const liveContracts = (state, cv) => cv.stops.flatMap((s) => s.contracts ?? []).map((id) => contractById(state, id)).filter((c) => c && (c.status === 'AGREED' || c.status === 'IN_TRANSIT'));

function spoil(state, cv) {
  const summer = seasonIndex(state.day) === 1 ? 1.5 : seasonIndex(state.day) === 3 ? 0.5 : 1;
  const salted = (cv.cargo.salt ?? 0) > 0 ? 0.5 : 1;
  for (const [g, n] of Object.entries(cv.cargo)) {
    const rate = COMMODITIES[g]?.perishable ?? 0;
    if (!rate || n <= 0) continue;
    cv.spoilAcc[g] = (cv.spoilAcc[g] ?? 0) + n * rate * summer * salted * HOURS_PER_TICK / 24;
    const lost = Math.min(n, Math.floor(cv.spoilAcc[g]));
    if (lost > 0) {
      cv.spoilAcc[g] -= lost;
      cv.cargo[g] -= lost;
      cv.spoiled[g] = (cv.spoiled[g] ?? 0) + lost;
      ensureTrade(state).stats.spoiled += lost;
      logCargo(state, { caravanId: cv.id, kind: 'spoil', g, n: lost });
      if (cv.cargo[g] <= 0) delete cv.cargo[g];
    }
  }
}

/** Sell whatever is still aboard at a market (diverted or leftover cargo). */
function sellOff(state, cv, where) {
  for (const [g, n] of Object.entries({ ...cv.cargo })) {
    const sold = spotSale(state, where, g, n, cv.account, `${cv.ownerName} sold cargo in ${settlementName(where)}`);
    if (sold > 0) {
      cv.cargo[g] -= sold;
      logCargo(state, { caravanId: cv.id, kind: 'sold', g, n: sold, at: where });
      note(cv, state, `Sold ${sold} ${g} in ${settlementName(where)}.`);
    }
    if (cv.cargo[g] <= 0) delete cv.cargo[g];
  }
}

function handleStop(state, cv) {
  const stop = cv.stops[cv.stopIndex];
  if (!stop) { finish(state, cv); return; }
  if (stop.action === 'home') {
    if (cargoUnits(cv) > 0) sellOff(state, cv, cv.at);
    finish(state, cv);
    return;
  }
  if (cv.status !== 'LOADING' && cv.status !== 'UNLOADING') {
    cv.status = stop.action === 'load' ? 'LOADING' : 'UNLOADING';
    cv.timer = CARAVAN.loadTicks;
    return;
  }
  if (--cv.timer > 0) return;
  for (const id of stop.contracts ?? []) {
    const c = contractById(state, id);
    if (!c) continue;
    if (stop.action === 'load') {
      const blocked = tradeBlocked(state, c.origin, c.destination, c.merchantHome);
      if (blocked) { cancelContract(state, c, blocked); continue; }
      const n = loadContract(state, c, cv);
      if (n > 0) note(cv, state, `Loaded ${n} ${c.commodity} in ${settlementName(cv.at)}.`);
    } else {
      const blocked = tradeBlocked(state, c.origin, c.destination, c.merchantHome);
      if (blocked) { cancelContract(state, c, blocked); continue; }
      const n = deliverContract(state, c, cv);
      note(cv, state, `Delivered ${n} ${c.commodity} in ${settlementName(cv.at)}.`);
    }
  }
  // Undeliverable leftovers are sold where they are unless more deliveries lie ahead.
  const moreDeliveries = cv.stops.slice(cv.stopIndex + 1).some((s) => s.action === 'unload' && (s.contracts ?? []).some((id) => contractById(state, id)?.status === 'IN_TRANSIT'));
  if (stop.action === 'unload' && !moreDeliveries && cargoUnits(cv) > 0) sellOff(state, cv, cv.at);
  if (stop.action === 'load' && !liveContracts(state, cv).length) {
    // Nothing was loaded: abandon the run and head home.
    cv.stops = [...cv.stops.slice(0, cv.stopIndex + 1), { at: cv.home, action: 'home' }];
  }
  cv.stopIndex++;
  cv.status = 'PLANNING';
}

function finish(state, cv) {
  cv.status = 'COMPLETED';
  cv.completedTick = state.tick;
  cv.leg = null;
  const t = ensureTrade(state);
  const merchant = t.merchants[cv.ownerId];
  if (merchant) merchant.active = null;
  if (cv.home !== HEARTH && t.houses[cv.home]) t.houses[cv.home].active = Math.max(0, t.houses[cv.home].active - 1);
}

/** Advance one caravan by one tick. */
export function caravanTick(state, cv) {
  if (cv.status === 'COMPLETED' || cv.status === 'CANCELLED') return;
  if (cv.leg) {
    spoil(state, cv);
    const route = routeById(cv.leg.route);
    const closed = routeClosed(state, route);
    if (closed) {
      if (cv.status !== 'DELAYED') { cv.status = 'DELAYED'; cv.waitingSince = state.day; note(cv, state, `Held up: ${closed}.`); }
      if (state.day - cv.waitingSince >= CARAVAN.waitDays && cv.leg.progress < cv.leg.km / 2) {
        // Turn back to the last town and find another way.
        const back = cv.leg.from;
        note(cv, state, `Turned back to ${settlementName(back)} after waiting ${CARAVAN.waitDays} days.`);
        cv.leg = { ...cv.leg, from: cv.leg.to, to: back, progress: cv.leg.km - cv.leg.progress };
        cv.journey = [];
        cv.status = 'TRAVELING';
      }
      return;
    }
    if (cv.status === 'DELAYED') { cv.status = cargoUnits(cv) ? 'TRAVELING' : 'RETURNING'; cv.waitingSince = null; }
    cv.leg.progress = Math.min(cv.leg.km, cv.leg.progress + routeSpeed(state, route, cargoUnits(cv) / cv.capacity).speed * HOURS_PER_TICK);
    if (cv.leg.progress < cv.leg.km) return;
    cv.at = cv.leg.to;
    cv.leg = null;
    if (route.crossing) ensureTrade(state).fordCrossings += 1;
    if (cv.journey.length) { startLeg(state, cv, cv.journey.shift()); return; }
    cv.status = 'ARRIVED';
    note(cv, state, `Arrived in ${settlementName(cv.at)}.`);
    return;
  }
  const stop = cv.stops[cv.stopIndex];
  if (!stop) { finish(state, cv); return; }
  if (stop.at === cv.at) { handleStop(state, cv); return; }
  // Plan the way to the next stop.
  const plan = planJourney(state, cv.at, stop.at, { allow: routeAllowed(state, cv.home) });
  if (!plan) {
    if (cv.status !== 'DELAYED') { cv.status = 'DELAYED'; cv.waitingSince = state.day; note(cv, state, `No open road to ${settlementName(stop.at)}; waiting.`); }
    if (state.day - cv.waitingSince > CARAVAN.waitDays * 2) {
      for (const c of liveContracts(state, cv)) cancelContract(state, c, 'no open road');
      if (cargoUnits(cv) > 0) sellOff(state, cv, cv.at);
      if (cv.at === cv.home) finish(state, cv);
      else { cv.stops = [{ at: cv.home, action: 'home' }]; cv.stopIndex = 0; cv.waitingSince = state.day; }
      record(state, 'trade', sentence(`${possessive(cv.ownerName)} caravan gave up its journey to ${settlementName(stop.at)}: every road was closed to it.`), {}, 1);
    }
    return;
  }
  cv.journey = plan.legs;
  startLeg(state, cv, cv.journey.shift());
}

/** Keep the caravan list bounded. */
export function pruneCaravans(state) {
  const t = ensureTrade(state);
  const done = t.caravans.filter((c) => c.status === 'COMPLETED' || c.status === 'CANCELLED');
  if (done.length > 25) {
    const drop = new Set(done.slice(0, done.length - 25).map((c) => c.id));
    t.caravans = t.caravans.filter((c) => !drop.has(c.id));
  }
}
