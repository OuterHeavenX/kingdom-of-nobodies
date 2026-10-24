import { dateLabel, ageOn, yearOf } from '../core/Calendar.js';

// The historical archive keeps a compact, permanent record of every person who
// has died or left. Nothing about a person's identity is deleted: names, dates,
// family links, careers and achievements stay available for biographies,
// family trees and the Founders' Memorial.

export function archiveCitizen(state, c, status, cause) {
  const rec = {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    sex: c.sex,
    birthDay: c.birthDay,
    deathDay: status === 'dead' ? state.day : null,
    leftDay: status === 'emigrated' ? state.day : null,
    status,
    cause: cause ?? null,
    ageAtEnd: ageOn(c.birthDay, state.day),
    generation: c.generation,
    founder: c.founder,
    color: c.color,
    appearance: c.appearance,
    profession: c.profession,
    legacyTrait: c.legacyTrait,
    traits: c.traits,
    dream: { text: c.dream.text, fulfilledDay: c.dream.fulfilledDay ?? null },
    family: { ...c.family, parentIds: [...c.family.parentIds], childIds: [...c.family.childIds], formerSpouseIds: [...c.family.formerSpouseIds] },
    employmentHistory: c.employmentHistory.slice(-8),
    achievements: c.achievements.slice(),
    skills: Object.fromEntries(Object.entries(c.skills).filter(([, v]) => v >= 0.35)),
    education: { level: c.education.level, trade: c.education.trade },
    reputation: { ...c.reputation },
    stats: { earned: c.stats.earned, shiftsWorked: c.stats.shiftsWorked, buildingsCompleted: c.stats.buildingsCompleted, gifts: c.stats.gifts, maxStaff: c.stats.maxStaff },
    bornHere: c.bornHere,
    arrivedDay: c.arrivedDay,
    lastMemories: c.memories.filter((m) => m.weight >= 3).slice(0, 5),
  };
  state.archive[c.id] = rec;
  return rec;
}

export function lifespanLabel(p) {
  const born = dateLabel(p.birthDay);
  if (p.status === 'dead') return `${born} – ${dateLabel(p.deathDay)}`;
  if (p.status === 'emigrated') return `${born} – left in Year ${yearOf(p.leftDay)}`;
  return `born ${born}`;
}
