import { nextRandom } from '../core/Random.js';
import { byId } from '../core/EntityRegistry.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { yearOf } from '../core/Calendar.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';
import { routeById, settlementName } from '../region/RegionManager.js';
import { ensureMilitary, note } from './Army.js';

// Battles are resolved as strategic engagements, not as thousands of duels.
// Each side's strength combines its numbers with training, equipment,
// morale, supply, its commander and the ground; a bounded roll (±15%)
// stands for the fortunes of the day. More soldiers do not always win: a
// hungry, poorly armed host can lose to a smaller, better one. The outcome
// changes real numbers: soldiers lost, morale, the war's score and, for the
// villagers in First Hearth's militia, who comes home.

const TERRAIN_DEFENCE = { mountain: 1.25, forest: 1.15, plains: 1, coast: 1.05 };
const FORTIFIED = { ironhold: 1.5, saltmere: 1.25, greenvale: 1.1, hearth: 1.15 };

export const supplyFactor = (army) => (army.supplies > 0 ? 1 : Math.max(0.5, 1 - (army.hungry ?? 0) * 0.08));

function leadership(state, army) {
  if (army.owner === HEARTH) {
    const c = byId(state.citizens, army.commander);
    return 0.9 + (c?.skills.leadership ?? 0) * 0.25;
  }
  const p = state.foreign?.people[army.commander];
  return p ? 0.9 + (p.standing / 100) * 0.15 + (p.personality.caution - 0.5) * 0.05 : 1;
}

/** The factors behind an army's strength, kept so the battle can be explained. */
export function strengthOf(state, army, { defending = false, terrain = 'plains', fortified = null } = {}) {
  const factors = {
    soldiers: army.soldiers,
    training: Math.round((0.6 + army.training * 0.8) * 100) / 100,
    equipment: Math.round((0.6 + army.equipment * 0.8) * 100) / 100,
    morale: Math.round((0.5 + army.morale) * 100) / 100,
    supply: Math.round(supplyFactor(army) * 100) / 100,
    leadership: Math.round(leadership(state, army) * 100) / 100,
    ground: defending ? (fortified ? FORTIFIED[fortified] ?? 1.1 : TERRAIN_DEFENCE[terrain] ?? 1) : 1,
  };
  const value = Object.values(factors).reduce((a, b) => a * b, 1);
  return { value: Math.round(value), factors };
}

/**
 * Resolve a battle between two armies. `defender` holds the ground (a field
 * on a route, or the walls of a settlement when `fortified` names it).
 */
export function resolveBattle(state, attacker, defender, { routeId = null, fortified = null, war = null } = {}) {
  const m = ensureMilitary(state);
  const route = routeId ? routeById(routeId) : null;
  const terrain = route?.terrain ?? 'plains';
  const A = strengthOf(state, attacker, { terrain });
  const D = strengthOf(state, defender, { defending: true, terrain, fortified });
  const rollA = 0.85 + nextRandom(state) * 0.3, rollD = 0.85 + nextRandom(state) * 0.3;
  const a = A.value * rollA, d = D.value * rollD;
  const attackerWins = a > d;
  const ratio = attackerWins ? a / Math.max(1, d) : d / Math.max(1, a);
  const winner = attackerWins ? attacker : defender, loser = attackerWins ? defender : attacker;
  // Losses: the beaten side loses more, especially when the battle was lopsided.
  const loserShare = Math.min(0.4, 0.12 + (ratio - 1) * 0.15);
  const winnerShare = Math.max(0.03, 0.12 - (ratio - 1) * 0.05);
  const before = { [attacker.id]: attacker.soldiers, [defender.id]: defender.soldiers };
  const lostL = Math.max(1, Math.round(loser.soldiers * loserShare));
  const lostW = Math.max(0, Math.round(winner.soldiers * winnerShare));
  loser.soldiers -= lostL; winner.soldiers -= lostW;
  loser.morale = Math.max(0.05, Math.round((loser.morale - 0.25) * 100) / 100);
  winner.morale = Math.min(1, Math.round((winner.morale + 0.08) * 100) / 100);
  const place = fortified ? `the walls of ${settlementName(fortified)}` : route ? `the ${route.name}` : 'open ground';
  const name = `Battle of ${fortified ? settlementName(fortified) : route ? route.name.replace(/^the /i, '') : 'the Field'}`;
  const battle = {
    id: 'bt' + ++m.nextId.battle, name, day: state.day, year: yearOf(state.day), warId: war?.id ?? attacker.warId, place, terrain, fortified,
    sides: [
      { party: attacker.owner, armyId: attacker.id, role: 'attacker', before: before[attacker.id], after: attacker.soldiers, strength: A.value, roll: Math.round(rollA * 100) / 100, factors: A.factors },
      { party: defender.owner, armyId: defender.id, role: 'defender', before: before[defender.id], after: defender.soldiers, strength: D.value, roll: Math.round(rollD * 100) / 100, factors: D.factors },
    ],
    winner: winner.owner, loser: loser.owner, decisive: ratio > 1.5,
  };
  m.battles.push(battle);
  if (m.battles.length > 40) m.battles.shift();
  if (war) { war.battles.push(battle.id); war.score[winner.owner] = (war.score[winner.owner] ?? 0) + (battle.decisive ? 3 : 2); war.casualties[attacker.owner] = (war.casualties[attacker.owner] ?? 0) + (before[attacker.id] - attacker.soldiers); war.casualties[defender.owner] = (war.casualties[defender.owner] ?? 0) + (before[defender.id] - defender.soldiers); }
  // Soldiers are people: a kingdom's losses come out of its population.
  for (const [army, lost] of [[loser, lostL], [winner, lostW]]) {
    if (army.owner !== HEARTH) {
      const k = state.region.settlements[army.owner];
      k.population = Math.max(40, k.population - lost);
      k.mobilised = Math.max(0, (k.mobilised ?? 0) - lost);
    } else militiaLosses(state, army, lost, battle);
    note(army, state, `${army === winner ? 'Won' : 'Lost'} the ${name}; ${lost} soldiers lost.`);
  }
  const why = explain(battle);
  record(state, 'diplomacy', `The ${name} (Year ${battle.year}): ${partyName(winner.owner)} ${battle.decisive ? 'decisively defeated' : 'defeated'} ${partyName(loser.owner)} at ${place}. ${partyName(attacker.owner)} brought ${before[attacker.id]} soldiers, ${partyName(defender.owner)} ${before[defender.id]}; ${why}. The beaten army withdrew.`, {}, 3);
  return battle;
}

const partyName = (p) => (p === HEARTH ? 'First Hearth' : KINGDOMS[p]?.name ?? p);

/** Plain words for why a battle went the way it did. */
export function explain(battle) {
  const [a, d] = battle.sides;
  const w = battle.winner === a.party ? a : d, l = w === a ? d : a;
  const reasons = [];
  if (w.before < l.before) reasons.push(`though outnumbered, ${partyName(w.party)} had the better of ${['training', 'equipment', 'morale', 'supply'].filter((k) => w.factors[k] > l.factors[k]).join(' and ') || 'the day'}`);
  else reasons.push(`${partyName(w.party)} had the larger force`);
  if (l.factors.supply < 1) reasons.push(`${partyName(l.party)}'s soldiers were going hungry`);
  if (w.role === 'defender' && w.factors.ground > 1) reasons.push(`the ground favoured the defenders`);
  return reasons.join('; ');
}

/**
 * First Hearth's militia counts its villagers as small companies: a battle's
 * losses fall on those companies, and occasionally a villager does not come home.
 */
function militiaLosses(state, army, lost, battle) {
  const share = lost / Math.max(1, army.soldiers + lost);
  const fallen = [];
  for (const id of [...army.citizenIds]) {
    const c = byId(state.citizens, id);
    if (!c) continue;
    if (nextRandom(state) < share * 0.35) fallen.push(c);
    else remember(state, c, `Fought at the ${battle.name}.`, 3, 'life');
  }
  for (const c of fallen) {
    army.citizenIds = army.citizenIds.filter((x) => x !== c.id);
    c.away = null;
    state.military.fallen = [...(state.military.fallen ?? []), { id: c.id, name: `${c.firstName} ${c.lastName}`, battle: battle.name, day: state.day }].slice(-40);
    warDeath(state, c, `fell at the ${battle.name}`);
  }
}

/** Set by the war system (Lifecycle.die) to avoid a circular import. */
export const casualtyHooks = { die: null };
const warDeath = (state, c, cause) => casualtyHooks.die?.(state, c, cause);
