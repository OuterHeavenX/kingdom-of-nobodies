import { CALENDAR, DAYS_PER_YEAR, TIME, LIFE_STAGES } from './Config.js';

// The kingdom calendar. Day 1 is the first day of Spring, Year 1. All dates
// are stored as absolute day numbers (which may be negative for people born
// before the founding), so ages are always derived, never counted, and a
// save/load can never age anyone twice.

export const yearOf = (day) => Math.floor((day - 1) / DAYS_PER_YEAR) + 1;
export const dayOfYear = (day) => ((((day - 1) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR);
export const seasonIndex = (day) => Math.floor(dayOfYear(day) / CALENDAR.daysPerSeason);
export const seasonOf = (day) => CALENDAR.seasons[seasonIndex(day)];
export const dayOfSeason = (day) => (dayOfYear(day) % CALENDAR.daysPerSeason) + 1;
export const isNewYear = (day) => dayOfYear(day) === 0;
export const isNewSeason = (day) => dayOfYear(day) % CALENDAR.daysPerSeason === 0;
export const firstDayOfYear = (year) => (year - 1) * DAYS_PER_YEAR + 1;
export const ticksToDays = (ticks) => ticks / TIME.ticksPerDay;

/** Absolute day a person of `age` years should have been born, given today. */
export const birthDayForAge = (today, age, offset = 0) => today - age * DAYS_PER_YEAR - offset;

/** Whole years lived on `day`. */
export const ageOn = (birthDay, day) => Math.floor((day - birthDay) / DAYS_PER_YEAR);
export const isBirthday = (birthDay, day) => day !== birthDay && dayOfYear(day) === dayOfYear(birthDay);

export function stageForAge(age) {
  let stage = LIFE_STAGES[0];
  for (const s of LIFE_STAGES) if (age >= s.from) stage = s;
  return stage;
}

export function dateLabel(day, { short = false } = {}) {
  const y = yearOf(day);
  return short ? `${seasonOf(day).slice(0, 3)} ${dayOfSeason(day)}, Y${y}` : `${seasonOf(day)} ${dayOfSeason(day)}, Year ${y}`;
}

export { DAYS_PER_YEAR };
