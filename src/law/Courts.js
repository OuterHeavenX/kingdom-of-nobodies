import { balance, transfer } from '../economy/Transactions.js';
import { isTrading, businessById } from '../economy/Businesses.js';
import { ageOf } from '../citizens/Citizen.js';
import { DAYS_PER_YEAR } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { chance } from '../core/Random.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { bump } from '../society/Reputation.js';
import { plotById, plotHistory } from '../property/LandRegistry.js';
import { listForSale } from '../property/Ownership.js';
import { ensureLaw, lawInForce, LAWS } from './LegalCode.js';
import { isInstitutionId, institutionName } from '../institutions/Registry.js';

/** Judgments for case kinds owned by other systems (debts): (state, case, judgment, pay) => void. */
export const judgmentHandlers = {};

// Courts. Claims are captured at the moment something goes wrong (an unpaid
// shift, a theft with witnesses, a short delivery, an estate left to one
// child, money missing from the treasury), with references to the records
// that prove it. A claimant decides whether to sue; the council's inspectors
// file the public cases (idle land, unrepaired buildings, unlicensed shops).
// A judge hears cases in order, as the court's capacity allows, applies the
// law that was in force when the events happened, and every judgment is
// carried out once through the ledger or the land registry.

const HEARING_HOUR = 10;
const JUDGE_FEE = 3;

const who = (state, id) => {
  if (id === 'council') return { kind: 'council', id, name: 'the council' };
  const c = byId(state.citizens, id);
  if (c) return { kind: 'citizen', id, name: `${c.firstName} ${c.lastName}` };
  const b = businessById(state, id);
  if (b) return { kind: 'business', id, name: b.name, ownerId: b.ownerId };
  if (isInstitutionId(id)) return { kind: 'institution', id, name: institutionName(state, id) ?? id };
  const a = state.archive[id];
  return { kind: 'citizen', id, name: a ? `${a.firstName} ${a.lastName}` : id };
};

// --- Claims captured from events ------------------------------------------------

function claim(state, entry) {
  const law = ensureLaw(state);
  const open = law.claims.find((c) => c.kind === entry.kind && c.claimantId === entry.claimantId && c.defendantId === entry.defendantId && !c.filed);
  if (open && entry.kind === 'wages') { open.items.push(...entry.items); open.evidence.push(...entry.evidence); open.amount += entry.amount; return open; }
  law.claims.push({ id: 'cl' + (law.claims.length + 1) + '-' + state.day, filed: false, day: state.day, ...entry });
  if (law.claims.length > 80) law.claims = law.claims.filter((c) => !c.filed).concat(law.claims.filter((c) => c.filed).slice(-20));
  return law.claims.at(-1);
}

/** Other systems file claims through here (a bank recovering a defaulted loan). */
export const fileClaim = (state, entry) => claim(state, entry);

/** An employer could not pay a shift. */
export function noteUnpaidWage(state, worker, business, wage) {
  claim(state, {
    kind: 'wages', law: 'wages', claimantId: worker.id, defendantId: business.id, amount: wage,
    items: [{ day: state.day, minute: state.minute, wage }],
    evidence: [
      { type: 'employment', text: `Employed at ${business.name} since day ${worker.employment.since} at ${worker.employment.wage} coins a shift.` },
      { type: 'ledger', text: `No wage payment from ${business.name} to ${worker.firstName} for the shift on day ${state.day} (ledger checked to entry ${state.nextId.tx}); the business held ${balance(state, business.id)} coins.` },
    ],
  });
}

/** A theft, recorded with whoever saw it. */
export function noteTheft(state, thief, victimId, good, n, value, witnesses) {
  claim(state, {
    kind: 'theft', law: 'theft', claimantId: victimId, defendantId: thief.id, amount: value, good, n,
    evidence: [
      { type: 'inventory', text: `${n} ${good} missing from ${who(state, victimId).name}'s stock on day ${state.day}.` },
      ...witnesses.map((w) => ({ type: 'witness', text: `${w.firstName} ${w.lastName} saw ${thief.firstName} take the ${good}.`, witnessId: w.id })),
    ],
  });
}

/** A delivery fell short through the merchant's own fault. */
export function noteContractShortfall(state, contract, short, cause) {
  if (short <= 0) return;
  const local = contract.merchantHome === 'hearth' || contract.destination === 'hearth';
  if (!local) return;
  const claimant = contract.destination === 'hearth' ? contract.buyer.party : null;
  if (!claimant) return; // foreign buyers sue in their own courts
  claim(state, {
    kind: 'contract', law: 'contracts', claimantId: claimant, defendantId: contract.merchantId, amount: Math.round(contract.sellPrice * short), cause,
    evidence: [
      { type: 'contract', text: `Contract ${contract.id}: ${contract.qty} ${contract.commodity} at ${contract.sellPrice} a unit, agreed day ${contract.createdDay}.` },
      { type: 'cargo', text: `Only ${contract.delivered ?? contract.qty - short} delivered on day ${state.day}; ${short} short (${cause}).` },
    ],
  });
}

/** An heir was left out of an estate. */
export function noteEstateDispute(state, estate, claimant, heir) {
  claim(state, {
    kind: 'estate', law: 'property', claimantId: claimant.id, defendantId: heir.id, amount: 0, estateId: estate.id,
    evidence: [
      { type: 'estate', text: `Estate ${estate.id} of the late ${who(state, estate.deceasedId).name}: ${estate.plots.length} propert${estate.plots.length === 1 ? 'y' : 'ies'}, ${estate.coins} coins.` },
      { type: 'registry', text: `Land registered to ${heir.firstName}: ${estate.plots.filter((p) => p.to === heir.id).length} plot(s); to ${claimant.firstName}: none.` },
      { type: 'family', text: `${claimant.firstName} and ${heir.firstName} are both children of the deceased.` },
    ],
  });
}

/** Money was taken from the treasury. */
export function noteEmbezzlement(state, scandal, leader) {
  claim(state, {
    kind: 'fraud', law: 'fraud', claimantId: 'council', defendantId: leader.id, amount: scandal.amount - (scandal.repaid ?? 0), scandalId: scandal.id,
    evidence: [{ type: 'ledger', text: `An unrecorded withdrawal of ${scandal.amount} coins from the treasury to ${leader.firstName} on day ${scandal.day}${scandal.txId ? ` (ledger entry ${scandal.txId})` : ''}.` }],
  });
}

// --- Filing ------------------------------------------------------------------------

function fileCase(state, cl) {
  const law = ensureLaw(state);
  cl.filed = true;
  const c = {
    id: 'case' + ++law.nextCase, kind: cl.kind, law: cl.law, claimId: cl.id, eventDay: cl.day, filedDay: state.day,
    plaintiff: who(state, cl.claimantId), defendant: who(state, cl.defendantId), amount: cl.amount,
    evidence: cl.evidence.slice(0, 8), details: Object.fromEntries(Object.entries({ good: cl.good, n: cl.n, cause: cl.cause, estateId: cl.estateId, scandalId: cl.scandalId, plotId: cl.plotId, loanId: cl.loanId }).filter(([, v]) => v !== undefined)),
    status: 'FILED', hearingDay: null, judgment: null,
  };
  law.cases.push(c);
  law.stats.filed++;
  record(state, 'law', `${c.plaintiff.name.replace(/^the /, 'The ')} brought a ${LAWS[c.law].name.replace(' Act', '').toLowerCase()} case against ${c.defendant.name}.`, { citizens: [c.plaintiff.id, c.defendant.id].filter((id) => byId(state.citizens, id)) }, 2);
  return c;
}

/** Daily: claimants decide whether to sue; inspectors look for public wrongs. */
function filings(state) {
  const law = ensureLaw(state);
  for (const cl of law.claims.filter((x) => !x.filed)) {
    if (cl.claimantId === 'council' || businessById(state, cl.claimantId)?.ownerId === 'council' || isInstitutionId(cl.claimantId)) { fileCase(state, cl); continue; }
    const plaintiff = byId(state.citizens, cl.claimantId) ?? byId(state.citizens, businessById(state, cl.claimantId)?.ownerId);
    if (!plaintiff) { cl.filed = true; cl.abandoned = true; continue; }
    const resolve = 0.15 + trait(plaintiff, 'honest') * 0.2 + trait(plaintiff, 'stubborn') * 0.25 - trait(plaintiff, 'shy') * 0.15 + (cl.amount >= 10 ? 0.2 : 0) + (cl.kind === 'wages' && cl.items.length >= 2 ? 0.25 : 0);
    if (chance(state, Math.max(0.05, resolve))) fileCase(state, cl);
    else if (state.day - cl.day > 8) { cl.filed = true; cl.abandoned = true; }
  }
  inspections(state);
}

function inspections(state) {
  if (state.day % 3 !== 0) return;
  const law = ensureLaw(state);
  const pending = (kind, id) => law.cases.some((c) => c.kind === kind && c.details.plotId === id && c.status !== 'JUDGED') || law.claims.some((c) => c.kind === kind && c.plotId === id && !c.filed);
  if (lawInForce(state, 'land')) {
    for (const p of state.plots) {
      if (p.ownerId === 'council' || p.building || p.projectId || !byId(state.citizens, p.ownerId)) continue;
      const since = Math.max(p.acquiredDay ?? 0, lawStart(state, 'land'));
      if (state.day - since > DAYS_PER_YEAR * 2 && !pending('land', p.id)) {
        claim(state, { kind: 'land', law: 'land', claimantId: 'council', defendantId: p.ownerId, amount: p.boughtFor ?? p.price, plotId: p.id, evidence: [{ type: 'registry', text: `${p.name} registered to ${who(state, p.ownerId).name} since day ${since}; nothing built in ${state.day - since} days.` }] });
      }
    }
  }
  if (lawInForce(state, 'safety')) {
    for (const p of state.plots) {
      if (!p.building || (p.building.condition ?? 100) >= 40 || p.ownerId === 'council' || p.projectId) { if (p.decayedSince) delete p.decayedSince; continue; }
      p.decayedSince = p.decayedSince ?? state.day;
      if (state.day - p.decayedSince > 6 && !pending('safety', p.id)) claim(state, { kind: 'safety', law: 'safety', claimantId: 'council', defendantId: p.ownerId, amount: 8, plotId: p.id, evidence: [{ type: 'inspection', text: `${p.name} found at ${Math.round(p.building.condition)}% condition on day ${state.day}, unrepaired since day ${p.decayedSince}.` }] });
    }
  }
  if (lawInForce(state, 'licensing')) {
    for (const b of state.businesses) {
      if (!isTrading(b) || b.licensed || b.ownerId === 'council' || law.claims.some((c) => c.kind === 'licence' && c.defendantId === b.id && !c.filed) || law.cases.some((c) => c.kind === 'licence' && c.defendant.id === b.id && c.status !== 'JUDGED')) continue;
      claim(state, { kind: 'licence', law: 'licensing', claimantId: 'council', defendantId: b.id, amount: 10, evidence: [{ type: 'registry', text: `${b.name} trading on day ${state.day} with no licence on the council's register.` }] });
    }
  }
}

const lawStart = (state, key) => ensureLaw(state).laws.find((l) => l.key === key)?.effectiveDay ?? state.day;

// --- Judges and hearings --------------------------------------------------------

export function appointJudge(state) {
  const law = ensureLaw(state);
  if (law.judgeId && byId(state.citizens, law.judgeId)) return byId(state.citizens, law.judgeId);
  const pick = state.citizens.filter((c) => ageOf(state, c) >= 30 && !c.away && state.government?.leaderId !== c.id)
    .map((c) => ({ c, s: c.reputation.standing + c.reputation.honesty * 0.5 + trait(c, 'honest') * 20 - trait(c, 'dishonest') * 30 }))
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id))[0]?.c;
  if (!pick) return null;
  law.judgeId = pick.id;
  record(state, 'law', `${pick.firstName} ${pick.lastName} was appointed to hear the village's cases, trusted for ${pick.reputation.honesty >= 60 ? 'honesty' : 'good standing'}.`, { citizens: [pick.id] }, 2);
  return pick;
}

export const courtCapacity = (state) => (state.plots.some((p) => p.building?.type === 'courthouse') ? 2 : 1);

function schedule(state) {
  const law = ensureLaw(state);
  const cap = courtCapacity(state);
  const booked = {};
  for (const c of law.cases) if (c.status === 'SCHEDULED') booked[c.hearingDay] = (booked[c.hearingDay] ?? 0) + 1;
  for (const c of law.cases.filter((x) => x.status === 'FILED')) {
    let day = state.day + 1;
    while ((booked[day] ?? 0) >= cap) day++;
    booked[day] = (booked[day] ?? 0) + 1;
    c.hearingDay = day;
    c.status = 'SCHEDULED';
  }
  law.backlog = law.cases.filter((c) => c.status === 'SCHEDULED').length;
}

/** People due in court today (for citizens' decisions). */
export function courtToday(state, c) {
  const law = state.law;
  if (!law) return null;
  return law.cases.find((x) => x.status === 'SCHEDULED' && x.hearingDay === state.day && (x.plaintiff.id === c.id || x.defendant.id === c.id || law.judgeId === c.id || x.plaintiff.ownerId === c.id || x.defendant.ownerId === c.id)) ?? null;
}

// --- Judgments ------------------------------------------------------------------------

/** Pay what can be paid; returns the amount moved. */
function pay(state, from, to, amount, kind, memo, j) {
  const accounts = from.kind === 'business' ? [from.id, from.ownerId].filter((a) => a && a !== 'council') : [from.id === 'council' ? 'treasury' : from.id];
  let left = amount;
  for (const acct of accounts) {
    const n = Math.min(left, balance(state, acct));
    if (n > 0 && transfer(state, acct, to === 'council' ? 'treasury' : to, n, kind, memo)) { j.transfers.push({ from: acct, to, amount: n, kind, tx: state.nextId.tx }); left -= n; }
  }
  return amount - left;
}

// Acts of nature and of governments excuse a merchant; spoilage and short loading do not.
const excused = (cause) => /storm|closed|closure|embargo|landslide|flood/.test(cause ?? '');

/** Hear a case and carry out the judgment. Safe to call twice: a judged case is never re-executed. */
export function hearCase(state, c) {
  if (c.status === 'JUDGED') return c.judgment;
  const law = ensureLaw(state);
  const judge = appointJudge(state);
  const j = { day: state.day, judgeId: judge?.id ?? null, judgeName: judge ? `${judge.firstName} ${judge.lastName}` : 'the council', law: LAWS[c.law].name, outcome: 'dismissed', reason: '', transfers: [], evidenceUsed: c.evidence.map((e) => e.type) };
  const inForce = lawInForce(state, c.law, c.eventDay);
  const D = c.defendant, P = c.plaintiff;
  const gone = D.kind === 'citizen' && !byId(state.citizens, D.id) || D.kind === 'business' && !businessById(state, D.id);
  if (!inForce) j.reason = `no law covered it when it happened (the ${LAWS[c.law].name} was not in force on day ${c.eventDay})`;
  else if (gone) j.reason = `${D.name} is no longer here to answer`;
  else if (c.kind === 'wages') {
    const owed = c.amount;
    const paid = pay(state, D, P.id, owed, 'restitution', `Court-ordered back pay to ${P.name}`, j);
    // The council does not fine itself.
    const fine = D.ownerId === 'council' ? 0 : pay(state, D, 'council', Math.ceil(owed * 0.2), 'fine', `Fine under the ${LAWS.wages.name}`, j);
    j.outcome = 'restitution';
    j.reason = `the employment record and the missing wage payments show ${owed} coins owed for ${c.evidence.length - 1} unpaid shift(s); ${paid} paid back, ${fine} fined${paid < owed ? `; ${owed - paid} could not be recovered` : ''}`;
  } else if (c.kind === 'theft') {
    const witnesses = c.evidence.filter((e) => e.type === 'witness').length;
    if (!witnesses) j.reason = 'there was no witness, only missing stock';
    else {
      const thief = byId(state.citizens, D.id);
      const poor = balance(state, thief.id) < c.amount * 2;
      const paid = pay(state, D, P.kind === 'business' ? P.id : P.id, c.amount, 'restitution', `Restitution for stolen ${c.details.good}`, j);
      const fine = poor ? 0 : pay(state, D, 'council', Math.ceil(c.amount * 0.5), 'fine', `Fine under the ${LAWS.theft.name}`, j);
      j.outcome = fine ? 'fine' : 'restitution';
      j.reason = `${witnesses} witness${witnesses > 1 ? 'es' : ''} saw it; ${paid} coins restored${fine ? ` and a fine of ${fine}` : poor ? ', the fine waived because the thief was in real want' : ''}`;
      bump(thief, 'honesty', -15);
      remember(state, thief, `Was judged for stealing ${c.details.good}.`, 3, 'grievance');
    }
  } else if (c.kind === 'contract') {
    if (excused(c.details.cause)) j.reason = `the shortfall was caused by ${c.details.cause}, which excuses the merchant`;
    else {
      const damages = Math.max(1, Math.round(c.amount * 0.1));
      const paid = pay(state, D, P.id, damages, 'restitution', `Damages for a short delivery`, j);
      j.outcome = 'contract enforced';
      j.reason = `the contract and cargo records show a shortfall through the merchant's own fault (${c.details.cause}); damages of ${paid}`;
    }
  } else if (c.kind === 'fraud') {
    const paid = pay(state, D, 'council', c.amount, 'restitution', 'Return of misused treasury funds', j);
    const fine = pay(state, D, 'council', Math.ceil(c.amount * 0.25), 'fine', `Fine under the ${LAWS.fraud.name}`, j);
    j.outcome = 'restitution';
    j.reason = `the ledger shows ${c.amount} coins unaccounted for; ${paid} returned and ${fine} fined`;
  } else if (c.kind === 'estate') {
    const estate = state.estates.find((e) => e.id === c.details.estateId);
    const heirPlots = (estate?.plots ?? []).filter((p) => p.to === D.id).map((p) => plotById(state, p.id)).filter((p) => p && p.ownerId === D.id && !p.projectId);
    if (heirPlots.length >= 2 && !state.citizens.some((x) => x.id === P.id)) {
      // A claimant who has since left the kingdom cannot be given land here.
      j.reason = `${P.name} has left the kingdom; the estate stays with the lawful heir under the Property Registry Act`;
    } else if (heirPlots.length >= 2) {
      // The law favours the main heir, but not to the exclusion of every sibling.
      const plot = heirPlots.sort((a, b) => a.price - b.price)[0];
      plot.ownerId = P.id;
      plot.reservedBy = null;
      plotHistory(state, plot, `Transferred to ${P.name} by court order (case ${c.id}).`);
      j.outcome = 'property transfer';
      j.propertyTransfer = { plotId: plot.id, from: D.id, to: P.id };
      j.reason = `the estate left ${heirPlots.length} plots to ${D.name} and nothing to ${P.name}; ${plot.name} passes to ${P.name}`;
    } else j.reason = 'the estate passed to the lawful heir under the Property Registry Act';
  } else if (c.kind === 'land') {
    const plot = plotById(state, c.details.plotId);
    if (!plot || plot.building || plot.projectId || plot.ownerId !== D.id) j.reason = 'the land has since been built on or sold';
    else {
      const price = Math.min(plot.boughtFor ?? plot.price, balance(state, 'treasury'));
      if (price > 0) pay(state, { kind: 'council', id: 'council' }, D.id, price, 'property', `Council buy-back of ${plot.name}`, j);
      plot.ownerId = 'council';
      plot.reservedBy = null;
      listForSale(state, plot.id);
      plotHistory(state, plot, `Bought back by the council under the Land Development Act (case ${c.id}).`);
      j.outcome = 'property transfer';
      j.propertyTransfer = { plotId: plot.id, from: D.id, to: 'council' };
      j.reason = `${plot.name} stood idle for over two years; the council bought it back for ${price} coins and offered it for sale`;
    }
  } else if (c.kind === 'safety') {
    const plot = plotById(state, c.details.plotId);
    if (!plot?.building || (plot.building.condition ?? 100) >= 40) j.reason = 'the building has been repaired';
    else { const fine = pay(state, D, 'council', 8, 'fine', `Fine under the ${LAWS.safety.name}`, j); plot.repairOrdered = state.day; j.outcome = 'fine'; j.reason = `the inspection found ${plot.name} at ${Math.round(plot.building.condition)}%; fined ${fine} and ordered to repair`; }
  } else if (c.kind === 'licence') {
    const b = businessById(state, D.id);
    if (!b || b.licensed || !isTrading(b)) j.reason = 'the business is now licensed or closed';
    else {
      const repeat = law.cases.some((x) => x !== c && x.kind === 'licence' && x.defendant.id === b.id && x.judgment?.outcome === 'fine');
      const fine = pay(state, D, 'council', 10, 'fine', `Fine under the ${LAWS.licensing.name}`, j);
      if (repeat) { b.suspendedUntil = state.day + 3; j.outcome = 'licence suspension'; j.reason = `trading again without a licence; fined ${fine} and closed for three days`; }
      else { j.outcome = 'fine'; j.reason = `trading without a licence; fined ${fine}`; }
    }
  }
  else if (judgmentHandlers[c.kind]) judgmentHandlers[c.kind](state, c, j, pay);
  if (j.outcome === 'dismissed') law.stats.dismissed++;
  for (const t of j.transfers) { if (t.kind === 'fine') law.stats.fines += t.amount; if (t.kind === 'restitution') law.stats.restitution += t.amount; }
  // The judge is paid for the hearing.
  if (judge && transfer(state, 'treasury', judge.id, JUDGE_FEE, 'wage', `${judge.firstName}'s fee for hearing ${c.id}`)) j.fee = JUDGE_FEE;
  j.executedDay = state.day;
  c.judgment = j;
  c.status = 'JUDGED';
  law.stats.judged++;
  for (const id of [P.id, D.id, P.ownerId, D.ownerId]) { const p = byId(state.citizens, id); if (p) p.mood = Math.max(0, Math.min(100, p.mood + ((id === P.id || id === P.ownerId) === (j.outcome !== 'dismissed') ? 6 : -6))); }
  record(state, 'law', `${j.judgeName} ruled in ${P.name} v ${D.name}: ${j.outcome}. ${j.reason.charAt(0).toUpperCase() + j.reason.slice(1)}.`, { citizens: [P.id, D.id, P.ownerId, D.ownerId, j.judgeId].filter((id) => id && byId(state.citizens, id)) }, j.outcome === 'property transfer' || c.kind === 'fraud' ? 3 : 1);
  return j;
}

/** Daily: file, schedule. Hourly at ten: hear today's cases. */
export function dailyCourts(state) {
  ensureLaw(state);
  filings(state);
  schedule(state);
  const law = state.law;
  if (law.cases.length > 80) law.cases = law.cases.filter((c) => c.status !== 'JUDGED').concat(law.cases.filter((c) => c.status === 'JUDGED').slice(-50)).sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
}

export function hourlyCourts(state) {
  if (!state.law || state.minute / 60 !== HEARING_HOUR) return;
  for (const c of state.law.cases.filter((x) => x.status === 'SCHEDULED' && x.hearingDay <= state.day)) hearCase(state, c);
}

export const needsCourthouse = (state) => (state.law?.stats.filed ?? 0) >= 6 || ((state.law?.backlog ?? 0) >= 3) || state.citizens.length >= 70;
