import { fireWeather } from './Weather.js';
import { lawInForce } from '../law/LegalCode.js';
import { EVENTS, DAYS_PER_YEAR, LIFE } from '../core/Config.js';
import { chance, nextRandom, intRange } from '../core/Random.js';
import { seasonOf, isNewSeason, yearOf, isNewYear } from '../core/Calendar.js';
import { balance } from '../economy/Transactions.js';
import { closeBusiness } from '../economy/EconomyManager.js';
import { startProject } from '../property/Construction.js';
import { plotHistory, BUILDING_INFO, bedsAt } from '../property/LandRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { achieve } from '../citizens/Citizen.js';


/** Later medicine and sanitation lower disease and infant deaths; set by civilization/. */
export const healthHooks = { disease: null, infant: null };
// Rare, condition-driven hardships. Every disaster changes real state: fires
// damage or destroy buildings (then repaired or rebuilt through ordinary
// construction), crop failures cut farm output, harsh winters raise hunger and
// risk, disease spreads through real contact, recessions cut trade.

const FLAMMABLE = { bakery: 2, blacksmith: 2.2, tavern: 1.6, lumberyard: 1.8, farm: 0.8, cottage: 1, hall: 0.8, townhall: 0.6, general_store: 1, school: 0.8, granary: 1.2, stall: 1.2 };

export const season = (state) => (state.season = state.season ?? {});
const wells = (state) => state.plots.filter((p) => p.building?.type === 'well' && p.constructionStatus === 'COMPLETE');
const nearWell = (state, plot) => wells(state).some((w) => Math.hypot(w.x - plot.x, w.z - plot.z) < 26);

/** Daily: roll for new fires, and seasonal/yearly hazards. */
export function dailyDisasters(state) {
  const s = season(state);
  state.fires = state.fires ?? [];
  if (isNewSeason(state.day)) {
    const name = seasonOf(state.day);
    if (name === 'Spring') { s.harshWinter = false; s.cropFailureYear = s.cropFailureYear === yearOf(state.day) ? s.cropFailureYear : null; }
    if (name === 'Summer' && chance(state, EVENTS.cropFailureChance * (state.discoveries?.improvedPlow ? 0.7 : 1))) {
      s.cropFailureYear = yearOf(state.day);
      s.troubledUntil = state.day + DAYS_PER_YEAR / 2;
      record(state, 'economy', `Blight and drought: the harvest of Year ${yearOf(state.day)} is failing. Farms will yield half their usual grain until spring.`, {}, 3);
      state.eventLog.push({ type: 'cropFailure', day: state.day });
    }
    if (name === 'Winter' && chance(state, EVENTS.harshWinterChance)) {
      s.harshWinter = true;
      record(state, 'economy', `A bitter winter has set in: food runs short faster and the old and very young are at risk.`, {}, 2);
      state.eventLog.push({ type: 'harshWinter', day: state.day });
    }
  }
  if (isNewYear(state.day) && chance(state, EVENTS.recessionChance)) {
    s.recessionUntil = state.day + DAYS_PER_YEAR;
    record(state, 'economy', `Trade has collapsed across the region: caravans will pay less and come less often this year.`, {}, 2);
    state.eventLog.push({ type: 'recession', day: state.day });
  }
  const winter = seasonOf(state.day) === 'Winter';
  for (const p of state.plots) {
    if (!p.building || p.building.type === 'ruins' || p.building.type === 'well' || p.projectId || state.fires.some((f) => f.plotId === p.id)) continue;
    // Brick, concrete and steel burn far less readily than timber and thatch.
    let risk = EVENTS.fireDailyPerBuilding * (FLAMMABLE[p.building.type] ?? 1) * ([1, 1, 0.6, 0.3, 0.18, 0.12][p.building.era ?? 1] ?? 1) * (winter ? 1.6 : 1) * (s.harshWinter ? 1.3 : 1) * (nearWell(state, p) ? 0.6 : 1) * ((p.building.condition ?? 100) < 50 ? 1.5 : 1) * (lawInForce(state, 'safety') ? 0.8 : 1) * fireWeather(state);
    if (chance(state, risk)) igniteFire(state, p);
  }
  maybeOutbreak(state);
  for (const p of state.plots) if (p.building) p.building.condition = p.building.condition ?? 100;
  scheduleRepairs(state);
}

export function igniteFire(state, plot, spreadFrom = null) {
  const severity = intRange(state, 30, 100);
  state.fires.push({ plotId: plot.id, startTick: state.tick, severity, responders: [] });
  state.stats.fires = (state.stats.fires ?? 0) + 1;
  record(state, 'construction', spreadFrom ? `The fire spread to ${plot.building.name} on ${plot.name}!` : `Fire! ${plot.building.name} on ${plot.name} is burning.`, { plot: plot.id }, 3);
  plotHistory(state, plot, 'A fire broke out.');
}

/** Hourly: resolve fires that have burned long enough, given how many people fought them. */
export function updateFires(state) {
  for (const fire of [...(state.fires ?? [])]) {
    if (state.tick - fire.startTick < EVENTS.fireDurationTicks) continue;
    state.fires = state.fires.filter((f) => f !== fire);
    const plot = state.plots.find((p) => p.id === fire.plotId);
    if (!plot?.building) continue;
    const responders = [...new Set(fire.responders)].filter((id) => state.citizens.some((c) => c.id === id));
    const protection = Math.min(0.85, responders.length * 0.14 + (nearWell(state, plot) ? 0.2 : 0));
    const damage = Math.round(fire.severity * (1 - protection));
    plot.building.condition = Math.max(0, (plot.building.condition ?? 100) - damage);
    const heroes = responders.map((id) => state.citizens.find((c) => c.id === id)).filter(Boolean);
    for (const h of heroes) {
      remember(state, h, `Helped fight the fire at ${plot.name}.`, 2, 'event');
      if (!h.achievements.some((a) => a.type === 'firefighter')) achieve(state, h, 'firefighter', `Fought the fire at ${plot.name}`);
    }
    if (plot.building.condition <= 0) {
      destroyBuilding(state, plot, heroes);
    } else {
      plotHistory(state, plot, `Fire damaged the building (${damage}% damage, ${heroes.length} villagers fought it).`);
      record(state, 'construction', `The fire at ${plot.name} was put out by ${heroes.length ? heroes.slice(0, 4).map((h) => h.firstName).join(', ') + (heroes.length > 4 ? ` and ${heroes.length - 4} others` : '') : 'no one, burning itself out'}. The building is ${plot.building.condition}% intact.`, { plot: plot.id, citizens: heroes.map((h) => h.id) }, 2);
    }
    // A big, unfought fire can leap to a neighbour.
    if (fire.severity > 75 && heroes.length < 2) {
      const next = state.plots.find((p) => p !== plot && p.building && p.building.type !== 'ruins' && Math.hypot(p.x - plot.x, p.z - plot.z) < 13 && !state.fires.some((f) => f.plotId === p.id));
      if (next && chance(state, 0.35)) igniteFire(state, next, plot);
    }
  }
}

function destroyBuilding(state, plot, heroes) {
  const old = plot.building;
  const label = old.name;
  if (plot.businessId) {
    const b = state.businesses.find((x) => x.id === plot.businessId);
    if (b) closeBusiness(state, b, 'CLOSED', 'building destroyed');
  }
  for (const id of plot.residents) {
    const c = state.citizens.find((x) => x.id === id);
    if (c) { c.homePlotId = null; remember(state, c, `Lost my home to fire.`, 3, 'loss'); c.mood = Math.max(0, c.mood - 20); }
  }
  plot.residents = [];
  plot.building = { type: 'ruins', name: `Ruins of ${label.replace(/^Empty /, '')}`, builtDay: state.day, condition: 0, was: old.type };
  plot.businessId = null;
  plot.constructionStatus = 'COMPLETE';
  season(state).troubledUntil = state.day + DAYS_PER_YEAR / 2;
  state.eventLog.push({ type: 'buildingDestroyed', day: state.day, plotId: plot.id });
  plotHistory(state, plot, `${label} burned to the ground.`);
  record(state, 'construction', `${label} on ${plot.name} burned to the ground${heroes.length ? ` despite the efforts of ${heroes.length} villagers` : ''}.`, { plot: plot.id }, 3);
}

/** Owners repair damaged buildings and clear ruins; the council does the same for public property. */
function scheduleRepairs(state) {
  for (const p of state.plots) {
    if (!p.building || p.projectId) continue;
    const owner = p.ownerId === 'council' ? null : state.citizens.find((c) => c.id === p.ownerId);
    const funds = owner ? balance(state, owner.id) : balance(state, 'treasury');
    if (p.building.type === 'ruins') {
      if (funds > 20 && (owner || p.ownerId === 'council')) startProject(state, { plotId: p.id, ownerId: p.ownerId, kind: 'demolition' });
    } else if ((p.building.condition ?? 100) < 70 && funds > 25) {
      startProject(state, { plotId: p.id, ownerId: p.ownerId, kind: 'repair' });
    }
  }
}

// ---------------------------------------------------------------------------
// Disease
// ---------------------------------------------------------------------------

function maybeOutbreak(state) {
  const s = season(state);
  const sick = state.citizens.filter((c) => c.health.sickUntil > state.day);
  if (s.outbreak && !sick.length) {
    record(state, 'citizen', `The sickness has passed. ${s.outbreak.cases} fell ill and ${s.outbreak.deaths} died.`, {}, 2);
    state.eventLog.push({ type: 'outbreakEnded', day: state.day, cases: s.outbreak.cases, deaths: s.outbreak.deaths });
    s.outbreak = null;
  }
  if (s.outbreak) return;
  const beds = state.plots.reduce((t, p) => t + bedsAt(state, p), 0);
  const crowding = state.citizens.length / Math.max(1, beds);
  const risk = EVENTS.diseaseDailyChance * (0.5 + crowding) * (wells(state).length ? 0.6 : 1.2) * (state.discoveries?.sanitation ? 0.5 : 1) * (healthHooks.disease?.(state) ?? 1) * (seasonOf(state.day) === 'Winter' ? 1.5 : 1);
  if (state.citizens.length < 8 || !chance(state, risk)) return;
  const victims = state.citizens.filter((c) => c.health.immuneUntil <= state.day).sort(() => nextRandom(state) - 0.5).slice(0, 2);
  if (!victims.length) return;
  s.outbreak = { startDay: state.day, cases: 0, deaths: 0 };
  for (const v of victims) infect(state, v);
  s.troubledUntil = state.day + DAYS_PER_YEAR / 2;
  state.eventLog.push({ type: 'outbreak', day: state.day });
  record(state, 'citizen', `A fever is spreading: ${victims.map((v) => v.firstName).join(' and ')} fell ill first.`, { citizens: victims.map((v) => v.id) }, 3);
}

export function infect(state, c) {
  if (c.health.sickUntil > state.day || c.health.immuneUntil > state.day) return false;
  c.health.sickUntil = state.day + intRange(state, 2, 4);
  c.health.immuneUntil = c.health.sickUntil + DAYS_PER_YEAR * 2;
  if (season(state).outbreak) season(state).outbreak.cases++;
  remember(state, c, 'Fell ill with the fever.', 2, 'event');
  return true;
}

/** Called when two people spend time together. */
export function maybeSpread(state, a, b) {
  const sa = a.health.sickUntil > state.day, sb = b.health.sickUntil > state.day;
  if (sa === sb) return;
  if (chance(state, EVENTS.diseaseSpread)) infect(state, sa ? b : a);
}

export function noteDiseaseDeath(state) {
  if (season(state).outbreak) season(state).outbreak.deaths++;
}

/** Hunger drains faster in a harsh winter. */
// People burn more food in winter, and more again in a harsh one.
export const hungerMultiplier = (state) => (seasonOf(state.day) === 'Winter' ? (state.season?.harshWinter ? 1.25 : 1.06) : 1);
export const harvestMultiplier = (state) => (state.season?.cropFailureYear === yearOf(state.day) ? 0.5 : 1);
export const inRecession = (state) => (state.season?.recessionUntil ?? 0) > state.day;

export { LIFE, ageOf };
