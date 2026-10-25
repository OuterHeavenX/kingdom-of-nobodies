import { byId } from '../core/EntityRegistry.js';
import { LIFE, DAYS_PER_YEAR, TIME, FOOD_GOODS } from '../core/Config.js';
import { ageOn, stageForAge, isBirthday, seasonOf, yearOf } from '../core/Calendar.js';
import { chance } from '../core/Random.js';
import { balance } from '../economy/Transactions.js';
import { leaveJob } from '../economy/Employment.js';
import { settleEstate, resolveTrusts, transferBusiness, chooseSuccessor } from '../economy/Inheritance.js';
import { isTrading } from '../economy/Businesses.js';
import { archiveCitizen } from '../history/Archive.js';
import { adjust, peekRel } from './Relationships.js';
import { ageOf, achieve } from './Citizen.js';
import { trait } from '../ai/Personality.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { plotById } from '../property/LandRegistry.js';
import { noteDiseaseDeath } from '../events/Disasters.js';

// Ageing, life stages, retirement and mortality. Ages are derived from birth
// days, so this module only reacts to transitions; it never counts years.

/** Other systems (government, education, families) register to hear about deaths and coming-of-age. */
export const lifecycleHooks = { death: [], adulthood: [], teen: [] };

/** Daily probability of dying of natural causes, from a yearly Gompertz curve plus circumstances. */
export function dailyMortality(state, c) {
  const age = ageOf(state, c);
  let yearly = LIFE.gompertzA * Math.exp(LIFE.gompertzB * age);
  if (age < 3) yearly += LIFE.infantYearlyRisk;
  const home = plotById(state, c.homePlotId);
  if (!home) yearly *= 1.3;
  if (state.season?.harshWinter && seasonOf(state.day) === 'Winter' && (age >= 60 || age < 3)) yearly *= 2;
  if (state.discoveries?.sanitation) yearly *= 0.85;
  yearly = Math.min(0.95, yearly);
  let daily = 1 - Math.pow(1 - yearly, 1 / DAYS_PER_YEAR);
  if (c.health.starvingDays > 0) daily += LIFE.starvationDailyRisk * c.health.starvingDays;
  if (c.health.sickUntil > state.day) daily += age >= 60 || age < 3 ? 0.012 : 0.002;
  return Math.min(1, daily);
}

function causeOf(state, c) {
  if (c.health.starvingDays >= 1) return 'hunger';
  if (c.health.sickUntil > state.day) return 'illness';
  const age = ageOf(state, c);
  if (age < 3) return 'a childhood fever';
  if (state.season?.harshWinter && seasonOf(state.day) === 'Winter') return 'the bitter winter';
  return age >= 60 ? 'old age' : 'a sudden illness';
}

/** Why a villager starved: the archive keeps this so famines can be told apart from poverty. */
export function hungerCause(state, c) {
  if (c.away) return 'stranded away from home';
  const forSale = state.businesses.some((b) => isTrading(b) && FOOD_GOODS.some((g) => (b.inventory[g] ?? 0) > 0));
  if (!forSale) return 'no food to be had in the village';
  if (ageOf(state, c) < LIFE.adultAge) {
    const g = byId(state.citizens, c.family.guardianId);
    if (!g) return 'an orphan the council could not feed';
    return balance(state, g.id) < 2 ? `a child of a family too poor to buy food${g.employment ? '' : ' (no work)'}` : 'a child left unfed at home';
  }
  if (balance(state, c.id) < 2) return c.employment ? 'wages too low to buy food' : 'out of work and penniless';
  return 'too ill or frail to fetch food';
}

/** Runs once at the start of each day. */
export function dailyLifecycle(state) {
  const deaths = [];
  for (const c of state.citizens) {
    c.health.starvingDays = c.needs.hunger <= 1 ? c.health.starvingDays + 1 : 0;
    const age = ageOf(state, c);
    if (isBirthday(c.birthDay, state.day)) onBirthday(state, c, age);
    if (chance(state, dailyMortality(state, c))) deaths.push([c, causeOf(state, c)]);
    else if (age >= LIFE.retireAge && !c.retired && c.employment) considerRetirement(state, c, age);
  }
  for (const [c, cause] of deaths) {
    const why = cause === 'hunger' ? hungerCause(state, c) : null;
    const entry = die(state, c, cause);
    if (entry && why) entry.hungerCause = why;
  }
}

function onBirthday(state, c, age) {
  const before = stageForAge(age - 1), now = stageForAge(age);
  if (before.id === now.id) return;
  if (now.id === 'child') remember(state, c, 'Old enough to run about the village.', 1, 'life');
  if (now.id === 'teen') {
    remember(state, c, 'Became a teenager.', 2, 'life');
    for (const fn of lifecycleHooks.teen) fn(state, c);
  }
  if (now.id === 'young') {
    remember(state, c, 'Came of age.', 3, 'life');
    record(state, 'citizen', `${c.firstName} ${c.lastName} came of age in Year ${yearOf(state.day)}.`, { citizens: [c.id] }, 1);
    for (const fn of lifecycleHooks.adulthood) fn(state, c);
    resolveTrusts(state, c);
  }
  if (now.id === 'elder') {
    remember(state, c, 'Became one of the village elders.', 2, 'life');
    record(state, 'citizen', `${c.firstName} ${c.lastName} turned sixty.`, { citizens: [c.id] }, 1);
  }
}

/** Elders may step back from work: owners hand over to family, workers simply retire. */
function considerRetirement(state, c, age) {
  const p = (age - LIFE.retireAge + 1) * 0.004 + trait(c, 'lazy') * 0.01 + (balance(state, c.id) > 60 ? 0.006 : 0) - trait(c, 'hardworking') * 0.003;
  if (!chance(state, Math.max(0.001, p))) return;
  const b = c.employment.role === 'owner' ? state.businesses.find((x) => x.id === c.employment.businessId) : null;
  if (b && isTrading(b)) {
    const family = [c.family.spouseId, ...c.family.childIds].map((id) => byId(state.citizens, id)).filter(Boolean);
    const { heir, outcome } = chooseSuccessor(state, b, family);
    if (!heir || outcome !== 'successor') return; // no one to hand over to: keep working
    leaveJob(state, c, 'retired');
    transferBusiness(state, b, c, heir, 'successor', 'retirement');
  } else {
    leaveJob(state, c, 'retired');
  }
  c.retired = true;
  c.profession = `Retired ${c.profession.replace(/^Retired /, '')}`;
  remember(state, c, 'Retired from work.', 2, 'career');
  record(state, 'citizen', `${c.firstName} ${c.lastName} retired at the age of ${age}.`, { citizens: [c.id] }, 1);
}

/**
 * A citizen dies. Every consequence is applied here exactly once: work,
 * partnerships, guardianship, the estate, housing, relationships, and the
 * permanent archive record.
 */
export function die(state, c, cause) {
  if (!state.citizens.includes(c)) return null;
  const age = ageOf(state, c);
  if (c.activity?.kind === 'build') { const p = state.projects.find((x) => x.id === c.activity.projectId); if (p) delete p.crew[c.id]; }
  c.activity = null;
  if (c.employment) leaveJob(state, c, 'died');
  for (const b of state.businesses) b.employees = b.employees.filter((id) => id !== c.id);
  const spouse = byId(state.citizens, c.family.spouseId);
  if (spouse) {
    spouse.family.spouseId = null;
    spouse.family.formerSpouseIds.push(c.id);
    spouse.romance.partnerId = null;
    spouse.family.partnerId = null;
    spouse.widowedDay = state.day;
    spouse.mood = Math.max(0, spouse.mood - 30);
    remember(state, spouse, `Lost my ${spouse.family.formerSpouseIds.length > 1 ? 'spouse' : 'beloved'} ${c.firstName}.`, 3, 'loss');
  }
  for (const o of state.citizens) {
    if (o === c) continue;
    if (o.romance.partnerId === c.id) { o.romance.partnerId = null; o.family.partnerId = null; }
    if (o.romance.courtingId === c.id) o.romance.courtingId = null;
    if (o.romance.engagedTo === c.id) o.romance.engagedTo = null;
    if (o.education.masterId === c.id) o.education.masterId = null;
    const r = peekRel(state, o.id, c.id);
    const kin = o.family.parentIds.includes(c.id) || c.family.parentIds.includes(o.id);
    if (kin || (r && (r.friendship > 55 || r.affection > 55))) {
      o.mood = Math.max(0, o.mood - (kin ? 20 : 8));
      if (o !== spouse) remember(state, o, `Mourned ${c.firstName}${kin ? `, my ${c.family.parentIds.includes(o.id) ? 'child' : 'parent'}` : ''}.`, kin ? 3 : 2, 'loss');
    }
  }
  reassignWards(state, c);
  for (const fn of lifecycleHooks.death) fn(state, c);
  settleEstate(state, c);
  const home = plotById(state, c.homePlotId);
  if (home) home.residents = home.residents.filter((id) => id !== c.id);
  for (const key of Object.keys(state.relationships)) if (key.startsWith(c.id + '|') || key.endsWith('|' + c.id)) delete state.relationships[key];
  archiveCitizen(state, c, 'dead', cause);
  state.citizens = state.citizens.filter((x) => x !== c);
  if (balance(state, c.id) === 0) delete state.accounts[c.id];
  state.stats.deaths++;
  if (cause === 'illness') noteDiseaseDeath(state);
  record(state, 'citizen', `${c.firstName} ${c.lastName} died of ${cause} at the age of ${age}.${c.founder ? ' One of the five founders has passed.' : ''}`, { citizens: [c.id] }, c.founder || age < 18 ? 3 : 2);
  return state.archive[c.id];
}

/** Children whose guardian died are taken in by the other parent, a grown sibling, a grandparent, or the council. */
export function reassignWards(state, guardian) {
  for (const child of state.citizens) {
    // Grown children keep their own homes; guardianship only matters for minors.
    if (ageOf(state, child) >= LIFE.adultAge) continue;
    if (child.family.guardianId !== guardian.id && !(child.family.parentIds.includes(guardian.id) && ageOf(state, child) < LIFE.adultAge)) continue;
    if (child.family.guardianId && child.family.guardianId !== guardian.id && state.citizens.some((x) => x.id === child.family.guardianId)) continue;
    const alive = (id) => state.citizens.find((x) => x.id === id && x !== guardian);
    const otherParent = child.family.parentIds.map(alive).find(Boolean);
    const sibling = state.citizens.find((x) => x !== guardian && x !== child && ageOf(state, x) >= LIFE.adultAge && x.family.parentIds.some((p) => child.family.parentIds.includes(p)));
    const grandparent = child.family.parentIds.flatMap((p) => (state.archive[p] ?? byId(state.citizens, p))?.family.parentIds ?? []).map(alive).find(Boolean);
    const next = otherParent ?? sibling ?? grandparent ?? null;
    child.family.guardianId = next ? next.id : 'council';
    if (next && next.homePlotId && child.homePlotId !== next.homePlotId) {
      const old = plotById(state, child.homePlotId);
      if (old) old.residents = old.residents.filter((id) => id !== child.id);
      child.homePlotId = next.homePlotId;
      const home = plotById(state, next.homePlotId);
      if (home && !home.residents.includes(child.id)) home.residents.push(child.id);
    }
    if (!next) record(state, 'citizen', `Young ${child.firstName} was left without family and is now cared for by the council.`, { citizens: [child.id] }, 2);
  }
}

export const yearsToTicks = (years) => years * DAYS_PER_YEAR * TIME.ticksPerDay;
export { achieve, adjust };
