import { POPULATION } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { formOf } from '../civilization/ArchitectureData.js';

// The land registry: every plot in the settlement, who owns it and what stands on it.

export const LAND_TYPES = {
  farmland: { label: 'Farmland', base: 44, allows: ['farm', 'cottage', 'mansion', 'grounds'] },
  commercial: { label: 'Commercial', base: 38, allows: ['bakery', 'general_store', 'tavern', 'blacksmith', 'bank', 'guildhall', 'apartment', 'tower', 'grounds', 'hospital'] },
  workshop: { label: 'Workshop land', base: 34, allows: ['lumberyard', 'blacksmith', 'general_store', 'guildhall', 'barracks', 'station', 'grounds'] },
  residential: { label: 'Residential', base: 22, allows: ['cottage', 'shrine', 'apartment', 'tower', 'mansion', 'grounds'] },
  civic: { label: 'Civic', base: 50, allows: ['hall', 'market', 'school', 'granary', 'well', 'townhall', 'memorial', 'courthouse', 'shrine', 'chapel', 'temple', 'barracks', 'station', 'hospital', 'grounds'] },
};

export const BUILDING_INFO = {
  hall: { label: 'Hearth Hall', class: 'civic', value: 60 },
  market: { label: 'Market Square', class: 'civic', value: 40 },
  farm: { label: 'Farmstead', class: 'farm', value: 26 },
  lumberyard: { label: 'Lumberyard', class: 'workshop', value: 30 },
  blacksmith: { label: 'Smithy', class: 'workshop', value: 32 },
  bakery: { label: 'Bakery', class: 'shop', value: 30 },
  general_store: { label: 'General Store', class: 'shop', value: 30 },
  tavern: { label: 'Tavern', class: 'shop', value: 34 },
  stall: { label: 'Trading Stall', class: 'shop', value: 14 },
  cottage: { label: 'Cottage', class: 'home', value: 24 },
  school: { label: 'School', class: 'civic', value: 40 },
  granary: { label: 'Granary', class: 'civic', value: 36 },
  well: { label: 'Well', class: 'civic', value: 14 },
  townhall: { label: 'Town Hall', class: 'civic', value: 90 },
  ruins: { label: 'Ruins', class: 'ruins', value: 0 },
  courthouse: { label: 'Courthouse', class: 'civic', value: 80 },
  bank: { label: 'Counting House', class: 'institution', value: 70 },
  guildhall: { label: 'Guild Hall', class: 'institution', value: 80 },
  shrine: { label: 'Shrine', class: 'faith', value: 20 },
  chapel: { label: 'Chapel', class: 'faith', value: 50 },
  temple: { label: 'Temple', class: 'faith', value: 95 },
  barracks: { label: 'Barracks', class: 'civic', value: 60 },
  // v0.5.2: density, wealth and infrastructure.
  apartment: { label: 'Apartment building', class: 'home', value: 60 },
  tower: { label: 'Residential tower', class: 'home', value: 90 },
  mansion: { label: 'Mansion', class: 'home', value: 70 },
  grounds: { label: 'Grounds', class: 'annex', value: 10 },
  station: { label: 'Station', class: 'civic', value: 70 },
  hospital: { label: 'Hospital', class: 'civic', value: 90 },
};

/** Systems that stamp architecture on new buildings and adjust land prices register here (see civilization/). */
export const buildingHooks = { stamp: null, landFactor: null };

// Hand-placed village layout around the crossroads at (0, 0).
const LAYOUT = [
  ['Hearth Hall', -8, -8, 9, 8, 'civic'],
  ['Sunfield', -24, -9, 12, 10, 'farmland'],
  ['Timber Edge', 21, -11, 10, 9, 'workshop'],
  ['Crossroads Corner', 8, 8, 8, 7, 'commercial'],
  ['North Lane', 8, -8, 8, 8, 'commercial'],
  ['Mill Row', 21, 8, 9, 8, 'workshop'],
  ['West Green', -8, 8, 8, 7, 'commercial'],
  ['Meadow Field', -24, 9, 12, 10, 'farmland'],
  ['Brook Cottage', -15, 21, 7, 7, 'residential'],
  ['Willow Cottage', -6, 21, 7, 7, 'residential'],
  ['Hill Cottage', 6, 21, 7, 7, 'residential'],
  ['Elm Cottage', 15, 21, 7, 7, 'residential'],
  ['Forge Yard', 25, 21, 8, 7, 'workshop'],
  ['East Commons', 32, -1, 8, 8, 'commercial'],
];

export function createPlots(state) {
  for (const [name, x, z, w, d, landType] of LAYOUT) makePlot(state, { name, x, z, w, d, landType, district: 'Old Town' });
}

export function makePlot(state, { name, x, z, w, d, landType, district }) {
  {
    const plot = {
      id: 'p' + ++state.nextId.plot,
      name, x, z, w, d, landType,
      ownerId: 'council',
      price: LAND_TYPES[landType].base,
      marketStatus: landType === 'civic' ? 'NOT_FOR_SALE' : 'FOR_SALE',
      reservedBy: null,
      reservedUntil: 0,
      building: null,
      businessId: null,
      residents: [],
      constructionStatus: 'NONE',
      projectId: null,
      history: [],
      facing: x > 28 ? 'west' : x < -34 ? 'east' : z > 0 ? 'north' : 'south',
      district,
    };
    state.plots.push(plot);
    return plot;
  }
}

const FACING = { south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0] };
/** Rotation (radians about y) that turns a model's +z front toward the street. */
export const facingAngle = (plot) => ({ south: 0, north: Math.PI, west: -Math.PI / 2, east: Math.PI / 2 }[plot.facing ?? 'south']);
/** A point just outside the plot's front door. `offset` shifts along the frontage. */
export function frontOf(plot, offset = 0, extra = 0.8) {
  const [fx, fz] = FACING[plot.facing ?? 'south'];
  const half = (fz ? plot.d : plot.w) / 2;
  return { x: plot.x + fx * (half + extra) + fz * offset, z: plot.z + fz * (half + extra) - fx * offset };
}

export const plotById = (state, id) => byId(state.plots, id);
export const plotByName = (state, name) => state.plots.find((p) => p.name === name) ?? null;
export const buildingClass = (type) => BUILDING_INFO[type]?.class ?? null;
export const allows = (plot, buildingType) => LAND_TYPES[plot.landType].allows.includes(buildingType);

export function plotValue(plot) {
  const land = Math.round(LAND_TYPES[plot.landType].base * (buildingHooks.landFactor?.(plot) ?? 1));
  const b = plot.building;
  if (!b || plot.constructionStatus !== 'COMPLETE') return land;
  // A building's worth grows with its architecture and falls with neglect.
  const era = b.era ?? 1;
  const worth = era <= 1 && !b.floors ? BUILDING_INFO[b.type].value : Math.round(BUILDING_INFO[b.type].value * formOf(b.type, era).value * (0.55 + 0.45 * Math.min(100, b.condition ?? 100) / 100));
  return land + worth;
}

export function plotHistory(state, plot, text) {
  plot.history.push({ day: state.day, text });
  if (plot.history.length > 24) plot.history.shift();
}

export function setBuilding(state, plot, type, name = null, arch = null) {
  plot.building = { type, name: name ?? BUILDING_INFO[type].label, builtDay: state.day };
  buildingHooks.stamp?.(state, plot, plot.building, arch);
  plot.constructionStatus = 'COMPLETE';
}

/** Plots a citizen could buy for a building type, cheapest first. */
export function plotsForSale(state, buildingType, buyerId) {
  return state.plots
    .filter((p) => p.marketStatus === 'FOR_SALE' && p.ownerId !== buyerId && allows(p, buildingType) && !p.projectId &&
      !(p.reservedBy && p.reservedBy !== buyerId && p.reservedUntil > state.tick))
    .sort((a, b) => a.price - b.price);
}

export function bedsAt(state, plot) {
  if (!plot.building || plot.constructionStatus !== 'COMPLETE') return 0;
  if (plot.building.type === 'hall' || plot.building.type === 'townhall') return POPULATION.hallBeds + Math.max(0, formOf(plot.building.type, plot.building.era ?? 1).beds - POPULATION.hallBeds);
  if (plot.building.type === 'cottage') return ((plot.building.level ?? 1) >= 2 ? POPULATION.houseBeds : POPULATION.cottageBeds) + Math.max(0, formOf('cottage', plot.building.era ?? 1).beds - POPULATION.cottageBeds);
  if (['apartment', 'tower', 'mansion'].includes(plot.building.type)) return Math.round(formOf(plot.building.type, plot.building.era ?? 1).beds * (plot.building.serviceFactor ?? 1));
  return 0;
}
