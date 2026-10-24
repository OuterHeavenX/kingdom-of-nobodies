import { openAccount } from '../economy/Transactions.js';
import { PROFESSIONS } from './Careers.js';

const HAIR = ['short', 'long', 'bun', 'bald', 'braid', 'curly'];

/** Create a citizen record and its wallet. All fields are plain JSON for saving. */
export function createCitizen(state, template) {
  const spec = structuredClone(template);
  const id = 'c' + ++state.nextId.citizen;
  const skills = { ...(spec.skills ?? {}) };
  const own = PROFESSIONS[spec.profession]?.skill;
  if (own && skills[own] === undefined) skills[own] = 0.4;
  const c = {
    id,
    firstName: spec.firstName,
    lastName: spec.lastName,
    age: spec.age,
    color: spec.color,
    appearance: spec.appearance ?? { hair: HAIR[state.nextId.citizen % HAIR.length], hairColor: '#5a3b26', skin: '#f2cfab' },
    profession: spec.profession,
    legacyTrait: spec.legacyTrait ?? null,
    traits: spec.traits,
    skills,
    needs: { hunger: 72, energy: 86, social: 62 },
    mood: 70,
    inventory: {},
    homePlotId: spec.homePlotId ?? null,
    employment: null,
    employmentHistory: [],
    dream: spec.dream,
    venture: null,
    plan: { goal: 'Settling in', steps: [], next: '' },
    memories: [],
    beliefs: {},
    reputation: { reliability: 55, honesty: spec.traits.dishonest ? 45 : 58, generosity: 50, competence: 45, standing: 45 },
    romance: { partnerId: null, courtingId: null, since: 0, history: [] },
    family: { partnerId: null, parentIds: [], childIds: [] },
    activity: null,
    decision: { action: 'idle', label: 'Looking around', reason: 'Just arrived.', alternatives: [] },
    shiftsToday: 0,
    x: spec.x ?? 0,
    z: spec.z ?? 0,
    stats: { shiftsWorked: 0, shiftsMissed: 0, earned: 0, spent: 0, gifts: 0, buildingsCompleted: 0, sales: 0 },
    arrivedDay: state.day,
  };
  state.citizens.push(c);
  openAccount(state, id, 0);
  return c;
}

export const fullName = (c) => `${c.firstName} ${c.lastName}`;
export const citizenById = (state, id) => state.citizens.find((c) => c.id === id) ?? null;
