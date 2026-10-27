import { enjoyFestival } from '../culture/Festivals.js';
import { celebrationSpot, celebrated, holidayNow } from '../culture/Holidays.js';
import { byId } from '../core/EntityRegistry.js';
import { NEEDS, MOVE, GOODS, FOOD_GOODS, ECONOMY, LIFE } from '../core/Config.js';
import { range, chance } from '../core/Random.js';
import { balance, transfer } from '../economy/Transactions.js';
import { qty, removeGoods, addGoods, moveGoods } from '../economy/Inventory.js';
import { businessById, isTrading, BUSINESS_TYPES, retailPrice } from '../economy/Businesses.js';
import { buyRetail, buyFromPantry, businessLocation, sellGathered, isOpenNow } from '../economy/Marketplace.js';
import { applyForJob, completeShift } from '../economy/Employment.js';
import { buyPlot, reservePlot } from '../property/Ownership.js';
import { startProject, projectById, addWork, joinCrew, needsLabour, openBusiness, moveHome } from '../property/Construction.js';
import { householdOf } from '../population/Housing.js';
import { raiseCash } from '../finance/BankAccounts.js';
import { plotById, plotHistory, frontOf, bedsAt } from '../property/LandRegistry.js';
import { socialize, adjust } from '../citizens/Relationships.js';
import { shareGossip, createFact } from '../society/Gossip.js';
import { bump } from '../society/Reputation.js';
import { record } from '../society/Chronicle.js';
import { remember } from './MemorySystem.js';
import { trait } from './Personality.js';
import { planFor, checkDreamFulfilled } from './GoalPlanner.js';
import { generateCandidates, explain, hourOf, isNight } from './DecisionUtility.js';
import { guardianOf } from '../citizens/Families.js';
import { castVote } from '../politics/Government.js';
import { hungerMultiplier, maybeSpread } from '../events/Disasters.js';
import { gainSkill } from '../education/Skills.js';
import { ageOf } from '../citizens/Citizen.js';
import { schoolOpen, completeLesson, completeApprenticeship, completeMentoring } from '../education/Education.js';
import { findPath, segmentClear } from '../navigation/Pathfinding.js';
import { navGrid, costAt, cellOf, nearestOpen, cellX, cellZ, walkable } from '../navigation/NavigationGrid.js';
import { roadWorkSpot } from '../navigation/RoadConstruction.js';
import { noteTheft } from '../law/Courts.js';
import { recordTrip, crowdFactor, ensureNavigation } from '../navigation/Traffic.js';

// Each citizen is always either performing an activity or choosing one.
// Activities have two phases: travel to a location, then perform for a duration.
// Decisions happen only when the current activity ends (or a critical need
// interrupts it), which gives citizens commitment instead of constant dithering.

const clamp = (v) => Math.max(0, Math.min(100, v));

const LABELS = {
  eat_own: 'Eating', steal: 'Stealing food', court: 'At court', see_caravan: 'Overseeing a caravan', eat_stock: 'Eating from stock', buy_food: 'Buying food', sleep: 'Sleeping', work: 'Working', build: 'Building',
  seek_job: 'Looking for work', forage: 'Foraging in the forest', sell_goods: 'Selling goods', socialize: 'Socialising',
  tavern: 'At the tavern', help: 'Helping a neighbour', festival: 'Enjoying the festival', celebrate: 'Celebrating the holiday', buy_plot: 'Buying property',
  start_project: 'Starting a building project', explore: 'Wandering', idle: 'Taking a moment',
  cradle: 'Being looked after', rest_sick: 'Resting while ill', vote: 'Voting', campaign: 'Campaigning', govern: 'Governing', fight_fire: 'Fighting a fire', lessons: 'Lessons', apprentice: 'Apprenticing', mentor: 'Mentoring', family_time: 'Family time',
};

export function homeOf(state, c) {
  const p = plotById(state, c.homePlotId) ?? state.plots[0];
  return frontOf(p, range(state, -1.2, 1.2), range(state, -0.2, 0.6));
}

const hallDoor = (state) => frontOf(state.plots[0], range(state, -1, 1), 1);
const square = (state) => ({ x: range(state, -3.5, 3.5), z: range(state, -3.5, 3.5) });
const forestSpot = (state) => ({ x: range(state, 13, 32), z: range(state, -30, -21) });

export function updateCitizen(state, c) {
  // Someone away from the valley (scouting) is provisioned and off the map.
  if (c.away) {
    if (c.activity?.kind !== 'away') c.activity = { kind: 'away', label: c.away.reason === 'scouting' ? 'Away scouting' : 'Away', x: c.x, z: c.z, duration: 1, elapsed: 0, phase: 'perform' };
    return;
  }
  tickNeeds(state, c);
  const a = c.activity;
  if (a && shouldInterrupt(state, c, a)) abandon(state, c, a);
  if (!c.activity) decide(state, c);
  const act = c.activity;
  if (act.phase === 'travel') {
    // Visitors follow the person they are going to see.
    if ((act.kind === 'socialize' || act.kind === 'mentor') && act.citizenId && state.tick % 3 === 0) {
      const t = byId(state.citizens, act.citizenId);
      if (t) {
        act.x = t.x + 0.8; act.z = t.z + 0.6;
        const end = act.path?.[act.path.length - 1];
        if (end && Math.hypot(end[0] - act.x, end[1] - act.z) > 4) act.path = null;
      }
    }
    travel(state, c, act);
    return;
  }
  act.elapsed++;
  if (act.kind === 'sleep') {
    c.needs.energy = clamp(c.needs.energy + NEEDS.sleepGain);
    const h = hourOf(state);
    if (c.needs.energy >= 99 || (!isNight(state) && h >= 6 && c.needs.energy >= 78) || act.elapsed > 80) finish(state, c);
    return;
  }
  if (act.elapsed >= act.duration) finish(state, c);
}

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Walk the planned route: plan it on first use (A* around buildings, preferring
 * roads), re-plan if the town changed under it, and move at a speed set by the
 * ground underfoot and how crowded it is. Unreachable places fail with a reason
 * instead of leaving anyone frozen.
 */
/** Later transport (cars, buses, pods) speeds up long trips; set by civilization/Transport. */
export const travelHooks = { plan: null };

/**
 * Later systems add their own activities without editing this file: `begin`
 * turns a chosen candidate of that kind into { label, loc, duration, extra }
 * (or null), `finish` applies its consequences, and every `chat` hook hears a
 * conversation between two villagers.
 */
export const activityHooks = { begin: {}, finish: {}, chat: [] };

function travel(state, c, act) {
  const grid = navGrid(state);
  if (act.path && act.navV !== grid.version) {
    // The town changed: keep the route only if every remaining leg is still clear.
    const rest = [[c.x, c.z], ...act.path.slice(act.wp ?? 0)];
    const clear = rest.every((p, i) => i === 0 || segmentClear(state, rest[i - 1][0], rest[i - 1][1], p[0], p[1]));
    if (clear) act.navV = grid.version;
    else act.path = null;
  }
  if (!act.path) {
    // Someone standing where a wall now is steps out first.
    const here = cellOf(c.x, c.z);
    if (here >= 0 && !walkable(grid, here)) {
      const open = nearestOpen(grid, here);
      if (open >= 0) { c.x = cellX(open); c.z = cellZ(open); }
    }
    const route = findPath(state, c, act);
    if (route.failed) return routeFailed(state, c, act, route.failed);
    act.path = route.points.map(([x, z]) => [r2(x), r2(z)]);
    act.wp = 0;
    act.navV = route.version;
    act.vf = travelHooks.plan?.(state, c, act, act.path) ?? 1;
    if (act.vf === 1) delete act.vf;
    recordTrip(state, route.cells);
  }
  let budget = MOVE.unitsPerTick * crowdFactor(state, c.x, c.z) * (act.vf ?? 1);
  while (budget > 1e-6 && act.wp < act.path.length) {
    const [tx, tz] = act.path[act.wp];
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    const speed = 1 / Math.max(0.45, Math.min(4, costAt(state, c.x, c.z)));
    const step = Math.min(d, budget * speed);
    if (d > 1e-6) { c.x += (dx / d) * step; c.z += (dz / d) * step; }
    budget -= step / speed;
    if (step >= d - 1e-6) act.wp++;
  }
  if (act.wp >= act.path.length) { act.phase = 'perform'; act.path = null; delete act.vehicle; delete act.vf; }
}

function routeFailed(state, c, act, reason) {
  const nav = ensureNavigation(state);
  nav.failures++;
  nav.recentFailures.push({ day: state.day, who: c.id, label: act.label, reason });
  if (nav.recentFailures.length > 20) nav.recentFailures.shift();
  remember(state, c, `Could not find a way there (${reason}) and gave up on ${act.label.toLowerCase()}.`, 1, 'routine');
  abandon(state, c, act);
}

function tickNeeds(state, c) {
  if (state.tick % 6 !== 0) {
    c.needs.hunger = clamp(c.needs.hunger - NEEDS.hungerDecay * hungerMultiplier(state));
    if (c.activity?.kind !== 'sleep' || c.activity.phase !== 'perform') c.needs.energy = clamp(c.needs.energy - NEEDS.energyDecay * (c.activity?.kind === 'work' || c.activity?.kind === 'build' ? 1.15 : 0.85));
    c.needs.social = clamp(c.needs.social - NEEDS.socialDecay);
    return;
  }
  c.needs.hunger = clamp(c.needs.hunger - NEEDS.hungerDecay * hungerMultiplier(state));
  if (c.activity?.kind !== 'sleep' || c.activity.phase !== 'perform') c.needs.energy = clamp(c.needs.energy - NEEDS.energyDecay * (c.activity?.kind === 'work' || c.activity?.kind === 'build' ? 1.15 : 0.85));
  c.needs.social = clamp(c.needs.social - NEEDS.socialDecay);
  const money = balance(state, c.id);
  const home = plotById(state, c.homePlotId);
  const target = 18 + c.needs.hunger * 0.22 + c.needs.energy * 0.18 + c.needs.social * 0.2 +
    Math.min(12, money / 4) + (home?.ownerId === c.id ? 6 : 0) + (c.romance.partnerId ? 6 : 0) +
    (c.employment ? 4 : 0) + ECONOMY.taxMood[state.council.taxLevel];
  c.mood = clamp(c.mood + (target - c.mood) * 0.09);
}

/** Who pays for this citizen's food: their own wallet, or a minor's guardian (the council for its wards). */
function foodPayer(state, c) {
  if (ageOf(state, c) >= LIFE.adultAge) return c.id;
  return guardianOf(state, c)?.id ?? 'treasury';
}

/**
 * A fire close enough that this citizen should drop what they are doing (or
 * wake) to fight it. Each person is alerted once per fire, so someone who
 * decides not to go is not pulled out of every later activity.
 */
function fireAlarm(state, c, radius) {
  if (!(state.fires?.length > 0) || c.health?.sickUntil > state.day || ageOf(state, c) < 14) return null;
  const fire = state.fires.find((f) => {
    if (f.responders.length >= 8 || f.responders.includes(c.id) || f.alerted?.includes(c.id)) return false;
    const p = plotById(state, f.plotId);
    return p && Math.hypot(p.x - c.x, p.z - c.z) < radius;
  });
  if (fire) (fire.alerted ?? (fire.alerted = [])).push(c.id);
  return fire ?? null;
}

function shouldInterrupt(state, c, a) {
  // Sleepers near a fire are woken by the commotion (the very tired sleep through it).
  if (a.kind === 'sleep') return a.phase === 'perform' && c.needs.energy > 25 && !!fireAlarm(state, c, 20);
  if (a.kind === 'eat_own' || a.kind === 'eat_stock' || a.kind === 'buy_food' || a.kind === 'cradle' || a.kind === 'rest_sick') return false;
  // A minor's meals are bought from the guardian's purse, not their own.
  if (c.needs.hunger < NEEDS.criticalHunger && (FOOD_GOODS.some((g) => qty(c.inventory, g) > 0) || balance(state, foodPayer(state, c)) > 0)) return true;
  if (c.needs.energy < NEEDS.criticalEnergy) return true;
  if (a.kind === 'work') {
    const b = businessById(state, a.businessId);
    if (!b || !isTrading(b) || c.employment?.businessId !== b.id) return true;
  }
  if (a.kind === 'build' && !projectById(state, a.projectId)) return true;
  // Neighbours drop what they are doing to fight a nearby fire.
  if (a.kind !== 'fight_fire' && fireAlarm(state, c, 30)) return true;
  return false;
}

function abandon(state, c, a) {
  if (a.kind === 'build') { const p = projectById(state, a.projectId); if (p) delete p.crew[c.id]; }
  if ((a.kind === 'work' || a.kind === 'build') && a.phase === 'perform' && a.elapsed > 4) {
    c.stats.shiftsMissed++;
    bump(c, 'reliability', -1.5);
  }
  c.activity = null;
}

/** Choose the best-scoring action, record why, and start it. */
export function decide(state, c) {
  const plan = planFor(state, c);
  checkDreamFulfilled(state, c);
  const candidates = generateCandidates(state, c, plan).sort((x, y) => y.score - x.score);
  for (const chosen of candidates) {
    const activity = begin(state, c, chosen);
    if (!activity) continue;
    c.activity = activity;
    c.decision = {
      action: chosen.kind,
      label: activity.label,
      reason: explain(chosen),
      score: chosen.score,
      alternatives: candidates.filter((x) => x !== chosen).slice(0, 3).map((x) => ({ action: LABELS[x.kind] ?? x.kind, score: x.score })),
      goal: plan.goal,
      next: plan.next,
      day: state.day,
      minute: state.minute,
    };
    return;
  }
}

function activity(kind, label, loc, duration, extra = {}) {
  return { kind, label, x: loc.x, z: loc.z, duration, elapsed: 0, phase: 'travel', ...extra };
}

/** Turn a chosen candidate into a concrete activity, or null if it is not possible after all. */
function begin(state, c, k) {
  switch (k.kind) {
    case 'eat_own': return activity('eat_own', `Eating ${GOODS[k.good].label.toLowerCase()}`, { x: c.x, z: c.z }, 3, { good: k.good });
    case 'eat_stock': {
      const b = businessById(state, k.businessId);
      return activity('eat_stock', `Eating ${GOODS[k.good].label.toLowerCase()} from ${b.name}`, businessLocation(state, b), 3, { businessId: b.id, good: k.good });
    }
    case 'buy_food': {
      if (k.pantry) return activity('buy_food', k.relief ? 'Getting food from the council pantry' : `Buying ${GOODS[k.good].label.toLowerCase()} at the council pantry`, hallDoor(state), 2, { pantry: true, relief: k.relief, good: k.good, payer: k.payer });
      const b = businessById(state, k.businessId);
      return activity('buy_food', `Buying ${GOODS[k.good].label.toLowerCase()} at ${b.name}`, businessLocation(state, b), 2, { businessId: b.id, good: k.good, payer: k.payer });
    }
    case 'court': {
      // With the hall lost to fire (and no courthouse yet), cases are heard on the hall's old site.
      const court = state.plots.find((p) => p.building?.type === 'courthouse') ?? state.plots.find((p) => p.building?.type === 'townhall' || p.building?.type === 'hall') ?? state.plots[0];
      return activity('court', state.law?.judgeId === c.id ? 'Hearing cases' : 'At court', frontOf(court, range(state, -1.6, 1.6), range(state, 0.2, 1)), 8, { caseId: k.caseId });
    }
    case 'see_caravan': return activity('see_caravan', 'Overseeing the caravan', { x: 9 + range(state, -1, 1), z: 4.5 + range(state, -0.5, 0.5) }, 6, { caravanId: k.caravanId });
    case 'steal': {
      const b = businessById(state, k.businessId);
      return b ? activity('steal', `Hanging about ${b.name}`, businessLocation(state, b), 2, { businessId: b.id, good: k.good }) : null;
    }
    case 'sleep': return activity('sleep', plotById(state, c.homePlotId)?.ownerId === c.id ? 'Sleeping at home' : 'Sleeping at the hall', homeOf(state, c), 80);
    case 'work': {
      const b = businessById(state, k.businessId);
      const plot = plotById(state, b.plotId);
      const road = b.type === 'works' ? roadWorkSpot(state, () => range(state, 0, 1)) : null;
      const loc = road ?? (b.type === 'farm' ? { x: plot.x + range(state, -4, 3), z: plot.z + range(state, -3, 1) } : frontOf(plot, range(state, -2.2, 2.2), range(state, 0.1, 1.2)));
      return activity('work', c.employment.role === 'owner' ? `Running ${b.name}` : `Working at ${b.name}`, loc, 24, { businessId: b.id });
    }
    case 'build': {
      const p = projectById(state, k.projectId);
      if (!p || !needsLabour(state, p)) return null;
      joinCrew(p, c, state.tick);
      const plot = plotById(state, p.plotId);
      return activity('build', p.kind === 'demolition' ? `Demolishing on ${plot.name}` : `Building on ${plot.name}`, { x: plot.x + range(state, -2.5, 2.5), z: plot.z + range(state, -2, 2) }, 24, { projectId: p.id });
    }
    case 'seek_job': {
      const b = businessById(state, k.businessId);
      return activity('seek_job', `Asking for work at ${b.name}`, businessLocation(state, b), 2, { businessId: b.id });
    }
    case 'forage': return activity('forage', 'Foraging in the forest', forestSpot(state), k.hungry ? 8 : 18);
    case 'sell_goods': {
      const buyer = state.businesses.find((b) => isOpenNow(state, b) && BUSINESS_TYPES[b.type].sells.includes(k.good) && b.ownerId !== c.id);
      return activity('sell_goods', `Selling ${GOODS[k.good].label.toLowerCase()}`, buyer ? businessLocation(state, buyer) : hallDoor(state), 2, { good: k.good });
    }
    case 'socialize': {
      const t = byId(state.citizens, k.citizenId);
      const loc = t ? { x: t.x + range(state, -1, 1), z: t.z + range(state, -1, 1) } : square(state);
      return activity('socialize', t ? `Chatting with ${t.firstName}` : 'Chatting in the square', loc, 8, { citizenId: t?.id ?? null });
    }
    case 'tavern': {
      const b = businessById(state, k.businessId);
      return activity('tavern', `Evening at ${b.name}`, businessLocation(state, b), 10, { businessId: b.id });
    }
    case 'help': {
      const t = byId(state.citizens, k.citizenId);
      const payee = byId(state.citizens, k.payeeId) ?? t;
      return activity('help', `Helping ${payee.firstName}`, { x: payee.x, z: payee.z }, 2, { citizenId: payee.id, ...(payee !== t ? { forId: t.id } : {}) });
    }
    case 'celebrate': {
      const now = holidayNow(state);
      if (!now || now.key !== k.key) return null;
      const spot = celebrationSpot(state, c, now, (lo, hi) => range(state, lo, hi));
      return activity('celebrate', spot.label, spot, 8, { holiday: now.id, key: now.key, partnerId: spot.partnerId ?? null });
    }
    case 'festival': return activity('festival', k.seasonal ? `At the ${state.culture?.current?.name ?? 'festival'}` : 'Celebrating at the festival', square(state), 10, { seasonal: !!k.seasonal });
    case 'buy_plot': {
      if (!reservePlot(state, k.plotId, c.id)) return null;
      return activity('buy_plot', `Buying ${plotById(state, k.plotId).name}`, hallDoor(state), 3, { plotId: k.plotId, home: !!k.home, moveIn: !!k.moveIn });
    }
    case 'start_project': {
      const plot = plotById(state, k.plotId);
      return activity('start_project', `Planning work on ${plot.name}`, { x: plot.x, z: plot.z }, 4, { plotId: k.plotId, projectKind: k.projectKind, businessType: k.businessType ?? null, home: !!k.home });
    }
    case 'cradle': return activity('cradle', 'Being looked after at home', homeOf(state, c), 36);
    case 'rest_sick': return activity('rest_sick', 'Resting while ill', homeOf(state, c), 30);
    case 'lessons': {
      const school = schoolOpen(state);
      const loc = school ? businessLocation(state, school) : homeOf(state, c);
      return activity('lessons', school ? `Lessons at ${school.name}` : 'Lessons at home', loc, 18, {});
    }
    case 'apprentice': {
      const m = byId(state.citizens, k.citizenId);
      if (!m) return null;
      return activity('apprentice', `Apprenticing with ${m.firstName}`, { x: m.x + range(state, -1.2, 1.2), z: m.z + range(state, -1.2, 1.2) }, 24, { citizenId: m.id });
    }
    case 'mentor': {
      const st = byId(state.citizens, k.citizenId);
      if (!st) return null;
      return activity('mentor', `Teaching ${st.firstName} ${k.skill}`, { x: st.x + 1, z: st.z }, 8, { citizenId: st.id, skill: k.skill });
    }
    case 'fight_fire': {
      const plot = plotById(state, k.plotId);
      return activity('fight_fire', `Fighting the fire at ${plot.name}`, { x: plot.x + range(state, -3, 3), z: plot.z + plot.d / 2 + range(state, 0.5, 2) }, 5, { plotId: plot.id });
    }
    case 'vote': return activity('vote', `Voting for ${state.government.title}`, hallDoor(state), 3);
    case 'campaign': return activity('campaign', 'Campaigning in the square', square(state), 10);
    case 'govern': return activity('govern', `Governing as ${state.government.title}`, hallDoor(state), 18);
    case 'family_time': return activity('family_time', 'Time with the family', homeOf(state, c), 8);
    case 'explore': return activity('explore', 'Wandering the village', { x: range(state, -26, 30), z: range(state, -20, 24) }, 4);
    default: {
      const hook = activityHooks.begin[k.kind];
      if (hook) { const spec = hook(state, c, k); return spec ? activity(k.kind, spec.label, spec.loc, spec.duration, spec.extra ?? {}) : null; }
      return activity('idle', 'Taking a moment', { x: c.x, z: c.z }, 3);
    }
  }
}

function eatFrom(c, good) {
  if (!removeGoods(c.inventory, good, 1)) return false;
  c.needs.hunger = clamp(c.needs.hunger + GOODS[good].food);
  if (GOODS[good].social) c.needs.social = clamp(c.needs.social + GOODS[good].social);
  return true;
}

function nearby(state, c, radius = 5) {
  return state.citizens.filter((o) => o.id !== c.id && o.activity?.kind !== 'sleep' && Math.hypot(o.x - c.x, o.z - c.z) < radius);
}

function chat(state, c, others, intensity = 1) {
  for (const o of others) {
    maybeSpread(state, c, o);
    socialize(state, c, o, intensity);
    shareGossip(state, c, o);
    shareGossip(state, o, c);
    for (const fn of activityHooks.chat) fn(state, c, o, intensity);
    o.needs.social = clamp(o.needs.social + 10 * intensity);
  }
}

/** Apply the consequences of a completed activity. */
function finish(state, c) {
  const a = c.activity;
  c.activity = null;
  switch (a.kind) {
    case 'eat_own': eatFrom(c, a.good); break;
    case 'eat_stock': {
      const b = businessById(state, a.businessId);
      if (b && b.ownerId === c.id && moveGoods(b.inventory, c.inventory, a.good, 1)) eatFrom(c, a.good);
      break;
    }
    case 'buy_food': {
      const payer = a.payer ?? c.id;
      if (!(payer in state.accounts)) break;
      if (a.pantry) { if (buyFromPantry(state, c, a.good, payer, a.relief).ok) eatFrom(c, a.good); break; }
      const b = businessById(state, a.businessId);
      const n = balance(state, payer) > 12 + retailPrice(b ?? { priceMult: {} }, a.good) * 2 ? 2 : 1;
      const res = b ? buyRetail(state, c, b, a.good, n, payer) : { ok: false };
      if (res.ok) eatFrom(c, a.good);
      break;
    }
    case 'steal': {
      const b = businessById(state, a.businessId);
      const n = b ? Math.min(2, qty(b.inventory, a.good)) : 0;
      if (n <= 0) break;
      removeGoods(b.inventory, a.good, n);
      addGoods(c.inventory, a.good, n);
      eatFrom(c, a.good);
      const witnesses = state.citizens.filter((o) => o !== c && !o.away && o.activity?.kind !== 'sleep' && Math.hypot(o.x - c.x, o.z - c.z) < 10).slice(0, 3);
      if (witnesses.length) {
        noteTheft(state, c, b.id, a.good, n, retailPrice(b, a.good) * n, witnesses);
        bump(c, 'honesty', -12);
        for (const w of witnesses) { adjust(state, w.id, c.id, { trust: -15, respect: -8 }); remember(state, w, `Saw ${c.firstName} steal ${a.good} from ${b.name}.`, 2, 'gossip'); }
        record(state, 'citizen', `${c.firstName} ${c.lastName}, starving and penniless, was seen stealing ${a.good} from ${b.name}.`, { citizens: [c.id, ...witnesses.map((w) => w.id)], business: b.id }, 2);
      }
      remember(state, c, `Took ${a.good} from ${b.name} because I was starving.`, 3, 'grievance');
      state.stats.thefts = (state.stats.thefts ?? 0) + 1;
      c.lastTheftDay = state.day;
      break;
    }
    case 'sleep': if (plotById(state, c.homePlotId)?.ownerId === c.id) c.mood = clamp(c.mood + 2); break;
    case 'work': {
      const b = businessById(state, a.businessId);
      if (b && c.employment?.businessId === b.id) completeShift(state, c, b);
      break;
    }
    case 'build': {
      const p = projectById(state, a.projectId);
      if (p) addWork(state, p, c);
      break;
    }
    case 'seek_job': {
      const b = businessById(state, a.businessId);
      const res = b ? applyForJob(state, c, b) : { ok: false, reason: 'gone' };
      if (!res.ok) {
        c.rejectedBy = { ...(c.rejectedBy ?? {}), [a.businessId]: state.day };
        c.decision.reason = `Turned away: ${res.reason}.`;
      }
      break;
    }
    case 'forage': {
      const skill = c.skills.foraging ?? 0.1;
      const n = Math.min(Math.floor(state.commons.berries), Math.round((a.duration > 10 ? 3 : 1) + skill * (a.duration > 10 ? 5 : 2)));
      if (n > 0) {
        state.commons.berries -= n;
        addGoods(c.inventory, 'berries', n);
        c.skills.foraging = Math.min(1, Math.round((skill + 0.01) * 1000) / 1000);
        if (a.duration > 10) { c.shiftsToday++; c.stats.shiftsWorked++; }
      }
      if (c.needs.hunger < 45 && qty(c.inventory, 'berries') > 0) eatFrom(c, 'berries');
      break;
    }
    case 'sell_goods': sellGathered(state, c, a.good); break;
    case 'socialize': {
      const people = nearby(state, c, 6);
      const visited = byId(state.citizens, a.citizenId);
      const target = visited && visited.activity?.kind !== 'sleep' && Math.hypot(visited.x - c.x, visited.z - c.z) < 12 ? visited : null;
      const group = target ? [target, ...people.filter((o) => o !== target).slice(0, 1)] : people.slice(0, 2);
      chat(state, c, group, 1);
      c.needs.social = clamp(c.needs.social + (group.length ? 26 : 8));
      break;
    }
    case 'tavern': {
      const b = businessById(state, a.businessId);
      if (b && qty(b.inventory, 'meal') > 0 && buyRetail(state, c, b, 'meal', 1).ok) eatFrom(c, 'meal');
      chat(state, c, nearby(state, c, 6).slice(0, 3), 1.2);
      c.needs.social = clamp(c.needs.social + 30);
      c.mood = clamp(c.mood + 3);
      break;
    }
    case 'help': {
      const t = byId(state.citizens, a.citizenId);
      if (t && transfer(state, c.id, t.id, 5, 'gift', `${c.firstName} helped ${t.firstName}`)) {
        c.stats.gifts++;
        bump(c, 'generosity', 5);
        adjust(state, t.id, c.id, { affection: 8, friendship: 8, trust: 6, respect: 6 });
        adjust(state, c.id, t.id, { friendship: 3 });
        remember(state, t, `${c.firstName} gave me 5 coins when I was struggling.`, 2, 'kindness');
        remember(state, c, `Helped ${t.firstName} with 5 coins.`, 1, 'kindness');
        createFact(state, 'gift', c.id, `${c.firstName} helped ${t.firstName} through hard times.`, [c.id, t.id], t.id);
        record(state, 'citizen', `${c.firstName} gave ${t.firstName} 5 coins to help them through hard times.`, { citizens: [c.id, t.id] }, 1);
        c.mood = clamp(c.mood + 4);
      }
      break;
    }
    case 'celebrate': celebrated(state, c, a, nearby(state, c, 6), (others) => chat(state, c, others, 1.2)); break;
    case 'festival': chat(state, c, nearby(state, c, 7).slice(0, 3), 1.4); c.needs.social = clamp(c.needs.social + 30); c.mood = clamp(c.mood + 5); if (a.seasonal) enjoyFestival(state, c); break;
    case 'buy_plot': {
      const target = plotById(state, a.plotId);
      if (target && balance(state, c.id) < target.price) raiseCash(state, c.id, target.price);
      const res = buyPlot(state, a.plotId, c.id);
      if (res.ok) {
        if (a.home) (c.homeVenture ?? (c.homeVenture = {})).plotId = a.plotId;
        else if (c.venture) c.venture.plotId = a.plotId; // land bought for a home is never a business site
        if (a.moveIn) {
          const plot = plotById(state, a.plotId);
          // The buyer moves in, and as much of the household as the beds allow.
          for (const m of householdOf(state, c)) if (m === c || bedsAt(state, plot) > plot.residents.length) moveHome(state, m, plot);
          record(state, 'property', `${c.firstName} ${c.lastName} moved the household into the cottage on ${plot.name}.`, { citizens: [c.id], plot: plot.id }, 2);
        }
      }
      else if (!res.ok) c.decision.reason = `Could not buy: ${res.reason}.`;
      break;
    }
    case 'start_project': startOwnProject(state, c, a); break;
    case 'cradle': break;
    case 'rest_sick': c.needs.energy = clamp(c.needs.energy + 25); break;
    case 'lessons': completeLesson(state, c, guardianOf(state, c)); c.shiftsToday++; break;
    case 'apprentice': {
      const m = byId(state.citizens, a.citizenId);
      completeApprenticeship(state, c, m);
      break;
    }
    case 'mentor': {
      const st = byId(state.citizens, a.citizenId);
      if (st && Math.hypot(st.x - c.x, st.z - c.z) < 12) completeMentoring(state, c, st, a.skill);
      break;
    }
    case 'vote': castVote(state, c); break;
    case 'fight_fire': {
      const fire = (state.fires ?? []).find((f) => f.plotId === a.plotId);
      if (fire) fire.responders.push(c.id);
      c.needs.energy = clamp(c.needs.energy - 10);
      break;
    }
    case 'campaign': {
      const voters = nearby(state, c, 8).filter((o) => ageOf(state, o) >= 18).slice(0, 4);
      for (const o of voters) { adjust(state, o.id, c.id, { respect: 2, friendship: 1 }); }
      chat(state, c, voters.slice(0, 2), 0.8);
      gainSkill(c, 'diplomacy', 0.01);
      gainSkill(c, 'leadership', 0.006);
      c.shiftsToday++;
      break;
    }
    case 'govern': {
      c.governedDay = state.day;
      gainSkill(c, 'leadership', 0.012);
      gainSkill(c, 'diplomacy', 0.004);
      break;
    }
    case 'family_time': {
      const kids = state.citizens.filter((k) => k.family.parentIds.includes(c.id) && Math.hypot(k.x - c.x, k.z - c.z) < 8);
      for (const k of kids) { socialize(state, c, k, 0.6); k.needs.social = clamp(k.needs.social + 20); }
      c.needs.social = clamp(c.needs.social + 15 + kids.length * 5);
      c.mood = clamp(c.mood + 2);
      break;
    }
    case 'explore': {
      c.mood = clamp(c.mood + 1 + trait(c, 'curious') * 2);
      if (chance(state, 0.15) && state.commons.berries > 1) { state.commons.berries -= 1; addGoods(c.inventory, 'berries', 1); }
      break;
    }
    default: activityHooks.finish[a.kind]?.(state, c, a); break;
  }
}

function startOwnProject(state, c, a) {
  const plot = plotById(state, a.plotId);
  if (!plot || plot.ownerId !== c.id) return;
  if (a.projectKind === 'reopen') {
    const b = openBusiness(state, c, plot, a.businessType);
    plotHistory(state, plot, `${c.firstName} reopened the building as ${b.name}.`);
    return;
  }
  const v = a.home ? (c.homeVenture ?? (c.homeVenture = {})) : (c.venture ?? (c.venture = {}));
  const spec = a.projectKind === 'upgrade' ? { kind: 'upgrade' } : a.home ? { kind: 'construction', buildingType: 'cottage', purpose: 'home' }
    : a.projectKind === 'demolition' ? { kind: 'demolition' }
      : { kind: a.projectKind, buildingType: BUSINESS_TYPES[a.businessType].building, purpose: 'business', businessType: a.businessType };
  const res = startProject(state, { plotId: plot.id, ownerId: c.id, ...spec });
  if (res.ok) { v.projectId = res.project.id; v.plotId = plot.id; }
}
