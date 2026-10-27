// Fair play in the economy: who trades with whom, what a new business opens
// with, what small loans cost, what happens to debts and land when people die
// or leave, and what the player's council can and cannot repeat. Each test
// failed before the fix it describes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, byName, bizByName, totalMoney, setHour } from './helpers.js';
import { balance, transfer } from '../src/economy/Transactions.js';
import { createBusiness, staffCap } from '../src/economy/Businesses.js';
import { addGoods, qty } from '../src/economy/Inventory.js';
import { restockAll, sellGathered } from '../src/economy/Marketplace.js';
import { closeDay } from '../src/economy/EconomyManager.js';
import { updateOpenings } from '../src/economy/Employment.js';
import { openBusiness } from '../src/property/Construction.js';
import { planFor } from '../src/ai/GoalPlanner.js';
import { deposit, depositOf, raiseCash, spendable } from '../src/finance/BankAccounts.js';
import { createBank, settleBeforeLeaving } from '../src/finance/BankManager.js';
import { issueLoan, collectPayment } from '../src/finance/LoanManager.js';
import { seasonalInterest } from '../src/finance/InterestSystem.js';
import { listForSale, softenListings } from '../src/property/Ownership.js';
import { plotValue } from '../src/property/LandRegistry.js';
import { die } from '../src/citizens/Lifecycle.js';
import { councilDaily } from '../src/council/Council.js';
import { onAdulthood } from '../src/education/Education.js';
import { applicationExecutors } from '../src/civilization/Heritage.js';
import { KINGDOMS } from '../src/region/RegionData.js';
import { citizenDetail } from '../src/ui/CitizenPanel.js';
import { businessDetail } from '../src/ui/BusinessPanel.js';
import { regionPanel } from '../src/ui/RegionPanel.js';

const plot = (state, name) => state.plots.find((p) => p.name === name);
const fund = (state, id, n) => transfer(state, 'outside', id, n, 'grant', 'test funds');
const drain = (state, id) => { const n = balance(state, id); if (n > 0) transfer(state, id, 'outside', n, 'expense', 'test: spent'); };

function bank(state) {
  const founder = byName(state, 'Ada');
  fund(state, founder.id, 310);
  return createBank(state, { kind: 'merchant_bank', ownerId: founder.id, name: 'Test Bank', capital: 300 });
}

test('fair trade: a business short of a tool buys from a tool maker, cheapest first, never from another tool user', () => {
  const { state } = makeSim();
  const farm = bizByName(state, 'Sunfield Farm');
  addGoods(farm.inventory, 'tools', 2);
  const held = qty(farm.inventory, 'tools');
  const newFarm = createBusiness(state, { type: 'farm', ownerId: byName(state, 'Elin').id, plotId: plot(state, 'Meadow Field').id, name: 'Meadow Farm' });
  fund(state, newFarm.id, 40);
  const dear = createBusiness(state, { type: 'blacksmith', ownerId: byName(state, 'Cora').id, plotId: plot(state, 'Mill Row').id, name: 'Dear Forge' });
  const cheap = createBusiness(state, { type: 'blacksmith', ownerId: byName(state, 'Bram').id, plotId: plot(state, 'Forge Yard').id, name: 'Cheap Forge' });
  for (const s of [dear, cheap]) { addGoods(s.inventory, 'tools', 3); fund(state, s.id, 30); }
  dear.priceMult.tools = 1.3; cheap.priceMult.tools = 0.8;
  const money = totalMoney(state);
  restockAll(state);
  assert.equal(qty(farm.inventory, 'tools'), held, 'the farm holding tools sold none: tool users do not trade tools among themselves');
  assert.equal(qty(newFarm.inventory, 'tools'), 1);
  const sale = state.ledger.find((t) => t.kind === 'wholesale' && t.from === newFarm.id && / tools: /.test(t.memo));
  assert.equal(sale?.to, cheap.id, 'the tool came from the cheaper smith');
  assert.equal(qty(dear.inventory, 'tools'), 3, 'the dearer smith sold nothing');
  assert.equal(totalMoney(state), money);
});

test('fair trade: a gatherer sells to the buyer offering the best price, not the oldest shop', () => {
  const { state } = makeSim();
  const first = createBusiness(state, { type: 'general_store', ownerId: byName(state, 'Bram').id, plotId: plot(state, 'North Lane').id, name: 'Old Store' });
  const second = createBusiness(state, { type: 'general_store', ownerId: byName(state, 'Cora').id, plotId: plot(state, 'West Green').id, name: 'New Store' });
  for (const b of [first, second]) fund(state, b.id, 60);
  first.priceMult.berries = 0.8; second.priceMult.berries = 1.3;
  const dain = byName(state, 'Dain');
  addGoods(dain.inventory, 'berries', 3);
  setHour(state, 10);
  const res = sellGathered(state, dain, 'berries');
  assert.equal(res.buyer, 'New Store');
  assert.equal(res.paid, 6, '2 coins a berry instead of 1');
});

test('fair trade: the council pantry buys grain from the cheapest farm first', () => {
  const { state } = makeSim();
  const sunfield = bizByName(state, 'Sunfield Farm');
  const meadow = createBusiness(state, { type: 'farm', ownerId: byName(state, 'Elin').id, plotId: plot(state, 'Meadow Field').id, name: 'Meadow Farm' });
  for (const f of [sunfield, meadow]) addGoods(f.inventory, 'grain', 20);
  sunfield.priceMult.grain = 1.5; meadow.priceMult.grain = 0.7;
  state.council.pantry = {};
  councilDaily(state);
  const sales = state.ledger.filter((t) => t.memo.endsWith('grain for the council pantry'));
  assert.ok(sales.length > 0);
  assert.equal(sales[0].to, meadow.id, 'the cheaper farm sold first');
  assert.ok(!sales.some((t) => t.to === sunfield.id), 'the cheap farm covered the whole need');
});

test('fair relief: when the pantry runs short, the hungriest are fed first, not the longest-settled', () => {
  const { state } = makeSim();
  const [ada, elin] = [byName(state, 'Ada'), byName(state, 'Elin')];
  for (const c of state.citizens) { c.needs.hunger = 80; c.inventory = {}; }
  for (const c of [ada, elin]) drain(state, c.id);
  ada.needs.hunger = 30; elin.needs.hunger = 5;
  transfer(state, 'treasury', 'outside', balance(state, 'treasury') - 10, 'expense', 'test: empty the treasury');
  state.council.pantry = { grain: 1 };
  councilDaily(state);
  assert.equal(qty(elin.inventory, 'grain'), 1, 'the starving villager was fed');
  assert.equal(qty(ada.inventory, 'grain'), 0);
});

test('fair relief: a bedridden villager starving beside their food is fed by the council, and starving children get a day\'s food', () => {
  const { state } = makeSim();
  const [cora, kid] = [byName(state, 'Cora'), byName(state, 'Dain')];
  for (const c of state.citizens) { c.needs.hunger = 80; c.inventory = {}; }
  cora.needs.hunger = 5; cora.health.sickUntil = state.day + 3; addGoods(cora.inventory, 'grain', 2);
  drain(state, kid.id); kid.needs.hunger = 8; kid.birthDay = state.day - 10 * 12;
  state.council.pantry = { grain: 5 };
  councilDaily(state);
  assert.ok(cora.needs.hunger > 20, `fed in bed (hunger ${cora.needs.hunger})`);
  assert.equal(qty(kid.inventory, 'grain'), 2, 'two portions for a starving child');
});

test('new business: opening draws working capital from savings in the bank, not just the purse', () => {
  const { state } = makeSim();
  const b0 = bank(state);
  const cora = byName(state, 'Cora');
  fund(state, cora.id, 100);
  assert.ok(deposit(state, b0, cora.id, 100));
  transfer(state, cora.id, 'outside', balance(state, cora.id) - 3, 'expense', 'test: spent');
  const money = totalMoney(state);
  const shop = plot(state, 'Crossroads Corner');
  shop.ownerId = cora.id;
  const b = openBusiness(state, cora, shop, 'general_store');
  assert.ok(balance(state, b.id) >= 30, `the store opened with ${balance(state, b.id)} coins of working capital`);
  assert.ok(depositOf(state, cora.id) < 100, 'part of it came from her savings');
  assert.ok(spendable(state, cora.id) >= 4, 'she kept a little for herself');
  assert.equal(totalMoney(state), money);
});

test('new business: a founder saves the working capital before starting work on the premises', () => {
  const { state } = makeSim();
  const dain = byName(state, 'Dain');
  dain.traits.riskTaking = 0;
  dain.dream = { type: 'business', businessType: 'general_store', text: 'Open a general store' };
  const shop = plot(state, 'Crossroads Corner');
  shop.ownerId = dain.id; shop.marketStatus = 'NOT_FOR_SALE';
  dain.venture = { plotId: shop.id };
  drain(state, dain.id); fund(state, dain.id, 10);
  let plan = planFor(state, dain);
  assert.ok(!plan.actions.some((a) => a.kind === 'start_project'), 'no refit with 10 coins and an empty till ahead');
  assert.ok(plan.need >= 15, `still to save: ${plan.need}`);
  fund(state, dain.id, 60);
  plan = planFor(state, dain);
  assert.ok(plan.actions.some((a) => a.kind === 'start_project'), 'with the capital saved, work can start');
});

test('jobs: a thriving business at full strength takes on extra hands, and lets the place go when trade turns', () => {
  const { state } = makeSim();
  const farm = bizByName(state, 'Sunfield Farm');
  fund(state, farm.id, 400);
  const usual = staffCap(farm);
  for (let i = 0; farm.employees.length + 1 < usual; i++) {
    const c = { ...structuredClone(byName(state, 'Dain')), id: `cx${i + 30}`, employment: { businessId: farm.id, role: 'worker', wage: 6, since: 1, unpaid: 0 } };
    state.citizens.push(c); state.accounts[c.id] = 0; farm.employees.push(c.id);
  }
  farm.status = 'OPEN';
  farm.history = Array.from({ length: 6 }, (_, i) => ({ day: state.day - 6 + i, revenue: 60, expenses: 40, profit: 20, customers: 8, produced: 20, cash: 400 }));
  updateOpenings(state, farm);
  assert.equal(staffCap(farm), usual + 1, 'room for one more');
  assert.equal(farm.openings, 1, 'and it is hiring');
  updateOpenings(state, farm);
  assert.equal(staffCap(farm), usual + 1, 'at most one extra place at a time');
  farm.status = 'STRUGGLING';
  updateOpenings(state, farm);
  assert.equal(staffCap(farm), usual, 'the unfilled extra place goes when trade turns');
});

test('new business: the number a market supports grows with the town', () => {
  const { state } = makeSim();
  const bram = byName(state, 'Bram');
  bram.dream = { type: 'business', businessType: 'bakery', text: 'Open a bakery' };
  bram.venture = {};
  for (const [i, name] of ['North Lane', 'West Green', 'East Commons'].entries()) createBusiness(state, { type: 'bakery', ownerId: byName(state, 'Cora').id, plotId: plot(state, name).id, name: `Bakery ${i}` });
  const dain = byName(state, 'Dain');
  for (let i = 0; i < 115; i++) state.citizens.push({ ...structuredClone(dain), id: `cx${i}` });
  assert.notEqual(planFor(state, bram).goal, 'Keep working while the market is crowded', 'three bakeries do not saturate a town of 120');
});

test('new business: a shop is given time to find customers before it is judged', () => {
  const { state } = makeSim();
  const b = createBusiness(state, { type: 'bakery', ownerId: byName(state, 'Bram').id, plotId: plot(state, 'North Lane').id, name: 'Patient Bakery' });
  fund(state, b.id, 40);
  for (let d = 0; d < 7; d++) { closeDay(state); state.day++; }
  assert.equal(b.status, 'OPEN', 'a week without sales is not yet a failure');
});

test('new business: an owner with savings tops up a struggling business through the ledger, within limits', () => {
  const { state } = makeSim();
  const cora = byName(state, 'Cora');
  fund(state, cora.id, 300);
  const b = createBusiness(state, { type: 'bakery', ownerId: cora.id, plotId: plot(state, 'North Lane').id, name: 'Rescued Bakery' });
  b.foundedDay = -20;
  b.status = 'STRUGGLING';
  fund(state, b.id, 2);
  const money = totalMoney(state);
  closeDay(state);
  assert.ok(balance(state, b.id) > 10, `the owner put money in (${balance(state, b.id)} coins)`);
  const tx = state.ledger.findLast((t) => t.to === b.id);
  assert.equal(tx.kind, 'capital');
  assert.equal(tx.from, cora.id);
  for (let d = 0; d < 60 && b.status === 'STRUGGLING'; d++) { b.today.other = 30; state.day++; closeDay(state); }
  assert.ok(['CLOSED', 'BANKRUPT'].includes(b.status), 'a business with no trade still closes in the end');
  assert.ok(300 - balance(state, cora.id) <= 2 * 40 + 30, 'the owner did not pour in everything she had');
  assert.equal(totalMoney(state), money);
});

test('small loans: payments always cover the interest, so a 7-coin loan is paid off', () => {
  const { state } = makeSim();
  const b0 = bank(state);
  const dain = byName(state, 'Dain');
  fund(state, dain.id, 100);
  const loan = issueLoan(state, b0, dain, 7, { rate: 0.08, seasons: 8, payment: 1, purpose: 'general', score: 60, collateralPlotId: null });
  for (let i = 0; i < 40 && loan.status !== 'PAID'; i++) {
    state.day += 3;
    seasonalInterest(state);
    collectPayment(state, loan);
  }
  assert.equal(loan.status, 'PAID');
  assert.ok(loan.paid <= 9, `repaid ${loan.paid} coins on a 7-coin loan`);
});

function forcedSale(state, c, amount) {
  const b0 = bank(state);
  const land = plot(state, 'Mill Row');
  land.ownerId = c.id;
  const loan = issueLoan(state, b0, c, amount, { rate: 0.1, seasons: 8, payment: 4, purpose: 'premises', score: 40, collateralPlotId: land.id });
  loan.status = 'COLLECTING';
  land.forcedSale = { loanId: loan.id, caseId: 'k1', day: state.day };
  listForSale(state, land.id, plotValue(land));
  return { loan, land };
}

test('forced sales: a debtor who leaves the village settles a debt under a court-ordered sale', () => {
  const { state } = makeSim();
  const dain = byName(state, 'Dain');
  const { loan, land } = forcedSale(state, dain, 20);
  fund(state, dain.id, 40);
  settleBeforeLeaving(state, dain);
  assert.equal(loan.status, 'PAID');
  assert.equal(land.lien, undefined);
  assert.equal(land.forcedSale, undefined);
});

test('forced sales: a debtor who dies has the debt settled from the estate', () => {
  const { state } = makeSim();
  const dain = byName(state, 'Dain');
  const { loan, land } = forcedSale(state, dain, 20);
  fund(state, dain.id, 40);
  const money = totalMoney(state);
  die(state, dain, 'old age');
  assert.equal(loan.status, 'PAID');
  assert.equal(land.forcedSale, undefined);
  assert.equal(totalMoney(state), money);
});

test('council land: an unsold council listing comes down toward its value over time', () => {
  const { state } = makeSim();
  const p = plot(state, 'North Lane');
  listForSale(state, p.id, 200);
  for (let d = 0; d < 36; d++) { state.day++; softenListings(state); }
  assert.ok(p.price < 200, `still asking ${p.price}`);
  assert.ok(p.price >= Math.round(plotValue(p) * 0.75));
});

test('inheritance: land is shared among the heirs and the home stays with the household', () => {
  const { state } = makeSim();
  const [ada, bram, cora, elin] = ['Ada', 'Bram', 'Cora', 'Elin'].map((n) => byName(state, n));
  ada.family.spouseId = bram.id; bram.family.spouseId = ada.id;
  ada.family.childIds = [cora.id, elin.id];
  for (const k of [cora, elin]) k.family.parentIds = [ada.id];
  const home = plot(state, 'Brook Cottage');
  for (const p of [home, plot(state, 'North Lane'), plot(state, 'Mill Row')]) { p.ownerId = ada.id; p.marketStatus = 'NOT_FOR_SALE'; }
  ada.homePlotId = home.id; bram.homePlotId = home.id; home.residents = [ada.id, bram.id];
  die(state, ada, 'old age');
  assert.equal(home.ownerId, bram.id, 'the widower keeps the family home');
  assert.deepEqual(new Set([plot(state, 'North Lane').ownerId, plot(state, 'Mill Row').ownerId]), new Set([cora.id, elin.id]), 'each child inherits land');
});

test('taxes: a new levy takes effect the next day and cannot be toggled around midnight', () => {
  const sim = makeSim();
  const s = sim.state;
  bizByName(s, 'Sunfield Farm').foundedDay = -10;
  s.minute = 23 * 60 + 50;
  assert.equal(sim.council('setTax', 'high').ok, true);
  assert.equal(s.council.taxLevel, 'normal', 'not yet in force');
  sim.step();
  const levy = s.ledger.find((t) => t.memo === 'Daily levy on Sunfield Farm');
  assert.equal(levy?.amount, 1, 'the day that ended was taxed at the level villagers lived under');
  assert.equal(s.council.taxLevel, 'high', 'in force from the new day');
  assert.equal(sim.council('setTax', 'low').ok, false, 'no flipping back at midnight');
  sim.runDays(3);
  assert.equal(sim.council('setTax', 'low').ok, true, 'a season later it can change again');
});

test('council favours: aid, business grants and gifts cannot be repeated on the same target at once', () => {
  const sim = makeSim();
  const s = sim.state;
  fund(s, 'treasury', 500);
  const [dain, bram] = [byName(s, 'Dain'), byName(s, 'Bram')];
  assert.equal(sim.council('aid', dain.id).ok, true);
  const again = sim.council('aid', dain.id);
  assert.equal(again.ok, false);
  assert.match(again.message, /again from day/);
  assert.equal(sim.council('aid', bram.id).ok, true, 'another villager can still be helped');
  const farm = bizByName(s, 'Sunfield Farm');
  assert.equal(sim.council('supportBusiness', farm.id).ok, true);
  assert.equal(sim.council('supportBusiness', farm.id).ok, false);
  const kingdom = Object.keys(KINGDOMS)[0];
  assert.equal(sim.council('gift', kingdom).ok, true);
  assert.equal(sim.council('gift', kingdom).ok, false);
  // The buttons say so.
  assert.match(citizenDetail(sim, dain.id).html, /data-action="aid"[^>]*disabled/);
  assert.doesNotMatch(citizenDetail(sim, byName(s, 'Cora').id).html, /data-action="aid"[^>]*disabled/);
  assert.match(businessDetail(sim, farm.id).html, /data-action="supportBusiness"[^>]*disabled/);
  assert.match(regionPanel(sim, { regionMode: 'diplomacy' }).html, new RegExp(`data-action="gift" data-id="${kingdom}"[^>]*disabled`));
});

test('apprentices: a graduate is kept on only if the premises have room', () => {
  const { state } = makeSim();
  const ada = byName(state, 'Ada');
  const farm = bizByName(state, 'Sunfield Farm');
  fund(state, farm.id, 200);
  for (let i = 0; farm.employees.length + 1 < staffCap(farm); i++) {
    const c = { ...structuredClone(byName(state, 'Dain')), id: `cx${i + 10}`, employment: { businessId: farm.id, role: 'worker', wage: 6, since: 1, unpaid: 0 } };
    state.citizens.push(c); state.accounts[c.id] = 0; farm.employees.push(c.id);
  }
  assert.equal(farm.employees.length + 1, staffCap(farm), 'the farm is fully staffed');
  const grad = { ...structuredClone(byName(state, 'Dain')), id: 'cx2', employment: null, education: { ...structuredClone(byName(state, 'Dain').education), trade: 'farming', masterId: ada.id } };
  state.citizens.push(grad); state.accounts[grad.id] = 0;
  onAdulthood(state, grad);
  assert.equal(grad.employment, null);
  assert.ok(farm.employees.length + 1 <= staffCap(farm));
});

test('development: a scheme whose financing falls through does not drain the developer\'s savings first', () => {
  const { state } = makeSim();
  const b0 = bank(state);
  const dain = byName(state, 'Dain');
  fund(state, dain.id, 100);
  assert.ok(deposit(state, b0, dain.id, 100));
  const before = depositOf(state, dain.id);
  const app = { kind: 'scheme', type: 'apartment', era: 2, applicantId: dain.id, plotIds: [plot(state, 'North Lane').id], annexId: null, purpose: 'rental' };
  const finance = { funds: (c) => spendable(state, c.id), raise: raiseCash, borrow: () => false };
  const why = applicationExecutors.scheme(state, app, finance);
  assert.equal(typeof why, 'string', 'the scheme could not go ahead');
  assert.equal(depositOf(state, dain.id), before, 'savings stayed in the bank');
});
