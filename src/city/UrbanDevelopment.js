import { CITY, LIFE } from '../core/Config.js';
import { balance } from '../economy/Transactions.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { byId } from '../core/EntityRegistry.js';
import { plotById, frontOf, plotHistory } from '../property/LandRegistry.js';
import { buyPlot, listForSale, saleHooks } from '../property/Ownership.js';
import { startProject, estimateMaterialsCost, completionHooks } from '../property/Construction.js';
import { roadRect } from '../navigation/RoadNetwork.js';
import { STAGES, BUILD, ECONOMY } from '../core/Config.js';
import { householdOf } from '../population/Housing.js';
import { landDemand } from './LandDemand.js';
import { ensureCity } from './CityPlanner.js';

// Private development. When families are short of homes, a citizen with
// capital (their own, or borrowed from a bank) may buy a house plot that a
// road already reaches, pay builders to raise a cottage, and sell it. They
// only go ahead when the numbers work: there must be households in the hall
// or in borrowed beds who could afford the asking price. The number of
// speculative homes under way at once is capped, so a boom cannot run away.

const LABOUR_SHIFTS = Math.ceil(STAGES.reduce((s, x) => s + x.work, 0) / BUILD.builderWorkPerShift);

/** Distance from a plot's front door to the nearest road. */
export function roadAccess(state, plot) {
  const door = frontOf(plot, 0, 0.4);
  let best = Infinity;
  for (const r of state.roads) {
    const [a, b, c, d] = roadRect(r);
    const dx = Math.max(a - door.x, 0, door.x - c), dz = Math.max(b - door.z, 0, door.z - d);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

export const buildCost = (state, plot) => plot.price + estimateMaterialsCost(state, 'construction') + LABOUR_SHIFTS * BUILD.builderWage;

/** Households living in the hall or in someone else's house who could pay `price` (cash and savings). */
export function prospectiveBuyers(state, price, funds = (c) => balance(state, c.id)) {
  const seen = new Set();
  let n = 0;
  for (const c of state.citizens) {
    if (seen.has(c.id) || ageOf(state, c) < LIFE.adultAge) continue;
    const family = householdOf(state, c);
    family.forEach((m) => seen.add(m.id));
    const home = plotById(state, c.homePlotId);
    const owns = home && family.some((m) => m.id === home.ownerId);
    if (owns) continue;
    const money = family.filter((m) => ageOf(state, m) >= LIFE.adultAge).reduce((s, m) => s + funds(m), 0);
    if (money >= price) n++;
  }
  return n;
}

const activeDevelopments = (state) => ensureCity(state).developments.filter((d) => d.status === 'BUILDING' || d.status === 'LISTED');

/**
 * Every third day: a developer may start one speculative cottage.
 * `funds(c)` reports what a citizen could spend (cash plus deposits); `finance`
 * may top a developer up with a loan (supplied by the finance system).
 */
export function considerDevelopment(state, { funds = (c) => balance(state, c.id), raise = null, borrow = null } = {}) {
  if (state.day % 3 !== 1) return null;
  const demand = landDemand(state);
  if (demand.housingShortage < 1) return null;
  if (activeDevelopments(state).length >= CITY.maxSpeculativeHomes) return null;
  const land = state.plots.filter((p) => p.landType === 'residential' && !p.building && !p.projectId && p.marketStatus === 'FOR_SALE' && roadAccess(state, p) < 4)
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
  if (!land) return null;
  const cost = buildCost(state, land);
  const ask = Math.round(cost * CITY.homeSalePremium);
  const buyers = prospectiveBuyers(state, ask, funds);
  if (buyers < 1) return null;
  const busy = new Set(activeDevelopments(state).map((d) => d.developerId));
  const dev = state.citizens
    .filter((c) => ageOf(state, c) >= 25 && !c.away && !busy.has(c.id) && !c.retired)
    .map((c) => ({ c, appetite: trait(c, 'ambitious') + trait(c, 'riskTaking') + trait(c, 'greedy') * 0.5 - trait(c, 'frugal') * 0.6 + (c.skills.building ?? 0) * 0.5, money: funds(c) }))
    .filter((x) => x.appetite > 0.5 && x.money >= Math.max(CITY.developerMinWealth, cost * 0.6))
    .sort((a, b) => b.appetite - a.appetite || b.money - a.money || a.c.id.localeCompare(b.c.id))[0];
  if (!dev) return null;
  const c = dev.c;
  // Builders are only so many: no new speculative site while the village's building sites are full.
  if (state.projects.filter((p) => byId(state.citizens, p.ownerId)).length >= ECONOMY.maxActiveProjects) return null;
  // Make the money liquid: withdraw savings, then borrow any remaining shortfall.
  if (balance(state, c.id) < cost && raise) raise(state, c.id, cost);
  if (balance(state, c.id) < cost && borrow) borrow(state, c, cost - balance(state, c.id), land);
  if (balance(state, c.id) < cost) return null;
  const bought = buyPlot(state, land.id, c.id);
  if (!bought.ok) return null;
  const res = startProject(state, { plotId: land.id, ownerId: c.id, kind: 'construction', buildingType: 'cottage', purpose: 'sale' });
  if (!res.ok) { listForSale(state, land.id, land.boughtFor); return null; }
  const city = ensureCity(state);
  const d = { id: 'dv' + (city.developments.length + 1) + '-' + state.day, developerId: c.id, plotId: land.id, projectId: res.project.id, landCost: bought.price, status: 'BUILDING', startDay: state.day, ask, buyers };
  city.developments.push(d);
  if (city.developments.length > 40) city.developments = city.developments.filter((x) => x.status === 'BUILDING' || x.status === 'LISTED').concat(city.developments.filter((x) => x.status !== 'BUILDING' && x.status !== 'LISTED').slice(-25));
  remember(state, c, `Bought ${land.name} to build a cottage for sale.`, 2, 'property');
  record(state, 'property', `${c.firstName} ${c.lastName} began developing ${land.name}: a cottage for sale (about ${cost} coins to build, asking ${ask}); ${buyers} household${buyers === 1 ? '' : 's'} in need of a home could afford it.`, { citizens: [c.id], plot: land.id }, 2);
  return d;
}

completionHooks.sale = (state, plot, project) => {
  const d = ensureCity(state).developments.find((x) => x.projectId === project.id);
  const basis = (d?.landCost ?? plot.boughtFor ?? 0) + project.materialsPaid + project.labourPaid;
  const ask = Math.max(d?.ask ?? 0, Math.round(basis * CITY.homeSalePremium));
  listForSale(state, plot.id, ask);
  plotHistory(state, plot, `A new cottage, built to sell, was put on the market for ${ask} coins.`);
  if (d) { d.status = 'LISTED'; d.basis = basis; d.listedDay = state.day; }
  const owner = byId(state.citizens, project.ownerId);
  record(state, 'property', `A new cottage on ${plot.name} is finished and for sale at ${ask} coins${owner ? ` by ${owner.firstName}` : ''}.`, { citizens: owner ? [owner.id] : [], plot: plot.id }, 2);
};

saleHooks.push((state, plot, sellerId, price) => {
  const d = state.city?.developments.find((x) => x.plotId === plot.id && x.status === 'LISTED');
  if (!d) return;
  d.status = 'SOLD';
  d.soldDay = state.day;
  d.price = price;
  d.profit = price - (d.basis ?? price);
  const dev = byId(state.citizens, sellerId);
  if (dev) remember(state, dev, `Sold the cottage I built on ${plot.name} for ${price} coins (${d.profit >= 0 ? `a profit of ${d.profit}` : `a loss of ${-d.profit}`}).`, 2, 'property');
});
