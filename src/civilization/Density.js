import { CIV, LIFE } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { chance } from '../core/Random.js';
import { ownerAccount } from '../economy/Marketplace.js';
import { BUILDING_INFO, allows, bedsAt, plotById, plotValue, plotHistory, setBuilding } from '../property/LandRegistry.js';
import { buyPlot, listForSale } from '../property/Ownership.js';
import { startProject, moveHome, completionHooks, projectRules } from '../property/Construction.js';
import { householdOf } from '../population/Housing.js';
import { landDemand } from '../city/LandDemand.js';
import { roadAccess } from '../city/UrbanDevelopment.js';
import { formOf, zoneOf, formLabel, ERA_NAMES } from './ArchitectureData.js';
import { eraForType } from './Architecture.js';
import { unmetNeeds } from './Infrastructure.js';
import { rebuildStages, rebuildCost } from './Modernization.js';
import { applyForPlanning, applicationExecutors } from './Heritage.js';

// Density and wealth: apartment blocks and towers raised by developers (or by
// the council as public housing) and rented out, and mansions commissioned by
// the wealthiest families. Every site is acquired legally (a plot on the
// market, or an owner who accepts an offer), every scheme goes through
// planning, and tall buildings need the district's utilities and transit.

const HOMES = ['apartment', 'tower', 'mansion'];
const isRental = (p) => p.building?.rental && ['apartment', 'tower'].includes(p.building.type) && p.constructionStatus === 'COMPLETE';

/** Two plots are neighbours if they are close and in the same district. */
const neighbours = (a, b) => a !== b && a.district === b.district && Math.hypot(a.x - b.x, a.z - b.z) <= 12.5;

/** Can `buyer` acquire this plot legally right now? Returns a price or null. */
export function acquirable(state, plot, buyerId) {
  if (plot.projectId || plot.ownerId === buyerId) return plot.ownerId === buyerId && !plot.projectId ? 0 : null;
  if (state.civ.heritage?.listed?.[plot.id]) return null;
  if (plot.businessId || plot.residents.length) return null;
  if (plot.marketStatus === 'FOR_SALE' && !(plot.reservedBy && plot.reservedBy !== buyerId && plot.reservedUntil > state.tick)) return plot.price;
  // An owner who neither lives nor trades there may accept a generous offer.
  const owner = byId(state.citizens, plot.ownerId);
  if (owner && plot.building && !owner.away && (trait(owner, 'greedy') + trait(owner, 'ambitious') > 0.5 || ageOf(state, owner) >= 65)) return Math.round(plotValue(plot) * 1.3);
  return null;
}

/** Complete a purchase (a listed plot, or an accepted offer). */
function acquire(state, plot, buyerId, price) {
  if (plot.ownerId === buyerId) return true;
  if (plot.marketStatus !== 'FOR_SALE') {
    const seller = byId(state.citizens, plot.ownerId);
    listForSale(state, plot.id, price);
    if (seller) remember(state, seller, `Accepted an offer of ${price} coins for ${plot.name}.`, 2, 'property');
  }
  return buyPlot(state, plot.id, buyerId).ok;
}

function siteCost(state, sites, buyerId) {
  let land = 0;
  for (const p of sites) { const price = acquirable(state, p, buyerId); if (price === null) return null; land += price; }
  return land;
}

/** Candidate sites for a scheme, best first. */
function sitesFor(state, type, buyerId, era) {
  const zones = type === 'tower' ? ['core'] : type === 'apartment' ? ['core', 'urban'] : ['urban', 'suburban', 'rural'];
  const land = type === 'mansion' ? ['residential', 'farmland'] : ['residential', 'commercial'];
  const ok = (p) => zones.includes(zoneOf(p)) && land.includes(p.landType) && allows(p, type) && !p.annexFor && roadAccess(state, p) < 4 &&
    (!p.building || ['cottage', 'ruins', 'stall', 'farm'].includes(p.building.type) && (p.building.era ?? 1) < era) && !unmetNeeds(state, p, type, era).length &&
    !projectRules.veto?.(state, p, p.building ? 'rebuild' : 'construction', type);
  const out = [];
  for (const p of state.plots) {
    if (!ok(p)) continue;
    const pricedMain = acquirable(state, p, buyerId);
    if (pricedMain === null) continue;
    if (type === 'apartment') { out.push({ main: p, annex: null }); continue; }
    const annexLand = type === 'tower' ? ['residential', 'commercial', 'workshop'] : land;
    const annex = state.plots.find((q) => neighbours(p, q) && annexLand.includes(q.landType) && !q.annexFor && (!q.building || ['cottage', 'ruins', 'stall', 'farm'].includes(q.building.type)) && acquirable(state, q, buyerId) !== null && !projectRules.veto?.(state, q, q.building ? 'demolition' : 'construction', 'grounds'));
    if (annex) out.push({ main: p, annex });
  }
  // Prefer cheap land near the centre for density; quiet, roomy land for mansions.
  const r = (p) => Math.hypot(p.x, p.z);
  return out.sort((a, b) => (type === 'mansion' ? r(b.main) - r(a.main) : r(a.main) - r(b.main)) || a.main.id.localeCompare(b.main.id)).slice(0, 4);
}

function schemeCost(state, site, type, era) {
  const stages = rebuildStages(type, era, { demolish: !!site.main.building });
  const build = rebuildCost(stages);
  const land = siteCost(state, [site.main, site.annex].filter(Boolean), site.buyerId);
  return land === null ? null : { stages, build, land, total: build + land + (site.annex?.building ? 30 : 0) };
}

const busyDevelopers = (state) => new Set(state.civ.applications.filter((a) => !['DONE', 'REFUSED', 'LAPSED'].includes(a.status)).map((a) => a.applicantId));
const countType = (state, type) => state.plots.filter((p) => p.building?.type === type || (p.projectId && state.projects.find((x) => x.id === p.projectId)?.buildingType === type)).length;

/** Every few days: a developer (or the council) may put forward a scheme. */
export function considerSchemes(state, finance = {}) {
  if (state.day % CIV.developEveryDays !== 2) return null;
  const civ = state.civ;
  if (civ.applications.some((a) => ['PENDING', 'DISPUTED', 'IN_COURT', 'APPROVED'].includes(a.status))) return null;
  const demand = landDemand(state);
  const funds = finance.funds ?? ((c) => balance(state, c.id));
  const busy = busyDevelopers(state);
  const schemes = [];
  const aptEra = eraForType(state, 'apartment');
  const towerEra = eraForType(state, 'tower');
  // Flats already standing empty damp any new scheme.
  const vacantFlats = state.plots.filter(isRental).reduce((s, p) => s + Math.max(0, bedsAt(state, p) - p.residents.length), 0);
  if (formOf('apartment', aptEra).era === aptEra && aptEra >= 2 && vacantFlats < 8 && (demand.housingShortage >= 2 || demand.hallFamilies >= 2)) schemes.push(['apartment', aptEra]);
  // Towers: in the Metropolitan Age developers build ahead of demand in the centre, a few at a time.
  const towers = countType(state, 'tower');
  const skyline = (civ.age >= 4 ? 2 + (civ.age - 4) * 3 : 1);
  if (formOf('tower', towerEra).era === towerEra && towerEra >= 3 && towers < Math.min(CIV.maxTowers, skyline) && vacantFlats < 20 && (demand.housingShortage >= 1 || civ.age >= 4)) schemes.push(['tower', towerEra]);
  for (const [type, era] of schemes) {
    // Developers: ambitious citizens with capital; failing that the council builds public housing.
    const devs = state.citizens.filter((c) => !busy.has(c.id) && !c.away && !c.retired && ageOf(state, c) >= 25)
      .map((c) => ({ c, money: funds(c), appetite: trait(c, 'ambitious') + trait(c, 'riskTaking') * 0.6 + trait(c, 'greedy') * 0.5 - trait(c, 'frugal') * 0.5 }))
      .filter((x) => x.appetite > 0.55 && x.money >= 150).sort((a, b) => b.money - a.money || a.c.id.localeCompare(b.c.id));
    for (const d of devs.slice(0, 3)) {
      const site = sitesFor(state, type, d.c.id, era)[0];
      if (!site) break;
      site.buyerId = d.c.id;
      const cost = schemeCost(state, site, type, era);
      if (!cost || d.money < cost.total * (type === 'tower' ? 0.6 : 0.75)) continue;
      if (!chance(state, Math.min(0.7, 0.25 + d.appetite * 0.3))) continue;
      return applyForPlanning(state, { kind: 'scheme', type, era, applicantId: d.c.id, plotIds: [site.main.id], annexId: site.annex?.id ?? null, cost, purpose: 'rental' });
    }
    if (type === 'apartment' && demand.housingShortage >= 3) {
      const site = sitesFor(state, type, 'council', era)[0];
      if (site) {
        site.buyerId = 'council';
        const cost = schemeCost(state, site, type, era);
        if (cost && balance(state, 'treasury') >= cost.total + 250) return applyForPlanning(state, { kind: 'scheme', type, era, applicantId: 'council', plotIds: [site.main.id], annexId: null, cost, purpose: 'rental' });
      }
    }
  }
  // Mansions: a wealthy family that wants a grand home, has the money and does not have one.
  if (countType(state, 'mansion') < CIV.maxMansions && state.day % (CIV.developEveryDays * 3) === 2) {
    const era = eraForType(state, 'mansion');
    const rich = state.citizens.filter((c) => !busy.has(c.id) && !c.away && ageOf(state, c) >= 28 && !state.plots.some((p) => p.ownerId === c.id && p.building?.type === 'mansion'))
      .map((c) => ({ c, money: funds(c), want: trait(c, 'ambitious') * 0.6 + trait(c, 'greedy') * 0.5 + (c.dream?.type === 'wealth' || c.dream?.type === 'homestead' ? 0.4 : 0) + trait(c, 'creative') * 0.2 - trait(c, 'frugal') * 0.6 - trait(c, 'generous') * 0.2 }))
      .filter((x) => x.money >= 420 && x.want > 0.45).sort((a, b) => b.money - a.money || a.c.id.localeCompare(b.c.id));
    for (const r of rich.slice(0, 2)) {
      const site = sitesFor(state, 'mansion', r.c.id, era)[0];
      if (!site) break;
      site.buyerId = r.c.id;
      const cost = schemeCost(state, site, 'mansion', era);
      if (!cost || r.money < cost.total * 1.25) continue;
      if (!chance(state, Math.min(0.6, r.want * 0.6))) continue;
      return applyForPlanning(state, { kind: 'scheme', type: 'mansion', era, applicantId: r.c.id, plotIds: [site.main.id], annexId: site.annex.id, cost, purpose: 'mansion' });
    }
  }
  return null;
}

/** An approved scheme: buy the land, then demolish and build (or simply build). */
applicationExecutors.scheme = (state, app, finance = {}) => {
  const main = plotById(state, app.plotIds[0]);
  const annex = app.annexId ? plotById(state, app.annexId) : null;
  const buyer = app.applicantId;
  const acct = ownerAccount(buyer);
  const c = byId(state.citizens, buyer);
  const cost = schemeCost(state, { main, annex, buyerId: buyer }, app.type, app.era);
  if (!cost) return 'the land is no longer available';
  if (c && balance(state, acct) < cost.total && finance.raise) finance.raise(state, c.id, cost.total);
  if (c && balance(state, acct) < cost.total && finance.borrow) finance.borrow(state, c, cost.total - balance(state, acct) + 2, main);
  if (balance(state, acct) < cost.total) return 'the money could not be raised';
  for (const p of [main, annex].filter(Boolean)) {
    const price = acquirable(state, p, buyer);
    if (price === null || !acquire(state, p, buyer, price)) return `${p.name} could not be bought`;
  }
  const stages = rebuildStages(app.type, app.era, { demolish: !!main.building });
  const label = formOf(app.type, app.era).labels[0];
  const res = main.building
    ? startProject(state, { plotId: main.id, ownerId: buyer, kind: 'rebuild', buildingType: app.type, stages, targetEra: app.era, contractors: app.era >= 3, purpose: app.purpose, note: `clearing the old ${formLabel(main.building).toLowerCase()} for a ${label.toLowerCase()}` })
    : startProject(state, { plotId: main.id, ownerId: buyer, kind: 'construction', buildingType: app.type, stages, targetEra: app.era, contractors: app.era >= 3, purpose: app.purpose });
  if (!res.ok) return `work could not start (${res.reason})`;
  if (annex) {
    annex.annexFor = main.id;
    if (annex.building) startProject(state, { plotId: annex.id, ownerId: buyer, kind: 'demolition' });
    else setBuilding(state, annex, 'grounds', app.type === 'mansion' ? 'Estate grounds' : 'Tower plaza');
    annex.marketStatus = 'NOT_FOR_SALE';
  }
  app.projectId = res.project.id;
  state.civ.stats.schemes++;
  return null;
};

/** Daily: grounds annexes are laid out once their land is clear. */
function layOutGrounds(state) {
  for (const p of state.plots) {
    if (!p.annexFor || p.building || p.projectId) continue;
    const main = plotById(state, p.annexFor);
    if (!main || main.ownerId !== p.ownerId) { delete p.annexFor; continue; }
    setBuilding(state, p, 'grounds', main.building?.type === 'mansion' || state.projects.find((x) => x.plotId === main.id)?.buildingType === 'mansion' ? 'Estate grounds' : 'Tower plaza');
    p.marketStatus = 'NOT_FOR_SALE';
  }
}

completionHooks.rental = (state, plot, project) => {
  plot.building.rental = true;
  plot.marketStatus = 'NOT_FOR_SALE';
  const owner = byId(state.citizens, project.ownerId);
  const f = formOf(plot.building.type, plot.building.era);
  state.civ.stats[plot.building.type === 'tower' ? 'towers' : 'apartments']++;
  record(state, 'property', `${formLabel(plot.building)} on ${plot.name} opened: ${bedsAt(state, plot)} homes to rent across ${plot.building.floors} storeys${owner ? `, built by ${owner.firstName} ${owner.lastName}` : ', public housing built by the council'}.${f.tall ? ' The skyline has changed.' : ''}`,
    { citizens: owner ? [owner.id] : [], plot: plot.id }, f.tall ? 3 : 2);
};

completionHooks.mansion = (state, plot, project) => {
  const owner = byId(state.citizens, project.ownerId);
  state.civ.stats.mansions++;
  if (!owner) return;
  const family = householdOf(state, owner);
  for (const m of family) moveHome(state, m, plot);
  plot.marketStatus = 'NOT_FOR_SALE';
  remember(state, owner, `Moved the family into our ${formLabel(plot.building).toLowerCase()} on ${plot.name}.`, 3, 'milestone');
  owner.mood = Math.min(100, owner.mood + 18);
  record(state, 'property', `The ${owner.lastName} family moved into their new ${formLabel(plot.building).toLowerCase()} on ${plot.name}, with its own grounds (${ERA_NAMES[plot.building.era]} architecture, ${project.materialsPaid + project.labourPaid} coins).`, { citizens: family.map((m) => m.id), plot: plot.id }, 3);
};

/**
 * Daily: rented homes. Families in the communal hall (or without a home) who
 * can pay move into flats with free beds; rent is collected each day and goes
 * to the owner (the treasury for public housing); arrears end in eviction.
 */
export function rentalHousing(state) {
  const rentals = state.plots.filter(isRental);
  if (!rentals.length) return;
  const civ = state.civ;
  for (const p of rentals) {
    const owner = ownerAccount(p.ownerId);
    const seen = new Set();
    for (const id of [...p.residents]) {
      const c = byId(state.citizens, id);
      if (!c || seen.has(id)) continue;
      const fam = householdOf(state, c).filter((m) => p.residents.includes(m.id));
      fam.forEach((m) => seen.add(m.id));
      if (fam.some((m) => m.id === p.ownerId)) continue;
      const payer = fam.filter((m) => ageOf(state, m) >= LIFE.adultAge).sort((a, b) => balance(state, b.id) - balance(state, a.id))[0];
      if (!payer) continue;
      const rent = CIV.rentPerDay;
      const earning = fam.some((m) => m.employment);
      // Public housing charges only households with a wage, and never evicts.
      if (p.ownerId === 'council' && !earning) continue;
      if (balance(state, payer.id) >= rent + 2 && transfer(state, payer.id, owner, rent, 'property', `Rent for a flat at ${p.name}`)) { payer.rentArrears = 0; civ.stats.rentPaid += rent; continue; }
      payer.rentArrears = (payer.rentArrears ?? 0) + 1;
      if (p.ownerId !== 'council' && payer.rentArrears > CIV.evictAfterDays) {
        for (const m of fam) { p.residents = p.residents.filter((x) => x !== m.id); m.homePlotId = null; m.rentArrears = 0; }
        civ.stats.evictions++;
        remember(state, payer, `Could not pay the rent at ${p.name} and had to leave.`, 3, 'loss');
      }
    }
  }
  // Move families out of the communal hall into flats they can afford.
  const free = (p) => bedsAt(state, p) - p.residents.length;
  for (const c of state.citizens) {
    if (ageOf(state, c) < LIFE.adultAge) continue;
    const home = plotById(state, c.homePlotId);
    if (home && !['hall', 'townhall'].includes(home.building?.type)) continue;
    const fam = householdOf(state, c);
    const adults = fam.filter((m) => ageOf(state, m) >= LIFE.adultAge);
    // Households with a wage take a private tenancy; anyone may have a council flat.
    const earning = adults.some((m) => m.employment);
    const flat = rentals.find((p) => free(p) >= fam.length && (earning || p.ownerId === 'council'));
    if (!flat) continue;
    for (const m of fam) moveHome(state, m, flat);
    civ.stats.tenancies++;
  }
}

/** Daily work of this module. */
export function dailyDensity(state, finance) {
  layOutGrounds(state);
  rentalHousing(state);
  considerSchemes(state, finance);
}

export function densityStats(state) {
  const homes = state.plots.filter((p) => HOMES.includes(p.building?.type));
  return {
    apartments: homes.filter((p) => p.building.type === 'apartment').length,
    towers: homes.filter((p) => p.building.type === 'tower').length,
    mansions: homes.filter((p) => p.building.type === 'mansion').length,
    rentalBeds: state.plots.filter(isRental).reduce((s, p) => s + bedsAt(state, p), 0),
    renters: state.plots.filter(isRental).reduce((s, p) => s + p.residents.length, 0),
  };
}

export { BUILDING_INFO, plotHistory };
