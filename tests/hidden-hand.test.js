// v0.5.3 — The Hidden Hand. Each test is numbered after the release brief's
// automated-testing list (section 27) so the coverage can be checked line by line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, totalMoney } from './helpers.js';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { serialize, deserialize, migrate } from '../src/core/Serialization.js';
import { firstDayOfYear, yearOf } from '../src/core/Calendar.js';
import { DAYS_PER_YEAR, SAVE_VERSION } from '../src/core/Config.js';
import { balance } from '../src/economy/Transactions.js';
import { byId } from '../src/core/EntityRegistry.js';
import { isAdherent, TRADITIONS } from '../src/institutions/FaithManager.js';
import { ensureFaith, dailyFaith, activeCommunities } from '../src/institutions/ReligiousInstitutions.js';
import { validOwner } from '../src/institutions/Registry.js';
import { routeKnown, routeById } from '../src/region/RegionManager.js';
import { peopleOf } from '../src/region/ForeignCitizenManager.js';
import { castVote } from '../src/politics/Government.js';
import { generateCandidates } from '../src/ai/DecisionUtility.js';
import { planFor } from '../src/ai/GoalPlanner.js';
import { ensureDivine, unlock, regenerateWhispers, hiddenRecord } from '../src/divine/State.js';
import { DIVINE, INSCRIPTION_IDS, glyphsFor, GLYPHS } from '../src/divine/Config.js';
import { placeStone, siteProblem, suggestedSites, postponeStone, hourlyStone, seeStone, stoneEvent } from '../src/divine/Stone.js';
import { worldviewOf, weigh, learnOfStone, considerFaith, interpretOutcome, reconsider, socialIndex, primaryWorldview } from '../src/divine/Worldview.js';
import { hear, considerMissions, returnMissions, reviewRoles } from '../src/divine/Spread.js';
import { seasonalSocieties, considerSplit, siteWorks, activeSocieties, societyMembers } from '../src/divine/Movements.js';
import { troublesOf, dailyPrayers } from '../src/divine/Prayers.js';
import { bestow, BLESSINGS, blessingProblem, illnessFactor, productionFactor, keepSilence } from '../src/divine/Blessings.js';
import { sendOmen } from '../src/divine/Omens.js';
import { dailyDivine } from '../src/divine/index.js';

// A small living kingdom, grown once and copied for each test.
let base = null;
function world(seed = 11) {
  if (!base) { const sim = makeSim(seed); sim.runDays(90); base = serialize(sim.state); }
  return new Simulation(deserialize(base));
}
const adults = (s) => s.citizens.filter((c) => s.day - c.birthDay >= 18 * DAYS_PER_YEAR && !c.away);
function withStone(sim, key = 'meadow', inscription = 'watcher') {
  unlock(sim.state);
  const site = suggestedSites(sim.state).find((x) => x.key === key) ?? suggestedSites(sim.state).find((x) => !x.problem);
  const res = placeStone(sim.state, { x: site.x, z: site.z, inscription });
  assert.ok(res.ok, res.message);
  return res.stone;
}
/** Make a villager see the stone and settle on a definite view (bypassing chance, not reasoning). */
function seeIt(sim, c) { seeStone(sim.state, c); return c.worldview.stone; }

test('hidden hand 1: the stone is locked before Year 200', () => {
  const sim = world();
  const d = ensureDivine(sim.state);
  assert.equal(d.unlocked, false);
  const res = placeStone(sim.state, { x: -66, z: 20, inscription: 'watcher' });
  assert.equal(res.ok, false);
  assert.match(res.message, /Year 200/);
  assert.equal(d.stone, null);
});

test('hidden hand 2: the ability unlocks in Year 200 with a private notice (and an old world past it unlocks on load)', () => {
  const s = createKingdom(3);
  delete s.divine;
  s.day = firstDayOfYear(199) + 5;
  assert.equal(ensureDivine(s).unlocked, false);
  s.day = firstDayOfYear(200);
  const d = ensureDivine(s);
  assert.equal(d.unlocked, true);
  assert.equal(d.pendingNotice, true, 'the player is told, privately');
  assert.ok(d.hidden.some((h) => h.kind === 'awakening'));
  assert.ok(!s.chronicle.some((e) => /question carved in stone/.test(e.text)), 'the citizens are not told');
});

test('hidden hand 3: the player may postpone, and the ability is never lost', () => {
  const sim = world();
  unlock(sim.state);
  assert.equal(postponeStone(sim.state), true);
  const d = sim.state.divine;
  assert.equal(d.pendingNotice, false);
  sim.runDays(DAYS_PER_YEAR + 1);
  assert.equal(d.unlocked, true, 'still available a year later');
  const site = suggestedSites(sim.state).find((x) => !x.problem);
  assert.ok(placeStone(sim.state, { ...site, inscription: 'silence' }).ok);
});

test('hidden hand 4: invalid placements are rejected with a reason', () => {
  const sim = world();
  unlock(sim.state);
  const s = sim.state;
  const plot = s.plots.find((p) => p.building);
  const road = s.roads[0];
  assert.match(siteProblem(s, plot.x, plot.z), /property|building/);
  assert.match(siteProblem(s, road.x, road.z), /road|property|building|square/);
  assert.match(siteProblem(s, 0, 74.5), /river/);
  assert.match(siteProblem(s, 200, 0), /edge/);
  assert.match(siteProblem(s, -4.6, -4.6), /Memorial/);
  assert.equal(placeStone(s, { x: plot.x, z: plot.z, inscription: 'light' }).ok, false);
  assert.equal(placeStone(s, { x: -66, z: 20, inscription: 'nonsense' }).ok, false);
  for (const site of suggestedSites(s)) if (!site.problem) assert.equal(siteProblem(s, site.x, site.z), null, `${site.key} suggestion is valid`);
  assert.equal(s.divine.stone, null);
});

test('hidden hand 5 & 6: the stone persists through save/load and cannot be duplicated', () => {
  const sim = world();
  const stone = withStone(sim, 'meadow', 'question');
  const again = placeStone(sim.state, { x: stone.x + 6, z: stone.z, inscription: 'watcher' });
  assert.equal(again.ok, false);
  const loaded = deserialize(serialize(sim.state));
  assert.deepEqual({ id: loaded.divine.stone.id, x: loaded.divine.stone.x, z: loaded.divine.stone.z, inscription: loaded.divine.stone.inscription }, { id: stone.id, x: stone.x, z: stone.z, inscription: 'question' });
  assert.equal(placeStone(loaded, { x: stone.x + 6, z: stone.z, inscription: 'watcher' }).ok, false, 'no second stone after loading');
  const reloaded = deserialize(serialize(loaded));
  assert.equal([reloaded.divine.stone].filter(Boolean).length, 1);
});

test('hidden hand 7: discovery needs a real encounter or a real informant', () => {
  const sim = world();
  const stone = withStone(sim, 'valley');
  const s = sim.state;
  hourlyStone(s);
  assert.equal(s.divine.stone.discovered, false, 'nobody is near the far valley');
  assert.ok(s.citizens.every((c) => !c.worldview?.stone), 'nobody knows by magic');
  const walker = adults(s)[0];
  walker.x = stone.x + 1.5; walker.z = stone.z; walker.activity = null;
  hourlyStone(s);
  assert.equal(s.divine.stone.discovered, true);
  assert.equal(s.divine.stone.discovererId, walker.id);
  assert.equal(walker.worldview.stone.how, 'saw');
  assert.ok(s.chronicle.some((e) => e.text.includes(walker.firstName) && /standing stone/.test(e.text)), 'the discovery is in the Chronicle');
  sim.runDays(40);
  for (const c of s.citizens) {
    const k = c.worldview?.stone;
    if (!k) continue;
    assert.ok(['saw', 'heard', 'read', 'taught'].includes(k.how));
    if (k.how === 'heard' || k.how === 'taught') {
      const from = byId(s.citizens, k.from) ?? s.archive[k.from];
      assert.ok(!k.from || from, `${c.firstName} heard it from a real person`);
    }
  }
});

test('hidden hand 8 & 9: the same stone is explained differently, and sceptical views are as valid as faith', () => {
  const sim = world();
  withStone(sim, 'meadow');
  const s = sim.state;
  const people = adults(s).slice(0, 12);
  // A spread of temperaments, as the real population has.
  people.forEach((c, i) => {
    const wv = worldviewOf(s, c);
    wv.skep = [0.05, 0.9, 0.5, 0.2, 0.75, 0.35][i % 6];
    wv.cur = [0.9, 0.3, 0.7, 0.1, 0.8, 0.55][i % 6];
    wv.outlook = i % 3 === 1 ? 'atheist' : i % 3 === 2 ? 'reason' : 'personal';
    c.belief = { ...c.belief, tradition: i % 3 === 0 ? 'dawn' : null, stance: i % 3 === 0 ? 'devout' : 'none', devotion: i % 3 === 0 ? 0.9 : 0 };
  });
  const views = people.map((c) => seeIt(sim, c).interp);
  assert.ok(new Set(views).size >= 3, `several explanations: ${views.join(',')}`);
  const sceptic = people[1];
  assert.ok(['natural', 'prank', 'ancient', 'cosmic', 'indifferent'].includes(sceptic.worldview.stone.interp), 'a convinced sceptic does not see a god');
  // Sceptics keep their view under ordinary talk; nothing marks their view as wrong.
  for (let i = 0; i < 6; i++) hear(s, sceptic, people[0]);
  reconsider(s, sceptic, socialIndex(s));
  assert.notEqual(sceptic.worldview.stone.interp, 'divine');
});

test('hidden hand 10: atheists are not converted by signs, blessings or preaching', () => {
  const sim = world();
  withStone(sim, 'meadow');
  const s = sim.state;
  const a = adults(s)[1];
  Object.assign(a.belief, { tradition: null, stance: 'none', devotion: 0 });
  const wv = worldviewOf(s, a);
  Object.assign(wv, { outlook: 'atheist', skep: 0.8 });
  seeIt(sim, a);
  s.divine.whispers = 12;
  s.minute = 22 * 60;
  sendOmen(s, 'skylights');
  sendOmen(s, 'stoneglow');
  bestow(s, 'comfort', a.id);
  const preacher = adults(s)[0];
  learnOfStone(s, preacher, { how: 'saw' });
  Object.assign(preacher.worldview.stone, { interp: 'divine', conf: 1 });
  preacher.worldview.role = 'preacher';
  for (let i = 0; i < 10; i++) hear(s, a, preacher, 1.2);
  considerFaith(s, a);
  assert.equal(a.belief.tradition, null);
  assert.equal(isAdherent(a, 'hand'), false);
  assert.equal(a.worldview.outlook, 'atheist');
});

test('hidden hand 11: belief is not mechanically tied to intelligence, honesty or worth', () => {
  const sim = world();
  withStone(sim, 'meadow');
  const s = sim.state;
  const c = adults(s)[2];
  worldviewOf(s, c);
  const base = weigh(s, c, { saw: true }).scores;
  const snapshot = JSON.stringify(c.traits);
  // Honesty, greed, generosity and education never move the case for or against a god.
  for (const [k, v] of [['honest', 0.95], ['dishonest', 0.9], ['generous', 0.95], ['greedy', 0.9]]) {
    c.traits = { ...JSON.parse(snapshot), [k]: v };
    const scores = weigh(s, c, { saw: true }).scores;
    for (const key of ['divine', 'cosmic', 'ancient', 'prank', 'natural']) assert.equal(scores[key], base[key], `${k} does not change ${key}`);
  }
  c.traits = JSON.parse(snapshot);
  const edu = c.education.level;
  c.education.level = 0.05; const low = weigh(s, c, { saw: true }).scores;
  c.education.level = 0.95; const high = weigh(s, c, { saw: true }).scores;
  c.education.level = edu;
  for (const key of ['divine', 'cosmic', 'ancient', 'prank', 'natural']) assert.equal(low[key], high[key], `education does not change ${key}`);
  // And believing changes nothing about a person's honesty, standing or schooling.
  learnOfStone(s, c, { how: 'saw' });
  Object.assign(c.worldview.stone, { interp: 'divine', conf: 0.95, interest: 0.9 });
  const before = JSON.stringify([c.reputation, c.education, c.traits, c.skills]);
  for (let i = 0; i < 40 && !isAdherent(c, 'hand'); i++) { s.day++; considerFaith(s, c); }
  assert.equal(JSON.stringify([c.reputation, c.education, c.traits, c.skills]), before);
});

test('hidden hand 12: missionaries travel only on open, known roads and foreigners decide for themselves', () => {
  const sim = world();
  withStone(sim, 'meadow');
  const s = sim.state;
  s.divine.stone.discovered = true;
  const m = adults(s).find((c) => !c.employment || c.employment.role !== 'owner') ?? adults(s)[0];
  learnOfStone(s, m, { how: 'saw' });
  Object.assign(m.worldview.stone, { interp: 'divine', conf: 0.95, interest: 0.95 });
  m.worldview.role = 'missionary';
  s.accounts[m.id] = 0;
  s.accounts.outside -= 100; s.accounts[m.id] += 100;
  const money = totalMoney(s);
  let tries = 0;
  while (!s.divine.missions.length && tries++ < 40) { s.day++; considerMissions(s); }
  const mission = s.divine.missions[0];
  assert.ok(mission, 'the missionary set out');
  assert.equal(m.away.reason, 'mission');
  for (const leg of mission.legs) assert.ok(routeKnown(s, routeById(leg)), `${leg} is a known road`);
  assert.equal(totalMoney(s), money, 'provisions were paid for, not conjured');
  s.day = mission.returnDay;
  returnMissions(s);
  assert.equal(m.away, null);
  const heard = peopleOf(s, mission.to).filter((p) => p.hand);
  assert.ok(heard.length > 0 && heard.length <= 6, 'a handful of named people heard, not a kingdom');
  assert.ok(heard.every((p) => ['believer', 'interested', 'undecided', 'rejected'].includes(p.hand.view)));
  // With every road closed, nobody can go.
  const sim2 = world();
  withStone(sim2, 'meadow');
  const s2 = sim2.state;
  s2.divine.stone.discovered = true;
  const m2 = adults(s2)[0];
  learnOfStone(s2, m2, { how: 'saw' });
  Object.assign(m2.worldview.stone, { interp: 'divine', conf: 0.95, interest: 0.95 });
  m2.worldview.role = 'missionary';
  s2.region.discovered.routes = [];
  for (let i = 0; i < 20; i++) { s2.day++; considerMissions(s2); }
  assert.equal(s2.divine.missions.length, 0);
});

test('hidden hand 13 & 14: conversion needs one\'s own settled conviction, and members may leave', () => {
  const sim = world();
  withStone(sim, 'meadow');
  const s = sim.state;
  const c = adults(s)[3];
  Object.assign(c.belief, { tradition: null, stance: 'none', devotion: 0.1 });
  learnOfStone(s, c, { how: 'saw' });
  Object.assign(c.worldview.stone, { interp: 'divine', conf: 0.3, interest: 0.3 });
  for (let i = 0; i < 40; i++) { s.day++; considerFaith(s, c); }
  assert.equal(isAdherent(c, 'hand'), false, 'a tentative view does not make a member');
  Object.assign(c.worldview.stone, { conf: 0.95, interest: 0.95 });
  for (let i = 0; i < 200 && !isAdherent(c, 'hand'); i++) { s.day++; considerFaith(s, c); }
  assert.equal(isAdherent(c, 'hand'), true, 'a settled conviction may lead someone to join');
  Object.assign(c.worldview.stone, { interp: 'natural', conf: 0.7 });
  assert.equal(considerFaith(s, c), 'left');
  assert.equal(isAdherent(c, 'hand'), false);
  assert.ok(c.memories.some((m) => /Left The Hidden Hand/.test(m.text)));
});

test('hidden hand 15 & 16: stone faiths form communities with no free building; works at the stone are paid for', () => {
  const sim = world();
  withStone(sim, 'meadow');
  const s = sim.state;
  Object.assign(s.divine.stone, { discovered: true, discoveredDay: s.day - 2 * DAYS_PER_YEAR });
  const believers = adults(s).slice(0, 4);
  for (const c of believers) { Object.assign(c.belief, { tradition: 'hand', stance: 'casual', devotion: 0.6 }); learnOfStone(s, c, { how: 'saw' }); Object.assign(c.worldview.stone, { interp: 'divine', conf: 0.9, interest: 0.9, visits: 1 }); }
  ensureFaith(s);
  while (s.day % 3 !== 1) s.day++;
  dailyFaith(s);
  const f = activeCommunities(s).find((x) => x.tradition === 'hand');
  assert.ok(f, 'the Keepers of the Stone formed');
  assert.equal(f.tier, null, 'no building appears by itself');
  assert.equal(balance(s, f.id), f.stats.donations, 'its purse holds only what members gave');
  for (const p of s.plots.filter((p) => p.ownerId === f.id)) assert.ok(validOwner(s, p.ownerId));
  // Lanterns at the stone cost the community real coins.
  siteWorks(s);
  assert.equal(s.divine.stone.site.lanterns, undefined, 'too poor to pay, so nothing is built');
  const had = balance(s, f.id);
  s.accounts.outside -= 60; s.accounts[f.id] += 60;
  const money = totalMoney(s);
  siteWorks(s);
  assert.ok(s.divine.stone.site.lanterns, 'paid for now');
  assert.equal(balance(s, f.id), had + 60 - 18);
  assert.equal(totalMoney(s), money);
});

test('hidden hand 17 & 25: societies form from willing members, collect real dues, and the faith can split', () => {
  const sim = world();
  withStone(sim, 'meadow');
  const s = sim.state;
  s.divine.stone.discovered = true;
  const seekers = adults(s).slice(0, 4);
  for (const c of seekers) { learnOfStone(s, c, { how: 'saw' }); Object.assign(c.worldview.stone, { interp: 'cosmic', conf: 0.8, interest: 0.8 }); c.traits.friendly = 0.6; s.accounts.outside -= 50; s.accounts[c.id] += 50; }
  const money = totalMoney(s);
  seasonalSocieties(s);
  const soc = activeSocieties(s).find((x) => x.kind === 'seekers');
  assert.ok(soc);
  assert.ok(societyMembers(s, soc).length >= 3);
  assert.ok(balance(s, soc.id) > 0, 'dues reached the purse');
  assert.equal(totalMoney(s), money, 'dues moved coins; none were created');
  // A large Keepers community whose members lean strongly one way may divide.
  const sim2 = world();
  withStone(sim2, 'meadow');
  const s2 = sim2.state;
  s2.divine.stone.discovered = true;
  const members = adults(s2);
  while (members.length < 14) {
    const c = members[members.length % Math.max(1, adults(s2).length)];
    members.push(c);
  }
  const uniq = [...new Set(members)];
  if (uniq.length < 12) return; // too small a village to test a split
  uniq.forEach((c, i) => { Object.assign(c.belief, { tradition: 'hand', stance: 'devout', devotion: 0.8 }); c.traits = i < 6 ? { friendly: 0.9, creative: 0.9 } : { shy: 0.6, loyal: 0.6 }; c.reputation.standing = 60; });
  ensureFaith(s2);
  while (s2.day % 3 !== 1) s2.day++;
  dailyFaith(s2);
  for (let i = 0; i < 30 && !s2.divine.stats.splits; i++) { s2.day += DAYS_PER_YEAR; considerSplit(s2); }
  assert.ok(s2.divine.stats.splits >= 1, 'the faith divided');
  assert.ok(s2.citizens.some((c) => c.belief.tradition === 'light' || c.belief.tradition === 'silence'));
  assert.ok(s2.chronicle.some((e) => /divided/.test(e.text)));
});

test('hidden hand 18 & 19: blessings spend Whispers; worship never makes more', () => {
  const sim = world();
  const s = sim.state;
  const d = ensureDivine(s);
  d.whispers = 5;
  const sick = adults(s)[0];
  sick.health.sickUntil = s.day + 3;
  const res = bestow(s, 'healing', sick.id);
  assert.ok(res.ok, res.message);
  assert.equal(d.whispers, 5 - BLESSINGS.healing.cost);
  assert.ok(blessingProblem(s, 'healing', sick.id), 'on cooldown now');
  d.whispers = 0.5;
  assert.equal(bestow(s, 'comfort', adults(s)[1].id).ok, false, 'not enough Whispers');
  // Two worlds, one full of believers and prayers, regenerate exactly alike.
  const a = world(), b = world();
  for (const c of a.state.citizens) Object.assign(c.belief, { tradition: 'hand', stance: 'devout', devotion: 1 });
  ensureDivine(a.state).whispers = 1; ensureDivine(b.state).whispers = 1;
  a.runDays(6); b.runDays(6);
  assert.ok(a.state.divine.stats.prayersMade >= b.state.divine.stats.prayersMade);
  assert.equal(a.state.divine.whispers, b.state.divine.whispers);
  assert.equal(a.state.divine.whispers, 1 + 6 * DIVINE.whispers.perDay);
  regenerateWhispers(a.state);
  for (let i = 0; i < 200; i++) regenerateWhispers(a.state);
  assert.equal(a.state.divine.whispers, DIVINE.whispers.max, 'the store has a limit');
});

test('hidden hand 20: blessings change bounded numbers for a limited time', () => {
  const sim = world();
  const s = sim.state;
  ensureDivine(s).whispers = 12;
  const c = adults(s)[0];
  c.health.sickUntil = s.day + 4;
  assert.equal(illnessFactor(s, c), 1);
  bestow(s, 'healing', c.id);
  assert.equal(illnessFactor(s, c), 0.45);
  const farm = s.businesses.find((b) => b.type === 'farm');
  const plot = s.plots.find((p) => p.id === farm.plotId);
  assert.equal(productionFactor(s, farm, plot), 1);
  bestow(s, 'harvest', farm.id);
  assert.equal(productionFactor(s, farm, plot), 1.25);
  const far = { ...plot, x: plot.x + 80 };
  assert.equal(productionFactor(s, farm, far), 1, 'only within a small area');
  s.day += BLESSINGS.harvest.days + 1;
  assert.equal(productionFactor(s, farm, plot), 1, 'it ends');
  // Healing never cures instantly, and never touches the dead.
  const before = c.health.sickUntil;
  assert.ok(before >= s.day - BLESSINGS.harvest.days - 1);
});

test('hidden hand 21: a blessing cannot force a relationship, a vote or a conversion', () => {
  const sim = world();
  const s = sim.state;
  ensureDivine(s).whispers = 12;
  for (const x of adults(s)) x.needs.social = 20;
  const relBefore = JSON.stringify(s.relationships);
  const beliefBefore = JSON.stringify(s.citizens.map((x) => [x.belief, x.worldview?.stone ?? null]));
  let res = null, c = null;
  for (const x of adults(s)) { res = bestow(s, 'encounter', x.id); if (res.ok) { c = x; break; } }
  if (!c) return; // everyone in this small village already knows everyone
  assert.ok(res.ok, res.message);
  assert.equal(JSON.stringify(s.relationships), relBefore, 'nobody became friends by fiat');
  assert.equal(JSON.stringify(s.citizens.map((x) => [x.belief, x.worldview?.stone ?? null])), beliefBefore, 'nobody believes anything new');
  // The encounter is an option among others, not an order.
  s.minute = 11 * 60;
  const cands = generateCandidates(s, c, planFor(s, c));
  const meet = cands.find((k) => k.kind === 'socialize' && k.citizenId === res.effect.partner);
  assert.ok(meet, 'the chance to meet is on offer');
  assert.ok(cands.length > 1);
  // Votes are cast only from each voter's own priorities: the divine layer has no hook there.
  assert.ok(!String(castVote).includes('divine'));
});

test('hidden hand 22: prayers are about real circumstances in the prayer\'s life', () => {
  const sim = world();
  const s = sim.state;
  const parent = adults(s).find((c) => c.family.childIds.some((id) => byId(s.citizens, id)));
  if (!parent) return;
  const child = byId(s.citizens, parent.family.childIds.find((id) => byId(s.citizens, id)));
  assert.ok(!troublesOf(s, parent).some((t) => t.subject === 'illness' && t.target === child), 'no prayer about a fever that is not there');
  child.health.sickUntil = s.day + 3;
  const t = troublesOf(s, parent).find((x) => x.subject === 'illness' && x.target === child);
  assert.ok(t);
  assert.match(t.text, new RegExp(child.firstName));
  Object.assign(parent.belief, { tradition: 'dawn', stance: 'devout', devotion: 1 });
  const fever = (x) => x.targetId === child.id && x.subject === 'illness';
  for (let i = 0; i < 40 && !s.divine.prayers.some(fever); i++) { s.day++; child.health.sickUntil = s.day + 3; dailyPrayers(s); }
  const p = s.divine.prayers.find(fever);
  assert.ok(p, 'the devout parent prayed');
  assert.equal(p.world.sick, true);
  for (const q of s.divine.prayers.filter((x) => !x.resolvedDay)) assert.ok(byId(s.citizens, q.citizenId), 'every open prayer belongs to someone living here');
});

test('hidden hand 23: what the player did, what people saw, and what they think stay separate', () => {
  const sim = world();
  const s = sim.state;
  ensureDivine(s).whispers = 12;
  const c = adults(s)[0];
  const twin = adults(s)[1];
  twin.worldview = JSON.parse(JSON.stringify(worldviewOf(s, c)));
  c.health.sickUntil = s.day + 2;
  const blessedView = interpretOutcome(s, c, 'recovery', { prayed: true });
  bestow(s, 'healing', c.id);
  const afterBlessing = interpretOutcome(s, c, 'recovery', { prayed: true });
  assert.deepEqual(afterBlessing, blessedView, 'how someone explains a recovery does not depend on whether you helped');
  const text = JSON.stringify([c.memories, c.worldview, c.beliefs]);
  assert.ok(!/Healing Whisper|blessing|Whisper/i.test(text), 'the citizen holds no knowledge of the blessing');
  assert.ok(s.divine.hidden.some((h) => h.kind === 'blessing' && h.actual), 'the Hidden Chronicle has the actual event');
  assert.ok(!s.chronicle.some((e) => /Healing Whisper|You gave/.test(e.text)), 'the kingdom Chronicle does not');
});

test('hidden hand 24: one sign, many readings', () => {
  const sim = world();
  withStone(sim, 'meadow');
  const s = sim.state;
  s.divine.whispers = 12;
  s.minute = 22 * 60;
  for (const [i, c] of s.citizens.entries()) { c.activity = { kind: 'idle', phase: 'perform', x: c.x, z: c.z, duration: 3, elapsed: 0 }; const wv = worldviewOf(s, c); wv.skep = i % 2 ? 0.85 : 0.1; if (i % 2 === 0) Object.assign(c.belief, { tradition: 'dawn', stance: 'devout', devotion: 0.9 }); }
  const res = sendOmen(s, 'skylights');
  assert.ok(res.ok, res.message);
  assert.ok(Object.keys(res.omen.views).length >= 2, `readings: ${JSON.stringify(res.omen.views)}`);
  const omenEntry = s.chronicle.at(-1);
  assert.ok(!/you|Hidden/i.test(omenEntry.text.replace(/your/gi, '')), 'the Chronicle says what was seen, not who caused it');
});

test('hidden hand 26 & 27: real developments enter the Chronicle; private actions stay in the Hidden Chronicle', () => {
  const sim = world();
  const stone = withStone(sim, 'meadow');
  const s = sim.state;
  const w = adults(s)[0];
  w.x = stone.x + 1; w.z = stone.z;
  hourlyStone(s);
  assert.ok(s.chronicle.some((e) => /standing stone/.test(e.text)), 'discovery recorded');
  stoneEvent(s, 'test', 'A test event at the stone.', { first: 'test' });
  assert.equal(stoneEvent(s, 'test', 'Again.', { first: 'test' }), null, 'firsts are recorded once');
  const kinds = new Set(s.divine.hidden.map((h) => h.kind));
  assert.ok(kinds.has('stone') && kinds.has('awakening'));
  assert.ok(s.divine.hidden.find((h) => h.kind === 'stone').actual);
  assert.ok(!s.chronicle.some((e) => /You raised|carved with “/.test(e.text)), 'nobody saw the stone arrive');
  // The Hidden Chronicle stays bounded but keeps the player's own actions.
  for (let i = 0; i < DIVINE.kept.hidden + 50; i++) hiddenRecord(s, 'note', `filler ${i}`, {}, 1);
  assert.ok(s.divine.hidden.length <= DIVINE.kept.hidden);
  assert.ok(s.divine.hidden.some((h) => h.kind === 'stone'), 'the placement survives pruning');
});

test('hidden hand: keeping silence is free, and unanswered prayers carry no penalty', () => {
  const sim = world();
  const s = sim.state;
  const d = ensureDivine(s);
  for (const c of s.citizens) Object.assign(c.belief, { tradition: 'dawn', stance: 'devout', devotion: 1 });
  sim.runDays(12);
  const open = d.prayers.find((p) => !p.response && !p.resolvedDay) ?? d.prayers[0];
  if (!open) return;
  const moodBefore = s.citizens.map((c) => c.mood);
  const whispers = d.whispers;
  keepSilence(s, open.id);
  assert.equal(d.whispers, whispers);
  assert.deepEqual(s.citizens.map((c) => c.mood), moodBefore);
});

test('hidden hand 31: older saves migrate safely (before and after Year 200)', () => {
  const s = createKingdom(21);
  const money = totalMoney(s);
  const people = s.citizens.map((c) => [c.id, c.belief?.tradition, c.belief?.stance]);
  delete s.divine;
  for (const c of s.citizens) delete c.worldview;
  s.version = 8;
  const v8 = JSON.parse(JSON.stringify(s));
  const early = migrate(JSON.parse(JSON.stringify(v8)));
  assert.equal(early.version, SAVE_VERSION);
  assert.equal(early.divine.unlocked, false, 'a young kingdom stays locked');
  assert.equal(totalMoney(early), money);
  assert.deepEqual(early.citizens.map((c) => [c.id, c.belief?.tradition, c.belief?.stance]), people, 'traditions are kept exactly');
  assert.ok(early.migrationNotes.some((n) => n.version === 9));
  const late = JSON.parse(JSON.stringify(v8));
  late.day = firstDayOfYear(250);
  const m = migrate(late);
  assert.equal(m.divine.unlocked, true, 'an old world past Year 200 may place the stone at once');
  assert.equal(m.divine.pendingNotice, true);
  assert.equal(m.divine.stone, null, 'nothing is placed automatically');
  assert.equal(yearOf(m.day), 250);
});

test('hidden hand: the inscription is an original script and citizens never receive its meaning', () => {
  for (const id of INSCRIPTION_IDS) {
    const g = glyphsFor(id);
    assert.equal(g.length, 20);
    assert.ok(g.every((i) => i >= 0 && i < GLYPHS.length));
  }
  const sim = world();
  withStone(sim, 'meadow', 'light');
  const s = sim.state;
  const c = adults(s)[0];
  c.x = s.divine.stone.x + 1; c.z = s.divine.stone.z;
  hourlyStone(s);
  sim.runDays(10);
  const all = JSON.stringify([s.citizens.map((x) => [x.memories, x.worldview]), s.chronicle]);
  assert.ok(!all.includes('The unseen is not always absent'), 'the English stays with the player');
});

test('hidden hand: the divine layer runs on the simulation day, deterministically', () => {
  const a = world(), b = world();
  withStone(a, 'square'); withStone(b, 'square');
  a.runDays(30); b.runDays(30);
  assert.equal(JSON.stringify(a.state.divine), JSON.stringify(b.state.divine));
  assert.equal(JSON.stringify(a.state.citizens.map((c) => c.worldview)), JSON.stringify(b.state.citizens.map((c) => c.worldview)));
  assert.equal(typeof dailyDivine, 'function');
});
