// Milestone 5 — alliances, armies and warfare (Phase E).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { deserialize, serialize } from '../src/core/Serialization.js';
import { totalMoney, balance, transfer } from '../src/economy/Transactions.js';
import { MILITARY } from '../src/core/Config.js';
import { ROUTES } from '../src/region/RegionData.js';
import { signTreaty, tradeBlocked, relation } from '../src/diplomacy/Diplomacy.js';
import { disputeById, seasonalClaims } from '../src/diplomacy/TerritorialClaims.js';
import { declareWar, considerWar, makePeace, warBetween, activeWars } from '../src/military/WarManager.js';
import { liveArmies, armyPosition } from '../src/military/Army.js';
import { potentialStrength } from '../src/military/MilitaryManager.js';
import { resolveBattle } from '../src/military/BattleResolver.js';
import { rulerOf } from '../src/region/ForeignCitizenManager.js';

const fixture = () => deserialize(readFileSync(new URL('./fixtures/m4-save.json', import.meta.url), 'utf8'));
const corridor = (s) => disputeById(s, 'mill-corridor');

function brewDispute(s) {
  const d = corridor(s);
  relation(s, 'greenvale', 'ironhold').score = -50;
  d.status = 'DISPUTED'; d.tension = 14; d.failures = 2; d.causes = ['relations between Greenvale and Ironhold stand at -50'];
  return d;
}

test('acceptance: a dispute over the mountain corridor becomes a war, armies march, fight, and a treaty ends it', () => {
  const s = fixture();
  const sim = new Simulation(s);
  const money = totalMoney(s);
  const d = brewDispute(s);
  const gv = s.region.settlements.greenvale, ih = s.region.settlements.ironhold;
  const foodBefore = gv.inventory.grain + gv.inventory.provisions;
  const coinsBefore = { g: balance(s, 'k:greenvale'), i: balance(s, 'k:ironhold') };
  const war = declareWar(s, 'ironhold', 'greenvale', d);
  assert.ok(war.cause.includes('Old Mill corridor'), 'the war has a recorded cause');
  assert.ok(s.chronicle.some((e) => /declared war on Greenvale/.test(e.text) && e.text.includes('cause')));
  const armies = liveArmies(s).filter((a) => a.warId === war.id);
  assert.ok(armies.length >= 2, 'both sides raised armies');
  assert.ok(ih.mobilised > 0 && gv.mobilised > 0, 'soldiers were taken from the workforce');
  assert.ok(gv.inventory.grain + gv.inventory.provisions < foodBefore, 'armies carry real food from the stores');
  assert.ok(armies.every((a) => a.supplies > 0));
  assert.ok(tradeBlocked(s, 'greenvale', 'ironhold', 'hearth'), 'trade between the belligerents stops');
  // March: positions change a little at a time along real roads, never jumping.
  const track = new Map(armies.map((a) => [a.id, armyPosition(s, a)]));
  let battles = 0;
  for (let h = 0; h < 24 * 30 && war.status === 'ACTIVE'; h++) {
    sim.runTicks(6);
    for (const a of armies) {
      const p = armyPosition(s, a), q = track.get(a.id);
      if (a.status !== 'DISBANDED') assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 8, `${a.name} moved continuously`);
      track.set(a.id, p);
    }
    battles = s.military.battles.filter((b) => b.warId === war.id).length;
  }
  assert.ok(battles >= 1, 'a battle was fought');
  const b = s.military.battles.find((x) => x.warId === war.id);
  for (const side of b.sides) assert.ok(side.after < side.before, 'casualties update army strength');
  assert.ok(['ironhold', 'greenvale'].includes(b.winner));
  // Costs fall on the treasuries.
  assert.ok((war.costs.ironhold ?? 0) > 0 && (war.costs.greenvale ?? 0) > 0, 'the war costs coins every day');
  assert.ok(balance(s, 'k:ironhold') < coinsBefore.i + 2000);
  // It ends, one way or another, within the limit; then trade reopens.
  for (let i = 0; i < MILITARY.maxWarDays + 5 && war.status === 'ACTIVE'; i++) sim.runDays(1);
  assert.equal(war.status, 'ENDED', 'the war ended');
  assert.ok(war.terms.length >= 1);
  assert.equal(warBetween(s, 'ironhold', 'greenvale'), null);
  assert.equal(tradeBlocked(s, 'greenvale', 'ironhold', 'hearth'), null, 'trade routes reopen');
  assert.ok(['SETTLED'].includes(corridor(s).status));
  assert.ok(s.chronicle.some((e) => e.text.includes(`The ${war.name} ended`)));
  sim.runDays(20);
  assert.ok(liveArmies(s).filter((a) => a.warId === war.id).length === 0, 'armies went home and stood down');
  assert.equal(ih.mobilised, 0, 'soldiers returned to work');
  assert.equal(totalMoney(s), money, 'every coin accounted for');
});

test('alliances oblige allies to join, and deter an aggressor', () => {
  const s = fixture();
  const d = brewDispute(s);
  signTreaty(s, 'defense', 'greenvale', 'saltmere');
  // With a strong ally, a weaker aggressor is deterred.
  const r = rulerOf(s, 'ironhold');
  r.personality = { ambition: 0.9, pride: 0.9, caution: 0.1, warmth: 0.2 };
  transfer(s, 'outside', 'k:ironhold', 2000, 'grant', 'test');
  s.region.settlements.saltmere.population = 900;
  assert.equal(considerWar(s, d), null, 'Ironhold held back');
  assert.ok(s.chronicle.some((e) => /held back/.test(e.text) && e.text.includes('Saltmere')));
  // Declared anyway: the ally answers the call.
  const war = declareWar(s, 'ironhold', 'greenvale', d);
  assert.ok(war.defenders.includes('saltmere') || war.refused.includes('saltmere'), 'Saltmere answered the alliance');
  if (war.defenders.includes('saltmere')) assert.ok(liveArmies(s).some((a) => a.owner === 'saltmere' && a.warId === war.id));
  assert.ok(potentialStrength(s, 'saltmere') > 0);
});

test('First Hearth\'s militia takes real villagers from their jobs, and brings them home', () => {
  const s = fixture();
  const sim = new Simulation(s);
  const d = brewDispute(s);
  signTreaty(s, 'defense', 'hearth', 'greenvale');
  relation(s, 'hearth', 'ironhold').score = -10;
  const employed = s.citizens.filter((c) => c.employment && c.employment.role !== 'owner').length;
  const war = declareWar(s, 'ironhold', 'greenvale', d);
  assert.ok(war.defenders.includes('hearth'), 'First Hearth honoured the alliance');
  const militia = liveArmies(s).find((a) => a.owner === 'hearth');
  assert.ok(militia && militia.citizenIds.length >= 3);
  for (const id of militia.citizenIds) {
    const c = s.citizens.find((x) => x.id === id);
    assert.equal(c.employment, null, `${c.firstName} left their job`);
    assert.equal(c.away.reason, 'militia');
  }
  assert.ok(s.citizens.filter((c) => c.employment && c.employment.role !== 'owner').length < employed);
  makePeace(s, war, { reason: 'test' });
  for (let i = 0; i < 20 && liveArmies(s).some((a) => a.owner === 'hearth'); i++) sim.runDays(1);
  for (const id of militia.citizenIds) {
    const c = s.citizens.find((x) => x.id === id);
    if (c) { assert.equal(c.away, null, `${c.firstName} came home`); assert.ok(c.achievements.some((a) => a.type === 'militia')); }
  }
});

test('battles weigh more than numbers; peace ends a war exactly once', () => {
  const s = fixture();
  const d = brewDispute(s);
  const war = declareWar(s, 'ironhold', 'greenvale', d);
  const [a, b] = liveArmies(s).filter((x) => x.warId === war.id);
  // A large, starving, demoralised host against a small, well-fed, well-led one.
  Object.assign(a, { soldiers: 300, morale: 0.1, supplies: 0, hungry: 6, training: 0.2, equipment: 0.2 });
  Object.assign(b, { soldiers: 180, morale: 0.9, supplies: 50, hungry: 0, training: 0.8, equipment: 0.85 });
  const battle = resolveBattle(s, a, b, { routeId: 'mill-track', war });
  assert.equal(battle.winner, b.owner, 'the better army won though outnumbered');
  assert.ok(battle.sides.every((x) => x.after < x.before));
  assert.ok(makePeace(s, war, { reason: 'test' }));
  assert.equal(makePeace(s, war, { reason: 'again' }), null, 'a finished war cannot end twice');
  assert.equal(activeWars(s).length, 0);
  assert.ok(ROUTES.some((r) => r.id === 'mill-track'));
});

test('a war saved and reloaded mid-campaign continues identically, without duplicated troops or events', () => {
  const s = fixture();
  const sim = new Simulation(s);
  const d = brewDispute(s);
  declareWar(s, 'ironhold', 'greenvale', d);
  sim.runDays(2);
  sim.runTicks(37);
  const back = deserialize(serialize(s));
  const twin = new Simulation(back);
  sim.runDays(5); twin.runDays(5);
  assert.equal(JSON.stringify(back.military), JSON.stringify(s.military));
  const soldiers = (st) => liveArmies(st).reduce((t, x) => t + x.soldiers, 0);
  assert.equal(soldiers(back), soldiers(s));
  const ids = back.chronicle.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('disputes are negotiated before any war, and tension has recorded causes', () => {
  const s = fixture();
  const d = corridor(s);
  relation(s, 'greenvale', 'ironhold').score = -70;
  d.tension = 9;
  while ((s.day - 1) % 3 !== 0) s.day++;
  seasonalClaims(s);
  assert.ok(['DISPUTED', 'DORMANT', 'SETTLED'].includes(d.status));
  if (d.status === 'DISPUTED') assert.ok(d.causes.some((c) => /relations/.test(c)), 'the dispute names its causes');
  assert.equal(activeWars(s).length, 0, 'no war without failed talks');
});
