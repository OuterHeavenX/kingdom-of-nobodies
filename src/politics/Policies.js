import { ECONOMY } from '../core/Config.js';

// Policies the elected leader controls. Each one is read by a real system:
//   taxLevel            → business levy and the tithe (Council.collectTithe, EconomyManager)
//   foodAssistance      → free pantry relief for the destitute (Marketplace.bestFoodOffer)
//   housingSupport      → the council's public cottage programme (Council.councilDaily)
//   unemploymentAid     → daily relief paid to jobless adults (Government.applyPolicies)
//   publicWorks         → funding of the Village Works crew (Council.fundPublicWorks)
//   reducedFees         → business levy reduced by one coin (EconomyManager.closeDay)
//   constructionGrants  → treasury grant when a citizen starts building (Construction.startProject)
//   businessLicensing   → new businesses pay a licence; licensed shops are trusted more
//   publicSchooling     → the council builds a school and pays teachers (Government.applyPolicies)
//   apprenticeshipGrants→ the treasury pays apprentice stipends (Education)
//
// Each policy belongs to an issue; voters care about issues to different degrees.

export const POLICIES = {
  taxLevel: { label: 'Taxes', issue: 'taxes', options: ['low', 'normal', 'high'], default: 'normal', describe: (v) => `${v} (levy ${ECONOMY.tax[v]}🪙, tithe ${Math.round(ECONOMY.tithe[v] * 100)}%)` },
  foodAssistance: { label: 'Food assistance', issue: 'welfare', default: true },
  housingSupport: { label: 'Public housing', issue: 'welfare', default: true },
  unemploymentAid: { label: 'Unemployment relief', issue: 'welfare', default: false },
  publicWorks: { label: 'Public works crew', issue: 'works', default: true },
  reducedFees: { label: 'Reduced market fees', issue: 'business', default: false },
  constructionGrants: { label: 'Construction grants', issue: 'business', default: false },
  businessLicensing: { label: 'Business licensing', issue: 'trust', default: false },
  publicSchooling: { label: 'Public schooling', issue: 'education', default: false },
  apprenticeshipGrants: { label: 'Apprenticeship grants', issue: 'education', default: false },
  tariffLevel: { label: 'Import tariffs', issue: 'trade', options: ['low', 'normal', 'high'], default: 'normal', describe: (v) => `${v} (${{ low: 3, normal: 6, high: 12 }[v]}% on imports)` },
  openDiplomacy: { label: 'Seek treaties abroad', issue: 'trade', default: true },
};

export const ISSUES = ['taxes', 'welfare', 'works', 'business', 'trust', 'education', 'trade'];

export function defaultPolicies(taxLevel = 'normal') {
  const p = Object.fromEntries(Object.entries(POLICIES).map(([k, d]) => [k, d.default]));
  p.taxLevel = taxLevel;
  return p;
}

/**
 * How strongly a policy setting serves an issue, from -1 to 1. "taxes" is
 * served by low taxes; every other issue is served by its programmes being on.
 */
export function issueStance(policies) {
  const s = Object.fromEntries(ISSUES.map((i) => [i, 0]));
  s.taxes = policies.taxLevel === 'low' ? 1 : policies.taxLevel === 'high' ? -1 : 0;
  s.welfare = (['foodAssistance', 'housingSupport', 'unemploymentAid'].filter((k) => policies[k]).length - 1.5) / 1.5;
  s.works = policies.publicWorks ? 1 : -1;
  s.business = (Number(!!policies.reducedFees) + Number(!!policies.constructionGrants)) - 1;
  s.trust = policies.businessLicensing ? 1 : -0.3;
  s.education = (Number(!!policies.publicSchooling) + Number(!!policies.apprenticeshipGrants)) - 1;
  s.trade = ((policies.tariffLevel ?? 'normal') === 'low' ? 0.6 : (policies.tariffLevel ?? 'normal') === 'high' ? -0.6 : 0) + ((policies.openDiplomacy ?? true) ? 0.4 : -0.4);
  return s;
}

/** Turn a set of issue priorities (weights) into a concrete platform. */
export function platformFor(priorities, current) {
  const p = { ...current };
  p.taxLevel = priorities.taxes > 0.5 ? 'low' : priorities.taxes < -0.3 || priorities.welfare > 0.8 ? 'high' : 'normal';
  p.foodAssistance = priorities.welfare > -0.85;
  p.housingSupport = priorities.welfare > -0.1;
  p.unemploymentAid = priorities.welfare > 0.55;
  p.publicWorks = priorities.works > -0.6;
  p.reducedFees = priorities.business > 0.45;
  p.constructionGrants = priorities.business > 0.7;
  p.businessLicensing = priorities.trust > 0.35;
  p.publicSchooling = priorities.education > 0.3;
  p.apprenticeshipGrants = priorities.education > 0.6;
  p.tariffLevel = (priorities.trade ?? 0) > 0.5 ? 'low' : (priorities.trade ?? 0) < -0.3 ? 'high' : 'normal';
  p.openDiplomacy = (priorities.trade ?? 0) > -0.45;
  return p;
}

/** Short human summary of what a platform changes. */
export function platformPromises(platform, current) {
  const out = [];
  for (const [k, def] of Object.entries(POLICIES)) {
    if (platform[k] === current[k]) continue;
    if (k === 'taxLevel') out.push(platform.taxLevel === 'low' ? 'lower taxes' : platform.taxLevel === 'high' ? 'raise taxes' : 'restore moderate taxes');
    else if (k === 'tariffLevel') out.push(platform.tariffLevel === 'low' ? 'cut import tariffs' : platform.tariffLevel === 'high' ? 'protect local trades with high tariffs' : 'restore moderate tariffs');
    else out.push(`${platform[k] ? 'introduce' : 'end'} ${def.label.toLowerCase()}`);
  }
  return out.length ? out : ['keep things as they are'];
}
