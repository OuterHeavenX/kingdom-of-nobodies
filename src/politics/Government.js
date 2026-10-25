import { guildEndorsements, grantPrivileges, activeGuilds } from '../institutions/GuildManager.js';
import { noteEmbezzlement } from '../law/Courts.js';
import { POLITICS, LIFE, DAYS_PER_YEAR, EDUCATION } from '../core/Config.js';
import { chance } from '../core/Random.js';
import { isNewSeason, yearOf, dateLabel } from '../core/Calendar.js';
import { transfer, balance } from '../economy/Transactions.js';
import { isTrading, BUSINESS_TYPES } from '../economy/Businesses.js';
import { ageOf, achieve } from '../citizens/Citizen.js';
import { adjust } from '../citizens/Relationships.js';
import { trait } from '../ai/Personality.js';
import { gainSkill } from '../education/Skills.js';
import { bump } from '../society/Reputation.js';
import { createFact } from '../society/Gossip.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { startProject } from '../property/Construction.js';
import { allows } from '../property/LandRegistry.js';
import { settlementStage } from '../population/Expansion.js';
import { defaultPolicies, platformFor, platformPromises, POLICIES } from './Policies.js';
import { priorities, alignment, candidateAppeal, updateFactions, factionAlignment, FACTIONS } from './Opinion.js';

// The village government. Once enough adults live here, residents elect a
// leader whose title grows with the settlement. Candidates stand on platforms
// of real policies; every adult walks to the hall on election day and votes
// for the candidate who best fits their own interests, ties and trust. The
// winner enacts their platform, and must live with the consequences.

export const TITLES = { Hamlet: 'Village Elder', Village: 'Village Elder', 'Growing Town': 'Mayor', 'Large Town': 'Lord Mayor', 'Kingdom Center': 'Lord Protector' };
const termDays = () => POLITICS.termYears * DAYS_PER_YEAR;
const adults = (state) => state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge);
const person = (state, id) => state.citizens.find((c) => c.id === id) ?? null;

export function ensureGovernment(state) {
  if (state.government) return state.government;
  if (adults(state).length < POLITICS.firstElectionAdults) return null;
  state.government = {
    formedDay: state.day,
    title: TITLES[settlementStage(state.citizens.length)],
    leaderId: null, actingLeaderId: null, councillors: [],
    termStart: null, termEnd: null,
    nextElectionDay: state.day + POLITICS.campaignDays,
    campaign: null,
    elections: [],
    approval: 50,
    policies: defaultPolicies(state.council.taxLevel),
    scandals: [], protests: [], budget: [],
    lastProtestDay: -99,
  };
  record(state, 'council', `With ${adults(state).length} adults now living here, the village will elect its first ${state.government.title}.`, {}, 3);
  return state.government;
}

/** Daily government work: campaigns, tallies, approval, duties, policy effects. */
export function dailyGovernment(state) {
  const gov = ensureGovernment(state);
  if (!gov) return;
  const title = TITLES[settlementStage(state.citizens.length)];
  if (title !== gov.title) {
    record(state, 'council', `The village has grown: the office of ${gov.title} becomes ${title}.`, {}, 3);
    gov.title = title;
  }
  if (gov.campaign && state.day >= gov.campaign.electionDay + 1) tally(state);
  if (!gov.campaign && state.day >= gov.nextElectionDay - POLITICS.campaignDays) openCampaign(state);
  updateApproval(state);
  if (isNewSeason(state.day)) {
    updateFactions(state);
    leaderReview(state);
    attemptEmbezzlement(state);
  }
  discoverScandals(state);
  protestsAndResignation(state);
  crisisResponse(state);
  applyPolicies(state);
}

/** Whatever their convictions, a leader cannot ignore villagers starving to death. */
function crisisResponse(state) {
  const gov = state.government;
  const leader = currentLeader(state);
  const recentHunger = Object.values(state.archive).filter((p) => p.cause === 'hunger' && p.deathDay >= state.day - 3).length;
  const starving = state.citizens.filter((c) => c.needs.hunger < 12).length;
  if (!recentHunger && starving < 3) return;
  const changes = [];
  if (!gov.policies.foodAssistance) { gov.policies.foodAssistance = true; changes.push('restored food assistance'); }
  if (!gov.policies.publicWorks) { gov.policies.publicWorks = true; changes.push('restored the public works crew'); }
  if (changes.length) record(state, 'council', `Faced with hunger in the village, ${leader ? `${gov.title} ${leader.firstName}` : 'the council'} ${changes.join(' and ')}.`, { citizens: leader ? [leader.id] : [] }, 2);
}

export const currentLeader = (state) => person(state, state.government?.leaderId) ?? person(state, state.government?.actingLeaderId);

// ---------------------------------------------------------------------------
// Campaigns and elections
// ---------------------------------------------------------------------------

function candidacyScore(state, c) {
  const age = ageOf(state, c);
  if (age < LIFE.adultAge || (state.government.bannedUntil?.[c.id] ?? 0) > state.day) return -Infinity;
  let s = trait(c, 'ambitious') * 40 + (c.skills.leadership ?? 0) * 40 + c.reputation.standing * 0.4 + c.education.level * 10 + (c.skills.diplomacy ?? 0) * 15;
  if (c.dream.type === 'leader') s += 30;
  if (trait(c, 'shy') > 0.4) s -= 20;
  if (age > 72) s -= 25;
  if (c.id === state.government.leaderId) s += state.government.approval > 35 ? 35 : -40;
  return s;
}

const guildName = (state, id) => activeGuilds(state).find((g) => g.id === id)?.name ?? 'a guild';

export function openCampaign(state) {
  const gov = state.government;
  const pool = adults(state).map((c) => ({ c, s: candidacyScore(state, c) })).filter((x) => Number.isFinite(x.s)).sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id));
  const chosen = pool.filter((x, i) => i < 2 || (x.s >= 35 && i < POLITICS.maxCandidates)).map((x) => x.c);
  if (!chosen.length) { gov.nextElectionDay = state.day + DAYS_PER_YEAR; return null; }
  const candidates = chosen.map((c) => {
    const platform = platformFor(priorities(state, c), gov.policies);
    return { id: c.id, name: `${c.firstName} ${c.lastName}`, platform, promises: platformPromises(platform, gov.policies), incumbent: c.id === gov.leaderId, endorsedBy: [] };
  });
  for (const key of Object.keys(FACTIONS)) {
    let best = null, bestScore = 0.2;
    for (const cand of candidates) {
      const s = factionAlignment(state, key, cand.platform);
      if (s > bestScore) { bestScore = s; best = cand; }
    }
    if (best) best.endorsedBy.push(key);
  }
  const guildBacking = guildEndorsements(state, candidates);
  for (const cand of candidates) cand.guildBacking = guildBacking[cand.id] ?? [];
  gov.campaign = { startDay: state.day, electionDay: Math.max(state.day + 1, gov.nextElectionDay), candidates, ballots: {}, guildBacking };
  for (const cand of candidates) {
    const c = person(state, cand.id);
    remember(state, c, `Stood for ${gov.title}, promising to ${cand.promises.join(', ')}.`, 3, 'politics');
  }
  record(state, 'council', `Election campaign for ${gov.title}: ${candidates.map((x) => `${x.name} (${x.promises.slice(0, 2).join('; ')}${x.endorsedBy.length ? `; backed by the ${x.endorsedBy.map((k) => FACTIONS[k].name).join(' and ')}` : ''}${x.guildBacking.length ? `; the ${x.guildBacking.map((id) => guildName(state, id)).join(' and the ')} campaigned for them` : ''})`).join(' vs ')}. Voting on ${dateLabel(gov.campaign.electionDay)}.`,
    { citizens: candidates.map((x) => x.id) }, 3);
  return gov.campaign;
}

export const isCandidate = (state, c) => !!state.government?.campaign?.candidates.some((x) => x.id === c.id);
export const electionToday = (state) => state.government?.campaign && state.day === state.government.campaign.electionDay;

/** A voter at the hall picks the candidate who best fits their interests and loyalties. */
export function castVote(state, voter) {
  const camp = state.government?.campaign;
  if (!camp || camp.ballots[voter.id] || ageOf(state, voter) < LIFE.adultAge) return null;
  const prio = priorities(state, voter);
  let best = null, bestScore = -Infinity;
  for (const cand of camp.candidates) {
    const s = candidateAppeal(state, voter, cand, prio);
    if (s > bestScore || (s === bestScore && cand.id < best.id)) { bestScore = s; best = cand; }
  }
  if (!best) return null;
  camp.ballots[voter.id] = best.id;
  return best.id;
}

/** Count the ballots. Deterministic: most votes wins; ties go to higher standing, then the earlier id. */
export function tally(state) {
  const gov = state.government;
  const camp = gov.campaign;
  gov.campaign = null;
  const living = camp.candidates.filter((x) => person(state, x.id));
  if (!living.length) { gov.nextElectionDay = state.day + POLITICS.campaignDays; return null; }
  const votes = Object.fromEntries(living.map((x) => [x.id, 0]));
  for (const [voterId, candId] of Object.entries(camp.ballots)) if (person(state, voterId) && candId in votes) votes[candId]++;
  const ranked = [...living].sort((a, b) => votes[b.id] - votes[a.id] || person(state, b.id).reputation.standing - person(state, a.id).reputation.standing || a.id.localeCompare(b.id));
  const winner = ranked[0];
  const eligible = adults(state).length;
  const cast = Object.values(votes).reduce((a, b) => a + b, 0);
  const result = {
    day: state.day, year: yearOf(state.day), title: gov.title, eligible, turnout: cast,
    candidates: ranked.map((x) => ({ id: x.id, name: x.name, votes: votes[x.id], promises: x.promises, endorsedBy: x.endorsedBy, incumbent: x.incumbent })),
    winnerId: winner.id,
  };
  gov.elections.push(result);
  if (gov.elections.length > 60) gov.elections.splice(0, gov.elections.length - 60);
  const previous = gov.leaderId;
  gov.leaderId = winner.id;
  gov.actingLeaderId = null;
  gov.councillors = ranked.slice(1, 3).map((x) => x.id);
  gov.termStart = state.day;
  gov.termEnd = state.day + termDays();
  gov.nextElectionDay = gov.termEnd;
  const before = { ...gov.policies };
  gov.policies = { ...winner.platform };
  state.council.taxLevel = gov.policies.taxLevel;
  state.stats.elections++;
  const w = person(state, winner.id);
  achieve(state, w, 'elected', `Elected ${gov.title} in Year ${result.year} with ${votes[winner.id]} of ${cast} votes`, { title: gov.title });
  w.mood = Math.min(100, w.mood + 20);
  remember(state, w, `Won the election for ${gov.title}.`, 3, 'politics');
  bump(w, 'standing', 8);
  for (const x of ranked.slice(1)) { const loser = person(state, x.id); remember(state, loser, `Lost the election to ${w.firstName}.`, 2, 'politics'); loser.mood = Math.max(0, loser.mood - 10); }
  grantPrivileges(state, winner.id, camp.guildBacking ?? {});
  const changes = platformPromises(gov.policies, before);
  record(state, 'council', `${w.firstName} ${w.lastName} was ${previous === w.id ? 're-elected' : 'elected'} ${gov.title} with ${votes[winner.id]} of ${cast} votes (${ranked.map((x) => `${x.name.split(' ')[0]} ${votes[x.id]}`).join(', ')}). ${changes[0] === 'keep things as they are' ? 'Policies stay as they were.' : `New policies: ${changes.join(', ')}.`}`,
    { citizens: ranked.map((x) => x.id) }, 3);
  return result;
}

// ---------------------------------------------------------------------------
// Governing
// ---------------------------------------------------------------------------

/** Approval is the average opinion of adults: policy fit, mood, and how they feel about the leader. */
export function updateApproval(state) {
  const gov = state.government;
  const leader = currentLeader(state);
  if (!leader) { gov.approval = 50; return; }
  let total = 0, n = 0;
  for (const c of adults(state)) {
    const r = state.relationships[`${c.id}|${leader.id}`];
    const opinion = 50 + alignment(priorities(state, c), gov.policies) * 6 + (c.mood - 55) * 0.4 + ((r?.friendship ?? 20) - 20) * 0.2 + ((r?.trust ?? 45) - 45) * 0.3 - (r?.rivalry ?? 0) * 0.3;
    c.opinionOfLeader = Math.max(0, Math.min(100, Math.round(opinion)));
    total += c.opinionOfLeader; n++;
  }
  gov.approval = n ? Math.round(total / n) : 50;
  gov.approvalHistory = [...(gov.approvalHistory ?? []), gov.approval].slice(-24);
}

/** Each season the leader reviews the budget and adjusts policies within their convictions. */
function leaderReview(state) {
  const gov = state.government;
  const leader = currentLeader(state);
  if (!leader) return;
  gainSkill(leader, 'leadership', 0.02);
  const t = balance(state, 'treasury');
  const prio = priorities(state, leader);
  const p = gov.policies;
  const changes = [];
  if (t < 40 && p.taxLevel !== 'high' && prio.taxes < 0.9) { p.taxLevel = p.taxLevel === 'low' ? 'normal' : 'high'; changes.push(`raised taxes to ${p.taxLevel}`); }
  else if (t > 500 && p.taxLevel !== 'low' && prio.taxes > -0.2) { p.taxLevel = p.taxLevel === 'high' ? 'normal' : 'low'; changes.push(`lowered taxes to ${p.taxLevel}`); }
  const kids = state.citizens.filter((c) => ageOf(state, c) < LIFE.adultAge && ageOf(state, c) >= 5).length;
  if (!p.publicSchooling && kids >= 4 && t > 150 && prio.education > -0.2) { p.publicSchooling = true; changes.push('introduced public schooling'); }
  const jobless = adults(state).filter((c) => !c.employment && !c.retired).length;
  if (!p.unemploymentAid && jobless > adults(state).length * 0.25 && t > 120 && prio.welfare > 0) { p.unemploymentAid = true; changes.push('introduced unemployment relief'); }
  if (p.unemploymentAid && t < 30) { p.unemploymentAid = false; changes.push('ended unemployment relief to save money'); }
  state.council.taxLevel = p.taxLevel;
  if (changes.length) record(state, 'council', `${gov.title} ${leader.firstName} ${changes.join(' and ')}.`, { citizens: [leader.id] }, 2);
}

/** Policy effects that run every day. Others are read directly by the systems they affect. */
export function applyPolicies(state) {
  const gov = state.government;
  const p = gov.policies;
  state.council.taxLevel = p.taxLevel;
  // Unemployment relief: two coins a day to each jobless working-age adult.
  if (p.unemploymentAid) {
    for (const c of adults(state)) {
      if (c.employment || c.retired || ageOf(state, c) >= LIFE.retireAge || balance(state, 'treasury') < 30) continue;
      transfer(state, 'treasury', c.id, 2, 'aid', `Unemployment relief for ${c.firstName}`);
    }
  }
  // Public schooling: build a school, then keep its teachers' wages funded.
  const school = state.businesses.find((b) => b.type === 'school' && isTrading(b));
  if (p.publicSchooling) {
    if (!school && !state.projects.some((j) => j.businessType === 'school')) {
      const land = state.plots.find((x) => x.ownerId === 'council' && !x.building && !x.projectId && allows(x, 'school'));
      if (land && balance(state, 'treasury') > 60) {
        const res = startProject(state, { plotId: land.id, ownerId: 'council', kind: 'construction', buildingType: 'school', purpose: 'council_business', businessType: 'school' });
        if (res.ok) record(state, 'council', `The council began building a school on ${land.name}.`, { plot: land.id }, 2);
      }
    } else if (school) {
      const need = EDUCATION.teacherWage * 2 * Math.max(1, school.employees.length) - balance(state, school.id);
      if (need > 0 && balance(state, 'treasury') > need + 20) transfer(state, 'treasury', school.id, need, 'grant', 'Teachers’ wages');
      school.openings = school.employees.length < 2 && balance(state, school.id) >= EDUCATION.teacherWage * 3 ? 1 : 0;
    }
  } else if (school) school.openings = 0;
  // The leader receives a small stipend for their service.
  const leader = currentLeader(state);
  if (leader && balance(state, 'treasury') > 30) transfer(state, 'treasury', leader.id, 2, 'wage', `${gov.title}'s stipend`);
}

// ---------------------------------------------------------------------------
// Scandal, protest and succession
// ---------------------------------------------------------------------------

/** A dishonest leader may quietly take from the treasury. It is recorded, but hidden until discovered. */
function attemptEmbezzlement(state) {
  const gov = state.government;
  const leader = person(state, gov.leaderId);
  if (!leader) return;
  const temptation = trait(leader, 'dishonest') + trait(leader, 'greedy') * 0.6 - trait(leader, 'honest');
  if (temptation <= 0.25 || !chance(state, POLITICS.embezzleChancePerSeason * temptation)) return;
  const amount = Math.min(15, Math.floor(balance(state, 'treasury') * 0.06));
  if (amount < 2 || !transfer(state, 'treasury', leader.id, amount, 'embezzlement', 'Unrecorded withdrawal')) return;
  gov.scandals.push({ id: 's' + (gov.scandals.length + 1), leaderId: leader.id, amount, day: state.day, discovered: false, txId: state.nextId.tx });
}

function discoverScandals(state) {
  const gov = state.government;
  for (const sc of gov.scandals) {
    if (sc.discovered) continue;
    const watchers = state.citizens.filter((c) => trait(c, 'honest') > 0.4 || trait(c, 'curious') > 0.5);
    if (!chance(state, 0.02 + watchers.length * 0.004)) continue;
    sc.discovered = true;
    sc.discoveredDay = state.day;
    const finder = watchers[Math.floor(state.day % Math.max(1, watchers.length))];
    const leader = person(state, sc.leaderId) ?? state.archive[sc.leaderId];
    if (!leader) continue;
    // Restitution is now a matter for the court; without a legal system the money is taken back at once.
    const repaid = person(state, leader.id) && !state.law ? Math.min(sc.amount, balance(state, leader.id)) : 0;
    if (repaid > 0) transfer(state, leader.id, 'treasury', repaid, 'fine', `${leader.firstName} repaid misused funds`);
    sc.repaid = repaid;
    if (state.law && person(state, leader.id)) noteEmbezzlement(state, sc, leader);
    if (person(state, leader.id)) {
      bump(leader, 'honesty', -30);
      bump(leader, 'standing', -15);
      for (const c of state.citizens) if (c !== leader) adjust(state, c.id, leader.id, { trust: -12, respect: -10 });
      remember(state, leader, 'My misuse of the treasury was exposed.', 3, 'politics');
    }
    createFact(state, 'cheat', leader.id, `${leader.firstName} took ${sc.amount} coins from the treasury.`, finder ? [finder.id] : []);
    const removed = gov.leaderId === leader.id;
    record(state, 'council', `Scandal: ${finder ? `${finder.firstName} discovered that ` : ''}${leader.firstName} had taken ${sc.amount} coins from the treasury. ${repaid ? `${repaid} coins were repaid. ` : ''}${removed ? `${leader.firstName} was removed from office and barred from standing for two terms.` : ''}`,
      { citizens: [leader.id, ...(finder ? [finder.id] : [])] }, 3);
    if (removed) {
      gov.bannedUntil = { ...(gov.bannedUntil ?? {}), [leader.id]: state.day + termDays() * 2 };
      vacate(state, 'removed after a scandal');
    }
  }
}

function protestsAndResignation(state) {
  const gov = state.government;
  const leader = currentLeader(state);
  if (!leader) return;
  if (gov.approval < POLITICS.protestApproval && state.day - gov.lastProtestDay >= DAYS_PER_YEAR / 4) {
    const angry = adults(state).filter((c) => (c.opinionOfLeader ?? 50) < 30 && trait(c, 'shy') < 0.4);
    if (angry.length >= 3) {
      gov.lastProtestDay = state.day;
      gov.protests.push({ day: state.day, size: angry.length, approval: gov.approval });
      for (const c of angry) { c.protestDay = state.day; adjust(state, c.id, leader.id, { rivalry: 4 }); }
      bump(leader, 'standing', -4);
      record(state, 'council', `${angry.length} villagers gathered at the Hearth Hall to protest against ${gov.title} ${leader.firstName} (approval ${gov.approval}%).`, { citizens: [leader.id, ...angry.slice(0, 5).map((c) => c.id)] }, 2);
    }
  }
  gov.lowApprovalDays = gov.approval < POLITICS.resignApproval ? (gov.lowApprovalDays ?? 0) + 1 : 0;
  if (gov.leaderId && gov.lowApprovalDays >= 6) {
    record(state, 'council', `${gov.title} ${leader.firstName} resigned after losing the village's confidence.`, { citizens: [leader.id] }, 3);
    remember(state, leader, 'Resigned from office.', 3, 'politics');
    vacate(state, 'resigned');
  }
}

/** The leader is gone: a councillor acts until an early election. */
export function vacate(state, why) {
  const gov = state.government;
  if (!gov) return;
  gov.leaderId = null;
  gov.lowApprovalDays = 0;
  gov.actingLeaderId = gov.councillors.find((id) => person(state, id)) ?? null;
  if (!gov.campaign) gov.nextElectionDay = state.day + POLITICS.campaignDays;
  const acting = person(state, gov.actingLeaderId);
  if (acting) record(state, 'council', `${acting.firstName} serves as acting ${gov.title} until an early election (the previous leader ${why}).`, { citizens: [acting.id] }, 2);
}

/** Lifecycle hook: a leader or candidate dies. */
export function onCitizenGone(state, c) {
  const gov = state.government;
  if (!gov) return;
  if (gov.leaderId === c.id) vacate(state, 'died');
  if (gov.actingLeaderId === c.id) gov.actingLeaderId = gov.councillors.find((id) => id !== c.id && person(state, id)) ?? null;
  gov.councillors = gov.councillors.filter((id) => id !== c.id);
  if (gov.campaign) {
    gov.campaign.candidates = gov.campaign.candidates.filter((x) => x.id !== c.id);
    delete gov.campaign.ballots[c.id];
  }
}

export { POLICIES, BUSINESS_TYPES };
