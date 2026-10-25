import { setProfession } from '../citizens/Careers.js';
import { lawInForce } from '../law/LegalCode.js';
import { byId } from '../core/EntityRegistry.js';
import { STAGES, REFIT_STAGE, DEMOLITION, BUILD, GOODS, ECONOMY } from '../core/Config.js';
import { transfer, balance } from '../economy/Transactions.js';
import { qty, removeGoods, addGoods } from '../economy/Inventory.js';
import { BUSINESS_TYPES, isTrading, wholesalePrice, createBusiness, businessName } from '../economy/Businesses.js';
import { plotById, plotHistory, setBuilding, allows, buildingClass, BUILDING_INFO } from './LandRegistry.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { bump } from '../society/Reputation.js';
import { createFact } from '../society/Gossip.js';
import { ownerAccount, noteSale } from '../economy/Marketplace.js';
import { PROFESSION_FOR_BUSINESS } from '../citizens/Careers.js';
import { adjustBoth } from '../citizens/Relationships.js';
import { leaveJob } from '../economy/Employment.js';
import { achieve } from '../citizens/Citizen.js';
import { validOwner, institutionName, isInstitutionId } from '../institutions/Registry.js';

// Systems that commission buildings for their own purposes (banks, guild halls,
// shrines) register what happens when one is finished.
export const completionHooks = {};

// Construction, refits and demolition. Projects advance through stages; each
// stage needs timber delivered (bought by the owner) and labour (builder shifts).

export const projectById = (state, id) => state.projects.find((p) => p.id === id) ?? null;

export function stagesFor(kind) {
  if (kind === 'construction') return STAGES;
  if (kind === 'refit') return [REFIT_STAGE];
  if (kind === 'upgrade') return [{ name: 'EXPANSION', work: 10, timber: 4 }];
  if (kind === 'repair') return [{ name: 'REPAIR', work: 6, timber: 2 }];
  return [{ name: 'DEMOLISHING', work: DEMOLITION.work, timber: 0 }];
}

export function canStart(state, plot, ownerId, kind, buildingType) {
  if (!plot || plot.ownerId !== ownerId) return 'not the owner';
  if (plot.projectId) return 'work already under way';
  if (state.projects.filter((p) => p.ownerId !== 'council' && !isInstitutionId(p.ownerId)).length >= ECONOMY.maxActiveProjects && ownerId !== 'council' && !isInstitutionId(ownerId)) return 'too many building sites in the village';
  if (kind === 'construction' && (plot.building || !allows(plot, buildingType))) return 'plot cannot take that building';
  if (kind === 'refit' && (!plot.building || buildingClass(plot.building.type) !== buildingClass(buildingType) || plot.businessId)) return 'building cannot be refitted';
  if (kind === 'demolition' && (!plot.building || plot.businessId)) return 'nothing to demolish';
  if (kind === 'upgrade' && (!plot.building || (plot.building.level ?? 1) >= 3)) return 'cannot be expanded further';
  if (kind === 'repair' && (!plot.building || (plot.building.condition ?? 100) >= 90)) return 'needs no repair';
  return null;
}

/**
 * @param purpose 'business' (opens businessType on completion), 'home', or 'civic'
 */
export function startProject(state, { plotId, ownerId, kind, buildingType = null, purpose = null, businessType = null }) {
  const plot = plotById(state, plotId);
  const why = canStart(state, plot, ownerId, kind, buildingType);
  if (why) return { ok: false, reason: why };
  const project = {
    id: 'j' + ++state.nextId.project,
    kind, plotId, ownerId, buildingType, purpose, businessType,
    stage: 'PLANNING', stageIndex: -1, work: 0, materials: 0,
    startedDay: state.day, crew: {}, waiting: null, labourPaid: 0, materialsPaid: 0,
  };
  // Under the Building Permits Act private builders pay a permit fee to the council.
  if (ownerId !== 'council' && (kind === 'construction' || kind === 'upgrade') && lawInForce(state, 'permits')) {
    if (!transfer(state, ownerId, 'treasury', 4, 'tax', `Building permit for ${plot.name}`)) return { ok: false, reason: 'cannot afford the building permit' };
    project.permit = true;
  }
  state.projects.push(project);
  plot.projectId = project.id;
  if (state.government?.policies?.constructionGrants && ownerId !== 'council' && !isInstitutionId(ownerId) && kind !== 'demolition' && balance(state, 'treasury') > 60) {
    transfer(state, 'treasury', ownerId, 8, 'grant', `Construction grant for ${plot.name}`);
  }
  plot.marketStatus = 'NOT_FOR_SALE';
  plot.constructionStatus = kind === 'demolition' ? 'DEMOLISHING' : kind === 'upgrade' || kind === 'repair' ? 'COMPLETE' : 'PLANNING';
  const owner = byId(state.citizens, ownerId);
  const who = owner ? owner.firstName : institutionName(state, ownerId) ?? 'The council';
  const what = kind === 'upgrade' ? `expanding the ${BUILDING_INFO[plot.building.type].label.toLowerCase()}` : kind === 'repair' ? `repairing the ${BUILDING_INFO[plot.building.type].label.toLowerCase()}` : kind === 'demolition' ? `demolition of the old ${BUILDING_INFO[plot.building.type].label.toLowerCase()}` :
    kind === 'refit' ? `refitting the ${BUILDING_INFO[plot.building.type].label.toLowerCase()} as a ${BUILDING_INFO[buildingType].label.toLowerCase()}` :
      `a ${BUILDING_INFO[buildingType].label.toLowerCase()}`;
  plotHistory(state, plot, `${who} began ${what}.`);
  record(state, 'construction', `${who} began ${what} on ${plot.name}.`, { citizens: owner ? [owner.id] : [], plot: plot.id }, 2);
  if (owner) remember(state, owner, `Began ${what} on ${plot.name}.`, 2, 'property');
  return { ok: true, project };
}

const currentStage = (p) => stagesFor(p.kind)[p.stageIndex] ?? null;

/** Owner buys timber for the next stage from the cheapest seller (or outside traders as a last resort). */
function procure(state, p) {
  const nextIndex = p.stageIndex < 0 ? 0 : p.stageIndex;
  const stage = stagesFor(p.kind)[nextIndex];
  let need = stage.timber - p.materials;
  const acct = ownerAccount(p.ownerId);
  const sellers = state.businesses.filter((b) => isTrading(b) && qty(b.inventory, 'timber') > 0 && BUSINESS_TYPES[b.type].sells.includes('timber'))
    .sort((a, b) => wholesalePrice(a, 'timber') - wholesalePrice(b, 'timber'));
  for (const s of sellers) {
    if (need <= 0) break;
    const unit = wholesalePrice(s, 'timber') + 1;
    const n = Math.min(need, qty(s.inventory, 'timber'), Math.floor(balance(state, acct) / unit));
    if (n < 1) continue;
    if (transfer(state, acct, s.id, unit * n, 'construction', `${n} timber for ${plotById(state, p.plotId).name}`)) {
      removeGoods(s.inventory, 'timber', n);
      s.today.revenue += unit * n;
      s.totals.revenue += unit * n;
      const buyer = byId(state.citizens, p.ownerId);
      noteSale(state, s, buyer ? buyer.firstName : 'the council', n, 'timber', unit * n, buyer?.id ?? null);
      p.materials += n;
      p.materialsPaid += unit * n;
      need -= n;
    }
  }
  if (need > 0 && !sellers.length) {
    // Owner-held salvage timber counts too.
    const owner = byId(state.citizens, p.ownerId);
    const own = owner ? Math.min(need, qty(owner.inventory, 'timber')) : 0;
    if (own > 0) { removeGoods(owner.inventory, 'timber', own); p.materials += own; need -= own; }
    const unit = Math.round(GOODS.timber.base * 1.7);
    const n = Math.min(need, Math.floor(balance(state, acct) / unit));
    if (need > 0 && n > 0 && transfer(state, acct, 'outside', unit * n, 'import', 'timber from outside traders')) {
      p.materials += n;
      p.materialsPaid += unit * n;
      need -= n;
    }
  }
  p.waiting = need > 0 ? 'Waiting for timber' : null;
  return need <= 0;
}

/** Hourly: move projects out of planning and keep materials flowing. */
export function updateProjects(state) {
  // A site whose owner is gone, or that has made no progress for two years, is abandoned.
  for (const p of [...state.projects]) {
    const ownerGone = !validOwner(state, p.ownerId);
    p.lastProgress = p.lastProgress ?? state.day;
    if (ownerGone || state.day - p.lastProgress > 24) abandonProject(state, p, ownerGone ? 'its owner is gone' : 'work stalled for two years');
  }
  for (const p of state.projects) {
    if (p.stageIndex < 0) {
      if (procure(state, p)) advanceStage(state, p);
    } else if (p.materials < currentStage(p).timber) {
      procure(state, p);
    }
  }
}

function advanceStage(state, p) {
  const stages = stagesFor(p.kind);
  if (p.stageIndex >= 0) p.materials = Math.max(0, p.materials - stages[p.stageIndex].timber);
  p.stageIndex++;
  p.work = 0;
  const plot = plotById(state, p.plotId);
  if (p.stageIndex >= stages.length) return complete(state, p);
  p.stage = stages[p.stageIndex].name;
  plot.constructionStatus = p.stage;
  if (p.kind === 'construction' && p.stageIndex > 0) plotHistory(state, plot, `Construction reached the ${p.stage.toLowerCase()} stage.`);
  procure(state, p);
}

/** Does this project currently accept labour? */
export function needsLabour(state, p) {
  if (p.stageIndex < 0) return false;
  const stage = currentStage(p);
  return p.materials >= stage.timber && Object.keys(p.crew).length < BUILD.maxWorkersPerShift;
}

export function canPayBuilder(state, p) {
  return balance(state, ownerAccount(p.ownerId)) >= BUILD.builderWage;
}

/** A citizen finished a shift on a site. Builders are paid by the owner; owners work for free. */
export function addWork(state, p, c) {
  delete p.crew[c.id];
  if (!state.projects.includes(p) || p.stageIndex < 0) return { ok: false };
  const stage = currentStage(p);
  if (p.materials < stage.timber) return { ok: false, reason: 'no materials' };
  const isOwner = p.ownerId === c.id;
  const builder = c.profession === 'Builder';
  let paid = 0;
  if (!isOwner) {
    if (!transfer(state, ownerAccount(p.ownerId), c.id, BUILD.builderWage, 'construction', `${c.firstName} building on ${plotById(state, p.plotId).name}`)) {
      remember(state, c, 'Worked a building shift that went unpaid.', 1, 'grievance');
      return { ok: false, reason: 'unpaid' };
    }
    paid = BUILD.builderWage;
    p.labourPaid += paid;
    c.stats.earned += paid;
    const owner = byId(state.citizens, p.ownerId);
    if (owner) adjustBoth(state, c.id, owner.id, { friendship: 1.5, trust: 1, respect: 1 });
  }
  const units = (builder ? BUILD.builderWorkPerShift + Math.round((c.skills.building ?? 0) * 1.5) : BUILD.ownerWorkPerShift) + (state.discoveries?.constructionTechniques ? 1 : 0);
  p.work += units;
  p.lastProgress = state.day;
  c.stats.shiftsWorked++;
  c.shiftsToday++;
  if (builder) c.skills.building = Math.min(1, Math.round(((c.skills.building ?? 0.3) + 0.015) * 1000) / 1000);
  if (p.work >= stage.work) advanceStage(state, p);
  return { ok: true, units, paid };
}

function complete(state, p) {
  const plot = plotById(state, p.plotId);
  const owner = byId(state.citizens, p.ownerId);
  state.projects = state.projects.filter((x) => x !== p);
  plot.projectId = null;
  const crewIds = new Set(p.crewHistory ?? []);
  if (p.kind === 'upgrade' || p.kind === 'repair') {
    if (p.kind === 'upgrade') plot.building.level = (plot.building.level ?? 1) + 1;
    else plot.building.condition = 100;
    plot.constructionStatus = 'COMPLETE';
    const b = plot.businessId ? state.businesses.find((x) => x.id === plot.businessId) : null;
    if (b && p.kind === 'upgrade') b.level = plot.building.level;
    const label = b?.name ?? BUILDING_INFO[plot.building.type].label;
    plotHistory(state, plot, p.kind === 'upgrade' ? `${label} was expanded (level ${plot.building.level}).` : `${label} was repaired.`);
    record(state, 'construction', p.kind === 'upgrade' ? `${label} on ${plot.name} was expanded into larger premises.` : `${label} on ${plot.name} has been repaired.`, { citizens: owner ? [owner.id] : [], plot: plot.id, business: b?.id ?? null }, 2);
    return;
  }
  if (p.kind === 'demolition') {
    const old = plot.building ? BUILDING_INFO[plot.building.type].label.toLowerCase() : 'building';
    plot.building = null;
    plot.constructionStatus = 'NONE';
    if (owner) addGoods(owner.inventory, 'timber', DEMOLITION.salvageTimber);
    plotHistory(state, plot, `The old ${old} was demolished. The land is clear.`);
    record(state, 'construction', `The old ${old} on ${plot.name} has been demolished.`, { citizens: owner ? [owner.id] : [], plot: plot.id }, 2);
    return;
  }
  setBuilding(state, plot, p.buildingType);
  plotHistory(state, plot, `${BUILDING_INFO[p.buildingType].label} completed after ${state.day - p.startedDay} days.`);
  for (const c of state.citizens) if (crewIds.has(c.id) && c.profession === 'Builder') { c.stats.buildingsCompleted++; bump(c, 'competence', 3); }
  if (p.purpose === 'business' && owner) {
    openBusiness(state, owner, plot, p.businessType);
  } else if (p.purpose === 'home' && owner) {
    moveHome(state, owner, plot);
    record(state, 'construction', `${owner.firstName}'s new cottage on ${plot.name} is finished.`, { citizens: [owner.id], plot: plot.id }, 3);
    remember(state, owner, `Moved into my own cottage on ${plot.name}.`, 3, 'milestone');
    owner.mood = Math.min(100, owner.mood + 15);
  } else if (completionHooks[p.purpose]) {
    completionHooks[p.purpose](state, plot, p);
  } else if (p.purpose === 'council_business') {
    const b = createBusiness(state, { type: p.businessType, ownerId: 'council', plotId: plot.id, name: businessName(state, p.businessType, null) });
    plot.businessId = b.id;
    plot.building.name = b.name;
    transfer(state, 'treasury', b.id, Math.min(25, balance(state, 'treasury')), 'grant', `Starting funds for ${b.name}`);
    b.openings = 2;
    record(state, 'business', `The council opened ${b.name} on ${plot.name}.`, { business: b.id, plot: plot.id }, 2);
  } else {
    record(state, 'construction', `The council finished a new ${BUILDING_INFO[p.buildingType].label.toLowerCase()} on ${plot.name}.`, { plot: plot.id }, 2);
  }
}

export function abandonProject(state, p, why) {
  const plot = plotById(state, p.plotId);
  state.projects = state.projects.filter((x) => x !== p);
  if (plot) {
    plot.projectId = null;
    plot.constructionStatus = plot.building ? 'COMPLETE' : 'NONE';
    if (!validOwner(state, plot.ownerId)) { plot.ownerId = 'council'; plot.marketStatus = 'FOR_SALE'; }
    plotHistory(state, plot, `Building work was abandoned (${why}).`);
    record(state, 'construction', `Work on ${plot.name} was abandoned because ${why}.`, { plot: plot.id }, 1);
  }
}

export function moveHome(state, c, plot) {
  const old = state.plots.find((p) => p.id === c.homePlotId);
  if (old) old.residents = old.residents.filter((id) => id !== c.id);
  c.homePlotId = plot.id;
  if (!plot.residents.includes(c.id)) plot.residents.push(c.id);
}

/** A finished or refitted building opens as a business owned by `owner`. */
export function openBusiness(state, owner, plot, type) {
  const b = createBusiness(state, { type, ownerId: owner.id, plotId: plot.id, name: businessName(state, type, owner) });
  plot.businessId = b.id;
  plot.building.name = b.name;
  if ((state.government?.policies?.businessLicensing || lawInForce(state, 'licensing')) && transfer(state, owner.id, 'treasury', 6, 'tax', `Licence for ${b.name}`)) b.licensed = true;
  const capital = Math.min(ECONOMY.startingCapital, balance(state, owner.id) - 2);
  if (capital > 0) transfer(state, owner.id, b.id, capital, 'capital', `Starting capital for ${b.name}`);
  if (owner.employment) leaveJob(state, owner, `opened ${b.name}`);
  owner.employment = { businessId: b.id, role: 'owner', wage: 0, since: state.day, unpaid: 0 };
  owner.employmentHistory.push({ businessId: b.id, name: b.name, from: state.day, to: null, role: 'owner' });
  setProfession(state, owner, PROFESSION_FOR_BUSINESS[type]);
  if (owner.venture) owner.venture.businessId = b.id;
  bump(owner, 'competence', 5);
  achieve(state, owner, 'founded', `Founded ${b.name}`, { business: b.id });
  plotHistory(state, plot, `${b.name} opened for business.`);
  record(state, 'business', `${b.name} officially opened on ${plot.name}!`, { citizens: [owner.id], business: b.id, plot: plot.id }, 3);
  remember(state, owner, `Opened ${b.name}.`, 3, 'milestone');
  owner.mood = Math.min(100, owner.mood + 18);
  createFact(state, 'business_opened', owner.id, `${owner.firstName} opened ${b.name}.`, [owner.id]);
  return b;
}

export function joinCrew(p, c, tick) {
  p.crew[c.id] = tick;
  p.crewHistory = [...new Set([...(p.crewHistory ?? []), c.id])];
}

export function projectProgress(p) {
  const stages = stagesFor(p.kind);
  if (p.stageIndex < 0) return 0;
  const done = stages.slice(0, p.stageIndex).reduce((s, x) => s + x.work, 0) + Math.min(p.work, stages[p.stageIndex]?.work ?? 0);
  return done / stages.reduce((s, x) => s + x.work, 0);
}

export function estimateMaterialsCost(state, kind) {
  const timber = stagesFor(kind).reduce((s, x) => s + x.timber, 0);
  const seller = state.businesses.find((b) => isTrading(b) && BUSINESS_TYPES[b.type].sells.includes('timber'));
  const unit = seller ? wholesalePrice(seller, 'timber') + 1 : Math.round(GOODS.timber.base * 1.7);
  return timber * unit;
}
