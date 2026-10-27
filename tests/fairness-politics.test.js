// Fairness in politics, war, law and planning: elections that incumbents can
// lose, wars every kingdom can win, laws that do not punish people for rules
// they could not have followed, courts that keep up, relations that do not
// freeze, and planning that does not favour the planner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeSim, byName } from './helpers.js';
import { deserialize } from '../src/core/Serialization.js';
import { isNewSeason } from '../src/core/Calendar.js';
import { balance } from '../src/economy/Transactions.js';
import { createBusiness } from '../src/economy/Businesses.js';
import { plotByName, setBuilding } from '../src/property/LandRegistry.js';
import { candidateAppeal, priorities } from '../src/politics/Opinion.js';
import { updateApproval } from '../src/politics/Government.js';
import { platformFor, defaultPolicies, issueStance } from '../src/politics/Policies.js';
import * as Policies from '../src/politics/Policies.js';
import { relation, signTreaty, dailyDiplomacy } from '../src/diplomacy/Diplomacy.js';
import { seasonalAlliances } from '../src/diplomacy/Alliances.js';
import { disputeById, ensureDisputes } from '../src/diplomacy/TerritorialClaims.js';
import { DISPUTED_LANDS } from '../src/region/RegionData.js';
import { declareWar, makePeace, dailyWar } from '../src/military/WarManager.js';
import { beginSiege, pressSieges } from '../src/military/SiegeSystem.js';
import { liveArmies, ensureMilitary } from '../src/military/Army.js';
import { peacetimeForces, forcesOf, disband } from '../src/military/MilitaryManager.js';
import { resolveBattle } from '../src/military/BattleResolver.js';
import { ensureLaw, considerLaws, lawHooks } from '../src/law/LegalCode.js';
import { dailyCourts } from '../src/law/Courts.js';
import { dailyHeritage, heritageAffinity, applicationExecutors } from '../src/civilization/Heritage.js';
import { rebuildStages } from '../src/civilization/Modernization.js';
import { landDemand } from '../src/city/LandDemand.js';

const fixture = () => deserialize(readFileSync(new URL('./fixtures/m4-save.json', import.meta.url), 'utf8'));
const fund = (s, account, n) => { s.accounts.outside -= n; s.accounts[account] = (s.accounts[account] ?? 0) + n; };
const toNewSeason = (s) => { while (!isNewSeason(s.day)) s.day++; };

/** A world with a sitting leader and a two-way race between `a` (the incumbent) and `b`, on one platform. */
function race(seed = 7) {
  const s = makeSim(seed).state;
  const [voter, a, b] = s.citizens;
  const policies = defaultPolicies();
  s.government = { leaderId: a.id, councillors: [], approval: 50, performance: 50, terms: 1, policies, elections: [], scandals: [], protests: [] };
  const cand = (c, incumbent) => ({ id: c.id, platform: { ...policies }, promises: [], incumbent, endorsedBy: [], guildBacking: [] });
  s.government.campaign = { candidates: [cand(a, true), cand(b, false)], ballots: {} };
  for (const c of [a, b]) { c.skills.leadership = 0.3; c.reputation.standing = 50; c.reputation.honesty = 50; }
  return { s, voter, a, b, ca: s.government.campaign.candidates[0], cb: s.government.campaign.candidates[1] };
}

// --- Elections ----------------------------------------------------------------

test('fair politics: a master of office has an edge, not an unbeatable one', () => {
  const { s, voter, a, b, cb } = race();
  const prio = priorities(s, voter);
  b.skills.leadership = 0.3;
  const low = candidateAppeal(s, voter, cb, prio);
  b.skills.leadership = 1;
  const high = candidateAppeal(s, voter, cb, prio);
  assert.ok(high > low, 'leadership still counts');
  assert.ok(high - low < 0.8, `a fully skilled leader gains ${(high - low).toFixed(2)}, less than a modest policy difference`);
  assert.ok(a);
});

test('fair politics: personal ties are bounded and weighed against the other candidates', () => {
  const { s, voter, ca, cb, a } = race();
  const prio = priorities(s, voter);
  const even = candidateAppeal(s, voter, ca, prio) - candidateAppeal(s, voter, cb, prio);
  s.relationships[`${voter.id}|${a.id}`] = { friendship: 100, trust: 100, respect: 100, rivalry: 0, romance: 0, familiarity: 100 };
  const devoted = candidateAppeal(s, voter, ca, prio) - candidateAppeal(s, voter, cb, prio);
  assert.ok(devoted > even, 'a friend is preferred');
  assert.ok(devoted - even <= 3, `a lifelong friendship adds ${(devoted - even).toFixed(2)} points, not ten`);
});

test('fair politics: the record in office excludes personal ties (counted once), and long tenure tires voters', () => {
  const { s, voter, a, ca } = race();
  // Everyone adores the leader personally: approval rises, the record does not.
  for (const c of s.citizens) if (c !== a) s.relationships[`${c.id}|${a.id}`] = { friendship: 100, trust: 100, respect: 80, rivalry: 0, romance: 0, familiarity: 100 };
  updateApproval(s);
  const g = s.government;
  assert.ok(Number.isFinite(g.performance), 'the government keeps a record apart from approval');
  assert.ok(g.approval - g.performance >= 15, `approval ${g.approval} includes the ties, the record ${g.performance} does not`);
  // Elections still answer to the record...
  const prio = priorities(s, voter);
  g.performance = 30; const poor = candidateAppeal(s, voter, ca, prio);
  g.performance = 70; const good = candidateAppeal(s, voter, ca, prio);
  assert.ok(good - poor >= 3, 'a good record wins votes');
  // ...and a fourth term is harder to win than a second.
  g.terms = 1; const second = candidateAppeal(s, voter, ca, prio);
  g.terms = 3; const fourth = candidateAppeal(s, voter, ca, prio);
  assert.ok(second - fourth >= 1.5, `term fatigue costs ${(second - fourth).toFixed(2)}`);
});

test('fair politics: platforms must pay for their programmes, so rich and poor want different things', () => {
  const rich = { taxes: 1, welfare: -0.4, works: 0.2, business: 0.9, trust: 0, education: -0.3, trade: 0 };
  const poor = { taxes: -0.2, welfare: 1, works: 0.8, business: 0, trust: 0, education: 0.7, trade: 0 };
  const everything = { taxes: 0.9, welfare: 1, works: 1, business: 1, trust: 0.5, education: 1, trade: 0 };
  const load = (p) => Object.keys(Policies.PROGRAMME_COST ?? {}).filter((k) => p[k]).length || ['housingSupport', 'unemploymentAid', 'reducedFees', 'constructionGrants', 'publicSchooling', 'apprenticeshipGrants'].filter((k) => p[k]).length;
  const greedy = platformFor(everything, defaultPolicies());
  assert.ok(!(greedy.taxLevel === 'low' && load(greedy) > 1), `no platform offers low taxes with ${load(greedy)} programmes`);
  const r = platformFor(rich, defaultPolicies()), p = platformFor(poor, defaultPolicies());
  assert.equal(r.taxLevel, 'low');
  assert.notEqual(p.taxLevel, 'low', 'the poor pay for their programmes with taxes');
  assert.ok(load(p) > load(r));
  // Each voter does better under their own platform than the other's.
  const fit = (prio, plat) => Object.entries(issueStance(plat)).reduce((t, [k, v]) => t + (prio[k] ?? 0) * v, 0);
  assert.ok(fit(rich, r) > fit(rich, p) && fit(poor, p) > fit(poor, r));
});

// --- War ------------------------------------------------------------------------

const brew = (s) => { const d = disputeById(s, 'mill-corridor'); relation(s, 'greenvale', 'ironhold').score = -50; d.status = 'DISPUTED'; d.tension = 14; d.failures = 2; return d; };

test('fair war: each kingdom holds one disputed land at the founding', () => {
  const held = DISPUTED_LANDS.reduce((m, l) => ({ ...m, [l.controller]: (m[l.controller] ?? 0) + 1 }), {});
  assert.deepEqual(held, { greenvale: 1, ironhold: 1, saltmere: 1 });
  const s = fixture();
  s.military.disputes = [];
  ensureDisputes(s);
  const land = DISPUTED_LANDS.find((l) => l.controller === 'saltmere');
  assert.equal(s.diplomacy.territory[land.route], 'saltmere', 'the holder collects the tolls on its road');
});

test('fair war: a kingdom without mines keeps its armoury by buying arms abroad', () => {
  const s = fixture();
  const gv = s.region.settlements.greenvale;
  gv.inventory.iron = 0; gv.inventory.tools = 0;
  fund(s, 'k:greenvale', 3000);
  const f = forcesOf(s, 'greenvale');
  f.equipment = 0.4;
  const coins = balance(s, 'k:greenvale');
  for (let i = 0; i < 12; i++) { toNewSeason(s); peacetimeForces(s); s.day++; }
  assert.ok(f.equipment > 0.4, `equipment ${f.equipment}`);
  assert.ok(balance(s, 'k:greenvale') < coins - 12 * 3, 'the arms were paid for (garrison drills aside)');
  // Bought arms keep an armoury in fair order, though not up to a mining kingdom's own.
  f.equipment = 0.9;
  for (let i = 0; i < 4; i++) { toNewSeason(s); peacetimeForces(s); s.day++; }
  assert.ok(f.equipment < 0.9 && f.equipment >= 0.85, `equipment ${f.equipment}`);
});

test('fair war: allied armies on the same field fight as one host, and a small kingdom is not refilled by battle', () => {
  const s = fixture();
  const war = declareWar(s, 'ironhold', 'greenvale', brew(s));
  const [a, d] = [liveArmies(s).find((x) => x.owner === 'ironhold'), liveArmies(s).find((x) => x.owner === 'greenvale')];
  const ally = { ...structuredClone(d), id: 'ar-ally', owner: 'saltmere', soldiers: 120, startSoldiers: 120, history: [] };
  s.military.armies.push(ally);
  war.defenders.push('saltmere');
  Object.assign(a, { soldiers: 200, morale: 0.7, supplies: 50, training: 0.6, equipment: 0.6 });
  Object.assign(d, { soldiers: 120, morale: 0.7, supplies: 50, training: 0.6, equipment: 0.6 });
  Object.assign(ally, { morale: 0.7, supplies: 50, training: 0.6, equipment: 0.6 });
  s.region.settlements.ironhold.population = 30;
  const battle = resolveBattle(s, a, d, { routeId: 'mill-track', war, defenderAllies: [ally], ground: 'attacker' });
  assert.ok(ally.soldiers < 120, 'the ally fought (and lost soldiers)');
  assert.ok(battle.allies?.some((x) => x.party === 'saltmere'));
  assert.ok(battle.sides[0].factors.ground > 1 && battle.sides[1].factors.ground === 1, 'the side that chose the field has the ground');
  assert.ok(s.region.settlements.ironhold.population <= 30, 'battle never creates people');
});

test('fair war: allies\' victories count at the peace, and a disbanded army returns only its survivors', () => {
  const s = fixture();
  const war = declareWar(s, 'ironhold', 'greenvale', brew(s));
  war.attackers.push('saltmere');
  war.score = { saltmere: 6, greenvale: 1 };
  makePeace(s, war, { reason: 'test' });
  assert.equal(war.winner, 'ironhold', 'the side that won the battles won the war');
  const s2 = fixture();
  const w2 = declareWar(s2, 'ironhold', 'greenvale', brew(s2));
  const ih = s2.region.settlements.ironhold;
  const army = liveArmies(s2).find((x) => x.owner === 'ironhold' && x.warId === w2.id);
  const lost = Math.floor(army.soldiers / 3);
  army.soldiers -= lost; ih.mobilised -= lost; // as a battle does
  ih.mobilised += 50; // another army still in the field
  disband(s2, army, 'test');
  assert.equal(ih.mobilised, 50);
});

test('fair war: holding the field after the invaders fall back counts once, not every day', () => {
  const s = fixture();
  while (isNewSeason(s.day)) s.day++; // no peace talks today
  const war = declareWar(s, 'ironhold', 'greenvale', brew(s));
  for (const x of liveArmies(s).filter((a) => a.warId === war.id)) {
    if (x.owner === 'ironhold') x.status = 'RETREATING';
    else Object.assign(x, { status: 'ENCAMPED', at: null, field: war.field.route, arrivedDay: s.day - 5 });
  }
  for (let i = 0; i < 6; i++) dailyWar(s);
  assert.ok((war.score.greenvale ?? 0) > 0, 'the defenders are credited');
  assert.ok((war.score.greenvale ?? 0) <= 2, `held-field points ${war.score.greenvale} do not pile up by the day`);
});

test('fair war: a town stormed loses its garrison from its population once', () => {
  const s = fixture();
  const war = declareWar(s, 'ironhold', 'greenvale', brew(s));
  const gv = s.region.settlements.greenvale;
  const army = liveArmies(s).find((x) => x.owner === 'ironhold' && x.warId === war.id);
  Object.assign(army, { status: 'ENCAMPED', at: 'greenvale', soldiers: 3000, morale: 0.95, supplies: 500, training: 0.9, equipment: 0.95 });
  for (const x of liveArmies(s)) if (x.owner === 'greenvale') x.status = 'HOME';
  forcesOf(s, 'greenvale').morale = 0.9;
  const siege = beginSiege(s, army, war);
  siege.days = 5;
  let checked = false;
  for (let i = 0; i < 60 && siege.status === 'ACTIVE'; i++) {
    const pop = gv.population, battles = s.military.battles.length;
    army.supplies = 500; army.morale = 0.95;
    pressSieges(s, [war]);
    if (s.military.battles.length > battles) {
      const b = s.military.battles.at(-1);
      const garrison = b.sides.find((x) => x.party === 'greenvale');
      assert.equal(pop - gv.population, garrison.before - garrison.after, 'the fallen are counted once');
      checked = true;
    }
  }
  assert.ok(checked, 'the town was assaulted');
});

test('fair war: a record of aggression fades with years of peace', () => {
  const s = fixture();
  ensureMilitary(s).aggressions = { ironhold: 2 };
  toNewSeason(s);
  seasonalAlliances(s);
  assert.ok(s.military.aggressions.ironhold < 2, 'one season of peace has begun to soften it');
});

// --- Diplomacy ------------------------------------------------------------------

test('fair diplomacy: warm relations cool toward a baseline, as bitter ones soften', () => {
  const s = fixture();
  for (const r of Object.values(s.diplomacy.relations)) r.score = 100;
  relation(s, 'greenvale', 'ironhold').score = -30;
  toNewSeason(s);
  dailyDiplomacy(s);
  assert.ok(relation(s, 'hearth', 'saltmere').score < 100, 'perfect friendship fades without renewal');
  assert.ok(relation(s, 'greenvale', 'ironhold').score > -30, 'and old grievances still soften');
});

// --- Law ------------------------------------------------------------------------

function licensingWorld() {
  const s = makeSim(8).state;
  const law = ensureLaw(s);
  law.laws.push({ id: 'law-licensing', key: 'licensing', name: 'Market Licensing Act', status: 'ACTIVE', enactedDay: s.day, effectiveDay: s.day });
  const owner = s.citizens[0];
  const b = createBusiness(s, { type: 'bakery', ownerId: owner.id, plotId: plotByName(s, 'North Lane').id, name: 'Old Bakery' });
  b.status = 'OPEN';
  while (s.day % 3 !== 0) s.day++;
  return { s, b, owner, law };
}

test('fair law: a shop that opened before licensing is ordered to take a licence before it is fined', () => {
  const { s, b, owner, law } = licensingWorld();
  fund(s, owner.id, 50);
  const treasury = balance(s, 'treasury');
  const unlicensed = s.businesses.filter((x) => !x.licensed).length;
  dailyCourts(s);
  assert.ok(b.licensed, 'it took out a licence when the inspector called');
  const took = unlicensed - s.businesses.filter((x) => !x.licensed).length;
  assert.equal(balance(s, 'treasury') - treasury, 6 * took, 'licence fees, not fines');
  assert.ok(!law.claims.some((c) => c.kind === 'licence'));
  // A shop that cannot pay is given time before the court is involved.
  const { s: s2, b: b2, owner: o2, law: law2 } = licensingWorld();
  s2.accounts[o2.id] = 0; s2.accounts[b2.id] = 0;
  dailyCourts(s2);
  assert.ok(!b2.licensed && !law2.claims.some((c) => c.kind === 'licence'), 'no claim on the day of the order');
});

test('fair law: a rejected bill waits its turn without blocking the next one, and the leader proposes only what they back', () => {
  const s = makeSim(8).state;
  const law = ensureLaw(s);
  toNewSeason(s);
  s.trade = { ...(s.trade ?? {}), stats: { ...(s.trade?.stats ?? {}), deliveries: 40 } }; // a reason for the Contract Act
  while (s.projects.length < 4) s.projects.push({ id: 'pj-test' + s.projects.length, plotId: null, ownerId: 'council', kind: 'construction' }); // and for the Permits Act
  law.proposals.push({ id: 'lp-old', key: 'contracts', status: 'REJECTED', proposedDay: s.day - 3, decidedDay: s.day - 3, votes: {} });
  considerLaws(s);
  const fresh = law.proposals.filter((p) => p.proposedDay === s.day);
  assert.ok(!fresh.some((p) => p.key === 'contracts'), 'the rejected bill is not brought straight back');
  assert.ok(fresh.some((p) => p.key === 'permits'), 'the next bill with a reason is proposed instead');
  // A leader lukewarm about a bill (stance just below support) does not propose it.
  const s2 = makeSim(8).state;
  const law2 = ensureLaw(s2);
  toNewSeason(s2);
  while (s2.projects.length < 4) s2.projects.push({ id: 'pj-test' + s2.projects.length, plotId: null, ownerId: 'council', kind: 'construction' });
  const leader = s2.citizens[0];
  s2.government = { leaderId: leader.id, councillors: [], policies: defaultPolicies(), approval: 50 };
  const old = lawHooks.stance.permits;
  lawHooks.stance.permits = () => -0.05;
  try { considerLaws(s2); } finally { if (old) lawHooks.stance.permits = old; else delete lawHooks.stance.permits; }
  assert.ok(!law2.proposals.some((p) => p.key === 'permits'), 'a leader who would vote no does not propose it');
});

test('fair courts: hearings keep pace with the backlog, and unpaid wages are heard first', () => {
  const s = makeSim(8).state;
  const law = ensureLaw(s);
  const [p, d] = s.citizens;
  const mk = (kind, filedDay) => ({ id: 'case' + ++law.nextCase, kind, law: kind === 'wages' ? 'wages' : 'theft', claimId: null, eventDay: filedDay, filedDay, plaintiff: { kind: 'citizen', id: p.id, name: 'P' }, defendant: { kind: 'citizen', id: d.id, name: 'D' }, amount: 1, evidence: [], details: {}, status: 'FILED', hearingDay: null, judgment: null });
  for (let i = 0; i < 30; i++) law.cases.push(mk('theft', s.day - 2));
  const wages = mk('wages', s.day);
  law.cases.push(wages);
  dailyCourts(s);
  assert.equal(wages.hearingDay, s.day + 1, 'the worker is heard tomorrow');
  const last = Math.max(...law.cases.map((c) => c.hearingDay));
  assert.ok(last - s.day <= 10, `thirty-one cases are all heard within ${last - s.day} days`);
});

// --- Planning -------------------------------------------------------------------

/** A contested scheme on the old hall, awaiting the council's vote. */
function hallDispute(applicantId) {
  const { state: s } = makeSim(8);
  const hall = plotByName(s, 'Hearth Hall');
  const v = s.citizens.find((c) => c.id !== applicantId);
  Object.assign(v.traits, { loyal: 0, stubborn: 0, curious: 0, ambitious: 1, greedy: 1 });
  s.government = { leaderId: v.id, councillors: [], policies: defaultPolicies(), approval: 50 };
  const app = { id: 'pa-test', kind: 'scheme', type: 'apartment', era: 2, applicantId, plotIds: [hall.id], annexId: null, cost: { total: 1 }, status: 'DISPUTED', disputeId: 'hd-test', day: s.day };
  s.civ.applications.push(app);
  const lead = s.citizens.find((c) => c.id !== v.id && c.id !== applicantId);
  const d = { id: 'hd-test', appId: app.id, day: s.day, voteDay: s.day, concerns: ['the old hall'], campaigners: [lead.id], leadId: lead.id, status: 'OPEN' };
  s.civ.heritage.disputes.push(d);
  return { s, hall, v, app, d, lead };
}

test('fair planning: the council weighs its own scheme like anyone else\'s', () => {
  const { s, hall, v, d } = hallDispute('council');
  // Make this councillor lean, by a hair, toward saving the hall (one campaigner, and a little loyalty).
  const growthOf = () => { const p = priorities(s, v); return (p.business ?? 0) * 0.4 + (p.works ?? 0) * 0.3 + landDemand(s).housingShortage * 0.08; };
  const crowd = (1 / Math.max(8, s.citizens.length)) * 3;
  const margin = () => heritageAffinity(s, v, hall) + crowd - growthOf();
  // Loyalty moves heritage feeling without touching the councillor's other interests; ambition lowers it.
  Object.assign(v.traits, { ambitious: 0, greedy: 0, loyal: 0, stubborn: 0 });
  for (let i = 0; i < 40 && margin() > 0.2; i++) v.traits.ambitious = Math.min(1, v.traits.ambitious + 0.05);
  for (let i = 0; i < 40 && margin() < 0.1; i++) v.traits.loyal = Math.min(1, v.traits.loyal + 0.05);
  const lean = margin();
  dailyHeritage(s, {});
  assert.ok(lean > 0 && lean < 0.3, `set-up: the councillor leans to saving by ${lean.toFixed(2)}`);
  assert.equal(d.outcome, 'saved', 'no bonus for the council\'s own scheme');
});

test('fair planning: campaigners may challenge the council in court, and permission lapses with the land', () => {
  const { s, app, d } = hallDispute('council');
  ensureLaw(s).laws.push({ id: 'law-heritage', key: 'heritage', name: 'Heritage Preservation Act', status: 'ACTIVE', enactedDay: 1, effectiveDay: 1 });
  d.campaigners = [d.leadId]; d.support = 0;
  dailyHeritage(s, {});
  assert.equal(d.outcome, 'approved');
  assert.equal(app.status, 'IN_COURT', 'the council\'s scheme can be challenged');
  assert.ok(s.law.claims.some((c) => c.kind === 'heritage' && c.defendantId === 'council'));
  // A rebuild approved for one owner does not go ahead for whoever owns the plot later.
  const { state: t } = makeSim(8);
  const plot = plotByName(t, 'Brook Cottage');
  setBuilding(t, plot, 'cottage');
  const [first, second] = [byName(t, 'Bram'), byName(t, 'Cora')];
  plot.ownerId = second.id;
  fund(t, first.id, 5000); fund(t, second.id, 5000);
  const rebuild = { kind: 'rebuild', type: 'cottage', era: 2, applicantId: first.id, plotIds: [plot.id], annexId: null, cost: { total: 50 }, stages: rebuildStages('cottage', 2), who: 'Bram', reason: 'test', newLabel: 'House' };
  const err = applicationExecutors.rebuild(t, rebuild);
  assert.match(String(err), /no longer belongs/);
  assert.ok(!t.projects.some((j) => j.plotId === plot.id), 'no work began for the new owner');
});
