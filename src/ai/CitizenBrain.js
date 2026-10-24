import { byId } from '../core/EntityRegistry.js';
import { NEEDS, MOVE, GOODS, FOOD_GOODS, ECONOMY } from '../core/Config.js';
import { range, chance } from '../core/Random.js';
import { balance, transfer } from '../economy/Transactions.js';
import { qty, removeGoods, addGoods, moveGoods } from '../economy/Inventory.js';
import { businessById, isTrading, BUSINESS_TYPES } from '../economy/Businesses.js';
import { buyRetail, buyFromPantry, businessLocation, sellGathered, isOpenNow } from '../economy/Marketplace.js';
import { applyForJob, completeShift } from '../economy/Employment.js';
import { buyPlot, reservePlot } from '../property/Ownership.js';
import { startProject, projectById, addWork, joinCrew, needsLabour, openBusiness } from '../property/Construction.js';
import { plotById, plotHistory, frontOf } from '../property/LandRegistry.js';
import { socialize, adjust } from '../citizens/Relationships.js';
import { shareGossip, createFact } from '../society/Gossip.js';
import { bump } from '../society/Reputation.js';
import { record } from '../society/Chronicle.js';
import { remember } from './MemorySystem.js';
import { trait } from './Personality.js';
import { planFor, checkDreamFulfilled } from './GoalPlanner.js';
import { generateCandidates, explain, hourOf, isNight } from './DecisionUtility.js';
import { guardianOf } from '../citizens/Families.js';
import { schoolOpen, completeLesson, completeApprenticeship, completeMentoring } from '../education/Education.js';

// Each citizen is always either performing an activity or choosing one.
// Activities have two phases: travel to a location, then perform for a duration.
// Decisions happen only when the current activity ends (or a critical need
// interrupts it), which gives citizens commitment instead of constant dithering.

const clamp = (v) => Math.max(0, Math.min(100, v));

const LABELS = {
  eat_own: 'Eating', eat_stock: 'Eating from stock', buy_food: 'Buying food', sleep: 'Sleeping', work: 'Working', build: 'Building',
  seek_job: 'Looking for work', forage: 'Foraging in the forest', sell_goods: 'Selling goods', socialize: 'Socialising',
  tavern: 'At the tavern', help: 'Helping a neighbour', festival: 'Enjoying the festival', buy_plot: 'Buying property',
  start_project: 'Starting a building project', explore: 'Wandering', idle: 'Taking a moment',
  cradle: 'Being looked after', rest_sick: 'Resting while ill', lessons: 'Lessons', apprentice: 'Apprenticing', mentor: 'Mentoring', family_time: 'Family time',
};

export function homeOf(state, c) {
  const p = plotById(state, c.homePlotId) ?? state.plots[0];
  return frontOf(p, range(state, -1.2, 1.2), range(state, -0.2, 0.6));
}

const hallDoor = (state) => frontOf(state.plots[0], range(state, -1, 1), 1);
const square = (state) => ({ x: range(state, -3.5, 3.5), z: range(state, -3.5, 3.5) });
const forestSpot = (state) => ({ x: range(state, 13, 32), z: range(state, -30, -21) });

export function updateCitizen(state, c) {
  tickNeeds(state, c);
  const a = c.activity;
  if (a && shouldInterrupt(state, c, a)) abandon(state, c, a);
  if (!c.activity) decide(state, c);
  const act = c.activity;
  if (act.phase === 'travel') {
    const dx = act.x - c.x, dz = act.z - c.z, d = Math.hypot(dx, dz);
    if (d <= MOVE.arriveDistance) act.phase = 'perform';
    else {
      const step = Math.min(MOVE.unitsPerTick, d);
      c.x += (dx / d) * step;
      c.z += (dz / d) * step;
    }
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

function tickNeeds(state, c) {
  if (state.tick % 6 !== 0) {
    c.needs.hunger = clamp(c.needs.hunger - NEEDS.hungerDecay);
    if (c.activity?.kind !== 'sleep' || c.activity.phase !== 'perform') c.needs.energy = clamp(c.needs.energy - NEEDS.energyDecay * (c.activity?.kind === 'work' || c.activity?.kind === 'build' ? 1.15 : 0.85));
    c.needs.social = clamp(c.needs.social - NEEDS.socialDecay);
    return;
  }
  c.needs.hunger = clamp(c.needs.hunger - NEEDS.hungerDecay);
  if (c.activity?.kind !== 'sleep' || c.activity.phase !== 'perform') c.needs.energy = clamp(c.needs.energy - NEEDS.energyDecay * (c.activity?.kind === 'work' || c.activity?.kind === 'build' ? 1.15 : 0.85));
  c.needs.social = clamp(c.needs.social - NEEDS.socialDecay);
  const money = balance(state, c.id);
  const home = plotById(state, c.homePlotId);
  const target = 18 + c.needs.hunger * 0.22 + c.needs.energy * 0.18 + c.needs.social * 0.2 +
    Math.min(12, money / 4) + (home?.ownerId === c.id ? 6 : 0) + (c.romance.partnerId ? 6 : 0) +
    (c.employment ? 4 : 0) + ECONOMY.taxMood[state.council.taxLevel];
  c.mood = clamp(c.mood + (target - c.mood) * 0.09);
}

function shouldInterrupt(state, c, a) {
  if (a.kind === 'eat_own' || a.kind === 'eat_stock' || a.kind === 'buy_food' || a.kind === 'sleep' || a.kind === 'cradle' || a.kind === 'rest_sick') return false;
  if (c.needs.hunger < NEEDS.criticalHunger && (FOOD_GOODS.some((g) => qty(c.inventory, g) > 0) || balance(state, c.id) > 0)) return true;
  if (c.needs.energy < NEEDS.criticalEnergy) return true;
  if (a.kind === 'work') {
    const b = businessById(state, a.businessId);
    if (!b || !isTrading(b) || c.employment?.businessId !== b.id) return true;
  }
  if (a.kind === 'build' && !projectById(state, a.projectId)) return true;
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
    case 'sleep': return activity('sleep', plotById(state, c.homePlotId)?.ownerId === c.id ? 'Sleeping at home' : 'Sleeping at the hall', homeOf(state, c), 80);
    case 'work': {
      const b = businessById(state, k.businessId);
      const plot = plotById(state, b.plotId);
      const loc = b.type === 'farm' ? { x: plot.x + range(state, -4, 3), z: plot.z + range(state, -3, 1) } : frontOf(plot, range(state, -2.2, 2.2), range(state, 0.1, 1.2));
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
      return activity('help', `Helping ${t.firstName}`, { x: t.x, z: t.z }, 2, { citizenId: t.id });
    }
    case 'festival': return activity('festival', 'Celebrating at the festival', square(state), 10);
    case 'buy_plot': {
      if (!reservePlot(state, k.plotId, c.id)) return null;
      return activity('buy_plot', `Buying ${plotById(state, k.plotId).name}`, hallDoor(state), 3, { plotId: k.plotId });
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
    case 'family_time': return activity('family_time', 'Time with the family', homeOf(state, c), 8);
    case 'explore': return activity('explore', 'Wandering the village', { x: range(state, -26, 30), z: range(state, -20, 24) }, 4);
    default: return activity('idle', 'Taking a moment', { x: c.x, z: c.z }, 3);
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
    socialize(state, c, o, intensity);
    shareGossip(state, c, o);
    shareGossip(state, o, c);
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
      const n = a.good === 'grain' && balance(state, payer) > 14 ? 2 : 1;
      const res = b ? buyRetail(state, c, b, a.good, n, payer) : { ok: false };
      if (res.ok) eatFrom(c, a.good);
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
      const target = people.find((o) => o.id === a.citizenId);
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
    case 'festival': chat(state, c, nearby(state, c, 7).slice(0, 3), 1.4); c.needs.social = clamp(c.needs.social + 30); c.mood = clamp(c.mood + 5); break;
    case 'buy_plot': {
      const res = buyPlot(state, a.plotId, c.id);
      if (res.ok && c.venture) c.venture.plotId = a.plotId;
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
    default: break;
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
  const spec = a.home ? { kind: 'construction', buildingType: 'cottage', purpose: 'home' }
    : a.projectKind === 'demolition' ? { kind: 'demolition' }
      : { kind: a.projectKind, buildingType: BUSINESS_TYPES[a.businessType].building, purpose: 'business', businessType: a.businessType };
  const res = startProject(state, { plotId: plot.id, ownerId: c.id, ...spec });
  if (res.ok) { v.projectId = res.project.id; v.plotId = plot.id; }
}
