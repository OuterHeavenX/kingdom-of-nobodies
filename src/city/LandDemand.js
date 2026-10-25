import { bedsAt } from '../property/LandRegistry.js';
import { isTrading } from '../economy/Businesses.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE } from '../core/Config.js';
import { balance } from '../economy/Transactions.js';
import { villageFood } from '../economy/Marketplace.js';
import { ensureNavigation } from '../navigation/Traffic.js';
import { roadRect } from '../navigation/RoadNetwork.js';
import { cellOf, CELL } from '../navigation/NavigationGrid.js';
import { householdOf } from '../population/Housing.js';

// What the town needs, measured from its actual state: people without beds,
// shops per head, unfilled jobs, food stocks, land on the market and how
// crowded the roads are. Planners and developers act on these numbers, and
// the City panel shows them.

const SHOPS = ['bakery', 'general_store', 'tavern', 'blacksmith'];

export function landDemand(state) {
  const pop = state.citizens.length;
  const beds = state.plots.reduce((s, p) => s + bedsAt(state, p), 0);
  const homeless = state.citizens.filter((c) => !c.homePlotId).length;
  const adults = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge).length;
  const unemployed = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge && !c.employment && !c.retired && !c.away).length;
  const openings = state.businesses.filter(isTrading).reduce((s, b) => s + (b.openings ?? 0), 0);
  const shops = state.businesses.filter((b) => isTrading(b) && SHOPS.includes(b.type)).length;
  const workshops = state.businesses.filter((b) => isTrading(b) && ['blacksmith', 'lumberyard'].includes(b.type)).length;
  const vacant = (type) => state.plots.filter((p) => p.landType === type && !p.building && !p.projectId && p.marketStatus === 'FOR_SALE').length;
  const growth = state.yearly?.length >= 2 ? (state.yearly.at(-1).population ?? pop) - (state.yearly.at(-2).population ?? pop) : 0;
  // Housing shortage, in homes: the homeless, families squeezed into the communal hall,
  // and the year's growth, less finished cottages standing empty.
  let hallFamilies = 0;
  const seen = new Set();
  for (const p of state.plots.filter((x) => x.building?.type === 'hall' || x.building?.type === 'townhall')) {
    for (const id of p.residents) {
      const c = state.citizens.find((x) => x.id === id);
      if (!c || seen.has(c.id) || ageOf(state, c) < LIFE.adultAge) continue;
      const fam = householdOf(state, c);
      fam.forEach((m) => seen.add(m.id));
      hallFamilies += fam.length >= 2 ? 1 : 0.25;
    }
  }
  const emptyHomes = state.plots.filter((p) => p.building?.type === 'cottage' && p.constructionStatus === 'COMPLETE' && !p.residents.length && !p.businessId && (p.ownerId === 'council' || p.marketStatus === 'FOR_SALE')).length;
  const housingShortage = Math.max(0, Math.round(homeless / 2 + hallFamilies + Math.max(0, growth) / 4 - emptyHomes));
  const vacantResidential = vacant('residential');
  const vacantCommercial = vacant('commercial');
  const commercialDemand = Math.round((pop / 14 / Math.max(1, shops + vacantCommercial)) * 100) / 100;
  const workshopDemand = Math.round((pop / 30 / Math.max(1, workshops + vacant('workshop'))) * 100) / 100;
  const foodDemand = Math.round((pop * 1.5 / Math.max(1, villageFood(state))) * 100) / 100;
  const forSale = state.plots.filter((p) => p.marketStatus === 'FOR_SALE');
  const landPrice = forSale.length ? Math.round(forSale.reduce((s, p) => s + p.price, 0) / forSale.length) : 0;
  return {
    population: pop, adults, beds, homeless, hallFamilies, emptyHomes, housingShortage, growth, vacantResidential, vacantCommercial,
    commercialDemand, workshopDemand, foodDemand, unemployed, openings, landPrice,
    congestion: congestion(state), treasury: balance(state, 'treasury'),
  };
}

/** Average recent trips per road cell across the network, and the busiest road. */
export function congestion(state) {
  const t = ensureNavigation(state).traffic;
  let busiest = null, total = 0, cells = 0;
  for (const r of state.roads ?? []) {
    const q = roadRect(r);
    let sum = 0, n = 0;
    for (let x = q[0] + 1; x < q[2]; x += CELL) for (let z = q[1] + 1; z < q[3]; z += CELL) { sum += t[cellOf(x, z)] ?? 0; n++; }
    total += sum; cells += n;
    const avg = sum / Math.max(1, n);
    if (!busiest || avg > busiest.avg) busiest = { id: r.id, name: r.name, avg: Math.round(avg) };
  }
  return { average: Math.round(total / Math.max(1, cells)), busiest };
}
