import { isNewSeason } from '../core/Calendar.js';
import { DAYS_PER_YEAR, CALENDAR, LIFE } from '../core/Config.js';
import { ageOf } from '../citizens/Citizen.js';
import { byId } from '../core/EntityRegistry.js';
import { record } from '../society/Chronicle.js';
import { priorities } from '../politics/Opinion.js';

// The legal code. Each law has an id, a description, a requirement, a remedy,
// an enactment date and the day it takes effect; cases are judged only under
// laws in force when the events happened. Laws are proposed by the government
// (or the council before there is one) for reasons drawn from real events,
// voted on by the leader and councillors according to their own interests,
// and change public opinion once passed.

export const LAWS = {
  property: { name: 'Property Registry Act', issue: 'trust', founding: true, description: 'The land registry is the record of ownership. Estates pass to the spouse, then to the eldest adult child.', requirement: 'Land changes hands only by sale, inheritance or court order.', remedy: 'Disputed land stays with the registered owner; heirs left out may be compensated.' },
  wages: { name: 'Fair Wages Act', issue: 'welfare', founding: true, description: 'Wages agreed for work done must be paid.', requirement: 'Every completed shift is paid at the agreed wage.', remedy: 'Restitution of unpaid wages plus a fine of a fifth.' },
  theft: { name: 'Theft Act', issue: 'trust', founding: true, description: 'Taking goods without paying is theft.', requirement: 'Goods are taken only by purchase or gift.', remedy: 'Restitution of the value and a fine, reduced for those in real want.' },
  fraud: { name: 'Public Trust Act', issue: 'trust', founding: true, description: 'Officials may not take public money for themselves.', requirement: 'Treasury funds are spent only on public business.', remedy: 'Full restitution and a fine.' },
  tariffs: { name: 'Tariff Act', issue: 'trade', founding: true, description: 'Imports pay the tariff set by the government.', requirement: 'Merchants declare and pay duty on goods brought in.', remedy: 'Unpaid duty is recovered.' },
  contracts: { name: 'Contract Enforcement Act', issue: 'business', description: 'Delivery contracts are binding.', requirement: 'A merchant who fails to deliver through their own fault compensates the buyer.', remedy: 'Damages of a tenth of the undelivered value. Storms, closures and embargoes excuse a merchant.' },
  licensing: { name: 'Market Licensing Act', issue: 'trust', description: 'Every shop must hold a council licence.', requirement: 'Businesses pay a licence when they open.', remedy: 'A fine, and suspension for repeat offenders.' },
  safety: { name: 'Fire Safety Act', issue: 'works', description: 'Buildings must be kept in repair.', requirement: 'A building below 40% condition must be repaired within six days.', remedy: 'A fine and an order to repair.' },
  permits: { name: 'Building Permits Act', issue: 'trust', description: 'New buildings need a council permit.', requirement: 'Builders pay a permit fee when work begins.', remedy: 'A fine for building without a permit.' },
  debts: { name: 'Debt Recovery Act', issue: 'business', description: 'Loans freely made must be repaid.', requirement: 'A borrower pays what the loan agreement says, when it says.', remedy: 'Repayment from the borrower\'s means, a forced sale of pledged land, or bankruptcy.' },
  land: { name: 'Land Development Act', issue: 'works', description: 'Land is for building on, not hoarding.', requirement: 'Land bought must be built on within two years.', remedy: 'Idle land is bought back by the council at the price paid.' },
};

/** A rejected bill waits this long before it can be proposed again. */
export const BILL_COOLDOWN_DAYS = DAYS_PER_YEAR * 3;
/** A member supports a bill (proposes it, votes aye) when their stance is at least this. */
export const SUPPORT_STANCE = 0;

/** Laws added by later systems supply their own reasons and stances, keyed by law. */
export const lawHooks = { reason: {}, stance: {} };

export function ensureLaw(state) {
  if (state.law) return state.law;
  state.law = {
    laws: Object.entries(LAWS).filter(([, l]) => l.founding).map(([key, l]) => ({ id: 'law-' + key, key, name: l.name, status: 'ACTIVE', enactedDay: 1, effectiveDay: 1, proposedBy: 'the founders' })),
    proposals: [], cases: [], claims: [], judgeId: null, nextCase: 0, stats: { filed: 0, judged: 0, fines: 0, restitution: 0, dismissed: 0 },
  };
  return state.law;
}

export const lawByKey = (state, key) => ensureLaw(state).laws.find((l) => l.key === key) ?? null;

/** Was a law in force on a given day? */
export function lawInForce(state, key, day = state.day) {
  const l = lawByKey(state, key);
  return !!l && l.status === 'ACTIVE' && l.effectiveDay <= day && (!l.repealedDay || l.repealedDay > day);
}

/** How a citizen feels about a law, from their own interests (-1..1). */
function stanceOn(state, c, key) {
  if (lawHooks.stance[key]) return lawHooks.stance[key](state, c);
  const p = priorities(state, c);
  const owns = state.plots.filter((x) => x.ownerId === c.id && !x.building).length;
  switch (key) {
    case 'contracts': return (p.trade ?? 0) * 0.6 + (p.business ?? 0) * 0.3 + (p.trust ?? 0) * 0.3;
    case 'licensing': return (p.trust ?? 0) * 0.6 - (p.business ?? 0) * 0.4;
    case 'safety': return (p.works ?? 0) * 0.4 + 0.2 - (state.plots.some((x) => x.ownerId === c.id && (x.building?.condition ?? 100) < 50) ? 0.6 : 0);
    case 'permits': return (p.trust ?? 0) * 0.3 - (p.business ?? 0) * 0.3 - (p.taxes ?? 0) * 0.3;
    case 'land': return (p.welfare ?? 0) * 0.4 + (!c.homePlotId ? 0.4 : 0) - owns * 0.5 - (c.faction === 'landowners' ? 0.6 : 0);
    default: return 0.2;
  }
}

/** Why the government might propose a law now (null if it has no reason). */
function reasonFor(state, key) {
  const law = ensureLaw(state);
  if (lawByKey(state, key)?.status === 'ACTIVE' || law.proposals.some((p) => p.key === key && p.status === 'PENDING')) return null;
  // A bill that failed is not brought back for three years, whichever law it was.
  if (law.proposals.some((p) => p.key === key && p.status === 'REJECTED' && state.day - p.decidedDay < BILL_COOLDOWN_DAYS)) return null;
  if (lawHooks.reason[key]) return lawHooks.reason[key](state);
  if (key === 'contracts') {
    const dismissed = law.cases.filter((c) => c.kind === 'contract' && c.judgment?.outcome === 'dismissed' && /no law/.test(c.judgment.reason)).length;
    const deliveries = state.trade?.stats?.deliveries ?? 0;
    if (dismissed) return `${dismissed} breach-of-contract claim${dismissed > 1 ? 's were' : ' was'} thrown out for want of a law`;
    if (deliveries > 25) return `${deliveries} caravans have traded through the region with no contract law`;
  }
  if (key === 'land') {
    const idle = state.plots.filter((p) => p.ownerId !== 'council' && !p.building && !p.projectId && state.day - (p.acquiredDay ?? state.day) > DAYS_PER_YEAR * 2).length;
    if (idle >= 3 && (state.districts?.opened?.length ?? 0) >= 2) return `${idle} plots have sat idle for years while new districts are surveyed`;
  }
  if (key === 'safety') {
    const fires = state.stats.fires ?? 0;
    const shabby = state.plots.filter((p) => (p.building?.condition ?? 100) < 50).length;
    if (fires >= 4 && shabby >= 2) return `${fires} fires so far, and ${shabby} buildings in poor repair`;
  }
  if (key === 'licensing' && state.government?.policies?.businessLicensing) return 'the government has made licensing its policy';
  if (key === 'permits' && state.projects.length >= 4) return `${state.projects.length} building projects are under way with no oversight`;
  return null;
}

/** Seasonal: the government proposes and votes on laws. */
export function considerLaws(state) {
  const law = ensureLaw(state);
  if (!isNewSeason(state.day)) return;
  const gov = state.government;
  const leader = gov?.leaderId ? byId(state.citizens, gov.leaderId) : null;
  for (const key of Object.keys(LAWS)) {
    const reason = reasonFor(state, key);
    if (!reason) continue;
    // A leader only proposes what they themselves would vote for; the next bill gets its turn.
    if (leader && stanceOn(state, leader, key) < SUPPORT_STANCE) continue;
    const proposal = { id: 'lp' + (law.proposals.length + 1), key, name: LAWS[key].name, reason, proposedDay: state.day, proposedBy: leader ? `${leader.firstName} ${leader.lastName}` : 'the council', status: 'PENDING', votes: {} };
    law.proposals.push(proposal);
    vote(state, proposal);
    break; // one bill a season
  }
  // Repeal: a licensing law outlives the policy that created it.
  const lic = lawByKey(state, 'licensing');
  if (lic?.status === 'ACTIVE' && gov && !gov.policies.businessLicensing) {
    lic.status = 'REPEALED';
    lic.repealedDay = state.day;
    record(state, 'law', `The ${lic.name} was repealed now that the government has abandoned licensing.`, {}, 2);
  }
  if (law.proposals.length > 30) law.proposals = law.proposals.slice(-30);
}

function vote(state, proposal) {
  const gov = state.government;
  const voters = gov ? [gov.leaderId, ...(gov.councillors ?? [])].map((id) => byId(state.citizens, id)).filter(Boolean) : state.citizens.filter((c) => ageOf(state, c) >= 30).sort((a, b) => b.reputation.standing - a.reputation.standing).slice(0, 3);
  let ayes = 0, noes = 0;
  for (const v of voters) {
    const s = stanceOn(state, v, proposal.key);
    proposal.votes[v.id] = s >= SUPPORT_STANCE ? 'aye' : 'no';
    if (s >= SUPPORT_STANCE) ayes++; else noes++;
  }
  const passed = ayes > noes;
  proposal.status = passed ? 'PASSED' : 'REJECTED';
  proposal.decidedDay = state.day;
  const names = (kind) => voters.filter((v) => proposal.votes[v.id] === kind).map((v) => v.firstName).join(', ') || 'nobody';
  if (passed) {
    // Laws take effect at the start of the next season, never retroactively.
    const effective = state.day + CALENDAR.daysPerSeason;
    const l = { id: 'law-' + proposal.key, key: proposal.key, name: LAWS[proposal.key].name, status: 'ACTIVE', enactedDay: state.day, effectiveDay: effective, proposedBy: proposal.proposedBy, reason: proposal.reason };
    const law = ensureLaw(state);
    law.laws = law.laws.filter((x) => x.key !== proposal.key).concat(l);
    // Public opinion follows people's own interests.
    let pleased = 0, angry = 0;
    for (const c of state.citizens) {
      if (ageOf(state, c) < LIFE.adultAge) continue;
      const s = stanceOn(state, c, proposal.key);
      c.mood = Math.max(0, Math.min(100, c.mood + s * 4));
      if (s > 0.2) pleased++; else if (s < -0.2) angry++;
    }
    if (gov) gov.approval = Math.max(0, Math.min(100, Math.round(gov.approval + (pleased - angry) / Math.max(4, state.citizens.length) * 10)));
    record(state, 'law', `The ${l.name} passed (${names('aye')} for; ${names('no')} against), because ${proposal.reason}. It takes effect on day ${effective}. ${pleased} villagers welcomed it, ${angry} resented it.`, { citizens: voters.map((v) => v.id) }, 3);
  } else {
    record(state, 'law', `A proposed ${LAWS[proposal.key].name} failed (${names('aye')} for; ${names('no')} against).`, { citizens: voters.map((v) => v.id) }, 2);
  }
}
