import { CIV, LIFE, BUILD } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { chance } from '../core/Random.js';
import { isTrading, BUSINESS_TYPES } from '../economy/Businesses.js';
import { ownerAccount } from '../economy/Marketplace.js';
import { validOwner, isInstitutionId, institutionName } from '../institutions/Registry.js';
import { BUILDING_INFO, plotById } from '../property/LandRegistry.js';
import { startProject, projectRules, addContractWork } from '../property/Construction.js';
import { formOf, ERA_NAMES, ERA_MATERIAL, formLabel } from './ArchitectureData.js';
import { buildEra } from './Architecture.js';
import { unmetNeeds } from './Infrastructure.js';
import { DAYS_PER_YEAR } from '../core/Config.js';
import { applyForPlanning, applicationExecutors, heritageScore, CONCERN_SCORE } from './Heritage.js';

// Modernization. When a newer architecture is within reach, owners review
// their buildings: a merchant whose timber workshop is old and whose trade is
// good may pull it down and put up a brick factory; a poor family stays in
// the cottage it has. Rebuilding is a real project: the old building is
// demolished, the new one goes up stage by stage, builders are paid by the
// owner, timber is bought locally and modern materials (brick, steel, glass)
// from a builders' merchant. Nothing changes on its own when an age begins.

const SUPPLY_LABEL = ['', 'Timber', 'Brick and iron', 'Concrete and steel', 'Steel and glass', 'Solar glass and composites'];

/** The stages of rebuilding a plot as `type` in `era` (with the old building's demolition first). */
export function rebuildStages(type, era, { demolish = true } = {}) {
  const f = formOf(type, era);
  const w = f.work * CIV.rebuildCostScale[era];
  const base = BUILDING_INFO[type].value;
  const supplies = (share) => (era >= 2 ? Math.max(1, Math.round(base * f.value * 0.3 * share)) : 0);
  const timber = (old, modern) => (era <= 2 ? old : modern);
  const label = SUPPLY_LABEL[era];
  const stages = [];
  if (demolish) stages.push({ name: 'DEMOLISHING', work: 8, timber: 0 });
  stages.push(
    { name: 'FOUNDATION', work: Math.round(8 * w), timber: 1, supplies: supplies(0.25), label: `${label} for the foundations` },
    { name: 'FRAME', work: Math.round(12 * w), timber: timber(3, 1), supplies: supplies(0.35), label: `${label} for the structure` },
    { name: 'ROOF', work: Math.round(10 * w), timber: timber(2, 1), supplies: supplies(0.25), label: `${label} for the roof and facade` },
    { name: 'FINISHING', work: Math.round(6 * w), timber: 1, supplies: supplies(0.15), label: `Fittings` },
  );
  return stages;
}

/** Estimated full cost of a rebuild: labour, timber, modern materials and a permit. */
export function rebuildCost(stages) {
  const work = stages.reduce((s, x) => s + x.work, 0);
  const shifts = Math.ceil(work / (BUILD.builderWorkPerShift + 0.5));
  const timber = stages.reduce((s, x) => s + x.timber, 0);
  return shifts * BUILD.builderWage + timber * 3 + stages.reduce((s, x) => s + (x.supplies ?? 0), 0) + 4;
}

/** Concurrent rebuilds allowed by private owners in this age (the old cap still applies to new building). */
export const rebuildCap = (state) => CIV.maxRebuilds[state.civ?.age ?? 1];

/** The highest era a plot can be rebuilt to that its district's utilities can serve. */
export function reachableEra(state, plot, type) {
  const top = formOf(type, buildEra(state)).era;
  for (let e = top; e > (plot.building?.era ?? 1); e--) if (formOf(type, e).era === e && !unmetNeeds(state, plot, type, e).length) return e;
  return null;
}

function ownerKind(state, id) {
  if (id === 'council') return 'council';
  if (isInstitutionId(id)) return 'institution';
  return byId(state.citizens, id) ? 'citizen' : null;
}

/** How keen a citizen is to rebuild (a probability for this review). */
function appetite(state, c, plot, cost, funds, era) {
  const b = plot.building;
  const years = (state.day - (b.rebuiltDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR;
  const biz = plot.businessId ? state.businesses.find((x) => x.id === plot.businessId) : null;
  const profitable = biz && isTrading(biz) && biz.status === 'OPEN' && balance(state, biz.id) > 20;
  const crowded = plot.residents.length >= 4;
  let p = 0.02 + trait(c, 'ambitious') * 0.3 + trait(c, 'curious') * 0.15 + trait(c, 'riskTaking') * 0.15 + trait(c, 'creative') * 0.1 - trait(c, 'frugal') * 0.25 - trait(c, 'stubborn') * 0.15;
  p += (era - (b.era ?? 1) - 1) * 0.1 + (100 - (b.condition ?? 100)) / 150 + Math.min(0.3, years / 250) + (profitable ? 0.2 : 0) + (crowded ? 0.1 : 0);
  p *= Math.min(1.5, funds / (cost * 1.5));
  // Families who have held a place for generations are slow to pull it down.
  const held = (state.day - (plot.acquiredDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR;
  if (held > 60) p *= 0.6;
  return Math.max(0, Math.min(0.5, p * 0.6));
}

/**
 * Every few days a handful of owners review their buildings. `finance`
 * supplies { funds, raise, borrow } (savings and bank credit).
 */
export function reviewModernization(state, finance = {}) {
  if (state.day % CIV.modernizeEveryDays !== 0) return null;
  const era = buildEra(state);
  if (era <= 1) return null;
  const civ = state.civ;
  const active = state.projects.filter((p) => p.kind === 'rebuild' && ownerKind(state, p.ownerId) === 'citizen').length;
  const plots = state.plots.filter((p) => p.building && !['ruins', 'grounds', 'shrine'].includes(p.building.type) && !p.projectId && (p.building.era ?? 1) < era && validOwner(state, p.ownerId));
  if (!plots.length) return null;
  // Look at a few plots each time, in a fixed rotation, so every owner gets a turn.
  const n = Math.min(plots.length, 2);
  civ.cursor = (civ.cursor ?? 0) % plots.length;
  for (let i = 0; i < n; i++) {
    const plot = plots[(civ.cursor + i) % plots.length];
    const kind = ownerKind(state, plot.ownerId);
    if (kind === 'citizen' && active >= rebuildCap(state)) continue;
    const res = consider(state, plot, kind, finance);
    if (res) { civ.cursor += i + 1; return res; }
  }
  civ.cursor += n;
  return null;
}

function consider(state, plot, kind, finance) {
  const b = plot.building;
  if (projectRules.veto?.(state, plot, 'rebuild', b.type)) return null;
  const years = (state.day - (b.rebuiltDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR;
  if (years < CIV.minRebuildYears && (b.condition ?? 100) >= 75) return null;
  const target = reachableEra(state, plot, b.type);
  if (!target) return null;
  const stages = rebuildStages(b.type, target);
  const cost = rebuildCost(stages);
  const acct = ownerAccount(plot.ownerId);
  let who, reason;
  if (kind === 'council') {
    if (balance(state, 'treasury') < cost + 200 || !chance(state, 0.12)) return null;
    who = 'The council';
    reason = `the treasury could spare ${cost} coins`;
  } else if (kind === 'institution') {
    if (BUILDING_INFO[b.type].class === 'faith' && !chance(state, 0.15)) return null;
    if (balance(state, acct) < cost + 80 || !chance(state, 0.3)) return null;
    who = institutionName(state, plot.ownerId) ?? 'The owners';
    reason = `its funds could cover the ${cost} coins`;
  } else {
    const c = byId(state.citizens, plot.ownerId);
    if (!c || c.away || ageOf(state, c) < LIFE.adultAge + 4) return null;
    const funds = (finance.funds ?? ((x) => balance(state, x.id)))(c);
    const ambitious = trait(c, 'ambitious') + trait(c, 'riskTaking') > 0.7;
    if (funds < cost * 1.1 && !(ambitious && funds >= cost * 0.5 && finance.borrow)) return null;
    if (!chance(state, appetite(state, c, plot, cost, Math.max(funds, cost * 0.6), target))) return null;
    if (balance(state, c.id) < cost && finance.raise) finance.raise(state, c.id, cost);
    if (balance(state, c.id) < cost && finance.borrow) finance.borrow(state, c, cost - balance(state, c.id) + 2, plot);
    if (balance(state, c.id) < cost * 0.9) return null;
    who = `${c.firstName} ${c.lastName}`;
    const years = Math.round((state.day - (b.rebuiltDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR);
    const biz = plot.businessId ? state.businesses.find((x) => x.id === plot.businessId) : null;
    reason = `the old ${formLabel(b).toLowerCase()} was ${years} years old${(b.condition ?? 100) < 85 ? ` and in ${Math.round(b.condition)}% repair` : ''}${biz && isTrading(biz) ? `, and ${biz.name} was doing well enough to pay for it` : ''}`;
    remember(state, c, `Decided to rebuild ${plot.name} as a ${formOf(b.type, target).labels[0].toLowerCase()}.`, 3, 'property');
  }
  const newLabel = formOf(b.type, target).labels[(b.seed ?? 0) % formOf(b.type, target).labels.length];
  const app = { kind: 'rebuild', type: b.type, era: target, applicantId: plot.ownerId, plotIds: [plot.id], annexId: null, cost: { total: cost }, stages, who, reason, newLabel };
  // Pulling down a building of historic importance goes to planning first.
  if (heritageScore(state, plot).score >= CONCERN_SCORE) { applyForPlanning(state, app, finance); return null; }
  return startRebuild(state, app);
}

function startRebuild(state, app) {
  const plot = plotById(state, app.plotIds[0]);
  const b = plot.building;
  if (!b || plot.projectId) return null;
  const { who, reason, newLabel, stages, era: target } = app;
  const cost = app.cost.total;
  const res = startProject(state, {
    plotId: plot.id, ownerId: plot.ownerId, kind: 'rebuild', buildingType: b.type, stages, targetEra: target, contractors: target >= 3,
    note: `replacing the ${formLabel(b).toLowerCase()} with ${/^[aeiou]/i.test(newLabel) ? 'an' : 'a'} ${newLabel.toLowerCase()}`,
  });
  if (!res.ok) return null;
  res.project.estimate = cost;
  state.civ.stats.rebuildsStarted++;
  const kind = ownerKind(state, plot.ownerId);
  record(state, 'construction', `${who} decided to replace the ${formLabel(b).toLowerCase()} on ${plot.name} with ${/^[aeiou]/i.test(newLabel) ? 'an' : 'a'} ${newLabel.toLowerCase()} (${ERA_NAMES[target]} architecture, ${ERA_MATERIAL[target].toLowerCase()}): ${reason}. Estimated cost ${cost} coins.`, { citizens: kind === 'citizen' ? [plot.ownerId] : [], plot: plot.id, business: plot.businessId ?? null }, 2);
  return res.project;
}

applicationExecutors.rebuild = (state, app) => (startRebuild(state, app) ? null : 'the work could not start');

/** A finished rebuild: modern premises take more staff; the first building of each era is remembered. */
export function onRebuilt(state, plot, project) {
  const civ = state.civ;
  civ.stats.rebuilt++;
  const b = plot.building;
  const biz = plot.businessId ? state.businesses.find((x) => x.id === plot.businessId) : null;
  if (biz) biz.premisesStaff = formOf(b.type, b.era).staff ?? 0;
  const label = formLabel(b);
  const first = !civ.firsts[b.era];
  if (first) civ.firsts[b.era] = { day: state.day, plotId: plot.id, label };
  const owner = byId(state.citizens, project.ownerId);
  const days = state.day - project.startedDay;
  record(state, 'construction', `${first ? `The town's first ${ERA_NAMES[b.era]} building: ` : ''}the new ${label.toLowerCase()}${biz ? ` of ${biz.name}` : ''} on ${plot.name} is finished after ${days} days${b.floors > 1 ? `, ${b.floors} storeys high` : ''} (${project.materialsPaid + project.labourPaid} coins spent).`,
    { citizens: owner ? [owner.id] : [], plot: plot.id, business: biz?.id ?? null }, first || b.floors >= 8 ? 3 : 2);
  if (owner) { remember(state, owner, `Finished rebuilding ${plot.name} as a ${label.toLowerCase()}.`, 3, 'milestone'); owner.mood = Math.min(100, owner.mood + 12); }
}

/**
 * Daily: on modern sites (Modern Expansion onwards) a contracted crew from a
 * construction firm keeps work moving when no local builder came, paid by the owner.
 */
export function contractorWork(state) {
  for (const p of [...state.projects]) {
    if (!p.contractors || p.stageIndex < 0 || p.lastProgress === state.day) continue;
    const stage = (p.stages ?? [])[p.stageIndex];
    if (!stage || p.materials < stage.timber) continue;
    const acct = ownerAccount(p.ownerId);
    const fee = 12;
    if (balance(state, acct) < fee + 4 || !transfer(state, acct, 'outside', fee, 'construction', `Contracted crew at ${plotById(state, p.plotId).name}`)) continue;
    p.labourPaid += fee;
    p.contracted = (p.contracted ?? 0) + 1;
    addContractWork(state, p, 5);
  }
}

/** For the dashboard: live rebuilds with their progress. */
export function redevelopmentProjects(state) {
  return state.projects.filter((p) => p.kind === 'rebuild').map((p) => ({ p, plot: plotById(state, p.plotId), label: formOf(p.buildingType, p.targetEra).labels[0], owner: byId(state.citizens, p.ownerId)?.firstName ?? institutionName(state, p.ownerId) ?? (p.ownerId === 'council' ? 'Council' : p.ownerId) }));
}

export { BUSINESS_TYPES };
