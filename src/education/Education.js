import { byId } from '../core/EntityRegistry.js';
import { EDUCATION, LIFE } from '../core/Config.js';
import { nextRandom, pick } from '../core/Random.js';
import { transfer, balance } from '../economy/Transactions.js';
import { isTrading, produce, BUSINESS_TYPES } from '../economy/Businesses.js';
import { offeredWage, hire } from '../economy/Employment.js';
import { ageOf, achieve } from '../citizens/Citizen.js';
import { adjustBoth } from '../citizens/Relationships.js';
import { trait } from '../ai/Personality.js';
import { gainSkill, topSkills } from './Skills.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';

// Lessons, apprenticeships, mentoring and the choice of a trade.

export const TRADES = {
  farming: { profession: 'Farmer', business: 'farm', interests: { hardworking: 1, loyal: 0.5 } },
  forestry: { profession: 'Woodcutter', business: 'lumberyard', interests: { hardworking: 1, riskTaking: 0.4 } },
  building: { profession: 'Builder', business: null, interests: { creative: 1, curious: 0.5 } },
  smithing: { profession: 'Blacksmith', business: 'blacksmith', interests: { stubborn: 0.6, hardworking: 0.8, curious: 0.4 } },
  baking: { profession: 'Baker', business: 'bakery', interests: { creative: 0.6, generous: 0.5 } },
  hospitality: { profession: 'Innkeeper', business: 'tavern', interests: { friendly: 1.2, generous: 0.4 } },
  trade: { profession: 'Merchant', business: 'general_store', interests: { ambitious: 1, greedy: 0.6, curious: 0.3 } },
  foraging: { profession: 'Forager', business: null, interests: { curious: 0.8, shy: 0.5, frugal: 0.4 } },
};

export const tradeOfProfession = (p) => Object.entries(TRADES).find(([, t]) => t.profession === p.replace(/^Retired /, ''))?.[0] ?? null;

/**
 * A teenager picks a trade. Temperament matters most; a parent's trade is a
 * pull a loyal child feels more than a stubborn or curious one; local demand
 * and individual chance do the rest, so children often choose differently.
 */
export function chooseTrade(state, teen) {
  const parentTrades = teen.family.parentIds.map((id) => byId(state.citizens, id) ?? state.archive[id])
    .filter(Boolean).map((p) => tradeOfProfession(p.profession)).filter(Boolean);
  let best = null, bestScore = -Infinity;
  for (const [key, t] of Object.entries(TRADES)) {
    let s = nextRandom(state) * 1.6;
    for (const [tr, w] of Object.entries(t.interests)) s += trait(teen, tr) * w;
    if (parentTrades.includes(key)) s += 0.5 + trait(teen, 'loyal') * 0.8 - trait(teen, 'stubborn') * 0.4;
    s += (teen.skills[key] ?? 0) * 1.5;
    if (t.business && state.businesses.some((b) => b.type === t.business && isTrading(b))) s += 0.35;
    if (s > bestScore) { bestScore = s; best = key; }
  }
  teen.education.trade = best;
  const followed = parentTrades.includes(best);
  remember(state, teen, `Decided to learn ${best === 'trade' ? 'trading' : best}${followed ? ', like my family' : parentTrades.length ? ', breaking with family tradition' : ''}.`, 2, 'education');
  return best;
}

/** Find a master for an apprentice: a skilled owner or worker in that trade. */
export function findMaster(state, teen) {
  const trade = teen.education.trade;
  const t = TRADES[trade];
  if (!t) return null;
  const taken = new Set(state.citizens.filter((x) => x.education.masterId).map((x) => x.education.masterId));
  const candidates = state.citizens.filter((m) => m !== teen && ageOf(state, m) >= LIFE.adultAge && (m.skills[trade] ?? 0) >= 0.45 && !taken.has(m.id) && !m.retired &&
    (t.business ? m.employment && state.businesses.find((b) => b.id === m.employment.businessId)?.type === t.business : m.profession === t.profession));
  candidates.sort((a, b) => (b.skills[trade] + (b.skills.teaching ?? 0) * 0.5) - (a.skills[trade] + (a.skills.teaching ?? 0) * 0.5));
  const master = candidates[0];
  if (!master) return null;
  teen.education.masterId = master.id;
  teen.education.apprenticeSince = state.day;
  remember(state, teen, `Became apprenticed to ${master.firstName}.`, 3, 'education');
  remember(state, master, `Took on ${teen.firstName} as an apprentice.`, 2, 'education');
  record(state, 'citizen', `${teen.firstName} became apprenticed to ${master.firstName} to learn ${trade === 'trade' ? 'trading' : trade}.`, { citizens: [teen.id, master.id] }, 1);
  return master;
}

export function schoolOpen(state) {
  return state.businesses.find((b) => b.type === 'school' && isTrading(b)) ?? null;
}

/** A lesson: at school with a teacher present, or at home from a guardian. */
export function completeLesson(state, c, guardian) {
  const school = schoolOpen(state);
  const teacherPresent = school && state.citizens.some((t) => t.activity?.kind === 'work' && t.activity.businessId === school.id && t.activity.phase === 'perform');
  let gain = EDUCATION.lessonGain * (teacherPresent ? EDUCATION.schoolBonus : 1) * (0.8 + trait(c, 'curious') * 0.5 - trait(c, 'lazy') * 0.3);
  c.education.level = Math.min(1, Math.round((c.education.level + gain) * 1000) / 1000);
  if (teacherPresent) {
    const teacher = state.citizens.find((t) => t.activity?.kind === 'work' && t.activity.businessId === school.id);
    gainSkill(teacher, 'teaching', 0.004);
  } else if (guardian) {
    const [skill] = topSkills(guardian, 1)[0] ?? [];
    if (skill) gainSkill(c, skill, 0.006);
    gainSkill(guardian, 'teaching', 0.003);
    adjustBoth(state, c.id, guardian.id, { friendship: 1, trust: 1 });
  }
  // Upbringing nudges temperament a little: patient, kind teaching breeds kindness.
  if (guardian && trait(guardian, 'generous') > 0.5 && nextRandom(state) < 0.02) c.traits.generous = Math.min(0.9, (c.traits.generous ?? 0.2) + 0.05);
  return gain;
}

/** An apprentice's shift: real (if modest) output, fast learning, a small stipend. */
export function completeApprenticeship(state, c, master) {
  const trade = c.education.trade;
  const b = master?.employment ? state.businesses.find((x) => x.id === master.employment.businessId) : null;
  if (b && isTrading(b)) produce(state, b, 0.45 + (c.skills[trade] ?? 0) * 0.4);
  gainSkill(c, trade, 0.012 * EDUCATION.apprenticeGainMultiplier);
  if (master) {
    gainSkill(master, 'teaching', 0.005);
    adjustBoth(state, c.id, master.id, { friendship: 1.5, trust: 1, respect: 1.5 });
  }
  const payer = state.government?.policies?.apprenticeshipGrants ? 'treasury' : b?.id;
  if (payer && balance(state, payer) >= EDUCATION.apprenticeStipend) transfer(state, payer, c.id, EDUCATION.apprenticeStipend, 'wage', `${c.firstName}'s apprentice stipend`);
  c.shiftsToday++;
}

/** Elders and experts pass on what they know. */
export function completeMentoring(state, mentor, student, skill) {
  const gain = EDUCATION.mentorGain * (0.6 + (mentor.skills.teaching ?? 0.2));
  gainSkill(student, skill, gain);
  gainSkill(mentor, 'teaching', 0.006);
  adjustBoth(state, mentor.id, student.id, { friendship: 2, respect: 2 });
  if (!mentor.achievements.some((a) => a.type === 'mentor' && a.student === student.id)) {
    achieve(state, mentor, 'mentor', `Mentored ${student.firstName} in ${skill}`, { student: student.id });
  }
}

/** Coming of age: pick a profession and a dream, and try to keep a job with one's master. */
export function onAdulthood(state, c) {
  const trade = c.education.trade ?? pick(state, Object.keys(TRADES));
  const t = TRADES[trade];
  c.profession = t.profession;
  const master = byId(state.citizens, c.education.masterId);
  c.education.masterId = null;
  c.dream = dreamForYoungAdult(state, c, trade);
  achieve(state, c, 'trained', `Trained as a ${t.profession.toLowerCase()}`);
  if (master?.employment) {
    const b = state.businesses.find((x) => x.id === master.employment.businessId);
    if (b && isTrading(b) && balance(state, b.id) > offeredWage(c, b) * 3) hire(state, c, b, offeredWage(c, b));
  }
}

function dreamForYoungAdult(state, c, trade) {
  const t = TRADES[trade];
  const r = nextRandom(state);
  if (trait(c, 'ambitious') > 0.5 && (c.skills.leadership ?? 0) + c.education.level > 0.7 && r < 0.5) return { type: 'leader', text: 'Lead the village' };
  if (t.business && (trait(c, 'ambitious') + trait(c, 'riskTaking') > 0.6 || r < 0.3)) return { type: 'business', businessType: t.business, text: `Open a ${BUSINESS_TYPES[t.business].label.toLowerCase()}` };
  if (trade === 'building') return { type: 'master_builder', target: 3, text: 'Become a master builder' };
  if ((c.familyWish ?? 0.5) > 0.6 && r < 0.6) return { type: 'homestead', text: 'Raise a family in a home of my own' };
  if (trait(c, 'generous') > 0.5 || trait(c, 'friendly') > 0.6) return { type: 'respected', text: 'Be respected by everyone' };
  return pick(state, [{ type: 'wealth', target: 120, text: 'Save 120 coins' }, { type: 'partner', text: 'Find a life partner' }, { type: 'homestead', text: 'Build a home of my own' }]);
}
