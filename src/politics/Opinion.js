import { LIFE } from '../core/Config.js';
import { balance } from '../economy/Transactions.js';
import { isTrading } from '../economy/Businesses.js';
import { ageOf } from '../citizens/Citizen.js';
import { peekRel } from '../citizens/Relationships.js';
import { perceivedHonesty } from '../society/Reputation.js';
import { trait } from '../ai/Personality.js';
import { ISSUES, issueStance } from './Policies.js';
import { wealthClass } from '../population/SocialClasses.js';
import { guildInterests, guildOf } from '../institutions/GuildManager.js';
import { faithInterests } from '../institutions/FaithManager.js';

// What each citizen wants from government, derived from their own life:
// wealth, work, family, business, temperament. Nobody votes as a bloc; two
// workers with different families or temperaments weigh issues differently.

export function priorities(state, c) {
  const p = Object.fromEntries(ISSUES.map((i) => [i, 0]));
  const cls = wealthClass(state, c).id;
  const owner = state.businesses.some((b) => b.ownerId === c.id && isTrading(b));
  const jobless = !c.employment && !c.retired;
  const kids = state.citizens.filter((k) => k.family.parentIds.includes(c.id) && ageOf(state, k) < LIFE.adultAge).length;
  p.taxes = { struggling: -0.2, working: 0.1, comfortable: 0.4, wealthy: 0.8, affluent: 1 }[cls] + trait(c, 'frugal') * 0.3 + trait(c, 'greedy') * 0.4 - trait(c, 'generous') * 0.4;
  p.welfare = { struggling: 1, working: 0.4, comfortable: 0, wealthy: -0.4, affluent: -0.6 }[cls] + (jobless ? 0.4 : 0) + (!c.homePlotId ? 0.4 : 0) + trait(c, 'generous') * 0.5;
  p.works = (jobless ? 0.8 : 0) + (c.profession === 'Builder' ? 0.5 : 0) - (cls === 'affluent' ? 0.3 : 0);
  p.business = (owner ? 0.9 : 0) + trait(c, 'ambitious') * 0.5 + (c.dream.type === 'business' ? 0.4 : 0) + trait(c, 'riskTaking') * 0.2;
  p.trust = trait(c, 'honest') * 0.8 + (c.memories.some((m) => m.kind === 'grievance') ? 0.4 : 0) - trait(c, 'dishonest') * 0.8 - (owner ? 0.2 : 0);
  // Trade: merchants and exporters want open markets; those undercut by imports want protection.
  const exporter = state.businesses.some((b) => b.ownerId === c.id && isTrading(b) && ['farm', 'lumberyard'].includes(b.type));
  const competing = state.businesses.some((b) => b.ownerId === c.id && isTrading(b) && ['blacksmith', 'bakery'].includes(b.type));
  const merchant = c.profession === 'Merchant' || (state.trade?.merchants?.[c.id]?.trips ?? 0) > 0;
  p.trade = (merchant ? 1 : 0) + (exporter ? 0.4 : 0) - (competing ? 0.5 : 0) - (jobless ? 0.3 : 0) + trait(c, 'riskTaking') * 0.2 - trait(c, 'stubborn') * 0.2 + trait(c, 'curious') * 0.15;
  p.education = kids * 0.35 + trait(c, 'curious') * 0.4 + (c.profession === 'Teacher' ? 0.8 : 0) + c.education.level * 0.3;
  // Guilds and faith communities colour, but never dictate, what members want.
  for (const extra of [guildInterests(state, c), faithInterests(c)]) if (extra) for (const [k, v] of Object.entries(extra)) p[k] += v;
  for (const k of ISSUES) p[k] = Math.max(-1, Math.min(1.5, Math.round(p[k] * 100) / 100));
  return p;
}

/** How well a set of policies serves a citizen's priorities (roughly -5..5). */
export function alignment(prio, policies) {
  const stance = issueStance(policies);
  let s = 0;
  for (const k of ISSUES) s += (prio[k] ?? 0) * stance[k];
  return s;
}

/** How a voter feels about someone personally: friendship, trust, respect and rivalry (0 for a stranger). */
export function personalTie(state, voter, person) {
  const r = peekRel(state, voter.id, person.id);
  return ((r?.friendship ?? 20) - 20) / 18 + ((r?.trust ?? 45) - 45) / 22 + ((r?.respect ?? 35) - 35) / 18 - (r?.rivalry ?? 0) / 15;
}

/** Personal ties count only as far as they set one candidate apart from the others, and never without limit. */
export const TIE_WEIGHT = 1.5;
export const tieTerm = (tie, mean) => TIE_WEIGHT * Math.tanh((tie - mean) / 4);

/** Leadership shows, but with diminishing returns: a seasoned leader is not unbeatable. */
export const leadershipTerm = (skill) => Math.sqrt(Math.max(0, Math.min(1, skill ?? 0))) * 0.8;

/** Voters tire of the same leader: each consecutive term already served costs an incumbent. */
export const FATIGUE_PER_TERM = 1.3;

/**
 * A voter's score for a candidate: policy match, personal ties (relative to
 * the other candidates), honesty, standing, endorsements and, for the
 * incumbent, their record in office. The record is the government's
 * performance without the relationship terms (those are counted once, here).
 * `tieMean` is the voter's average tie to the candidates on the ballot.
 */
export function candidateAppeal(state, voter, cand, prio, tieMean = null) {
  const person = state.citizens.find((c) => c.id === cand.id);
  if (!person) return -Infinity;
  if (person.id === voter.id) return 1000;
  if (tieMean === null) {
    const others = (state.government?.campaign?.candidates ?? [cand]).map((x) => state.citizens.find((c) => c.id === x.id)).filter(Boolean);
    tieMean = others.reduce((s, c) => s + personalTie(state, voter, c), 0) / Math.max(1, others.length);
  }
  let s = alignment(prio, cand.platform) * 2.2;
  s += tieTerm(personalTie(state, voter, person), tieMean);
  s += (perceivedHonesty(state, voter, person) - 50) / 12;
  // Standing is itself built from how the village regards a person, so it weighs lightly beside the ties above.
  s += (person.reputation.standing - 50) / 40 + leadershipTerm(person.skills.leadership);
  if (cand.endorsedBy?.includes(voter.faction)) s += 2.5;
  const guild = guildOf(state, voter);
  if (guild && cand.guildBacking?.includes(guild.id)) s += guild.leaderId === cand.id ? 3 : 1.8;
  if (cand.incumbent) {
    const gov = state.government;
    s += ((gov.performance ?? gov.approval ?? 50) - 50) / 8;
    s -= FATIGUE_PER_TERM * Math.max(1, gov.terms ?? 1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Factions: citizens drift into the group whose interests best match theirs.
// ---------------------------------------------------------------------------

export const FACTIONS = {
  merchants: { name: 'Merchant Guild', wants: { taxes: 0.7, business: 1, trust: 0.2, welfare: -0.3, trade: 1 } },
  workers: { name: "Workers' Coalition", wants: { welfare: 1, works: 0.8, taxes: -0.3, trade: -0.3 } },
  landowners: { name: "Landowners' Association", wants: { taxes: 1, welfare: -0.5, business: 0.3, trade: -0.4 } },
  traditionalists: { name: 'Traditionalists', wants: { taxes: 0.4, education: -0.3, trust: 0.5, works: 0.2, trade: -0.3 } },
  reformers: { name: 'Reformers', wants: { education: 1, welfare: 0.5, trust: 0.6, trade: 0.4 } },
};

export function factionAffinity(state, c, key, prio) {
  const age = ageOf(state, c);
  const plots = state.plots.filter((p) => p.ownerId === c.id).length;
  const owner = state.businesses.some((b) => b.ownerId === c.id && isTrading(b));
  let s = 0;
  for (const [issue, w] of Object.entries(FACTIONS[key].wants)) s += (prio[issue] ?? 0) * w;
  if (key === 'merchants' && (owner || c.profession === 'Merchant')) s += 0.8;
  if (key === 'workers' && c.employment?.role === 'worker') s += 0.6;
  if (key === 'landowners' && plots >= 2) s += 1;
  if (key === 'traditionalists') s += (age >= 50 ? 0.6 : 0) + trait(c, 'loyal') * 0.5 + trait(c, 'stubborn') * 0.5;
  if (key === 'reformers') s += (age < 35 ? 0.5 : 0) + trait(c, 'curious') * 0.4 + trait(c, 'creative') * 0.4;
  return s;
}

/** Seasonal: everyone re-evaluates which faction (if any) speaks for them. */
export function updateFactions(state) {
  const counts = {};
  for (const c of state.citizens) {
    if (ageOf(state, c) < LIFE.adultAge) { c.faction = null; continue; }
    const prio = priorities(state, c);
    let best = null, bestScore = 0.9;
    for (const key of Object.keys(FACTIONS)) {
      const s = factionAffinity(state, c, key, prio);
      if (s > bestScore) { bestScore = s; best = key; }
    }
    c.faction = best;
    if (best) counts[best] = (counts[best] ?? 0) + 1;
  }
  return counts;
}

export function factionMembers(state, key) {
  return state.citizens.filter((c) => c.faction === key);
}

/** The faction's view of a platform, from its members' averaged priorities. */
export function factionAlignment(state, key, platform) {
  const members = factionMembers(state, key);
  if (!members.length) return 0;
  let total = 0;
  for (const m of members) total += alignment(priorities(state, m), platform);
  return total / members.length;
}

export const wealthOf = (state, c) => balance(state, c.id);
