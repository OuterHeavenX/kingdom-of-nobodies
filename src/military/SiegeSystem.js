import { nextRandom } from '../core/Random.js';
import { record } from '../society/Chronicle.js';
import { HEARTH, KINGDOMS, ROUTES } from '../region/RegionData.js';
import { settlementName } from '../region/RegionManager.js';
import { foodCover } from '../region/Settlement.js';
import { villageFood } from '../economy/Marketplace.js';
import { ensureMilitary, note } from './Army.js';
import { forcesOf, populationOf } from './MilitaryManager.js';
import { strengthOf, resolveBattle } from './BattleResolver.js';

// Sieges. An army that reaches an enemy town with no field army to stop it
// sits down before the walls. While the siege lasts the town's roads are
// closed to trade, its fields yield less, and both sides burn through food.
// It ends by surrender (the town's food runs out and its spirit breaks), by
// withdrawal (the besiegers starve or lose heart), by negotiation, by relief
// from an ally, or by assault when the besiegers grow strong enough.

export const siegeAt = (state, party) => ensureMilitary(state).sieges.find((s) => s.status === 'ACTIVE' && s.target === party) ?? null;

export function beginSiege(state, army, war) {
  const m = ensureMilitary(state);
  if (siegeAt(state, army.at)) return siegeAt(state, army.at);
  const siege = { id: 'sg' + ++m.nextId.siege, warId: war.id, target: army.at, armyId: army.id, attacker: army.owner, startDay: state.day, status: 'ACTIVE', days: 0, log: [] };
  m.sieges.push(siege);
  if (m.sieges.length > 20) m.sieges.shift();
  army.status = 'BESIEGING';
  if (army.at !== HEARTH) state.region.settlements[army.at].besieged = siege.id;
  else state.besieged = siege.id;
  // Every road into the town is closed while the siege lasts.
  for (const r of ROUTES.filter((x) => x.a === army.at || x.b === army.at)) state.region.closures.push({ routeId: r.id, until: state.day + 3, reason: `the siege of ${settlementName(army.at)}`, closed: true, siege: siege.id });
  note(army, state, `Laid siege to ${settlementName(army.at)}.`);
  record(state, 'diplomacy', `${partyName(army.owner)}'s army laid siege to ${settlementName(army.at)}. Its roads are closed to trade.`, {}, 3);
  return siege;
}

const partyName = (p) => (p === HEARTH ? 'First Hearth' : KINGDOMS[p]?.name ?? p);

function endSiege(state, siege, outcome, text) {
  siege.status = 'ENDED';
  siege.outcome = outcome;
  siege.endDay = state.day;
  if (siege.target !== HEARTH) delete state.region.settlements[siege.target].besieged;
  else delete state.besieged;
  state.region.closures = state.region.closures.filter((c) => c.siege !== siege.id);
  record(state, 'diplomacy', text, {}, 3);
}

/** A town's ability to hold out: days of food, and the spirit of its people. */
function holdOut(state, party) {
  if (party === HEARTH) return { food: villageFood(state) / Math.max(1, state.citizens.length), morale: forcesOf(state, HEARTH).morale };
  const k = state.region.settlements[party];
  return { food: foodCover(state, k), morale: forcesOf(state, party).morale };
}

/** Daily: each siege grinds on toward an end. Returns outcomes for the war system to act on. */
export function pressSieges(state, wars) {
  const outcomes = [];
  for (const siege of ensureMilitary(state).sieges.filter((s) => s.status === 'ACTIVE')) {
    siege.days++;
    const army = state.military.armies.find((a) => a.id === siege.armyId);
    const war = wars.find((w) => w.id === siege.warId);
    if (!army || army.status !== 'BESIEGING' || !war || war.status !== 'ACTIVE') { endSiege(state, siege, 'lifted', `The siege of ${settlementName(siege.target)} was lifted.`); continue; }
    // Keep the roads closed while the siege lasts.
    for (const c of state.region.closures) if (c.siege === siege.id) c.until = state.day + 1;
    const town = holdOut(state, siege.target);
    if (siege.target !== HEARTH) {
      const k = state.region.settlements[siege.target];
      k.leader.approval = Math.max(0, k.leader.approval - 1);
      forcesOf(state, siege.target).morale = Math.max(0.05, forcesOf(state, siege.target).morale - 0.01);
    }
    // Surrender: the stores are empty and hope is gone.
    if (town.food < 1.5 && town.morale < 0.45 && siege.days >= 4) {
      endSiege(state, siege, 'surrender', `${settlementName(siege.target)} surrendered to ${partyName(siege.attacker)} after ${siege.days} days of siege, its food all but gone.`);
      war.score[siege.attacker] = (war.score[siege.attacker] ?? 0) + 5;
      outcomes.push({ kind: 'surrender', siege, war, winner: siege.attacker });
      continue;
    }
    // Withdrawal: the besiegers starve or lose heart.
    if ((army.supplies <= 0 && (army.hungry ?? 0) >= 4) || army.morale < 0.2) {
      endSiege(state, siege, 'withdrawal', `${partyName(siege.attacker)}'s army abandoned the siege of ${settlementName(siege.target)} after ${siege.days} days${army.supplies <= 0 ? ', its supplies exhausted' : ', its spirit broken'}.`);
      war.score[siege.target] = (war.score[siege.target] ?? 0) + 2;
      outcomes.push({ kind: 'withdrawal', siege, war, army });
      continue;
    }
    // Assault, when the besiegers clearly outmatch the garrison.
    const garrisonSoldiers = Math.max(10, Math.floor(populationOf(state, siege.target) * 0.05));
    const garrison = { id: 'garrison', owner: siege.target, soldiers: garrisonSoldiers, startSoldiers: garrisonSoldiers, training: forcesOf(state, siege.target).training, equipment: forcesOf(state, siege.target).equipment, morale: town.morale, supplies: town.food > 1 ? 1 : 0, hungry: town.food > 1 ? 0 : 3, citizenIds: [], history: [] };
    const atk = strengthOf(state, army).value, def = strengthOf(state, garrison, { defending: true, fortified: siege.target }).value;
    if (siege.days >= 5 && atk > def * 2.2 && nextRandom(state) < 0.35) {
      const battle = resolveBattle(state, army, garrison, { fortified: siege.target, war });
      if (battle.winner === army.owner) {
        endSiege(state, siege, 'stormed', `${partyName(army.owner)} took ${settlementName(siege.target)} by assault after ${siege.days} days.`);
        outcomes.push({ kind: 'surrender', siege, war, winner: army.owner });
      } else {
        endSiege(state, siege, 'repulsed', `The defenders of ${settlementName(siege.target)} threw back the assault; the besiegers fell back.`);
        outcomes.push({ kind: 'withdrawal', siege, war, army });
      }
      // The garrison's losses already came out of the town's population in the battle.
      continue;
    }
    if (siege.days % 5 === 0) outcomes.push({ kind: 'parley', siege, war });
  }
  return outcomes;
}
