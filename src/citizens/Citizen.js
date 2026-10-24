import { openAccount } from '../economy/Transactions.js';
import { PROFESSIONS } from './Careers.js';
import { ageOn, stageForAge, birthDayForAge } from '../core/Calendar.js';
import { LIFE } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';

const HAIR = ['short', 'long', 'bun', 'bald', 'braid', 'curly'];

/**
 * Create a living citizen record and their wallet. All fields are plain JSON.
 * spec.birthDay (absolute day) wins over spec.age; ages are always derived.
 */
export function createCitizen(state, template) {
  const spec = structuredClone(template);
  const id = 'c' + ++state.nextId.citizen;
  const skills = { ...(spec.skills ?? {}) };
  const own = PROFESSIONS[spec.profession]?.skill;
  if (own && skills[own] === undefined) skills[own] = 0.4;
  const birthDay = spec.birthDay ?? birthDayForAge(state.day, spec.age ?? 25, (state.nextId.citizen * 5) % 11);
  const c = {
    id,
    firstName: spec.firstName,
    lastName: spec.lastName,
    sex: spec.sex ?? (state.nextId.citizen % 2 ? 'F' : 'M'),
    birthDay,
    generation: spec.generation ?? 1,
    color: spec.color,
    appearance: spec.appearance ?? { hair: HAIR[state.nextId.citizen % HAIR.length], hairColor: '#5a3b26', skin: '#f2cfab', height: 1 },
    profession: spec.profession,
    legacyTrait: spec.legacyTrait ?? null,
    founder: !!spec.founder,
    attraction: spec.attraction ?? attractionFor(state.nextId.citizen),
    traits: spec.traits,
    skills,
    needs: { hunger: 72, energy: 86, social: 62 },
    mood: 70,
    inventory: {},
    homePlotId: spec.homePlotId ?? null,
    employment: null,
    employmentHistory: [],
    retired: false,
    dream: spec.dream,
    venture: null,
    plan: { goal: 'Settling in', steps: [], next: '' },
    memories: [],
    beliefs: {},
    reputation: { reliability: 55, honesty: spec.traits.dishonest ? 45 : 58, generosity: 50, competence: 45, standing: 45 },
    romance: { partnerId: null, courtingId: null, engagedTo: null, since: 0, history: [] },
    family: { partnerId: null, spouseId: null, formerSpouseIds: [], parentIds: spec.parentIds ?? [], childIds: [], guardianId: spec.guardianId ?? null, adoptive: !!spec.adoptive },
    education: { level: spec.educationLevel ?? 0.3, trade: null, masterId: null, apprenticeSince: null },
    pregnancy: null,
    health: { sickUntil: 0, immuneUntil: 0, starvingDays: 0 },
    achievements: [],
    activity: null,
    decision: { action: 'idle', label: 'Looking around', reason: 'Just arrived.', alternatives: [] },
    shiftsToday: 0,
    x: spec.x ?? 0,
    z: spec.z ?? 0,
    stats: { shiftsWorked: 0, shiftsMissed: 0, earned: 0, spent: 0, gifts: 0, buildingsCompleted: 0, sales: 0, maxStaff: 0 },
    arrivedDay: state.day,
    bornHere: !!spec.bornHere,
  };
  state.citizens.push(c);
  openAccount(state, id, 0);
  return c;
}

export const fullName = (c) => `${c.firstName} ${c.lastName}`;
export const citizenById = (state, id) => byId(state.citizens, id);
export const ageOf = (state, c) => ageOn(c.birthDay, state.day);
export const stageOf = (state, c) => stageForAge(ageOf(state, c));
export const isAdult = (state, c) => ageOf(state, c) >= LIFE.adultAge;
export const isMinor = (state, c) => ageOf(state, c) < LIFE.adultAge;

/** Deterministic spread: most people are drawn to the opposite sex, some to the same sex, some to either. */
export function attractionFor(n) {
  const r = (n * 2654435761 >>> 0) % 100;
  return r < 86 ? 'opposite' : r < 93 ? 'same' : 'any';
}

/** Record a structured achievement used later by biographies. */
export function achieve(state, c, type, text, refs = {}) {
  if (!c) return;
  c.achievements.push({ type, text, day: state.day, ...refs });
  if (c.achievements.length > 30) c.achievements.splice(1, 1);
}
