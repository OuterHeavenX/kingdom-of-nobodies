import { balance, transfer } from '../economy/Transactions.js';
import { record } from '../society/Chronicle.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE, CIV } from '../core/Config.js';
import { isNewYear } from '../core/Calendar.js';
import { hasTech } from './Technology.js';
import { formOf } from './ArchitectureData.js';

// Utilities as simplified networks. Each network (power, water,
// communications, transit) has a level the town's technology allows, and a
// level actually laid in each district. The council lays networks district by
// district as public works: a real cost, paid day by day to the local crews
// (or outside contractors when nobody is free), and a yearly upkeep. Unpaid
// upkeep lets a district's service decay. Buildings that need more than their
// district provides work at reduced capacity until the network catches up.

export const NETWORKS = {
  power: { label: 'Power', icon: '⚡', levels: ['No power network', 'Gas and local power', 'Electric grid', 'Renewable grid', 'Advanced clean grid'], tech: [null, 'gas_lighting', 'electricity', 'renewables', 'fusion_grid'], cost: 5 },
  water: { label: 'Water', icon: '💧', levels: ['Wells', 'Public wells', 'Water mains', 'Modern sanitation', 'Smart water'], tech: [null, null, 'piped_water', 'sanitation', 'smart_materials'], cost: 5, base: 1 },
  comms: { label: 'Communications', icon: '📡', levels: ['Word of mouth', 'Telegraph', 'Telephone', 'Digital networks', 'Smart infrastructure'], tech: [null, 'telegraph', 'telephone', 'digital_networks', 'smart_infrastructure'], cost: 3 },
  transit: { label: 'Transit', icon: '🚉', levels: ['Walking and carts', 'Railway', 'Bus routes', 'Rapid transit', 'Autonomous transit'], tech: [null, 'railway', 'public_transit', 'rapid_transit', 'autonomous_vehicles'], cost: 6 },
};
export const NETWORK_KEYS = Object.keys(NETWORKS);

/** The highest level the town's technology allows for a network. */
export function maxLevel(state, net) {
  const def = NETWORKS[net];
  let lvl = def.base ?? 0;
  for (let i = 1; i < def.tech.length; i++) if (!def.tech[i] || hasTech(state, def.tech[i])) lvl = Math.max(lvl, i); else break;
  return lvl;
}

const districtsOf = (state) => [...new Set(state.plots.map((p) => p.district))].sort();

/** The service a district actually has. */
export const serviceIn = (state, district, net) => Math.max(NETWORKS[net].base ?? 0, state.civ?.infra?.[net]?.[district] ?? 0);
export const serviceAt = (state, plot, net) => serviceIn(state, plot.district, net);

/** Utility requirements of a form that a plot's district does not meet (empty when it does). */
export function unmetNeeds(state, plot, type, era) {
  const needs = formOf(type, era).needs ?? {};
  return Object.entries(needs).filter(([net, lvl]) => serviceAt(state, plot, net) < lvl).map(([net, lvl]) => `${NETWORKS[net].label.toLowerCase()} level ${lvl}`);
}

/** Share of capacity a standing building can use with the services it has (1 = fully served). */
export function serviceFactor(state, plot) {
  const b = plot.building;
  if (!b) return 1;
  const needs = formOf(b.type, b.era ?? 1).needs ?? {};
  let f = 1;
  for (const [net, lvl] of Object.entries(needs)) if (serviceAt(state, plot, net) < lvl) f -= 0.25 * (lvl - serviceAt(state, plot, net));
  return Math.max(0.4, f);
}

function districtWeight(state, district) {
  return state.plots.filter((p) => p.district === district && p.building).reduce((s, p) => s + 1 + (p.building.floors ?? 1) * 0.3 + (formOf(p.building.type, p.building.era ?? 1).tall ? 3 : 0), 0);
}

/** The next most useful piece of network to lay: where it serves the most buildings. */
function nextWork(state) {
  const options = [];
  for (const net of NETWORK_KEYS) {
    const top = maxLevel(state, net);
    for (const d of districtsOf(state)) {
      const have = serviceIn(state, d, net);
      if (have >= top) continue;
      const weight = districtWeight(state, d);
      if (weight < 1) continue;
      // Demand is higher where buildings already need the next level.
      const want = state.plots.filter((p) => p.district === d && p.building && (formOf(p.building.type, p.building.era ?? 1).needs?.[net] ?? 0) > have).length;
      options.push({ net, district: d, level: have + 1, score: weight + want * 4 - have * 2 + (d === 'Old Town' ? 3 : 0) });
    }
  }
  options.sort((a, b) => b.score - a.score || a.net.localeCompare(b.net) || a.district.localeCompare(b.district));
  return options[0] ?? null;
}

export function workCost(state, net, level, district) {
  const plots = state.plots.filter((p) => p.district === district).length;
  return Math.round(NETWORKS[net].cost * level * (2 + plots * 0.6));
}

/** Pay a day's instalment to local crews (jobless adults or builders), or to outside contractors. */
function payCrews(state, amount, memo) {
  const crews = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge && !c.retired && !c.away && (!c.employment || c.profession === 'Builder')).slice(0, 3);
  if (!crews.length) return transfer(state, 'treasury', 'outside', amount, 'construction', `Contractors: ${memo}`) ? amount : 0;
  const each = Math.floor(amount / crews.length);
  let paid = 0;
  for (const [i, c] of crews.entries()) {
    const n = each + (i === 0 ? amount - each * crews.length : 0);
    if (n > 0 && transfer(state, 'treasury', c.id, n, 'construction', memo)) { paid += n; c.stats.earned += n; }
  }
  return paid;
}

/** Daily: advance the active utility works, or start the next. */
export function dailyInfrastructure(state) {
  const civ = state.civ;
  if (!civ.works.length) {
    const w = nextWork(state);
    if (w) {
      const cost = workCost(state, w.net, w.level, w.district);
      civ.works.push({ id: 'u' + ++civ.nextId, ...w, cost, paid: 0, days: 2 + w.level * 2, done: 0, startDay: state.day, waiting: null });
    }
  }
  for (const w of [...civ.works]) {
    const instalment = Math.min(w.cost - w.paid, Math.ceil(w.cost / w.days));
    if (balance(state, 'treasury') - instalment < CIV.utilityReserve) { w.waiting = 'waiting for the treasury'; continue; }
    w.waiting = null;
    w.paid += payCrews(state, instalment, `${NETWORKS[w.net].label} works in ${w.district}`);
    w.done++;
    if (w.done >= w.days && w.paid >= w.cost) {
      civ.infra[w.net][w.district] = w.level;
      civ.works = civ.works.filter((x) => x !== w);
      civ.stats.utilityWorks++;
      record(state, 'construction', `${NETWORKS[w.net].icon} ${w.district} now has ${NETWORKS[w.net].levels[w.level].toLowerCase()} (${w.cost} coins of public works).`, {}, w.level >= 2 ? 2 : 1);
    }
  }
  if (isNewYear(state.day)) upkeep(state);
}

/** Yearly upkeep of every network. If the council cannot pay, the least-used district loses a level. */
function upkeep(state) {
  const civ = state.civ;
  let due = 0;
  for (const net of NETWORK_KEYS) for (const lvl of Object.values(civ.infra[net])) due += lvl * 0.35;
  due = Math.round(due);
  if (!due) return;
  if (balance(state, 'treasury') >= due && payCrews(state, due, 'Upkeep of the town\'s utilities') >= due) { civ.stats.upkeepPaid += due; return; }
  const candidates = NETWORK_KEYS.flatMap((net) => Object.entries(civ.infra[net]).filter(([, l]) => l > (NETWORKS[net].base ?? 0)).map(([d, l]) => ({ net, d, l, w: districtWeight(state, d) })))
    .sort((a, b) => a.w - b.w || a.d.localeCompare(b.d));
  const c = candidates[0];
  if (!c) return;
  civ.infra[c.net][c.d] = c.l - 1;
  civ.stats.decayed++;
  record(state, 'council', `The council could not pay for the upkeep of the utilities: ${c.d}'s ${NETWORKS[c.net].label.toLowerCase()} fell back to ${NETWORKS[c.net].levels[c.l - 1].toLowerCase()}.`, {}, 2);
}

/** For the UI: each network's town-wide picture. */
export function networkSummary(state) {
  const ds = districtsOf(state);
  return NETWORK_KEYS.map((net) => {
    const levels = ds.map((d) => serviceIn(state, d, net));
    return { net, ...NETWORKS[net], max: maxLevel(state, net), best: Math.max(...levels, 0), covered: levels.filter((l) => l >= maxLevel(state, net) && l > (NETWORKS[net].base ?? 0)).length, districts: ds.length };
  });
}
