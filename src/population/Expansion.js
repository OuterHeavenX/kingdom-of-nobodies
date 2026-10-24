import { transfer, balance } from '../economy/Transactions.js';
import { makePlot, bedsAt } from '../property/LandRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { record } from '../society/Chronicle.js';
import { addRoad } from '../navigation/RoadNetwork.js';
import { LIFE } from '../core/Config.js';

// Town growth. When land runs short the council surveys a new district: it
// pays road crews (real wages to local workers, or outside crews if no one is
// free) and opens a block of plots along a new road. Districts are then
// characterised by what people actually build there.

const SIZE = { residential: [7, 7], commercial: [8, 7], workshop: [9, 8], farmland: [12, 10], civic: [9, 8] };

export const BLOCKS = [
  { name: 'South Row', road: [0, 27, 62, 2.4], plots: [[-24, 31, 'residential'], [-15, 31, 'residential'], [-6, 31, 'civic'], [6, 31, 'residential'], [15, 31, 'residential'], [24, 31, 'commercial']] },
  { name: 'Northgate', road: [-11, -17, 36, 2.4], plots: [[-26, -22, 'residential'], [-16, -22, 'residential'], [-6, -22, 'civic'], [4, -22, 'residential']] },
  { name: 'Westbrook', road: [-34, 8, 2.4, 44], plots: [[-40, -14, 'farmland'], [-40, -1, 'residential'], [-40, 9, 'residential'], [-40, 19, 'commercial'], [-40, 29, 'residential']] },
  { name: 'Eastmarch', road: [40, 10, 2.4, 44], plots: [[46, -12, 'workshop'], [46, 0, 'residential'], [46, 10, 'residential'], [46, 20, 'commercial'], [46, 30, 'residential']] },
  { name: 'Southfields', road: [0, 37, 62, 2.4], plots: [[-24, 41, 'residential'], [-15, 41, 'residential'], [-6, 41, 'residential'], [6, 41, 'residential'], [15, 41, 'residential'], [24, 41, 'civic']] },
  { name: 'Old North', road: [-24, -27, 34, 2.4], plots: [[-38, -31, 'farmland'], [-24, -32, 'residential'], [-14, -32, 'residential'], [-4, -32, 'commercial']] },
  { name: 'Far West', road: [-48, 8, 2.4, 48], plots: [[-54, -14, 'farmland'], [-54, 0, 'residential'], [-54, 10, 'residential'], [-54, 20, 'residential'], [-54, 30, 'residential']] },
  { name: 'Far East', road: [54, 10, 2.4, 48], plots: [[60, -12, 'farmland'], [60, 0, 'residential'], [60, 10, 'residential'], [60, 20, 'residential'], [60, 30, 'workshop']] },
  { name: 'Lowmeadow', road: [0, 47, 62, 2.4], plots: [[-24, 51, 'residential'], [-15, 51, 'residential'], [-6, 51, 'residential'], [6, 51, 'residential'], [15, 51, 'residential'], [24, 51, 'residential']] },
  { name: 'Highfield', road: [0, 57, 62, 2.4], plots: [[-24, 61, 'residential'], [-15, 61, 'residential'], [-6, 61, 'commercial'], [6, 61, 'residential'], [15, 61, 'residential'], [24, 61, 'residential']] },
];
export const SURVEY_COST = 40;

export function openedBlocks(state) { return state.districts?.opened ?? []; }

export function needsLand(state) {
  const vacant = state.plots.filter((p) => !p.building && !p.projectId && p.marketStatus === 'FOR_SALE');
  const freeHomeLand = vacant.filter((p) => p.landType === 'residential').length;
  const homeless = state.citizens.filter((c) => !c.homePlotId).length;
  return vacant.length <= 2 || (freeHomeLand < 2 && (homeless > 0 || publicBeds(state) <= 2));
}

/** Beds a newcomer or homeless villager could actually move into (hall and council homes). */
export function publicBeds(state) {
  return state.plots.filter((p) => p.ownerId === 'council' || p.building?.type === 'hall').reduce((s, p) => s + Math.max(0, bedsAt(state, p) - p.residents.length), 0);
}

/** Daily: open the next district if land is short and the treasury can pay the road crews. */
export function maybeExpand(state) {
  state.districts = state.districts ?? { opened: [] };
  const next = BLOCKS.find((b) => !state.districts.opened.includes(b.name));
  if (!next || !needsLand(state) || balance(state, 'treasury') < SURVEY_COST + 30) return null;
  const crews = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge && !c.retired && (!c.employment || c.profession === 'Builder')).slice(0, 4);
  if (crews.length) {
    const each = Math.floor(SURVEY_COST / crews.length);
    for (const c of crews) transfer(state, 'treasury', c.id, each, 'construction', `Road crew for ${next.name}`);
  } else transfer(state, 'treasury', 'outside', SURVEY_COST, 'construction', `Outside road crew for ${next.name}`);
  for (const [i, [x, z, landType]] of next.plots.entries()) {
    const [w, d] = SIZE[landType];
    makePlot(state, { name: `${next.name} ${i + 1}`, x, z, w, d, landType, district: next.name });
  }
  state.districts.opened.push(next.name);
  const [rx, rz, rw, rd] = next.road;
  addRoad(state, { name: `${next.name} Road`, kind: 'dirt', x: rx, z: rz, w: rw, d: rd });
  record(state, 'property', `The council surveyed ${next.name}: a new road and ${next.plots.length} plots opened for settlement${crews.length ? `, paying ${crews.map((c) => c.firstName).join(', ')} to lay the road` : ''}.`, {}, 3);
  return next;
}

export const roadsFor = (state) => BLOCKS.filter((b) => openedBlocks(state).includes(b.name)).map((b) => b.road);

const STAGES = [[250, 'Kingdom Center'], [101, 'Large Town'], [41, 'Growing Town'], [16, 'Village'], [0, 'Hamlet']];
export const settlementStage = (pop) => STAGES.find(([min]) => pop >= min)[1];

/** What a district has become, judged from what stands there. */
export function districtCharacter(state, name) {
  const plots = state.plots.filter((p) => (p.district ?? 'Old Town') === name);
  const count = { home: 0, shop: 0, workshop: 0, farm: 0, civic: 0 };
  for (const p of plots) {
    const t = p.building?.type;
    if (!t) continue;
    if (t === 'cottage') count.home++;
    else if (['bakery', 'general_store', 'tavern', 'stall'].includes(t)) count.shop++;
    else if (['lumberyard', 'blacksmith'].includes(t)) count.workshop++;
    else if (t === 'farm') count.farm++;
    else count.civic++;
  }
  const built = Object.values(count).reduce((a, b) => a + b, 0);
  if (!built) return 'open land';
  const [kind] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return { home: 'residential quarter', shop: 'market quarter', workshop: 'crafts quarter', farm: 'farmsteads', civic: 'civic centre' }[kind];
}
