import { CITY } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { makePlot, LAND_TYPES } from '../property/LandRegistry.js';
import { record } from '../society/Chronicle.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE } from '../core/Config.js';
import { estimate, proposeRoad, roadCompletionHooks } from '../navigation/RoadConstruction.js';
import { BLOCKS, needsLand, SURVEY_COST, districtCharacter, FIXED_DISTRICTS } from '../population/Expansion.js';
import { yearOf, isNewYear } from '../core/Calendar.js';
import { landDemand } from './LandDemand.js';
import { bestStreet, trimStreet, STREET_KIND } from './RoadPlanner.js';

// Municipal planning. Once the hand-surveyed districts of the old town are
// taken, the town grows street by street: the planner measures demand, finds
// the best new street that fits the land, and puts a costed proposal to the
// council. The council approves it, modifies it to fit the budget, or rejects
// it. An approved street is built by the Village Works crew like any other
// road; only when it is finished are the plots along it surveyed and put on
// the market, so every new neighbourhood is reachable on foot.

export { FIXED_DISTRICTS };
const NAMES = ['Ashford', 'Cobble End', 'Larkrise', 'Mill Green', 'Fernhollow', 'Stonegate', 'Wrenfield', 'Oakhurst', 'Badger Row', 'Hollins',
  'Tanners Way', 'Brightwater', 'Kestrel Hill', 'Saffron Walk', 'Thornbury', 'Elmstead', 'Goose Green', 'Harrow Lane', 'Copperfold', 'Wychwood'];

const PLAN_RESERVE = 60;
/** How the council can raise money for a plan (set by the finance system). */
export const financing = { borrow: null };

export function ensureCity(state) {
  if (state.city) return state.city;
  state.city = { proposals: [], districts: {}, decisions: [], nextId: 0, developments: [], rezonings: [] };
  for (const name of ['Old Town', ...(state.districts?.opened ?? [])]) {
    state.city.districts[name] = { name, origin: name === 'Old Town' ? 'founding' : 'surveyed', foundedDay: 1, identity: districtCharacter(state, name), history: [] };
  }
  return state.city;
}

export const fixedBlocksLeft = (state) => (state.districts?.opened?.length ?? 0) < FIXED_DISTRICTS && BLOCKS.some((b) => !(state.districts?.opened ?? []).includes(b.name));

const plannedCount = (state) => Object.values(ensureCity(state).districts).filter((d) => d.origin === 'planned').length;

function decide(state, p, status, why) {
  const city = ensureCity(state);
  p.status = status;
  p.decision = why;
  p.decidedDay = state.day;
  city.decisions.push({ day: state.day, proposal: p.id, name: p.name, status, why });
  if (city.decisions.length > 40) city.decisions.shift();
}

function districtName(state) {
  const taken = new Set([...Object.keys(ensureCity(state).districts), ...state.plots.map((p) => p.district), ...ensureCity(state).proposals.map((p) => p.name)]);
  return NAMES.find((n) => !taken.has(n)) ?? `New Quarter ${ensureCity(state).nextId + 1}`;
}

/** Costs and benefits the council weighs, all from real prices and plot sizes. */
function appraise(plan) {
  const road = estimate(STREET_KIND, plan.road.w, plan.road.d);
  const homes = plan.plots.filter((p) => p.landType === 'residential').length;
  const beds = homes * 4;
  const shops = plan.plots.filter((p) => p.landType === 'commercial').length;
  const landValue = plan.plots.reduce((s, p) => s + LAND_TYPES[p.landType].base, 0);
  return { roadCoins: road.coins, work: road.work, survey: SURVEY_COST, total: road.coins + SURVEY_COST, beds, homes, shops, landValue };
}

/** Every few days: if the town is short of land, draw up a street plan. */
export function planCity(state) {
  const city = ensureCity(state);
  if (state.day % CITY.reviewEveryDays !== 0) return null;
  if (fixedBlocksLeft(state)) return null;
  if (city.proposals.some((p) => ['PROPOSED', 'APPROVED', 'BUILDING'].includes(p.status))) return null;
  if (plannedCount(state) >= CITY.maxProceduralDistricts) return null;
  const demand = landDemand(state);
  const short = needsLand(state) || (demand.housingShortage >= 2 && demand.vacantResidential < 2);
  if (!short) return null;
  const plan = bestStreet(state, demand);
  if (!plan) {
    if (!city.noLandNoted) { city.noLandNoted = state.day; record(state, 'property', 'The town planners found no more open land in the valley that a street could reach.', {}, 2); }
    return null;
  }
  const name = districtName(state);
  const p = {
    id: 'cp' + ++city.nextId, name, status: 'PROPOSED', proposedDay: state.day, parentRoad: plan.parentId, side: plan.side,
    road: { ...plan.road, kind: STREET_KIND }, plots: plan.plots, reason: demand.homeless ? `${demand.homeless} villagers have no home and the market has ${demand.vacantResidential} house plots` : `the town is about ${demand.housingShortage} homes short`,
    demand: { homeless: demand.homeless, shortage: demand.housingShortage, commercial: demand.commercialDemand },
  };
  p.appraisal = appraise(p);
  city.proposals.push(p);
  if (city.proposals.length > 30) city.proposals = city.proposals.filter((x) => ['PROPOSED', 'APPROVED', 'BUILDING'].includes(x.status)).concat(city.proposals.filter((x) => !['PROPOSED', 'APPROVED', 'BUILDING'].includes(x.status)).slice(-20));
  record(state, 'property', `The town planners proposed ${name}: a ${Math.round(Math.max(p.road.w, p.road.d))}-pace street with ${p.plots.length} plots (${p.appraisal.beds} beds, ${p.appraisal.shops} shops), costing about ${p.appraisal.total} coins, because ${p.reason}.`, {}, 2);
  return p;
}

/** Daily: the council takes up the open street proposal. */
export function reviewPlans(state) {
  const city = ensureCity(state);
  const p = city.proposals.find((x) => x.status === 'PROPOSED');
  if (!p) return null;
  // Streets that open land pay for themselves through plot sales, so the council keeps a smaller reserve for them.
  let spare = balance(state, 'treasury') - PLAN_RESERVE;
  const works = state.government?.policies?.publicWorks ?? true;
  if (!works) { decide(state, p, 'REJECTED', 'The government has ended public works.'); record(state, 'council', `The council rejected the plan for ${p.name}: public works have been ended.`, {}, 2); return p; }
  if (spare >= p.appraisal.total) return approve(state, p, `Approved: ${p.appraisal.beds} beds for ${p.appraisal.total} coins.`);
  // Short of funds: borrow from a bank against the land the street will open.
  if (!p.loanAsked && financing.borrow) {
    p.loanAsked = state.day;
    const loan = financing.borrow(state, p.appraisal.total - spare, { purpose: `to build ${p.name} Street`, security: p.appraisal.landValue });
    if (loan) { p.loanId = loan.id; spare = balance(state, 'treasury') - PLAN_RESERVE; if (spare >= p.appraisal.total) return approve(state, p, `Approved with a bank loan of ${loan.principal} coins.`); }
  }
  // Modify: a shorter street with fewer plots when the full plan is beyond the budget.
  if (spare >= p.appraisal.total * 0.55 && p.plots.length >= 5 && !p.modified) {
    const keep = Math.max(3, Math.floor(p.plots.length * (spare / p.appraisal.total)));
    const smaller = trimStreet(p, keep);
    const before = p.plots.length;
    Object.assign(p, { road: { ...smaller.road, kind: STREET_KIND }, plots: smaller.plots, modified: true });
    p.appraisal = appraise(p);
    record(state, 'council', `The council cut the ${p.name} plan from ${before} plots to ${p.plots.length} to fit the treasury.`, {}, 2);
    if (spare >= p.appraisal.total) return approve(state, p, `Approved after modification: ${p.plots.length} plots for ${p.appraisal.total} coins.`);
  }
  if (state.day - p.proposedDay > 24) { decide(state, p, 'REJECTED', 'Lapsed: the council could not fund it.'); record(state, 'council', `The plan for ${p.name} lapsed; the treasury never had ${p.appraisal.total} coins to spare.`, {}, 1); }
  return p;
}

function approve(state, p, why) {
  // Surveyors are paid now: local labourers if any are free, otherwise outside crews.
  const crews = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge && !c.retired && !c.away && (!c.employment || c.profession === 'Builder')).slice(0, 4);
  if (crews.length) { const each = Math.floor(SURVEY_COST / crews.length); for (const c of crews) transfer(state, 'treasury', c.id, each, 'construction', `Surveying ${p.name}`); }
  else transfer(state, 'treasury', 'outside', SURVEY_COST, 'construction', `Outside surveyors for ${p.name}`);
  const road = proposeRoad(state, { kind: STREET_KIND, name: `${p.name} Street`, x: p.road.x, z: p.road.z, w: p.road.w, d: p.road.d, reason: `the new ${p.name} district`, proposedBy: 'council', cityPlan: p.id, preApproved: true });
  if (!road) { decide(state, p, 'REJECTED', 'The street could not be laid out (the land is no longer clear).'); return p; }
  p.roadProjectId = road.id;
  decide(state, p, 'APPROVED', why);
  record(state, 'council', `The council approved ${p.name}. The Village Works crew will lay ${road.name}; ${p.plots.length} plots open when it is finished.`, {}, 3);
  return p;
}

/** A finished street opens its district: plots are surveyed onto the land registry. */
function onRoadComplete(state, project) {
  if (!project.cityPlan) return;
  const city = ensureCity(state);
  const p = city.proposals.find((x) => x.id === project.cityPlan);
  if (!p || p.status === 'COMPLETE') return;
  p.status = 'COMPLETE';
  p.completedDay = state.day;
  for (const [i, spec] of p.plots.entries()) {
    const plot = makePlot(state, { name: `${p.name} ${i + 1}`, x: spec.x, z: spec.z, w: spec.w, d: spec.d, landType: spec.landType, district: p.name });
    plot.facing = spec.facing;
    plot.history.push({ day: state.day, text: `Surveyed when ${p.name} Street was finished.` });
  }
  city.districts[p.name] = { name: p.name, origin: 'planned', foundedDay: state.day, identity: 'open land', history: [{ day: state.day, identity: 'open land', why: 'surveyed' }], streetId: state.roads.at(-1)?.id ?? null };
  state.districts = state.districts ?? { opened: [] };
  if (!state.districts.opened.includes(p.name)) state.districts.opened.push(p.name);
  record(state, 'property', `${p.name} Street is open. ${p.plots.length} new plots in ${p.name} are for sale (Year ${yearOf(state.day)}).`, {}, 3);
}
roadCompletionHooks.push(onRoadComplete);

// --- District identity and zoning ----------------------------------------------------

/** Yearly: each district's identity follows what stands there; changes are remembered. */
export function reviewDistricts(state) {
  const city = ensureCity(state);
  if (!isNewYear(state.day)) return;
  const names = new Set(state.plots.map((p) => p.district ?? 'Old Town'));
  for (const name of names) {
    const d = city.districts[name] ?? (city.districts[name] = { name, origin: 'surveyed', foundedDay: state.day, identity: 'open land', history: [] });
    const now = districtCharacter(state, name);
    if (now !== d.identity) {
      const was = d.identity;
      d.identity = now;
      d.history.push({ day: state.day, identity: now, why: `was ${was}` });
      if (d.history.length > 12) d.history.shift();
      if (was !== 'open land') record(state, 'property', `${name} has changed character: once ${articled(was)}, it is now ${articled(now)}.`, {}, 2);
    }
  }
  rezone(state);
}

const articled = (s) => (/^(farmsteads|open land)$/.test(s) ? s : `a ${s}`);

/** The council rezones idle land toward what the town actually lacks. */
function rezone(state) {
  const city = ensureCity(state);
  const demand = landDemand(state);
  const idle = (p) => !p.building && !p.projectId && p.marketStatus === 'FOR_SALE' && p.ownerId === 'council' && state.day - (p.listedDay ?? 0) > 12 * 2;
  let change = null;
  if (demand.commercialDemand > 1.6 && demand.vacantCommercial === 0) {
    const p = state.plots.find((x) => x.landType === 'residential' && idle(x) && ['market quarter', 'civic centre'].includes(city.districts[x.district ?? 'Old Town']?.identity));
    if (p) change = [p, 'commercial', 'shops are scarce for the number of people'];
  } else if (demand.housingShortage > 3 && demand.vacantResidential === 0) {
    const p = state.plots.find((x) => (x.landType === 'commercial' || x.landType === 'workshop') && idle(x));
    if (p) change = [p, 'residential', 'families need homes more than the town needs another shopfront'];
  }
  if (!change) return null;
  const [p, to, why] = change;
  const from = p.landType;
  p.landType = to;
  const [w, d] = [p.w, p.d];
  p.price = LAND_TYPES[to].base + Math.round((w * d - 49) * 0.2);
  p.history.push({ day: state.day, text: `Rezoned from ${LAND_TYPES[from].label.toLowerCase()} to ${LAND_TYPES[to].label.toLowerCase()}.` });
  city.rezonings.push({ day: state.day, plot: p.id, from, to, why });
  if (city.rezonings.length > 30) city.rezonings.shift();
  record(state, 'council', `The council rezoned ${p.name} from ${LAND_TYPES[from].label.toLowerCase()} to ${LAND_TYPES[to].label.toLowerCase()}: ${why}.`, { plot: p.id }, 2);
  return p;
}
