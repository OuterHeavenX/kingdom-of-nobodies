import { isTrading } from '../economy/Businesses.js';
import { achieve } from '../citizens/Citizen.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';

// Gradual improvements earned through practice. Each discovery accumulates
// progress from the real work of skilled people (and from schooling and trade);
// when it completes, it is credited to the most accomplished practitioner and
// its benefit is applied by the system it affects.

export const DISCOVERIES = {
  improvedPlow: { name: 'the heavy plough', skill: 'farming', cost: 140, effect: 'farms yield a fifth more grain' },
  betterTools: { name: 'tempered tools', skill: 'smithing', cost: 120, effect: 'tools last half as long again' },
  constructionTechniques: { name: 'timber framing', skill: 'building', cost: 130, effect: 'builders add more work each shift' },
  improvedStorage: { name: 'sealed granaries', skill: 'trade', cost: 110, effect: 'carried food spoils half as fast' },
  watermill: { name: 'the watermill', skill: 'baking', cost: 160, effect: 'bakeries bake an extra batch per shift', requires: 'improvedPlow' },
  sanitation: { name: 'clean wells and drains', skill: 'teaching', cost: 150, effect: 'fevers are rarer and lives longer' },
};

/** Daily: practitioners advance knowledge; schools and caravans help ideas spread. */
export function dailyDiscovery(state) {
  state.discoveries = state.discoveries ?? {};
  state.research = state.research ?? {};
  const school = state.businesses.some((b) => b.type === 'school' && isTrading(b));
  const trade = state.lastCaravanDay === state.day ? 0.5 : 0;
  for (const [key, d] of Object.entries(DISCOVERIES)) {
    if (state.discoveries[key] || (d.requires && !state.discoveries[d.requires])) continue;
    let gain = trade;
    for (const c of state.citizens) {
      const v = c.skills[d.skill] ?? 0;
      if (v > 0.55) gain += (v - 0.5) * 0.6 * (0.6 + (c.education?.level ?? 0.3));
    }
    if (school) gain *= 1.4;
    state.research[key] = Math.round(((state.research[key] ?? 0) + gain) * 100) / 100;
    if (state.research[key] >= d.cost) discover(state, key);
  }
}

export function discover(state, key) {
  const d = DISCOVERIES[key];
  const credit = [...state.citizens].sort((a, b) => (b.skills[d.skill] ?? 0) - (a.skills[d.skill] ?? 0))[0] ?? null;
  state.discoveries[key] = { day: state.day, by: credit?.id ?? null };
  if (credit) {
    achieve(state, credit, 'discovery', `Pioneered ${d.name}`, { discovery: key });
    remember(state, credit, `Pioneered ${d.name}.`, 3, 'milestone');
  }
  state.eventLog = state.eventLog ?? [];
  state.eventLog.push({ type: 'discovery', day: state.day, key });
  record(state, 'economy', `Discovery: ${credit ? `${credit.firstName} ${credit.lastName} pioneered` : 'the village adopted'} ${d.name}, so ${d.effect}.`, { citizens: credit ? [credit.id] : [] }, 3);
}

export const has = (state, key) => !!state.discoveries?.[key];
