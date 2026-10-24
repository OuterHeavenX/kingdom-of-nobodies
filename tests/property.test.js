import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, byName, totalMoney } from './helpers.js';
import { balance } from '../src/economy/Transactions.js';
import { buyPlot, reservePlot } from '../src/property/Ownership.js';
import { startProject, addWork, updateProjects, projectById } from '../src/property/Construction.js';
import { plotByName } from '../src/property/LandRegistry.js';
import { addGoods } from '../src/economy/Inventory.js';

test('7. a plot cannot be sold to two owners', () => {
  const { state } = makeSim();
  const bram = byName(state, 'Bram'), elin = byName(state, 'Elin');
  state.accounts[bram.id] = 100; state.accounts[elin.id] = 100;
  const plot = plotByName(state, 'Mill Row');
  assert.equal(reservePlot(state, plot.id, bram.id), true);
  assert.equal(reservePlot(state, plot.id, elin.id), false, 'reserved for Bram');
  assert.equal(buyPlot(state, plot.id, elin.id).ok, false);
  assert.equal(buyPlot(state, plot.id, bram.id).ok, true);
  assert.equal(buyPlot(state, plot.id, elin.id).ok, false, 'already sold');
  assert.equal(plot.ownerId, bram.id);
  assert.equal(balance(state, elin.id), 100);
  assert.equal(state.plots.filter((p) => p.ownerId === bram.id && p.id === plot.id).length, 1);
});

test('property purchases move money to the seller', () => {
  const { state } = makeSim();
  const total = totalMoney(state);
  const bram = byName(state, 'Bram');
  state.accounts[bram.id] = 50;
  state.accounts.outside -= 50 - 12;
  const t = balance(state, 'treasury');
  const plot = plotByName(state, 'Mill Row');
  const price = plot.price;
  assert.equal(buyPlot(state, plot.id, bram.id).ok, true);
  assert.equal(balance(state, 'treasury'), t + price);
  assert.equal(balance(state, bram.id), 50 - price);
  assert.equal(totalMoney(state), total);
});

test('8. construction takes time and needs materials and labour', () => {
  const { state } = makeSim();
  const bram = byName(state, 'Bram'), cora = byName(state, 'Cora');
  state.accounts[bram.id] = 200;
  const plot = plotByName(state, 'Mill Row');
  buyPlot(state, plot.id, bram.id);
  const { project } = startProject(state, { plotId: plot.id, ownerId: bram.id, kind: 'construction', buildingType: 'lumberyard', purpose: 'business', businessType: 'lumberyard' });
  assert.equal(plot.constructionStatus, 'PLANNING');
  addGoods(state.businesses.find((b) => b.name === 'Village Woodlot').inventory, 'timber', 30);
  updateProjects(state);
  assert.equal(plot.constructionStatus, 'FOUNDATION');
  const seen = new Set();
  let shifts = 0;
  while (projectById(state, project.id) && shifts < 100) {
    updateProjects(state);
    addWork(state, project, shifts % 2 ? cora : bram);
    seen.add(plot.constructionStatus);
    shifts++;
  }
  assert.ok(shifts >= 8, `took ${shifts} shifts`);
  for (const s of ['FRAME', 'ROOF', 'FINISHING', 'COMPLETE']) assert.ok(seen.has(s), `passed ${s}`);
  assert.equal(plot.building.type, 'lumberyard');
  const b = state.businesses.find((x) => x.plotId === plot.id);
  assert.equal(b.ownerId, bram.id);
  assert.equal(b.status, 'OPEN');
  assert.equal(bram.employment.businessId, b.id, 'Bram now runs his own business');
});

test('9. demolition clears the building and frees the plot for construction', () => {
  const { state } = makeSim();
  const elin = byName(state, 'Elin');
  state.accounts[elin.id] = 100;
  const plot = plotByName(state, 'Crossroads Corner');
  assert.equal(plot.building.type, 'stall');
  buyPlot(state, plot.id, elin.id);
  const { project } = startProject(state, { plotId: plot.id, ownerId: elin.id, kind: 'demolition' });
  assert.equal(plot.constructionStatus, 'DEMOLISHING');
  updateProjects(state);
  let n = 0;
  while (projectById(state, project.id) && n++ < 20) addWork(state, project, elin);
  assert.equal(plot.building, null);
  assert.equal(plot.constructionStatus, 'NONE');
  assert.equal(plot.projectId, null);
  assert.ok((elin.inventory.timber ?? 0) > 0, 'salvaged timber');
  const again = startProject(state, { plotId: plot.id, ownerId: elin.id, kind: 'construction', buildingType: 'tavern', purpose: 'business', businessType: 'tavern' });
  assert.equal(again.ok, true);
});
