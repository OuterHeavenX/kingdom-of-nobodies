import { MILITARY, DAYS_PER_YEAR } from '../core/Config.js';
import { nextRandom } from '../core/Random.js';
import { yearOf, isNewSeason } from '../core/Calendar.js';
import { balance, transfer } from '../economy/Transactions.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { HEARTH, KINGDOMS, DISPUTED_LANDS } from '../region/RegionData.js';
import { routeById, settlementName } from '../region/RegionManager.js';
import { relationScore, hasTreaty, signTreaty, adjustRelation, activeTreaties, diplomacyNote, PARTIES } from '../diplomacy/Diplomacy.js';
import { defensiveAllies, alliesOf, militaryWilling } from '../diplomacy/Alliances.js';
import { ensureDisputes, claimantOf, settle, disputeById, landOf } from '../diplomacy/TerritorialClaims.js';
import { achieve as foreignAchieve } from '../region/ForeignCitizenManager.js';
import { ensureMilitary, liveArmies, orderMarch, note } from './Army.js';
import { raiseArmy, disband, supplyArmies, potentialStrength, forcesOf, partyAccount } from './MilitaryManager.js';
import { resolveBattle } from './BattleResolver.js';
import { beginSiege, pressSieges, siegeAt } from './SiegeSystem.js';

// Wars: why they begin, who joins, how they are fought and how they end.
// A war needs a cause on record (a dispute whose talks have failed), a ruler
// willing to fight and the means to; allies can deter it. Once begun, armies
// are raised, march along the roads, meet in the field, besiege towns and
// cost their kingdoms every day. Exhaustion, defeats, sieges and the calendar
// all push toward peace, and every war ends in a treaty that changes the map
// of claims, relations and, sometimes, treasuries.

const name = (p) => (p === HEARTH ? 'First Hearth' : KINGDOMS[p]?.name ?? p);
const ruler = (state, p) => (p === HEARTH ? null : state.foreign?.people[state.region.settlements[p]?.leader?.citizenId] ?? null);
export const activeWars = (state) => ensureMilitary(state).wars.filter((w) => w.status === 'ACTIVE');
export const sides = (w) => [...w.attackers, ...w.defenders];
export function warBetween(state, a, b) {
  return activeWars(state).find((w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a))) ?? null;
}
export const atWar = (state, p) => activeWars(state).some((w) => sides(w).includes(p));
export const besieged = (state, p) => (siegeAt(state, p) ? p : null);

/** Combined strength of a coalition, as a ruler weighing war would reckon it. */
const coalition = (state, parties) => parties.reduce((s, p) => s + potentialStrength(state, p), 0);

/** The strength ratio over the enemy a ruler of this temper (plus need) wants before going to war. */
export const warOdds = (drive) => Math.max(0.85, Math.min(1.15, 1.15 - (drive - 0.75) * 0.5));

/** A side's standing in a war: the points won by every party fighting on it, allies included. */
export const sideScore = (war, side) => war[side].reduce((s, p) => s + (war.score[p] ?? 0), 0);

/**
 * Talks over a dispute have failed: does the claimant go to war? Returns the war or null.
 * The decision is explained in the Chronicle either way when it is close.
 */
export function considerWar(state, dispute) {
  const m = ensureMilitary(state);
  const aggressor = claimantOf(dispute), target = dispute.controller;
  if (atWar(state, aggressor) || atWar(state, target)) return null;
  if (hasTreaty(state, aggressor, target, 'peace') || hasTreaty(state, aggressor, target, 'border')) return null;
  const lastWar = m.wars.filter((w) => sides(w).includes(aggressor)).at(-1);
  if (lastWar && state.day - (lastWar.endDay ?? state.day) < DAYS_PER_YEAR * 3) return null;
  const r = ruler(state, aggressor);
  const temper = (r?.personality.ambition ?? 0.5) + (r?.personality.pride ?? 0.5) - (r?.personality.caution ?? 0.5) * 0.8;
  const need = state.region.settlements[aggressor].shortages[landOf(dispute.id).resource] || state.region.settlements[aggressor].shortages.food ? 0.3 : 0;
  const friends = alliesOf(state, aggressor).filter((p) => p !== target && militaryWilling(state, p, aggressor, 'assistance_mil'));
  const shield = defensiveAllies(state, target).filter((p) => p !== aggressor);
  const mine = coalition(state, [aggressor, ...friends]);
  const theirs = coalition(state, [target, ...shield]);
  const rich = balance(state, partyAccount(aggressor)) > 600;
  // A cautious ruler wants clearly better odds; a bold or desperate one gambles on a closer fight.
  const odds = warOdds(temper + need);
  const go = temper + need > 0.75 && rich && mine > theirs * odds;
  if (!go) {
    if (temper + need > 0.75 && shield.length && mine <= theirs * odds) {
      diplomacyNote(state, `${name(aggressor)} weighed war over ${dispute.name} but held back: ${name(target)}'s alliance with ${shield.map(name).join(' and ')} made the odds too poor.`, 2);
      dispute.deterred = (dispute.deterred ?? 0) + 1;
    }
    return null;
  }
  return declareWar(state, aggressor, target, dispute, friends);
}

export function declareWar(state, aggressor, target, dispute, friends = []) {
  const m = ensureMilitary(state);
  const land = DISPUTED_LANDS.find((l) => l.id === dispute.id);
  const war = {
    id: 'war' + ++m.nextId.war, name: `War of ${land.name.replace(/^the /, '')}`, cause: `${name(aggressor)} claims ${dispute.name}, held by ${name(target)}; talks failed ${dispute.failures} times (${dispute.causes.slice(0, 2).join('; ') || 'old grievances'})`,
    disputeId: dispute.id, attackers: [aggressor], defenders: [target], startDay: state.day, status: 'ACTIVE', score: {}, costs: {}, casualties: {}, battles: [], raised: {}, refused: [], log: [],
    field: { kind: 'field', route: land.route, name: land.name },
  };
  m.wars.push(war);
  if (m.wars.length > 30) m.wars = m.wars.filter((w) => w.status === 'ACTIVE').concat(m.wars.filter((w) => w.status !== 'ACTIVE').slice(-20));
  m.aggressions[aggressor] = (m.aggressions[aggressor] ?? 0) + 1;
  dispute.status = 'WAR';
  dispute.warId = war.id;
  // Any treaty between the belligerents is broken by the declaration.
  for (const t of activeTreaties(state, aggressor, target)) { t.status = 'BROKEN'; t.endedDay = state.day; }
  adjustRelation(state, aggressor, target, -25, 'a declaration of war');
  for (const p of PARTIES) if (p !== aggressor && p !== target) adjustRelation(state, aggressor, p, -4, `${name(aggressor)} went to war`);
  record(state, 'diplomacy', `${name(aggressor)} declared war on ${name(target)} (Year ${yearOf(state.day)}). The cause: ${war.cause}.`, {}, 3);
  foreignAchieve(ruler(state, aggressor), state, `Declared the ${war.name}`);
  // Allies answer the call — or break their word.
  for (const ally of defensiveAllies(state, target)) if (ally !== aggressor) callAlly(state, war, ally, 'defenders');
  for (const ally of friends) callAlly(state, war, ally, 'attackers');
  // Both sides raise armies for the contested land.
  for (const p of sides(war)) mobilise(state, war, p);
  return war;
}

function callAlly(state, war, ally, side) {
  if (sides(war).includes(ally) || atWar(state, ally)) return;
  const friend = side === 'defenders' ? war.defenders[0] : war.attackers[0];
  const foe = side === 'defenders' ? war.attackers[0] : war.defenders[0];
  const keeps = ally === HEARTH ? (state.government?.policies?.openDiplomacy ?? true) && relationScore(state, HEARTH, foe) < 50 : relationScore(state, ally, foe) < 55 && nextRandom(state) < 0.85;
  if (keeps) {
    war[side].push(ally);
    adjustRelation(state, ally, foe, -15, `joined the war against ${name(foe)}`);
    adjustRelation(state, ally, friend, 6, 'honoured an alliance');
    record(state, 'diplomacy', `${name(ally)} honoured its alliance and joined the war on the side of ${name(friend)}.`, {}, 3);
  } else {
    war.refused.push(ally);
    for (const t of activeTreaties(state, ally, friend).filter((x) => x.kind === 'defense' || x.kind === 'assistance_mil')) { t.status = 'BROKEN'; t.endedDay = state.day; }
    adjustRelation(state, ally, friend, -20, 'broke an alliance in the hour of need');
    record(state, 'diplomacy', `${name(ally)} refused to join the war, breaking its alliance with ${name(friend)}.`, {}, 3);
  }
}

function mobilise(state, war, party) {
  war.raised[party] = (war.raised[party] ?? 0) + 1;
  if (war.raised[party] > 2) return null;
  const lead = war.attackers[0] === party || war.defenders[0] === party;
  const army = raiseArmy(state, party, war, war.field, { share: lead ? 1 : 0.6 });
  if (army) record(state, 'diplomacy', `${name(party)} raised ${army.soldiers} soldiers for the ${war.name}${army.citizenIds.length ? `, calling up ${army.citizenIds.length} villagers` : ''}.`, {}, army.citizenIds.length ? 2 : 1);
  return army;
}

const enemiesOf = (war, party) => (war.attackers.includes(party) ? war.defenders : war.attackers);

/** Daily: armies march, meet, fight and besiege; wars move toward their end. */
export function dailyWar(state) {
  const m = ensureMilitary(state);
  ensureDisputes(state);
  supplyArmies(state);
  for (const war of activeWars(state)) {
    const armies = liveArmies(state).filter((a) => a.warId === war.id);
    // Ready armies set out for the contested land.
    for (const a of armies.filter((x) => x.status === 'READY')) orderMarch(state, a, war.field, 'campaign');
    // Battles in the field.
    const camp = armies.filter((a) => a.status === 'ENCAMPED' && a.field === war.field.route);
    const att = camp.filter((a) => war.attackers.includes(a.owner)).sort((x, y) => y.soldiers - x.soldiers || x.id.localeCompare(y.id));
    const def = camp.filter((a) => war.defenders.includes(a.owner)).sort((x, y) => y.soldiers - x.soldiers || x.id.localeCompare(y.id));
    if (att.length && def.length) {
      // Every army encamped on the field fights: allies stand together. The side that
      // reached the field first chose its position and has the ground (the holder on a tie).
      const first = (xs) => Math.min(...xs.map((x) => x.arrivedDay ?? state.day));
      const ground = first(att) < first(def) ? 'attacker' : 'defender';
      const battle = resolveBattle(state, att[0], def[0], { routeId: war.field.route, war, attackerAllies: att.slice(1), defenderAllies: def.slice(1), ground });
      const beaten = war.attackers.includes(battle.loser) ? att : def;
      for (const x of beaten) orderMarch(state, x, { kind: 'settlement', id: x.owner }, 'retreat');
      // The beaten side raises a fresh army if it still can.
      const lead = beaten === att ? war.attackers[0] : war.defenders[0];
      if (beaten.some((x) => x.owner === lead)) mobilise(state, war, lead);
    } else if (att.length && !def.length && state.day - (att[0].arrivedDay ?? state.day) >= 3) {
      // Holding the field unopposed: the land is occupied; a strong host marches on the enemy capital.
      if (!war.occupied) { war.occupied = state.day; war.score[att[0].owner] = (war.score[att[0].owner] ?? 0) + 2; record(state, 'diplomacy', `${name(att[0].owner)}'s army occupied ${war.field.name}.`, {}, 2); }
      const capital = war.defenders[0];
      if (!siegeAt(state, capital) && potentialStrength(state, capital) * 0.6 < att[0].soldiers && !armies.some((a) => war.defenders.includes(a.owner) && a.status !== 'HOME')) orderMarch(state, att[0], { kind: 'settlement', id: capital }, 'campaign');
    } else if (def.length && !att.length && !war.held && state.day - (def[0].arrivedDay ?? state.day) >= 3 && armies.every((a) => !war.attackers.includes(a.owner) || ['RETREATING', 'HOME'].includes(a.status))) {
      // Holding the field after the invaders have fallen back counts once, as an occupation does for the attacker.
      war.held = state.day;
      war.score[def[0].owner] = (war.score[def[0].owner] ?? 0) + 2;
      record(state, 'diplomacy', `${name(def[0].owner)}'s army held ${war.field.name} after the invaders fell back.`, {}, 2);
    }
    // An attacking army that reaches the enemy's town besieges it.
    for (const a of armies.filter((x) => x.status === 'ENCAMPED' && x.at && enemiesOf(war, x.owner).includes(x.at))) beginSiege(state, a, war);
    if (armies.filter((a) => a.status !== 'HOME').length === 0 && Object.values(war.raised).every((n) => n >= 2)) war.spent = true;
  }
  for (const out of pressSieges(state, activeWars(state))) {
    if (out.kind === 'surrender') makePeace(state, out.war, { winner: out.winner, reason: `${settlementName(out.siege.target)} surrendered` });
    else if (out.kind === 'withdrawal') orderMarch(state, out.army ?? state.military.armies.find((a) => a.id === out.siege.armyId), { kind: 'settlement', id: out.siege.attacker }, 'retreat');
    else if (out.kind === 'parley' && nextRandom(state) < 0.35) makePeace(state, out.war, { reason: 'terms were agreed outside the walls' });
  }
  for (const war of activeWars(state)) considerPeace(state, war);
  // After a peace, an army that could not find an open road home (a landslide, a siege elsewhere)
  // keeps trying; after ten days its soldiers make their own way home and it stands down.
  for (const a of liveArmies(state)) {
    const war = m.wars.find((w) => w.id === a.warId);
    if (war?.status === 'ACTIVE' || ['RETURNING', 'RETREATING', 'HOME'].includes(a.status)) continue;
    if (!orderMarch(state, a, { kind: 'settlement', id: a.owner }, 'home') && state.day - (war?.endDay ?? a.raisedDay) > 10) disband(state, a, 'the soldiers made their own way home');
  }
  // A retreating army that reached home stands down unless its war goes on and it can still fight.
  for (const a of liveArmies(state).filter((x) => x.status === 'HOME')) {
    const war = m.wars.find((w) => w.id === a.warId);
    if (war?.status === 'ACTIVE' && a.morale >= 0.4 && a.soldiers >= 20 && a.supplies > 0) { a.status = 'READY'; a.morale = Math.min(1, a.morale + 0.1); note(a, state, 'Regrouped at home.'); }
  }
}

/** War weariness, from days at war, coins spent and soldiers lost. */
export function exhaustion(state, war, party) {
  const days = state.day - war.startDay;
  const spent = (war.costs[party] ?? 0) / Math.max(200, balance(state, partyAccount(party)) + (war.costs[party] ?? 0));
  const lost = (war.casualties[party] ?? 0) / Math.max(1, party === HEARTH ? 30 : state.region.settlements[party].population * 0.12);
  return Math.round(Math.min(1.5, days / MILITARY.maxWarDays + spent * 0.6 + lost * 0.5) * 100) / 100;
}

function considerPeace(state, war) {
  const days = state.day - war.startDay;
  if (days >= MILITARY.maxWarDays) return makePeace(state, war, { reason: 'both sides were exhausted after three years of war' });
  if (war.spent) return makePeace(state, war, { reason: 'neither side could field another army' });
  if (!isNewSeason(state.day) || days < 3) return null;
  const tired = Math.max(...sides(war).map((p) => exhaustion(state, war, p)));
  const lead = Math.abs(sideScore(war, 'attackers') - sideScore(war, 'defenders'));
  const odds = Math.min(0.9, tired * 0.6 + lead * 0.05);
  if (nextRandom(state) < odds) return makePeace(state, war, { reason: lead >= 3 ? 'the losing side sued for peace' : 'envoys found terms both could accept' });
  return null;
}

/**
 * End a war with a treaty. The side ahead (or the one a besieged town
 * surrendered to) sets the terms: who holds the disputed land, reparations,
 * and a treaty recognising the border; an even war ends in a ceasefire on
 * the old lines. Armies go home; trade resumes.
 */
export function makePeace(state, war, { winner = null, reason }) {
  if (war.status !== 'ACTIVE') return null;
  const a = war.attackers[0], d = war.defenders[0];
  // Allies' victories count for the side they fought on.
  const sa = sideScore(war, 'attackers'), sd = sideScore(war, 'defenders');
  winner = winner ?? (sa - sd >= 2 ? a : sd - sa >= 2 ? d : null);
  const dispute = disputeById(state, war.disputeId);
  const terms = [];
  if (winner) {
    const loser = winner === a ? d : a;
    if (dispute) {
      if (dispute.claimants.includes(winner)) { settle(state, dispute, winner, `the peace that ended the ${war.name} gives it to ${name(winner)}`); terms.push(`${dispute.name} to ${name(winner)}`); }
      else { settle(state, dispute, dispute.controller, `the peace confirms ${name(dispute.controller)}'s hold`); terms.push(`${dispute.name} stays with ${name(dispute.controller)}`); }
    }
    const purse = partyAccount(loser);
    const reparations = Math.min(60 + Math.round(Math.abs(sa - sd) * 20), Math.floor(balance(state, purse) * 0.15));
    if (reparations > 0 && transfer(state, purse, partyAccount(winner), reparations, 'reparations', `${name(loser)}'s reparations to ${name(winner)}`)) terms.push(`${reparations} coins in reparations`);
    signTreaty(state, 'peace', a, d);
    terms.push('a non-aggression pact');
  } else {
    if (dispute) settle(state, dispute, dispute.controller, `a ceasefire leaves it with ${name(dispute.controller)}`);
    signTreaty(state, 'ceasefire', a, d);
    terms.push('a ceasefire on the old lines');
  }
  war.status = 'ENDED';
  war.endDay = state.day;
  war.terms = terms;
  war.winner = winner;
  war.reason = reason;
  adjustRelation(state, a, d, 12, `peace after the ${war.name}`);
  for (const army of liveArmies(state).filter((x) => x.warId === war.id)) {
    if (army.status === 'MUSTERING' || army.status === 'READY' || army.at === army.owner) disband(state, army, 'peace');
    else orderMarch(state, army, { kind: 'settlement', id: army.owner }, 'home');
  }
  for (const s of state.military.sieges.filter((x) => x.warId === war.id && x.status === 'ACTIVE')) {
    s.status = 'ENDED'; s.outcome = 'peace'; s.endDay = state.day;
    if (s.target !== HEARTH) delete state.region.settlements[s.target].besieged; else delete state.besieged;
    state.region.closures = state.region.closures.filter((c) => c.siege !== s.id);
  }
  const days = state.day - war.startDay;
  record(state, 'diplomacy', `The ${war.name} ended after ${days} days (Year ${yearOf(state.day)}): ${reason}. ${winner ? `${name(winner)} prevailed` : 'Neither side prevailed'}; terms: ${terms.join(', ')}. ${war.battles.length} battle${war.battles.length === 1 ? '' : 's'} were fought; the war cost ${sides(war).map((p) => `${name(p)} ${war.costs[p] ?? 0} coins`).join(', ')}. Trade routes reopen.`, {}, 3);
  foreignAchieve(ruler(state, winner), state, `Won the ${war.name}`);
  for (const p of sides(war)) for (const c of state.citizens.filter((x) => x.militia?.warId === war.id)) remember(state, c, `Heard that the ${war.name} is over.`, 1, 'life');
  return war;
}

/** Seasonal readiness: forces drill in peacetime. */
export { forcesOf };
