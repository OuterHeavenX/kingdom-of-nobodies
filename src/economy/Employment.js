import { setProfession } from '../citizens/Careers.js';
import { noteUnpaidWage } from '../law/Courts.js';
import { workOnRoad } from '../navigation/RoadConstruction.js';
import { byId } from '../core/EntityRegistry.js';
import { ECONOMY } from '../core/Config.js';
import { transfer, balance } from './Transactions.js';
import { BUSINESS_TYPES, businessById, isTrading, produce, staffCap } from './Businesses.js';
import { baseWage, productivity, improveSkill, skillFor, SKILL_FOR_BUSINESS, PROFESSION_FOR_BUSINESS } from '../citizens/Careers.js';
import { adjust, adjustBoth, peekRel } from '../citizens/Relationships.js';
import { bump } from '../society/Reputation.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { createFact } from '../society/Gossip.js';
import { trait } from '../ai/Personality.js';
import { cashReserve, ownerAccount } from './Marketplace.js';

// Hiring, firing, wages and shift output.

export function wageBill(state, b) {
  return b.employees.reduce((s, id) => s + (byId(state.citizens, id)?.employment?.wage ?? 0), 0);
}

export function openPositions(state, c) {
  return state.businesses
    .filter((b) => isTrading(b) && b.openings > 0 && b.ownerId !== c.id && !b.employees.includes(c.id))
    .map((b) => {
      const wage = offeredWage(c, b);
      const owner = byId(state.citizens, b.ownerId);
      const friendship = owner ? peekRel(state, c.id, owner.id)?.friendship ?? 20 : 20;
      return { business: b, wage, score: wage * 3 + skillFor(c, b.type) * 10 + friendship * 0.05 };
    })
    .sort((a, b) => b.score - a.score);
}

export function offeredWage(c, b) {
  return Math.max(ECONOMY.minWage, baseWage(PROFESSION_FOR_BUSINESS[b.type]) + Math.round(skillFor(c, b.type) * 2) - 1);
}

/** The employer weighs skills, reliability, relationship and whether they can afford the wage. */
/** Optional adjustments to how an applicant is judged (each returns points added to the score). */
export const hiringHooks = [];

export function applyForJob(state, c, b) {
  if (!isTrading(b) || b.openings < 1) return { ok: false, reason: `${b.name} is no longer hiring` };
  const wage = offeredWage(c, b);
  if (balance(state, b.id) < wage * 3 + wageBill(state, b)) return { ok: false, reason: `${b.name} cannot afford another wage` };
  const owner = byId(state.citizens, b.ownerId);
  const trust = owner ? peekRel(state, owner.id, c.id)?.trust ?? 45 : 50;
  const score = skillFor(c, b.type) * 40 + c.reputation.reliability * 0.5 + trust * 0.3 + hiringHooks.reduce((s, fn) => s + (fn(state, c, b) ?? 0), 0);
  if (score < 30) return { ok: false, reason: `${owner?.firstName ?? 'The council'} doubted my reliability` };
  hire(state, c, b, wage);
  return { ok: true, wage };
}

export function hire(state, c, b, wage) {
  if (c.employment) leaveJob(state, c, 'took a new position');
  c.employment = { businessId: b.id, role: 'worker', wage, since: state.day, unpaid: 0 };
  b.employees.push(c.id);
  b.openings = Math.max(0, b.openings - 1);
  const boss = byId(state.citizens, b.ownerId);
  if (boss) boss.stats.maxStaff = Math.max(boss.stats.maxStaff ?? 0, b.employees.length);
  const profession = PROFESSION_FOR_BUSINESS[b.type];
  const changed = profession !== c.profession && c.profession !== 'Builder' && b.type !== 'works';
  if (changed) setProfession(state, c, profession);
  c.employmentHistory.push({ businessId: b.id, name: b.name, from: state.day, to: null, role: 'worker' });
  record(state, 'business', `${b.name} hired ${c.firstName} as a ${profession.toLowerCase()} for ${wage} coins a shift.`, { citizens: [c.id], business: b.id }, 2);
  remember(state, c, `Hired at ${b.name}${changed ? `, becoming a ${profession.toLowerCase()}` : ''}.`, 2, 'career');
  c.mood = Math.min(100, c.mood + 8);
}

export function leaveJob(state, c, why) {
  const job = c.employment;
  if (!job) return;
  const b = businessById(state, job.businessId);
  if (b) b.employees = b.employees.filter((id) => id !== c.id);
  const h = c.employmentHistory.findLast?.((e) => e.businessId === job.businessId && e.to === null);
  if (h) { h.to = state.day; h.left = why; }
  c.employment = null;
}

/** Employer lets go of their least valued worker. */
export function layOff(state, b, reason) {
  if (!b.employees.length) return null;
  const owner = byId(state.citizens, b.ownerId);
  const ranked = b.employees.map((id) => byId(state.citizens, id)).filter(Boolean)
    .map((c) => ({ c, score: skillFor(c, b.type) * 30 + c.reputation.reliability * 0.4 + (owner ? (peekRel(state, owner.id, c.id)?.friendship ?? 20) * 0.4 * (1 + trait(owner, 'loyal')) : 0) }))
    .sort((x, y) => x.score - y.score);
  const c = ranked[0].c;
  leaveJob(state, c, 'laid off');
  c.mood = Math.max(0, c.mood - 18);
  remember(state, c, `Was let go from ${b.name}.`, 3, 'career');
  if (owner) {
    adjust(state, c.id, owner.id, { trust: -12, friendship: -8, rivalry: 10 + trait(c, 'jealous') * 20 });
  }
  record(state, 'business', `${b.name} let ${c.firstName} go (${reason}).`, { citizens: [c.id, ...(owner ? [owner.id] : [])], business: b.id }, 2);
  createFact(state, 'fired', c.id, `${c.firstName} lost their job at ${b.name}.`, [c.id, ...(owner ? [owner.id] : [])]);
  return c;
}

/**
 * A worker finished a shift: the business produces, the worker is paid (unless
 * they own it), skills and reputation improve, and coworkers bond.
 */
export function completeShift(state, c, b) {
  if (!isTrading(b)) return { ok: false, produced: 0, paid: 0 };
  const produced = produce(state, b, productivity(c, b.type));
  if (b.type === 'works' && !workOnRoad(state, c)) maintain(state, c);
  improveSkill(c, SKILL_FOR_BUSINESS[b.type]);
  c.stats.shiftsWorked++;
  c.shiftsToday++;
  bump(c, 'reliability', 0.6);
  let paid = 0;
  const isOwner = b.ownerId === c.id;
  if (!isOwner && c.employment?.businessId === b.id) {
    const wage = c.employment.wage;
    // A civic institution (works crew, school) whose fund has run dry pays straight from the treasury.
    const payer = BUSINESS_TYPES[b.type].civic && balance(state, b.id) < wage && balance(state, 'treasury') >= wage ? 'treasury' : b.id;
    if (transfer(state, payer, c.id, wage, 'wage', `${c.firstName}'s shift at ${b.name}`)) {
      paid = wage;
      b.today.wages += wage;
      c.stats.earned += wage;
      c.employment.unpaid = 0;
    } else {
      b.unpaidShifts++;
      c.employment.unpaid++;
      c.mood = Math.max(0, c.mood - 6);
      const owner = byId(state.citizens, b.ownerId);
      if (owner) adjust(state, c.id, owner.id, { trust: -10 });
      remember(state, c, `${b.name} could not pay my wage.`, 2, 'grievance');
      noteUnpaidWage(state, c, b, wage);
      if (c.employment.unpaid >= 2) {
        leaveJob(state, c, 'quit after unpaid wages');
        record(state, 'business', `${c.firstName} quit ${b.name} after going unpaid.`, { citizens: [c.id], business: b.id }, 2);
      }
    }
  }
  // Coworkers who also worked today grow closer.
  for (const id of [b.ownerId, ...b.employees]) {
    if (id === c.id || id === 'council') continue;
    const other = byId(state.citizens, id);
    if (other && other.shiftsToday > 0) adjustBoth(state, c.id, other.id, { friendship: 1.5, trust: 0.8, respect: 0.5 });
  }
  return { ok: true, produced, paid };
}

/** A public-works shift repairs the most damaged building in the village. */
function maintain(state, c) {
  const worst = state.plots.filter((p) => p.building && (p.building.condition ?? 100) < 100).sort((a, b) => a.building.condition - b.building.condition)[0];
  if (worst) worst.building.condition = Math.min(100, worst.building.condition + 12 + Math.round((c.skills.building ?? 0) * 8));
  improveSkill(c, 'building', 0.006);
}

/** Daily: decide how many people each business wants to hire. */
export function updateOpenings(state, b) {
  const def = BUSINESS_TYPES[b.type];
  const staff = b.employees.length + (b.ownerId === 'council' ? 0 : 1);
  const lowStock = def.output ? (b.inventory[def.output] ?? 0) < def.target : true;
  const cash = balance(state, b.id);
  const affordable = cash >= cashReserve(state, b) + 6 * 4;
  const flush = cash >= cashReserve(state, b) + 60;
  b.openings = b.status === 'OPEN' && (lowStock || flush) && affordable && staff < staffCap(b) ? 1 : 0;
  if (b.type === 'works') b.openings = cash >= 14 && b.employees.length < staffCap(b) ? 2 : 0;
  if (b.ownerId === 'council' && b.employees.length === 0 && b.status === 'OPEN') b.openings = Math.max(b.openings, 1);
}

export { ownerAccount };
