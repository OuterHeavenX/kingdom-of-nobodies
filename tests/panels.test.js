import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSim } from './helpers.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { Simulation } from '../src/sim/Simulation.js';
import { LAND_TYPES, BUILDING_INFO, landInfo, buildingLabel, plotValue } from '../src/property/LandRegistry.js';
import { plotDetail, buildingsList } from '../src/ui/PropertyPanel.js';
import { describeBuilding } from '../src/property/Ownership.js';
import { sweepPanels } from './panel-sweep.js';

test('panels: every building a land type allows has a label (the civic plot panel listed a "memorial" type that does not exist)', () => {
  for (const [land, info] of Object.entries(LAND_TYPES)) {
    for (const type of info.allows) assert.ok(BUILDING_INFO[type]?.label, `${land} allows "${type}", which has no BUILDING_INFO entry`);
  }
});

test('panels: every civic plot (hall, market, town hall) opens its property page', () => {
  const sim = makeSim(3);
  const civic = sim.state.plots.filter((p) => p.landType === 'civic');
  assert.ok(civic.length > 0);
  for (const p of civic) {
    const { html } = plotDetail(sim, p.id);
    assert.match(html, /Suitable for<\/dt><dd>[^<]*Town Hall/);
    assert.doesNotMatch(html, /undefined/);
  }
});

test('panels: every tab, mode and reachable detail page renders after a few years of play', () => {
  const sim = makeSim(5);
  sim.runDays(36 * 6);
  const { pages, errors } = sweepPanels(sim);
  assert.ok(pages > 300, `${pages} pages opened`);
  assert.deepEqual(errors, []);
});

test('panels: a save with an unknown land type or building type still opens instead of breaking the panel', () => {
  const sim = makeSim(6);
  const data = JSON.parse(JSON.parse(serialize(sim.state, 'test')).data);
  const [a, b] = data.plots;
  a.landType = 'meadowland';
  b.building = { ...(b.building ?? {}), type: 'lighthouse_keep', name: undefined };
  const loaded = new Simulation(deserialize(serialize(data, 'test')));
  for (const id of [a.id, b.id]) {
    const { html } = plotDetail(loaded, id);
    assert.doesNotMatch(html, /undefined/);
  }
  assert.equal(landInfo('meadowland').label, 'Land');
  assert.equal(buildingLabel('lighthouse_keep'), 'Lighthouse keep');
  assert.equal(describeBuilding(loaded.state.plots.find((p) => p.id === b.id)), 'Lighthouse keep');
  assert.ok(Number.isFinite(plotValue(loaded.state.plots.find((p) => p.id === a.id))));
  assert.ok(buildingsList(loaded, 'all').html.length > 0);
});
