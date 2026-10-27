// Skills are stored as 0..1 values on each citizen (c.skills[key]). Levels are
// a presentation of that value. Experience comes only from doing: working,
// building, foraging, teaching, leading, socialising, lessons and mentoring.

export const SKILLS = {
  farming: 'Farming', forestry: 'Woodcutting', building: 'Construction', smithing: 'Blacksmithing',
  baking: 'Baking', hospitality: 'Cooking & hosting', trade: 'Trading', foraging: 'Foraging',
  leadership: 'Leadership', diplomacy: 'Diplomacy', teaching: 'Teaching',
};

export const LEVELS = [[0.8, 'Master'], [0.6, 'Expert'], [0.4, 'Journeyman'], [0.2, 'Apprentice'], [0, 'Novice']];
export const levelOf = (v) => LEVELS.find(([min]) => v >= min)[1];

/** Gain experience in a skill. Better-educated people learn a little faster. */
/** Optional per-citizen learning-rate multipliers (state is not passed to gainSkill, so hooks read the citizen). */
export const skillHooks = [];

export function gainSkill(c, skill, amount) {
  const rate = (0.75 + (c.education?.level ?? 0.3) * 0.5) * skillHooks.reduce((m, fn) => m * (fn(c, skill) ?? 1), 1);
  c.skills[skill] = Math.min(1, Math.round(((c.skills[skill] ?? 0.05) + amount * rate) * 1000) / 1000);
  return c.skills[skill];
}

export function topSkills(c, n = 3) {
  return Object.entries(c.skills).filter(([k]) => SKILLS[k]).sort((a, b) => b[1] - a[1]).slice(0, n);
}
