import { transfer, balance } from '../economy/Transactions.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { achieve } from '../citizens/Citizen.js';
import { record } from '../society/Chronicle.js';
import { LANDMARKS, ROUTES, SETTLEMENT_POS, HEARTH } from './RegionData.js';
import { ensureRegion, reveal, isExplored, settlementName } from './RegionManager.js';
import { GATES } from '../navigation/RoadNetwork.js';

// Scouting. The council funds an expedition, a villager with a taste for the
// unknown leads it and is away from the valley for days, and what they find
// is real: hidden roads open to caravans, a stone outcrop becomes a quarry,
// an old bridge speeds the River Road, ruins enter the history books.

const KM_PER_DAY = 22;

/** The most promising unexplored part of the map, nearest first. */
export function nextScoutingTarget(state) {
  const r = ensureRegion(state);
  const home = SETTLEMENT_POS[HEARTH];
  let best = null;
  for (let j = 0; j < 10; j++) for (let i = 0; i < 10; i++) {
    if (r.fog[j * 10 + i] === '1') continue;
    const x = i * 10 + 5, y = j * 10 + 5;
    // Prefer unknown ground that borders known land (scouts follow the edge).
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => r.fog[(j + b) * 10 + (i + a)] === '1').length;
    const d = Math.hypot(x - home.x, y - home.y) - neighbours * 8;
    if (!best || d < best.d) best = { x, y, d };
  }
  return best;
}

export function expeditionCost(state, target) {
  const home = SETTLEMENT_POS[HEARTH];
  const km = Math.hypot(target.x - home.x, target.y - home.y);
  const days = Math.max(2, Math.ceil((km * 2) / KM_PER_DAY));
  return { days, coins: 20 + days * 9, wage: days * 5 };
}

function chooseScout(state) {
  return state.citizens
    .filter((c) => !c.away && ageOf(state, c) >= LIFE.adultAge && ageOf(state, c) < 58 && !c.retired && c.employment?.role !== 'owner' && !(state.government?.leaderId === c.id))
    .map((c) => ({ c, s: trait(c, 'curious') * 2 + trait(c, 'riskTaking') * 1.5 - trait(c, 'shy') * 0.5 + (c.skills.foraging ?? 0) }))
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id))[0]?.c ?? null;
}

/** Send a scouting party. Returns { ok, message }. */
export function launchExpedition(state, { reason = 'the council' } = {}) {
  const r = ensureRegion(state);
  if (r.expeditions.some((e) => e.status === 'OUT')) return { ok: false, message: 'A scouting party is already out.' };
  const target = nextScoutingTarget(state);
  if (!target) return { ok: false, message: 'The whole region has been mapped.' };
  const leader = chooseScout(state);
  if (!leader) return { ok: false, message: 'No villager is free to lead an expedition.' };
  const cost = expeditionCost(state, target);
  if (balance(state, 'treasury') < cost.coins) return { ok: false, message: `An expedition needs ${cost.coins} coins.` };
  transfer(state, 'treasury', leader.id, cost.wage, 'wage', `${leader.firstName}'s pay to lead a scouting party`);
  transfer(state, 'treasury', 'outside', cost.coins - cost.wage, 'expedition', 'Supplies, mules and guides for the scouts');
  state.nextId.expedition = (state.nextId.expedition ?? 0) + 1;
  const e = { id: 'ex' + state.nextId.expedition, leaderId: leader.id, leaderName: `${leader.firstName} ${leader.lastName}`, target: { x: target.x, y: target.y }, departDay: state.day, returnDay: state.day + cost.days, cost: cost.coins, status: 'OUT', findings: [], reason };
  r.expeditions.push(e);
  if (r.expeditions.length > 20) r.expeditions.shift();
  if (leader.employment) leader.employment.onLeaveUntil = e.returnDay;
  leader.away = { until: e.returnDay, reason: 'scouting', expeditionId: e.id };
  leader.activity = null;
  const gate = GATES.north;
  leader.x = gate.x; leader.z = gate.z;
  remember(state, leader, 'Set out to scout the lands beyond the valley.', 3, 'milestone');
  record(state, 'region', `${leader.firstName} ${leader.lastName} led a scouting party out of the valley (${reason} paid ${cost.coins} coins), expected back in ${cost.days} days.`, { citizens: [leader.id] }, 2);
  return { ok: true, message: `${leader.firstName} leads the scouts, back in ${cost.days} days.` };
}

/** What a discovered landmark changes. */
function discover(state, landmark, e) {
  const r = state.region;
  if (r.discovered.landmarks.includes(landmark.id)) return null;
  r.discovered.landmarks.push(landmark.id);
  let effect = '';
  if (landmark.revealsRoute && !r.discovered.routes.includes(landmark.revealsRoute)) {
    r.discovered.routes.push(landmark.revealsRoute);
    const route = ROUTES.find((x) => x.id === landmark.revealsRoute);
    for (const [x, y] of route.points) reveal(state, x, y, 8);
    effect = ` The ${route.name} between ${settlementName(route.a)} and ${settlementName(route.b)} is open to caravans.`;
  }
  if (landmark.resource === 'stone') { r.quarry = { day: state.day, price: 2 }; effect = ' The council can now buy stone from Greyfell quarrymen.'; }
  if (landmark.id === 'shepherds-bridge') effect = ' Carts on the River Road can now cross the river quickly.';
  if (landmark.kind === 'ruins') effect = ' Villagers marvel at the find; it becomes part of local lore.';
  for (const c of state.citizens) if (landmark.kind === 'ruins') c.mood = Math.min(100, c.mood + 3);
  return `${landmark.name}: ${landmark.text}${effect}`;
}

/** Daily: scouting parties return with what they found. */
export function dailyExploration(state) {
  const r = ensureRegion(state);
  for (const e of r.expeditions.filter((x) => x.status === 'OUT' && x.returnDay <= state.day)) {
    e.status = 'RETURNED';
    const home = SETTLEMENT_POS[HEARTH];
    // Scouts map a corridor from home to their target.
    let cells = 0;
    const corridor = [];
    for (let t = 0.25; t <= 1.001; t += 0.25) {
      const p = { x: home.x + (e.target.x - home.x) * t, y: home.y + (e.target.y - home.y) * t };
      corridor.push(p);
      cells += reveal(state, p.x, p.y, 9);
    }
    for (const l of LANDMARKS) {
      if (!r.discovered.landmarks.includes(l.id) && corridor.some((p) => Math.hypot(p.x - l.x, p.y - l.y) <= 13)) {
        const found = discover(state, l, e);
        if (found) e.findings.push(found);
      }
    }
    e.cellsMapped = cells;
    const leader = byId(state.citizens, e.leaderId);
    if (leader) {
      leader.away = null;
      if (leader.employment) delete leader.employment.onLeaveUntil;
      leader.x = GATES.north.x * 0.9; leader.z = GATES.north.z * 0.9;
      leader.needs.hunger = Math.max(leader.needs.hunger, 45);
      if (e.findings.length) achieve(state, leader, 'explorer', `Discovered ${e.findings.map((f) => f.split(':')[0]).join(' and ')}`, {});
      remember(state, leader, e.findings.length ? `Came home from scouting with news of ${e.findings.map((f) => f.split(':')[0]).join(' and ')}.` : 'Came home from scouting, having mapped new country.', 3, 'milestone');
    }
    record(state, 'region', `${e.leaderName}'s scouts returned, mapping ${cells} new stretches of country.${e.findings.length ? ' ' + e.findings.join(' ') : ''}`, { citizens: leader ? [leader.id] : [] }, e.findings.length ? 3 : 2);
  }
  // A scout who died while away is noted and the expedition simply ends.
  for (const e of r.expeditions.filter((x) => x.status === 'OUT' && !byId(state.citizens, x.leaderId))) e.status = 'LOST';
  // Now and then a well-off council funds scouting on its own initiative.
  if (state.day % 12 === 6 && balance(state, 'treasury') > 360 && r.fog.includes('0')) launchExpedition(state, { reason: 'the council' });
}
