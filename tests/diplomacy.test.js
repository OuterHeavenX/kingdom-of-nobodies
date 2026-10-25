// Milestone 4 — diplomacy and regional migration (brief items 19–23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { DAYS_PER_YEAR } from '../src/core/Config.js';
import { totalMoney, balance } from '../src/economy/Transactions.js';
import { signTreaty, imposeEmbargo, tariffRate, tradeBlocked, routeAllowed, relationScore, adjustRelation, dailyDiplomacy, noteTrade, hasTreaty } from '../src/diplomacy/Diplomacy.js';
import { createContract, ESCROW } from '../src/trade/Contracts.js';
import { createCaravan, caravanTick } from '../src/trade/Caravans.js';
import { bestOpportunity } from '../src/trade/TradeManager.js';
import { routeById } from '../src/region/RegionManager.js';
import { emigrate, maybeReturn } from '../src/population/Migration.js';
import { checkInvariants } from './longevity.mjs';

const fresh = (seed = 6) => new Simulation(createKingdom(seed));
const fund = (s, account, n) => { s.accounts.outside -= n; s.accounts[account] = (s.accounts[account] ?? 0) + n; };

test('19. treaties change the actual trade rules', () => {
  const s = fresh().state;
  const before = tariffRate(s, 'greenvale', 'hearth');
  assert.ok(before > 0);
  signTreaty(s, 'trade', 'hearth', 'greenvale');
  assert.equal(tariffRate(s, 'greenvale', 'hearth'), Math.round(before / 2 * 1000) / 1000, 'a trade agreement halves tariffs');
  assert.equal(tariffRate(s, 'greenvale', 'saltmere'), s.region.settlements.greenvale.tariff, 'others still pay full tariffs');
  signTreaty(s, 'tariff', 'hearth', 'greenvale');
  assert.equal(tariffRate(s, 'greenvale', 'hearth'), 0);
});

test('20. embargoes block contracts, roads and loading, with explicit rules for trades already agreed', () => {
  const s = fresh().state;
  fund(s, 'c1', 400);
  const merchant = { id: 'c1', name: 'Ada', account: 'c1', home: 'hearth', capacity: 36 };
  const c = createContract(s, { merchant, origin: 'greenvale', destination: 'ironhold', commodity: 'grain', qty: 10, buyPrice: 1, sellPrice: 4 });
  assert.ok(!c.error);
  const ironFunds = balance(s, 'k:ironhold');
  imposeEmbargo(s, 'ironhold', 'greenvale', 'test');
  assert.match(tradeBlocked(s, 'greenvale', 'ironhold', 'hearth'), /embargo/);
  assert.equal(routeAllowed(s, 'ironhold')(routeById('mill-track')), false, 'Greenvale closes its roads to Ironhold');
  assert.equal(bestOpportunity(s, { ...merchant, funds: 400, minProfit: 1, minMargin: 0 })?.destination === 'ironhold' && bestOpportunity(s, { ...merchant, funds: 400, minProfit: 1, minMargin: 0 })?.origin === 'greenvale', false, 'merchants stop planning the embargoed trade');
  // The caravan arrives to load: the agreed contract is void, the buyer refunded.
  const cv = createCaravan(s, { owner: merchant, home: 'hearth', stops: [{ at: 'greenvale', action: 'load', contracts: [c.id] }, { at: 'ironhold', action: 'unload', contracts: [c.id] }, { at: 'hearth', action: 'home' }], capacity: 36 });
  cv.at = 'greenvale';
  for (let i = 0; i < 10; i++) caravanTick(s, cv);
  assert.equal(c.status, 'CANCELLED');
  assert.equal(balance(s, 'k:ironhold'), ironFunds + 40, 'the 40 coins held in escrow went back to Ironhold');
  assert.equal(balance(s, ESCROW), 0);
});

test('21. expired treaties stop affecting the world', () => {
  const s = fresh().state;
  const base = tariffRate(s, 'saltmere', 'hearth');
  const t = signTreaty(s, 'tariff', 'hearth', 'saltmere');
  assert.equal(tariffRate(s, 'saltmere', 'hearth'), 0);
  adjustRelation(s, 'hearth', 'saltmere', -80, 'test');
  s.day = t.endDay;
  dailyDiplomacy(s);
  assert.equal(t.status, 'EXPIRED', 'soured relations mean no renewal');
  assert.equal(tariffRate(s, 'saltmere', 'hearth'), base);
});

test('22. diplomatic events and trade update relationships with recorded causes', () => {
  const sim = fresh();
  const s = sim.state;
  const before = relationScore(s, 'hearth', 'ironhold');
  noteTrade(s, 'hearth', 'ironhold', 300);
  assert.ok(relationScore(s, 'hearth', 'ironhold') > before);
  const rel = s.diplomacy.relations['hearth|ironhold'];
  assert.equal(rel.log.at(-1).why, 'profitable trade');
  imposeEmbargo(s, 'ironhold', 'hearth', 'test');
  assert.ok(relationScore(s, 'hearth', 'ironhold') < before);
  assert.ok(rel.log.some((l) => /embargo/.test(l.why)));
  sim.runDays(4 * DAYS_PER_YEAR);
  const all = Object.values(s.diplomacy.relations);
  assert.ok(all.every((r) => r.score >= -100 && r.score <= 100 && r.log.every((l) => l.why)), 'every change has a cause');
});

test('23. migration moves real people between settlements and keeps populations consistent', () => {
  const sim = fresh(1);
  sim.runDays(10 * DAYS_PER_YEAR);
  const s = sim.state;
  const money = totalMoney(s);
  const c = s.citizens.find((x) => !x.founder && x.family.spouseId === null && x.family.childIds.length === 0 && x.age === undefined && s.government?.leaderId !== x.id);
  const k = s.region.settlements.greenvale;
  const pop = k.population, here = s.citizens.length;
  emigrate(s, c, { why: 'in search of steady work', destination: 'greenvale' });
  assert.equal(s.citizens.length, here - 1);
  assert.equal(k.population, pop + 1, 'Greenvale gained a resident');
  assert.equal(s.archive[c.id].destination, 'greenvale', 'the record says where they went');
  assert.equal(totalMoney(s), money, 'their savings went with them, nothing lost');
  // Hard times in Greenvale bring them home as the same person.
  k.hunger = 0.5;
  s.archive[c.id].leftDay -= 20;
  // Others who emigrated earlier may come home first; wait for this one, and count everyone who came back from Greenvale.
  const from = Object.fromEntries(Object.entries(s.archive).filter(([, p]) => p.status === 'emigrated').map(([id, p]) => [id, p.destination]));
  const returned = [];
  for (let i = 0; i < 400 && !returned.some((m) => m.id === c.id); i++) returned.push(...(maybeReturn(s) ?? []));
  const back = returned.find((m) => m.id === c.id);
  assert.ok(back, 'they came home');
  assert.equal(back.id, c.id, 'with the same identity');
  assert.ok(!s.archive[c.id]);
  assert.equal(k.population, pop + 1 - returned.filter((m) => from[m.id] === 'greenvale').length);
  assert.equal(checkInvariants(s, 'migration', 0), 0);
  assert.equal(totalMoney(s), money);
});

test('a married merchant who emigrates mid-run hands the caravan to someone who stays, and escrow still settles', () => {
  // The scenario is searched for in ordinary play, so a few worlds are tried until one supplies it.
  let sim = null, s = null, cv = null;
  for (const seed of [1, 2, 3, 4, 5]) {
    sim = fresh(seed);
    s = sim.state;
    for (let i = 0; i < 400 * 144 && !cv; i++) {
      sim.step();
      cv = s.trade.caravans.find((x) => x.status !== 'COMPLETED' && x.status !== 'CANCELLED' && s.citizens.some((c) => c.id === x.account && c.family.spouseId && !c.founder && s.government?.leaderId !== c.id && s.government?.leaderId !== c.family.spouseId)) ?? null;
    }
    if (cv) break;
  }
  assert.ok(cv, 'a married villager has a caravan on the road');
  const merchant = s.citizens.find((c) => c.id === cv.account);
  const leaving = new Set([merchant.id, merchant.family.spouseId]);
  const money = totalMoney(s);
  emigrate(s, merchant, { why: 'for a better life', destination: 'greenvale' });
  assert.ok(!leaving.has(cv.account), 'the proceeds go to someone still in First Hearth');
  assert.ok(cv.account in s.accounts, 'and to an account that exists');
  for (let i = 0; i < 30 * 144 && !['COMPLETED', 'CANCELLED'].includes(cv.status); i++) sim.step();
  assert.equal(totalMoney(s), money);
  assert.equal(checkInvariants(s, 'emigrating merchant', 0), 0, 'escrow and cargo still balance');
});


test('a mutual assistance treaty feeds First Hearth in a famine, and lets the village help a hungry kingdom', () => {
  const s = fresh(2).state;
  signTreaty(s, 'assistance', 'hearth', 'greenvale');
  const g = s.region.settlements.greenvale;
  g.inventory.grain = 400;
  // The village runs out of food everywhere.
  for (const b of s.businesses) for (const f of ['grain', 'bread', 'meal', 'berries']) b.inventory[f] = 0;
  for (const c of s.citizens) for (const f of ['grain', 'bread', 'meal', 'berries']) c.inventory[f] = 0;
  s.council.pantry = {};
  dailyDiplomacy(s);
  assert.ok((s.council.pantry.grain ?? 0) >= 10, 'Greenvale sent grain to the council pantry');
  assert.equal(g.inventory.grain, 400 - s.council.pantry.grain, 'it came out of Greenvale\'s stores');
  // Later the village has plenty and Greenvale is hungry.
  s.day += 7;
  s.council.pantry.grain = 80;
  g.shortages.food = true;
  const before = g.inventory.grain;
  dailyDiplomacy(s);
  assert.ok(g.inventory.grain > before && s.council.pantry.grain < 80, 'the village sent grain from its pantry');
  assert.ok(s.council.pantry.grain >= 6 + s.citizens.length, 'keeping its own relief stock');
});
