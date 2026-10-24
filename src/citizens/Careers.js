import { WAGES } from '../core/Config.js';

// Which skill each profession uses and which business type employs it.
export const PROFESSIONS = {
  Farmer: { skill: 'farming', works: ['farm'] },
  Woodcutter: { skill: 'forestry', works: ['lumberyard'] },
  Builder: { skill: 'building', works: [] },
  Forager: { skill: 'foraging', works: [] },
  Baker: { skill: 'baking', works: ['bakery'] },
  Blacksmith: { skill: 'smithing', works: ['blacksmith'] },
  Merchant: { skill: 'trade', works: ['general_store'] },
  Innkeeper: { skill: 'hospitality', works: ['tavern'] },
  Laborer: { skill: 'labor', works: ['farm', 'lumberyard', 'general_store', 'tavern'] },
};

export const SKILL_FOR_BUSINESS = {
  farm: 'farming', lumberyard: 'forestry', bakery: 'baking', blacksmith: 'smithing',
  general_store: 'trade', tavern: 'hospitality',
};

export const PROFESSION_FOR_BUSINESS = {
  farm: 'Farmer', lumberyard: 'Woodcutter', bakery: 'Baker', blacksmith: 'Blacksmith',
  general_store: 'Merchant', tavern: 'Innkeeper',
};

export const baseWage = (profession) => WAGES[profession] ?? WAGES.Laborer;

export function skillFor(c, businessType) {
  return c.skills[SKILL_FOR_BUSINESS[businessType]] ?? 0.15;
}

// How productive a worker is at a given business (0.7 to 1.3).
export const productivity = (c, businessType) => 0.7 + skillFor(c, businessType) * 0.6;

export function improveSkill(c, skill, amount = 0.012) {
  c.skills[skill] = Math.min(1, Math.round(((c.skills[skill] ?? 0.1) + amount) * 1000) / 1000);
}
