// Milestone 4 — regional economy and caravans (brief items 7–18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { totalMoney, balance } from '../src/economy/Transactions.js';
import { simulateKingdom, updatePrices, available } from '../src/region/Settlement.js';
import { routeHours, routeById, planJourney } from '../src/region/RegionManager.js';
import { COMMODITIES } from '../src/region/RegionData.js';
import { reserve, release, marketAvailable } from '../src/trade/Markets.js';
import { createContract, loadContract, deliverContract, cancelContract, ESCROW } from '../src/trade/Contracts.js';
import { createCaravan, caravanTick, caravanPosition, cargoUnits } from '../src/trade/Caravans.js';
import { bestOpportunity } from '../src/trade/TradeManager.js';

const fresh = (seed = 4) => new Simulation(createKingdom(seed));
const trader = (state, home = 'hearth') => ({ id: 'c1', name: 'Ada Thornfield', account: 'c1', home, capacity: 36, funds: 400 });
const fund = (s, account, n) => { s.accounts.outside -= n; s.accounts[account] = (s.accounts[account] ?? 0) + n; };

test('7. foreign kingdoms keep persistent inventories that change and survive saving', () => {
  const sim = fresh();
  const before = structuredClone(sim.state.region.settlements.greenvale.inventory);
  sim.runDays(3);
  const k = sim.state.region.settlements.greenvale;
  assert.notDeepEqual(k.inventory, before, 'the kingdom produced and consumed');
  const loaded = deserialize(serialize(sim.state, 'test'));
  assert.deepEqual(loaded.region.settlements.greenvale.inventory, k.inventory);
});

test('8. production consumes its inputs (ore becomes iron becomes tools)', () => {
  const s = fresh().state;
  const iron = s.region.settlements.ironhold;
  iron.inventory.ore = 0;
  iron.inventory.iron = 0;
  const tools = iron.inventory.tools;
  simulateKingdom(s, iron);
  assert.ok(iron.inventory.iron <= iron.usage.ore.made / 2 + 1e-6, 'with no stock, iron is limited by the ore mined today (2 ore per iron)');
  iron.inventory.ore = 100;
  const oreBefore = iron.inventory.ore;
  simulateKingdom(s, iron);
  assert.ok(iron.inventory.iron > 0, 'iron was smelted');
  assert.ok(iron.inventory.ore < oreBefore + 8 * iron.population / 100, 'ore was used up in smelting');
  assert.ok(iron.inventory.tools >= 0 && Number.isFinite(tools));
});

test('9. prices respond to supply and demand and stay bounded', () => {
  const s = fresh().state;
  const k = s.region.settlements.ironhold;
  k.inventory.grain = 2000;
  for (let i = 0; i < 30; i++) updatePrices(s, k);
  const glut = k.prices.grain;
  k.inventory.grain = 0; k.inventory.provisions = 0; k.inventory.fish = 0;
  for (let i = 0; i < 30; i++) updatePrices(s, k);
  const scarce = k.prices.grain;
  assert.ok(scarce > glut * 3, `scarcity raises the price (${glut} → ${scarce})`);
  assert.ok(scarce <= COMMODITIES.grain.base * 3 && glut >= COMMODITIES.grain.base * 0.45, 'prices stay within bounds');
});

test('10. trade cannot reserve stock that is not there, or reserve it twice', () => {
  const s = fresh().state;
  const spare = marketAvailable(s, 'greenvale', 'grain');
  assert.equal(reserve(s, 'greenvale', 'grain', spare + 1), null);
  const first = reserve(s, 'greenvale', 'grain', spare);
  assert.ok(first);
  assert.equal(reserve(s, 'greenvale', 'grain', 5), null, 'the same grain cannot be promised again');
  release(s, 'greenvale', 'grain', first);
  assert.ok(reserve(s, 'greenvale', 'grain', 5), 'released stock can be reserved');
});

test('11 & 12. a full trade conserves money and a delivery cannot happen twice', () => {
  const s = fresh().state;
  fund(s, 'c1', 300);
  const money = totalMoney(s);
  const c = createContract(s, { merchant: trader(s), origin: 'greenvale', destination: 'ironhold', commodity: 'grain', qty: 20, buyPrice: 1.2, sellPrice: 4 });
  assert.ok(!c.error, c.error);
  assert.equal(balance(s, ESCROW), 80, 'the buyer paid into escrow');
  const cv = createCaravan(s, { owner: trader(s), home: 'hearth', stops: [], capacity: 36 });
  const grainBefore = s.region.settlements.greenvale.inventory.grain;
  assert.equal(loadContract(s, c, cv), 20);
  assert.equal(Math.round(grainBefore - s.region.settlements.greenvale.inventory.grain), 20, 'the grain left Greenvale');
  assert.equal(cv.cargo.grain, 20);
  const ironBefore = s.region.settlements.ironhold.inventory.grain;
  const merchantBefore = balance(s, 'c1');
  assert.equal(deliverContract(s, c, cv), 20);
  assert.equal(Math.round(s.region.settlements.ironhold.inventory.grain - ironBefore), 20, 'Ironhold received it');
  assert.ok(balance(s, 'c1') > merchantBefore, 'the merchant was paid');
  assert.equal(balance(s, ESCROW), 0);
  const after = { merchant: balance(s, 'c1'), iron: balance(s, 'k:ironhold') };
  assert.equal(deliverContract(s, c, cv), 0, 'a second delivery does nothing');
  assert.deepEqual({ merchant: balance(s, 'c1'), iron: balance(s, 'k:ironhold') }, after);
  assert.equal(totalMoney(s), money, 'no money was created or destroyed');
});

test('13. caravan capacity is enforced and the buyer refunded for the rest', () => {
  const s = fresh().state;
  fund(s, 'c1', 500);
  const c = createContract(s, { merchant: trader(s), origin: 'greenvale', destination: 'ironhold', commodity: 'grain', qty: 60, buyPrice: 1, sellPrice: 3 });
  const cv = createCaravan(s, { owner: trader(s), home: 'hearth', stops: [], capacity: 36 });
  const ironBefore = balance(s, 'k:ironhold');
  assert.equal(loadContract(s, c, cv), 36);
  assert.equal(c.qty, 36);
  assert.equal(balance(s, 'k:ironhold') - ironBefore, 24 * 3, 'escrow for the 24 that would not fit was refunded');
  assert.equal(s.region.settlements.greenvale.reserved.grain ?? 0, 0, 'no stock is left reserved');
});

test('14 & 15. caravans follow known routes, and distance and road quality set travel time', () => {
  const sim = fresh();
  const s = sim.state;
  const plan = planJourney(s, 'ironhold', 'saltmere');
  assert.ok(plan.legs.every((l) => l.route !== 'highland-way'), 'the undiscovered pass is not used');
  s.region.discovered.routes.push('highland-way');
  assert.ok(planJourney(s, 'ironhold', 'saltmere').legs.some((l) => l.route === 'highland-way'), 'once found, the shortcut is used');
  const river = routeById('river-road');
  const slow = routeHours(s, river);
  s.region.discovered.landmarks.push('shepherds-bridge');
  assert.ok(routeHours(s, river) < slow, 'a better crossing speeds the River Road');
  assert.ok(routeHours(s, routeById('river-road')) > routeHours(s, routeById('greenvale-road')), 'longer roads take longer');
  // A caravan's position moves along its road, from one end to the other.
  fund(s, 'c1', 300);
  const c = createContract(s, { merchant: trader(s), origin: 'hearth', destination: 'greenvale', commodity: 'timber', qty: 4, buyPrice: 2, sellPrice: 6 });
  const cv = createCaravan(s, { owner: trader(s), home: 'hearth', stops: c.error ? [{ at: 'greenvale', action: 'home' }] : [{ at: 'hearth', action: 'load', contracts: [c.id] }, { at: 'greenvale', action: 'unload', contracts: [c.id] }, { at: 'hearth', action: 'home' }], capacity: 36 });
  const xs = [];
  for (let i = 0; i < 200 && cv.status !== 'COMPLETED'; i++) { caravanTick(s, cv); if (cv.leg) xs.push(caravanPosition(cv).x); s.tick++; }
  assert.ok(xs.length > 10, 'it travelled for a while');
  assert.ok(Math.min(...xs) < 25 && Math.max(...xs) > 45, 'it went from First Hearth to Greenvale');
});

test('16. save and load preserve caravans mid-journey without duplicating cargo', () => {
  const sim = fresh(1);
  let found = null;
  for (let d = 0; d < 80 && !found; d++) {
    sim.runDays(1);
    found = sim.state.trade.caravans.find((c) => c.leg && cargoUnits(c) > 0);
  }
  assert.ok(found, 'a loaded caravan was on the road');
  const copy = new Simulation(deserialize(serialize(sim.state, 'test')));
  assert.deepEqual(copy.state.trade.caravans.find((c) => c.id === found.id).cargo, found.cargo);
  for (let i = 0; i < 300; i++) { sim.step(); copy.step(); }
  assert.equal(JSON.stringify(copy.state.trade), JSON.stringify(sim.state.trade));
  assert.equal(totalMoney(copy.state), totalMoney(sim.state));
});

test('17. cancelling a contract releases the reservation and refunds escrow', () => {
  const s = fresh().state;
  fund(s, 'c1', 300);
  const k = s.region.settlements.ironhold;
  const iron = balance(s, 'k:ironhold');
  const c = createContract(s, { merchant: trader(s), origin: 'greenvale', destination: 'ironhold', commodity: 'grain', qty: 15, buyPrice: 1, sellPrice: 3 });
  assert.equal(s.region.settlements.greenvale.reserved.grain, 15);
  cancelContract(s, c, 'test');
  assert.equal(s.region.settlements.greenvale.reserved.grain, 0);
  assert.equal(balance(s, 'k:ironhold'), iron);
  assert.equal(balance(s, ESCROW), 0);
  cancelContract(s, c, 'again');
  assert.equal(balance(s, 'k:ironhold'), iron, 'cancelling twice changes nothing');
  assert.ok(available(k, 'grain') >= 0);
});

test('18. every unit of cargo is accounted for: delivered, sold, spoiled or aboard', () => {
  const sim = fresh(2);
  sim.runDays(60);
  const t = sim.state.trade;
  for (const cv of t.caravans) {
    const log = t.cargoLog.filter((e) => e.caravanId === cv.id);
    if (!log.some((e) => e.kind === 'load')) continue;
    const sum = (kind) => log.filter((e) => e.kind === kind).reduce((a, e) => a + e.n, 0);
    assert.equal(sum('load'), sum('deliver') + sum('sold') + sum('spoil') + cargoUnits(cv), `${cv.id} cargo balances`);
  }
  assert.ok(t.stats.deliveries > 0, 'trade happened');
});

test('merchants only trade when it pays, and explain why', () => {
  const s = fresh().state;
  s.region.settlements.ironhold.inventory.grain = 0;
  s.region.settlements.ironhold.inventory.provisions = 0;
  s.region.settlements.ironhold.inventory.fish = 0;
  for (let i = 0; i < 20; i++) updatePrices(s, s.region.settlements.ironhold);
  const plan = bestOpportunity(s, { ...trader(s), minProfit: 10, minMargin: 0.1 });
  assert.ok(plan, 'a famine in Ironhold is an opportunity');
  assert.equal(plan.destination, 'ironhold');
  assert.ok(COMMODITIES[plan.commodity].food);
  assert.ok(plan.factors.some((f) => /short of food|wants/.test(f)));
  assert.equal(bestOpportunity(s, { ...trader(s), funds: 5, minProfit: 10, minMargin: 0.1 }), null, 'no money, no trade');
});
