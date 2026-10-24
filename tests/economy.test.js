import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, byName, bizByName, totalMoney, setHour } from './helpers.js';
import { transfer, balance } from '../src/economy/Transactions.js';
import { addGoods, qty } from '../src/economy/Inventory.js';
import { createBusiness, produce } from '../src/economy/Businesses.js';
import { buyRetail, wholesale } from '../src/economy/Marketplace.js';
import { completeShift } from '../src/economy/Employment.js';
import { closeDay, closeBusiness } from '../src/economy/EconomyManager.js';
import { plotByName } from '../src/property/LandRegistry.js';

test('1. citizens cannot spend money they do not have', () => {
  const { state } = makeSim();
  const bram = byName(state, 'Bram');
  const farm = bizByName(state, 'Sunfield Farm');
  const before = { bram: balance(state, bram.id), farm: balance(state, farm.id) };
  assert.equal(transfer(state, bram.id, farm.id, before.bram + 1, 'purchase'), false);
  state.accounts[bram.id] = 0;
  setHour(state, 10);
  const res = buyRetail(state, bram, farm, 'grain', 1);
  assert.equal(res.ok, false);
  assert.equal(balance(state, farm.id), before.farm);
  assert.ok(Object.values(state.accounts).every((v) => v >= 0));
});

test('2. currency transfers debit and credit exactly and conserve the money supply', () => {
  const { state } = makeSim();
  const total = totalMoney(state);
  const a = byName(state, 'Ada'), c = byName(state, 'Cora');
  const [ba, bc] = [balance(state, a.id), balance(state, c.id)];
  assert.equal(transfer(state, a.id, c.id, 5, 'gift', 'test'), true);
  assert.equal(balance(state, a.id), ba - 5);
  assert.equal(balance(state, c.id), bc + 5);
  assert.equal(totalMoney(state), total);
  assert.equal(state.ledger.at(-1).amount, 5);
  assert.equal(transfer(state, a.id, c.id, 2.5, 'gift'), false, 'fractional coins are rejected');
  assert.equal(transfer(state, a.id, c.id, -3, 'gift'), false, 'negative transfers are rejected');
});

test('council aid moves money from the treasury instead of creating it', () => {
  const sim = makeSim();
  const total = totalMoney(sim.state);
  const t = balance(sim.state, 'treasury');
  const dain = byName(sim.state, 'Dain');
  const d = balance(sim.state, dain.id);
  assert.equal(sim.council('aid', dain.id).ok, true);
  assert.equal(balance(sim.state, 'treasury'), t - 10);
  assert.equal(balance(sim.state, dain.id), d + 10);
  assert.equal(totalMoney(sim.state), total);
});

test('3. businesses cannot sell inventory they do not have', () => {
  const { state } = makeSim();
  const farm = bizByName(state, 'Sunfield Farm');
  const dain = byName(state, 'Dain');
  setHour(state, 10);
  farm.inventory = {};
  const res = buyRetail(state, dain, farm, 'grain', 1);
  assert.equal(res.ok, false);
  const plot = plotByName(state, 'North Lane');
  const bakery = createBusiness(state, { type: 'bakery', ownerId: dain.id, plotId: plot.id, name: 'Test Bakery' });
  state.accounts[bakery.id] = 100;
  assert.equal(wholesale(state, bakery, farm, 'grain', 5), 0);
  assert.equal(qty(bakery.inventory, 'grain'), 0);
});

test('4. production consumes its required inputs', () => {
  const { state } = makeSim();
  const plot = plotByName(state, 'North Lane');
  const bakery = createBusiness(state, { type: 'bakery', ownerId: 'council', plotId: plot.id, name: 'Test Bakery' });
  assert.equal(produce(state, bakery, 1), 0, 'no grain, no bread');
  addGoods(bakery.inventory, 'grain', 2);
  const made = produce(state, bakery, 1);
  assert.equal(made, 4, 'two batches of two loaves');
  assert.equal(qty(bakery.inventory, 'grain'), 0);
  assert.equal(qty(bakery.inventory, 'bread'), 4);
  const woodlot = bizByName(state, 'Village Woodlot');
  const forest = state.commons.forest;
  const timber = produce(state, woodlot, 1);
  assert.equal(state.commons.forest, forest - timber, 'the lumberyard draws down the forest');
});

test('5. wages are paid correctly for a completed shift', () => {
  const { state } = makeSim();
  const bram = byName(state, 'Bram');
  const woodlot = bizByName(state, 'Village Woodlot');
  const [b0, w0] = [balance(state, bram.id), balance(state, woodlot.id)];
  const res = completeShift(state, bram, woodlot);
  assert.equal(res.paid, 7);
  assert.equal(balance(state, bram.id), b0 + 7);
  assert.equal(balance(state, woodlot.id), w0 - 7);
  state.accounts[woodlot.id] = 0;
  const unpaid = completeShift(state, bram, woodlot);
  assert.equal(unpaid.paid, 0);
  assert.equal(bram.employment.unpaid, 1);
});

test('6. bankruptcy closes the business and terminates employment', () => {
  const { state } = makeSim();
  const ada = byName(state, 'Ada'), elin = byName(state, 'Elin');
  const farm = bizByName(state, 'Sunfield Farm');
  const total = totalMoney(state);
  closeBusiness(state, farm, 'BANKRUPT');
  assert.equal(farm.status, 'BANKRUPT');
  assert.equal(elin.employment, null);
  assert.equal(ada.employment, null);
  assert.equal(farm.employees.length, 0);
  assert.equal(balance(state, farm.id), 0, 'remaining cash returned to owner');
  assert.equal(Object.keys(farm.inventory).length, 0, 'stock liquidated');
  const plot = state.plots.find((p) => p.id === farm.plotId);
  assert.equal(plot.businessId, null);
  assert.equal(plot.marketStatus, 'FOR_SALE');
  assert.equal(plot.ownerId, ada.id, 'the owner keeps the property');
  assert.equal(totalMoney(state), total);
  setHour(state, 10);
  assert.equal(buyRetail(state, byName(state, 'Dain'), farm, 'grain', 1).ok, false, 'closed businesses stop trading');
});

test('sustained losses drive a business through STRUGGLING to closure', () => {
  const { state } = makeSim();
  const ada = byName(state, 'Ada');
  const plot = plotByName(state, 'North Lane');
  const b = createBusiness(state, { type: 'bakery', ownerId: ada.id, plotId: plot.id, name: 'Doomed Bakery' });
  b.foundedDay = -10;
  for (let d = 0; d < 12 && b.status !== 'CLOSED' && b.status !== 'BANKRUPT'; d++) {
    b.today.other = 3;
    closeDay(state);
    state.day++;
  }
  assert.ok(['CLOSED', 'BANKRUPT'].includes(b.status));
  assert.ok(state.chronicle.some((e) => e.business === b.id || e.refs.business === b.id));
});
