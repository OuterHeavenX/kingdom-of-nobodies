import { foundingRoads, addRoad } from '../navigation/RoadNetwork.js';
import { BLOCKS } from '../population/Expansion.js';
import { ensureRegion } from '../region/RegionManager.js';
import { SAVE_VERSION, POPULATION } from '../core/Config.js';
import { familyWish } from '../citizens/Genetics.js';
import { transfer, openAccount } from '../economy/Transactions.js';
import { addGoods } from '../economy/Inventory.js';
import { createBusiness } from '../economy/Businesses.js';
import { createPlots, plotByName, setBuilding, plotHistory } from '../property/LandRegistry.js';
import { createCitizen } from '../citizens/Citizen.js';
import { assignHomes } from '../citizens/CitizenManager.js';
import { record } from '../society/Chronicle.js';
import { adjustBoth } from '../citizens/Relationships.js';

// The founding of the kingdom: five original residents, the Hearth Hall,
// Sunfield Farm, the council's woodlot and an old empty trading stall.

export const FOUNDERS = [
  {
    firstName: 'Ada', lastName: 'Thornfield', age: 34, sex: 'F', founder: true, color: '#f5aa7d', profession: 'Farmer', legacyTrait: 'Generous',
    traits: { generous: 0.8, hardworking: 0.7, loyal: 0.5, frugal: 0.35 }, skills: { farming: 0.6 },
    appearance: { hair: 'bun', hairColor: '#8c3b22', skin: '#f2cfab' },
    dream: { type: 'homestead', text: 'Build a flourishing homestead' }, money: 26,
  },
  {
    firstName: 'Bram', lastName: 'Ashgrove', age: 27, sex: 'M', founder: true, color: '#a9c7f6', profession: 'Woodcutter', legacyTrait: 'Ambitious',
    traits: { ambitious: 0.9, hardworking: 0.6, riskTaking: 0.55, jealous: 0.35 }, skills: { forestry: 0.55, building: 0.2 },
    appearance: { hair: 'short', hairColor: '#3b2a1e', skin: '#e0b48c' },
    dream: { type: 'business', businessType: 'lumberyard', text: 'Own a thriving workshop: a lumberyard of his own' }, money: 12,
  },
  {
    firstName: 'Cora', lastName: 'Millbrook', age: 31, sex: 'F', founder: true, color: '#e4b7df', profession: 'Builder', legacyTrait: 'Curious',
    traits: { curious: 0.8, creative: 0.75, honest: 0.6, friendly: 0.4 }, skills: { building: 0.6 },
    appearance: { hair: 'braid', hairColor: '#a8763e', skin: '#f5d9c0' },
    dream: { type: 'master_builder', target: 4, text: 'Create a beautiful village' }, money: 20,
  },
  {
    firstName: 'Dain', lastName: 'Holloway', age: 40, sex: 'M', founder: true, color: '#eed68f', profession: 'Forager', legacyTrait: 'Stubborn',
    traits: { stubborn: 0.75, frugal: 0.7, loyal: 0.6, shy: 0.5, curious: 0.45 }, skills: { foraging: 0.6 },
    appearance: { hair: 'curly', hairColor: '#6b4226', skin: '#c68e64' },
    dream: { type: 'wealth', target: 120, text: 'Explore the forest and live well off its bounty' }, money: 15,
  },
  {
    firstName: 'Elin', lastName: 'Brookes', age: 24, sex: 'F', founder: true, color: '#a7e5ca', profession: 'Farmer', legacyTrait: 'Friendly',
    traits: { friendly: 0.9, generous: 0.45, riskTaking: 0.4, creative: 0.4 }, skills: { farming: 0.45, hospitality: 0.3 },
    appearance: { hair: 'long', hairColor: '#d9b36c', skin: '#f2cfab' },
    dream: { type: 'business', businessType: 'tavern', text: 'Bring everyone together at a tavern of her own' }, money: 18,
  },
];

/** The council's public-works crew, based at the Hearth Hall. */
export function createWorks(state) {
  const hall = plotByName(state, 'Hearth Hall');
  const works = createBusiness(state, { type: 'works', ownerId: 'council', plotId: hall.id, name: 'Village Works' });
  works.foundedDay = state.day;
  return works;
}

export function emptyState(seed) {
  return {
    version: SAVE_VERSION,
    kingdomName: 'Kingdom of Nobodies',
    seed,
    rng: seed | 0,
    tick: 0,
    day: 1,
    minute: 8 * 60,
    nextId: { citizen: 0, business: 0, plot: 0, project: 0, chronicle: 0, rumor: 0, tx: 0 },
    accounts: { treasury: 0, outside: 0 },
    ledger: [],
    ledgerTotals: {},
    council: { taxLevel: 'normal', pantry: {}, marketplace: false, festivalUntil: 0, festivalCooldownUntil: 0 },
    commons: { forest: 220, forestCap: 320, berries: 90, berriesCap: 180 },
    citizens: [],
    businesses: [],
    plots: [],
    projects: [],
    relationships: {},
    rumors: [],
    chronicle: [],
    history: [],
    lastCaravanDay: 0,
    events: [],
    archive: {},
    estates: [],
    stats: { births: 0, deaths: 0, immigrants: 0, emigrants: 0, marriages: 0, elections: 0, fires: 0 },
    season: {},
    discoveries: {},
    government: null,
    eras: [{ name: 'The Founding Years', startDay: 1, reason: 'Five strangers lit the first hearth.' }],
    populationCap: POPULATION.max,
    yearly: [],
    eventLog: [],
    fires: [],
    research: {},
    monuments: [{ id: 'founders', name: "Founders' Memorial", day: 1 }],
  };
}

/**
 * Everything Milestone 4 adds to a world. New kingdoms and migrated saves both
 * go through here, so a village loaded from Milestone 3 ends up with exactly
 * the same structures as a new one.
 */
export function addMilestone4State(state) {
  state.nextId.road = state.nextId.road ?? 0;
  if (!state.roads) {
    state.roads = foundingRoads();
    state.nextId.road = Math.max(state.nextId.road, state.roads.length);
    for (const name of state.districts?.opened ?? []) {
      const block = BLOCKS.find((b) => b.name === name);
      if (block) { const [x, z, w, d] = block.road; addRoad(state, { name: `${name} Road`, kind: 'dirt', x, z, w, d }); }
    }
  }
  state.roadProjects = state.roadProjects ?? [];
  state.navigation = state.navigation ?? { traffic: {}, routes: 0, failures: 0, recentFailures: [] };
  state.council.stores = state.council.stores ?? {};
  ensureRegion(state);
  return state;
}

export function createKingdom(seed = 20251024) {
  const state = emptyState(seed);
  state.accounts.treasury = 140;
  state.accounts.outside = 50000; // the wider world beyond the valley
  createPlots(state);
  const hall = plotByName(state, 'Hearth Hall');
  setBuilding(state, hall, 'hall');
  plotHistory(state, hall, 'The Hearth Hall was raised by the founders.');

  const founders = FOUNDERS.map((f) => {
    const c = createCitizen(state, { ...f, homePlotId: null, x: hall.x + state.citizens.length * 0.8 - 2, z: hall.z + 6 });
    transfer(state, 'outside', c.id, f.money, 'immigration', `${f.firstName}'s founding savings`);
    return c;
  });
  const [ada, bram, cora, dain, elin] = founders;
  assignHomes(state);

  const sunfield = plotByName(state, 'Sunfield');
  sunfield.ownerId = ada.id;
  sunfield.marketStatus = 'NOT_FOR_SALE';
  setBuilding(state, sunfield, 'farm');
  const farm = createBusiness(state, { type: 'farm', ownerId: ada.id, plotId: sunfield.id, name: 'Sunfield Farm' });
  sunfield.businessId = farm.id;
  sunfield.building.name = farm.name;
  transfer(state, 'treasury', farm.id, 30, 'grant', 'Founding grant to Sunfield Farm');
  addGoods(farm.inventory, 'grain', 16);
  addGoods(farm.inventory, 'tools', 1);
  ada.employment = { businessId: farm.id, role: 'owner', wage: 0, since: 1, unpaid: 0 };
  ada.employmentHistory.push({ businessId: farm.id, name: farm.name, from: 1, to: null, role: 'owner' });
  elin.employment = { businessId: farm.id, role: 'worker', wage: 6, since: 1, unpaid: 0 };
  elin.employmentHistory.push({ businessId: farm.id, name: farm.name, from: 1, to: null, role: 'worker' });
  farm.employees.push(elin.id);
  plotHistory(state, sunfield, 'Ada Thornfield founded Sunfield Farm.');

  const edge = plotByName(state, 'Timber Edge');
  edge.marketStatus = 'NOT_FOR_SALE';
  setBuilding(state, edge, 'lumberyard');
  const woodlot = createBusiness(state, { type: 'lumberyard', ownerId: 'council', plotId: edge.id, name: 'Village Woodlot' });
  edge.businessId = woodlot.id;
  edge.building.name = woodlot.name;
  transfer(state, 'treasury', woodlot.id, 40, 'grant', 'Founding grant to the Village Woodlot');
  addGoods(woodlot.inventory, 'timber', 6);
  addGoods(woodlot.inventory, 'tools', 1);
  bram.employment = { businessId: woodlot.id, role: 'worker', wage: 7, since: 1, unpaid: 0 };
  bram.employmentHistory.push({ businessId: woodlot.id, name: woodlot.name, from: 1, to: null, role: 'worker' });
  woodlot.employees.push(bram.id);
  plotHistory(state, edge, 'The council opened the Village Woodlot.');

  createWorks(state);
  addMilestone4State(state);

  const corner = plotByName(state, 'Crossroads Corner');
  setBuilding(state, corner, 'stall', 'Old Trading Stall');
  corner.price = 30;
  plotHistory(state, corner, 'An old trading stall stands empty, left by passing merchants.');

  addGoods(state.council.pantry, 'grain', 8);
  adjustBoth(state, ada.id, elin.id, { friendship: 18, trust: 10 });
  adjustBoth(state, bram.id, cora.id, { friendship: 8 });
  adjustBoth(state, dain.id, ada.id, { friendship: 6 });
  for (const c of founders) { c.mood = 70; c.familyWish = familyWish(state, c); }
  record(state, 'citizen', 'Five strangers lit the first hearth. Their story begins.', { citizens: founders.map((c) => c.id) }, 3);
  return state;
}

export { openAccount };
