import { CIV, POPULATION } from '../core/Config.js';
import { isNewYear, isNewSeason, yearOf } from '../core/Calendar.js';
import { balance } from '../economy/Transactions.js';
import { record } from '../society/Chronicle.js';
import { dailyHooks } from '../sim/Hooks.js';
import { milestone5Setup } from '../sim/Setup.js';
import { productionHooks } from '../economy/Businesses.js';
import { buildingHooks, plotById, allows } from '../property/LandRegistry.js';
import { projectRules, rebuildHooks, supplyHooks, startProject } from '../property/Construction.js';
import { buyPlot } from '../property/Ownership.js';
import { isTrading } from '../economy/Businesses.js';
import { transportHooks } from '../region/RegionManager.js';
import { travelHooks } from '../ai/CitizenBrain.js';
import { healthHooks } from '../events/Disasters.js';
import { AGES, ageForYear, ageDef } from './Ages.js';
import { TECHNOLOGIES, seasonalTechnology, adoptTech, hasTech } from './Technology.js';
import { NETWORK_KEYS, dailyInfrastructure, serviceFactor } from './Infrastructure.js';
import { stampBuilding, yearlyWear, landFactor, premisesProductivity, premisesStaff, buildEra } from './Architecture.js';
import { reviewModernization, onRebuilt, contractorWork, rebuildCap, rebuildStages } from './Modernization.js';
import { dailyDensity } from './Density.js';
import { ensureHeritage, dailyHeritage, heritageVeto, noteLoss } from './Heritage.js';
import { recordPropertyChanges, ensureArchive } from './PropertyHistory.js';
import { dailyTransport, regionalFactor, planTrip } from './Transport.js';
import { seedOf, floorsFor, formLabel } from './ArchitectureData.js';

// v0.5.2 — The Evolution of Civilization. Wires the ages, technology,
// utilities, architecture, modernization, density, heritage, transport and
// the Then & Now records into the simulation's schedules and hooks.

/** Everything v0.5.2 adds to a world; new kingdoms and migrated saves both come through here. */
export function ensureCivilization(state) {
  if (!state.civ) {
    const age = ageForYear(yearOf(state.day));
    state.civ = {
      age: 1, ages: [{ age: 1, day: 1, year: 1 }], tech: {}, techLog: [],
      infra: Object.fromEntries(NETWORK_KEYS.map((n) => [n, {}])), works: [],
      transport: { trips: {}, paved: 0 }, firsts: {}, applications: [], cursor: 0, nextId: 0,
      stats: { built: 0, rebuildsStarted: 0, rebuilt: 0, schemes: 0, apartments: 0, towers: 0, mansions: 0, utilityWorks: 0, upkeepPaid: 0, decayed: 0, rentPaid: 0, evictions: 0, tenancies: 0 },
    };
    // An old world joins the age its calendar has already reached, with its own buildings as they stand.
    for (let a = 2; a <= age; a++) openAge(state, a, { quiet: true });
    for (const t of TECHNOLOGIES.filter((x) => x.founding)) state.civ.tech[t.id] = 1;
    for (const p of state.plots) if (p.building && p.building.era === undefined) stampLegacy(state, p);
  }
  ensureHeritage(state);
  // Each property's Then & Now record begins with what stands on it now.
  if (!Object.keys(ensureArchive(state)).length) recordPropertyChanges(state);
  return state.civ;
}

/** Buildings that predate the evolution of civilization are Age of Foundations buildings. */
function stampLegacy(state, p) {
  const b = p.building;
  b.era = 1;
  b.seed = seedOf(`${p.id}:${b.type}:${b.builtDay ?? 1}`);
  b.floors = floorsFor(b.type, 1, b.seed, p);
  b.style = formLabel(b);
}

function openAge(state, id, { quiet = false } = {}) {
  const civ = state.civ;
  if (civ.age >= id) return;
  civ.age = id;
  civ.ages.push({ age: id, day: state.day, year: yearOf(state.day) });
  state.populationCap = Math.max(state.populationCap ?? POPULATION.max, CIV.populationCap[id]);
  if (quiet) return;
  const def = ageDef(id);
  record(state, 'council', `${def.icon} Year ${yearOf(state.day)}: the ${def.name} begins. ${def.blurb} Nothing changes by itself: new ways of building, working and travelling are now within reach of anyone who can afford them.`, {}, 3);
}

function dailyCivilization(state) {
  const civ = ensureCivilization(state);
  if (isNewYear(state.day)) {
    const age = ageForYear(yearOf(state.day));
    if (age > civ.age) openAge(state, age);
    if (civ.age >= 2) for (const p of state.plots) p.landMult = Math.round(landFactor(state, p) * 100) / 100;
  }
  const finance = civ.financeHook?.(state) ?? dailyHooks.developmentFunding?.(state) ?? {};
  seasonalTechnology(state);
  dailyInfrastructure(state);
  civicBuildings(state);
  yearlyWear(state);
  contractorWork(state);
  reviewModernization(state, finance);
  dailyHeritage(state, finance);
  dailyDensity(state, finance);
  dailyTransport(state);
  serviceFactors(state);
  recordPropertyChanges(state);
}

/** Buildings record how well their district's utilities serve them (beds and output depend on it). */
function serviceFactors(state) {
  if (state.day % 3 !== 0) return;
  for (const p of state.plots) if (p.building && (p.building.era ?? 1) >= 2) { const f = serviceFactor(state, p); if (f < 1) p.building.serviceFactor = f; else delete p.building.serviceFactor; }
}

/** The council builds a railway station and a hospital once the technologies are adopted. */
function civicBuildings(state) {
  if (!isNewSeason(state.day)) return;
  const want = [];
  if (hasTech(state, 'railway')) want.push(['station', 'workshop']);
  if (hasTech(state, 'hospital_care')) want.push(['hospital', 'commercial']);
  for (const [type, land] of want) {
    if (state.plots.some((p) => p.building?.type === type || state.projects.some((x) => x.plotId === p.id && x.buildingType === type))) continue;
    if (balance(state, 'treasury') < 150) continue;
    const site = state.plots.filter((p) => !p.building && !p.projectId && allows(p, type) && (p.ownerId === 'council' || p.marketStatus === 'FOR_SALE') && (p.landType === land || p.landType === 'civic'))
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || a.id.localeCompare(b.id))[0];
    if (!site) continue;
    if (site.ownerId !== 'council' && !buyPlot(state, site.id, 'council').ok) continue;
    const era = Math.max(buildEra(state), type === 'station' ? 2 : 3);
    const res = startProject(state, { plotId: site.id, ownerId: 'council', kind: 'construction', buildingType: type, purpose: 'civic', stages: rebuildStages(type, era, { demolish: false }), targetEra: era, contractors: era >= 3 });
    if (res.ok) record(state, 'council', `The council began building a ${type === 'station' ? 'railway station' : 'hospital'} on ${site.name}.`, { plot: site.id }, 2);
  }
}

/** The best builders' merchant in town: a trading lumberyard or smithy (the newest premises first). */
function supplier(state) {
  return state.businesses.filter((b) => isTrading(b) && (b.type === 'lumberyard' || b.type === 'blacksmith'))
    .map((b) => ({ b, era: plotById(state, b.plotId)?.building?.era ?? 1 })).sort((x, y) => y.era - x.era || x.b.id.localeCompare(y.b.id))[0]?.b ?? null;
}

// --- Wiring -----------------------------------------------------------------------------

milestone5Setup.push(ensureCivilization);
dailyHooks.late.push(dailyCivilization);
buildingHooks.stamp = (state, plot, b, arch) => { if (state.civ) stampBuilding(state, plot, b, arch); };
buildingHooks.landFactor = (plot) => plot.landMult ?? 1; // refreshed each new year from the age and the plot's centrality
productionHooks.push((state, b, plot) => (state.civ ? premisesProductivity(state, b, plot) : 1));
projectRules.veto = (state, plot, kind, type) => (state.civ ? heritageVeto(state, plot, kind, type) : null);
projectRules.privateCap = (state) => (state.civ ? rebuildCap(state) : 0);
rebuildHooks.push(onRebuilt, noteLoss);
supplyHooks.seller = supplier;
transportHooks.regional = (state) => (state.civ ? regionalFactor(state) : null);
travelHooks.plan = (state, c, act, points) => (state.civ ? planTrip(state, c, act, points) : 1);
healthHooks.disease = (state) => (state.civ && state.plots.some((p) => p.building?.type === 'hospital') ? 0.55 : 1) * (state.civ && hasTech(state, 'sanitation') ? 0.6 : 1);
healthHooks.infant = (state) => (state.civ && state.plots.some((p) => p.building?.type === 'hospital') ? 0.55 : 1);

export { AGES, adoptTech, premisesStaff, landFactor };
