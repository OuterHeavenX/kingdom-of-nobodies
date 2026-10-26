import { DAYS_PER_YEAR, LIFE, CALENDAR } from '../core/Config.js';
import { isNewYear, yearOf } from '../core/Calendar.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { peekRel } from '../citizens/Relationships.js';
import { priorities } from '../politics/Opinion.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { LAWS, lawInForce, lawHooks } from '../law/LegalCode.js';
import { fileClaim, judgmentHandlers } from '../law/Courts.js';
import { plotById, BUILDING_INFO } from '../property/LandRegistry.js';
import { landDemand } from '../city/LandDemand.js';
import { formOf, formLabel } from './ArchitectureData.js';

// Historic preservation. Buildings gather historic importance as they age,
// house long-lived businesses, belong to the founders' generation or are the
// first of their era. Schemes that would pull down an important building, or
// raise a tower beside a listed one, go to planning: villagers who care
// campaign, the council votes, and under the Heritage Preservation Act the
// campaigners can take the developer to court. Listed buildings may be
// repaired and restored but not demolished or rebuilt.

export const LISTING_SCORE = 60;
export const CONCERN_SCORE = 42;

LAWS.heritage = {
  name: 'Heritage Preservation Act', issue: 'works',
  description: 'Buildings of historic importance are listed by the council and protected.',
  requirement: 'A listed building may be repaired or restored, but not demolished or rebuilt.',
  remedy: 'An injunction stopping the work, and listing of the building.',
};

/** Systems that carry out approved applications register here, by kind. */
export const applicationExecutors = {};

export function ensureHeritage(state) {
  const civ = state.civ;
  civ.heritage = civ.heritage ?? { listed: {}, disputes: [], lost: [], nextId: 0 };
  civ.heritage.conservation = civ.heritage.conservation ?? [];
  civ.applications = civ.applications ?? [];
  return civ.heritage;
}

const yearsStanding = (state, b) => (state.day - (b.firstBuiltDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR;
/** Years the present building has stood since it was built or last rebuilt. */
const ownAge = (state, b) => (state.day - (b.rebuiltDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR;

/** Historic importance of what stands on a plot (0..100), with the reasons. */
export function heritageScore(state, plot) {
  const b = plot.building;
  if (!b || ['ruins', 'grounds'].includes(b.type)) return { score: 0, reasons: [] };
  const reasons = [];
  let s = 0;
  const years = yearsStanding(state, b);
  const unchanged = (state.day - (b.rebuiltDay ?? b.builtDay ?? 1)) / DAYS_PER_YEAR;
  s += Math.min(30, unchanged * 0.25);
  if (unchanged >= 60) reasons.push(`standing unchanged for ${Math.round(unchanged)} years`);
  if ((b.builtDay ?? 1) <= DAYS_PER_YEAR * 5 && !b.rebuiltDay) { s += 25; reasons.push("built in the founders' time"); }
  if ((b.era ?? 1) < (state.civ.age ?? 1) - 1 && unchanged > 100) { s += 10; reasons.push('a rare survivor of an earlier age'); }
  if (['hall', 'townhall', 'temple', 'chapel', 'courthouse', 'school', 'guildhall'].includes(b.type)) { s += 12; reasons.push(`the ${BUILDING_INFO[b.type].label.toLowerCase()} is a public landmark`); }
  const biz = plot.businessId ? state.businesses.find((x) => x.id === plot.businessId) : null;
  if (biz && (state.day - biz.foundedDay) / DAYS_PER_YEAR >= 50) { s += 10; reasons.push(`home of ${biz.name} for ${Math.round((state.day - biz.foundedDay) / DAYS_PER_YEAR)} years`); }
  const first = Object.values(state.civ.firsts ?? {}).find((f) => f.plotId === plot.id);
  if (first && b.era > 1) { s += 12; reasons.push(`the town's first ${first.label.toLowerCase()}`); }
  if (b.type === 'tavern' && unchanged >= 80) { s += 6; reasons.push('a historic tavern'); }
  if (years > unchanged + 1 && b.firstBuiltDay) s += 3;
  return { score: Math.round(Math.min(100, s)), reasons };
}

export const isListed = (state, plotId) => !!state.civ?.heritage?.listed?.[plotId];

/** Construction veto: listed buildings can be repaired, upgraded and restored, not demolished or rebuilt. */
export function heritageVeto(state, plot, kind, type = null) {
  const destructive = kind === 'demolition' || kind === 'rebuild' || kind === 'refit';
  if (isListed(state, plot.id) && destructive) return `${plot.name} is a listed historic building`;
  // In a conservation area old buildings stay (unless they are ruinous) and nothing tall is built.
  if (inConservation(state, plot)) {
    const b = plot.building;
    if (destructive && b && b.type !== 'ruins' && (b.condition ?? 100) >= 40 && ownAge(state, b) >= 60) return `${plot.name} stands in the ${plot.district} conservation area`;
    if ((kind === 'construction' || kind === 'rebuild') && type && formOf(type, state.civ.age).tall) return `no towers may rise in the ${plot.district} conservation area`;
  }
  return null;
}

export const inConservation = (state, plot) => !!state.civ?.heritage?.conservation?.includes(plot.district);

/** Under the Heritage Act the council protects whole historic districts: the old town first, then the oldest surviving quarter. */
function designateConservation(state) {
  const h = ensureHeritage(state);
  const districts = [...new Set(state.plots.map((p) => p.district))];
  const oldness = (d) => state.plots.filter((p) => p.district === d && p.building && ownAge(state, p.building) >= 80 && (p.building.era ?? 1) <= Math.max(1, (state.civ.age ?? 1) - 2)).length;
  const limit = (state.civ.age ?? 1) >= 4 ? 2 : 1;
  if (h.conservation.length >= limit) return;
  const pick = districts.filter((d) => !h.conservation.includes(d)).map((d) => [d, oldness(d) + (d === 'Old Town' ? 3 : 0)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!pick || pick[1] < 3) return;
  h.conservation.push(pick[0]);
  record(state, 'law', `🏛 The council declared ${pick[0]} a conservation area under the Heritage Preservation Act: its old buildings may be repaired and restored, but not pulled down, and no towers may rise there.`, {}, 3);
}

function list(state, plot, why) {
  const h = ensureHeritage(state);
  if (h.listed[plot.id]) return false;
  h.listed[plot.id] = { day: state.day, why, label: formLabel(plot.building), name: plot.building?.name ?? plot.name };
  record(state, 'law', `🏛 ${plot.building?.name ?? plot.name} on ${plot.name} was listed as a historic building: ${why}.`, { plot: plot.id }, 2);
  return true;
}

/** How much a villager cares about the town's old buildings (roughly -0.5..1.5). */
export function heritageAffinity(state, c, site = null) {
  let a = trait(c, 'loyal') * 0.35 + trait(c, 'stubborn') * 0.2 + trait(c, 'curious') * 0.1 - trait(c, 'ambitious') * 0.25 - trait(c, 'greedy') * 0.2;
  if (ageOf(state, c) >= 50) a += 0.15;
  if (c.generation >= 3 || c.founder) a += 0.1;
  if (c.faith?.tradition === 'hearthkin') a += 0.25; // ancestors and family memory
  if (site) {
    const home = plotById(state, c.homePlotId);
    if (home && Math.hypot(home.x - site.x, home.z - site.z) < 18) a += 0.25;
    if (site.ownerId && state.civ.archive?.[site.id]?.some((r) => r.o && (r.o === c.id || c.family.parentIds.includes(r.o)))) a += 0.35;
  }
  return Math.round(a * 100) / 100;
}

/** Concerns a scheme raises: important buildings it would remove, or listed ones a tower would overshadow. */
export function planningConcerns(state, app) {
  const out = [];
  const plots = [...app.plotIds, app.annexId].filter(Boolean).map((id) => plotById(state, id));
  for (const p of plots) {
    if (!p?.building) continue;
    if (isListed(state, p.id)) out.push({ plotId: p.id, why: `${p.name} is listed` , hard: true });
    const { score, reasons } = heritageScore(state, p);
    if (score >= CONCERN_SCORE) out.push({ plotId: p.id, score, why: `${formLabel(p.building).toLowerCase()} on ${p.name} (${reasons.slice(0, 2).join('; ') || 'old and loved'})` });
  }
  if (formOf(app.type, app.era).tall) {
    const site = plots[0];
    for (const id of Object.keys(ensureHeritage(state).listed)) {
      const q = plotById(state, id);
      if (q && site && q !== site && Math.hypot(q.x - site.x, q.z - site.z) < 15) out.push({ plotId: q.id, why: `a tower would overshadow the listed ${q.building?.name ?? q.name}` });
    }
  }
  return out;
}

/**
 * Put a scheme to planning. Uncontroversial schemes are approved at once and
 * carried out; contested ones become a dispute the council votes on.
 */
export function applyForPlanning(state, app, finance = null) {
  const h = ensureHeritage(state);
  const a = { id: 'pa' + ++h.nextId, day: state.day, status: 'PENDING', ...app };
  state.civ.applications.push(a);
  if (state.civ.applications.length > 40) state.civ.applications = state.civ.applications.filter((x) => !['DONE', 'REFUSED', 'LAPSED'].includes(x.status)).concat(state.civ.applications.filter((x) => ['DONE', 'REFUSED', 'LAPSED'].includes(x.status)).slice(-24));
  const concerns = planningConcerns(state, a);
  if (concerns.some((c) => c.hard)) return refuse(state, a, concerns.find((c) => c.hard).why);
  if (!concerns.length) return approve(state, a, 'no historic building was affected', finance);
  const site = plotById(state, a.plotIds[0]);
  const campaigners = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge && c.id !== a.applicantId && heritageAffinity(state, c, site) >= 0.45)
    .sort((x, y) => heritageAffinity(state, y, site) - heritageAffinity(state, x, site) || x.id.localeCompare(y.id));
  if (campaigners.length < 3) return approve(state, a, `only ${campaigners.length} villager${campaigners.length === 1 ? '' : 's'} objected`, finance);
  const d = { id: 'hd' + h.nextId, appId: a.id, day: state.day, voteDay: state.day + CALENDAR.daysPerSeason, concerns: concerns.map((c) => c.why), campaigners: campaigners.slice(0, 12).map((c) => c.id), leadId: campaigners[0].id, status: 'OPEN' };
  h.disputes.push(d);
  if (h.disputes.length > 30) h.disputes.shift();
  a.status = 'DISPUTED';
  a.disputeId = d.id;
  const lead = campaigners[0];
  for (const c of campaigners.slice(0, 6)) remember(state, c, `Campaigned to save ${concerns[0].why.split(' (')[0]}.`, 2, 'opinion');
  record(state, 'law', `A planning dispute: ${applicantName(state, a)} wants to build ${article(formOf(a.type, a.era).labels[0])} ${formOf(a.type, a.era).labels[0].toLowerCase()} on ${site.name}, but ${campaigners.length} villagers led by ${lead.firstName} ${lead.lastName} are campaigning to save ${concerns.map((c) => c.why).slice(0, 2).join(' and ')}. The council will decide on day ${d.voteDay}.`,
    { citizens: [lead.id, ...(byId(state.citizens, a.applicantId) ? [a.applicantId] : [])], plot: site.id }, 3);
  return a;
}

const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const applicantName = (state, a) => (a.applicantId === 'council' ? 'the council' : (() => { const c = byId(state.citizens, a.applicantId); return c ? `${c.firstName} ${c.lastName}` : 'a developer'; })());

function approve(state, a, why, finance) {
  a.status = 'APPROVED';
  a.decision = why;
  a.decidedDay = state.day;
  return execute(state, a, finance);
}

function refuse(state, a, why) {
  a.status = 'REFUSED';
  a.decision = why;
  a.decidedDay = state.day;
  const site = plotById(state, a.plotIds[0]);
  record(state, 'law', `Planning refused for ${applicantName(state, a)}'s ${formOf(a.type, a.era).labels[0].toLowerCase()} on ${site?.name}: ${why}.`, { plot: site?.id ?? null }, 2);
  return a;
}

function execute(state, a, finance) {
  const run = applicationExecutors[a.kind];
  const err = run ? run(state, a, finance ?? state.civ.financeHook?.(state) ?? {}) : 'nobody can carry it out';
  if (err) { a.status = 'LAPSED'; a.decision = `${a.decision}; then lapsed because ${err}`; return a; }
  a.status = 'BUILDING';
  // A notable building being pulled down is remembered (and may move the council to pass a heritage law).
  for (const id of [...a.plotIds, a.annexId].filter(Boolean)) {
    const p = plotById(state, id);
    if (p?.building && heritageScore(state, p).score >= CONCERN_SCORE) ensureHeritage(state).lost.push({ day: state.day, plotId: p.id, label: formLabel(p.building) });
  }
  return a;
}

/** Daily: council votes on disputes; court cases decide contested approvals; projects finish applications. */
export function dailyHeritage(state, finance) {
  const h = ensureHeritage(state);
  for (const d of h.disputes.filter((x) => x.status === 'OPEN' && x.voteDay <= state.day)) councilVote(state, d, finance);
  for (const a of state.civ.applications.filter((x) => x.status === 'IN_COURT')) {
    const law = state.law;
    const c = law?.cases.find((x) => x.claimId === a.claimId);
    const claim = law?.claims.find((x) => x.id === a.claimId);
    if (claim?.abandoned || (!c && state.day - a.decidedDay > 12)) { approve(state, a, `${a.decision}; the campaigners did not pursue it in court`, finance); continue; }
    if (c?.status !== 'JUDGED') continue;
    if (c.judgment.outcome === 'injunction') refuse(state, a, `the court granted an injunction (${c.id})`);
    else approve(state, a, `${a.decision}; the court dismissed the campaigners' case (${c.id})`, finance);
  }
  for (const a of state.civ.applications.filter((x) => x.status === 'BUILDING')) if (!state.projects.some((p) => p.id === a.projectId)) a.status = 'DONE';
  if (isNewYear(state.day)) yearlyListing(state);
}

function councilVote(state, d, finance) {
  const a = state.civ.applications.find((x) => x.id === d.appId);
  if (!a) { d.status = 'CLOSED'; return; }
  const site = plotById(state, a.plotIds[0]);
  const gov = state.government;
  const voters = (gov ? [gov.leaderId, ...(gov.councillors ?? [])] : []).map((id) => byId(state.citizens, id)).filter(Boolean);
  const panel = voters.length ? voters : state.citizens.filter((c) => ageOf(state, c) >= 30).sort((x, y) => y.reputation.standing - x.reputation.standing || x.id.localeCompare(y.id)).slice(0, 3);
  const shortage = landDemand(state).housingShortage;
  let save = 0, build = 0;
  const votes = {};
  for (const v of panel) {
    const p = priorities(state, v);
    const rel = byId(state.citizens, a.applicantId) ? peekRel(state, v.id, a.applicantId) : null;
    const forHeritage = heritageAffinity(state, v, site) + (d.campaigners.length / Math.max(8, state.citizens.length)) * 3;
    const forGrowth = (p.business ?? 0) * 0.4 + (p.works ?? 0) * 0.3 + shortage * 0.08 + ((rel?.friendship ?? 20) - 20) / 80 + (a.applicantId === 'council' ? 0.3 : 0);
    const keep = forHeritage > forGrowth;
    votes[v.id] = keep ? 'save' : 'build';
    if (keep) save++; else build++;
  }
  d.votes = votes;
  d.status = 'DECIDED';
  d.decidedDay = state.day;
  const names = (k) => panel.filter((v) => votes[v.id] === k).map((v) => v.firstName).join(', ') || 'nobody';
  if (save > build) {
    d.outcome = 'saved';
    for (const id of [...a.plotIds, a.annexId].filter(Boolean)) { const p = plotById(state, id); if (p?.building && heritageScore(state, p).score >= CONCERN_SCORE && lawInForce(state, 'heritage')) list(state, p, 'saved by the council after a public campaign'); }
    refuse(state, a, `the council voted to protect it (${names('save')} to save; ${names('build')} to build)`);
    for (const id of d.campaigners) { const c = byId(state.citizens, id); if (c) c.mood = Math.min(100, c.mood + 6); }
    return;
  }
  d.outcome = 'approved';
  a.decision = `the council approved it (${names('build')} to build; ${names('save')} to save)`;
  a.decidedDay = state.day;
  const lead = byId(state.citizens, d.leadId);
  // Under the Heritage Act the campaigners may go to court.
  if (lawInForce(state, 'heritage') && lead && byId(state.citizens, a.applicantId)) {
    const cl = fileClaim(state, { kind: 'heritage', law: 'heritage', claimantId: lead.id, defendantId: a.applicantId, amount: 0, plotId: site.id,
      evidence: [{ type: 'registry', text: `${d.concerns.join('; ')}.` }, ...d.campaigners.slice(0, 4).map((id) => ({ type: 'witness', text: `${byId(state.citizens, id)?.firstName ?? 'A villager'} objected.` }))] });
    a.status = 'IN_COURT';
    a.claimId = cl.id;
    record(state, 'law', `The council approved ${applicantName(state, a)}'s scheme on ${site.name} (${names('build')} for; ${names('save')} against). ${lead.firstName} ${lead.lastName} means to take it to court under the Heritage Preservation Act.`, { citizens: [lead.id], plot: site.id }, 2);
    return;
  }
  record(state, 'law', `The council approved ${applicantName(state, a)}'s scheme on ${site.name} (${names('build')} for; ${names('save')} against), over the campaigners' objections.`, { citizens: d.campaigners.slice(0, 3), plot: site.id }, 2);
  for (const id of d.campaigners) { const c = byId(state.citizens, id); if (c) { c.mood = Math.max(0, c.mood - 4); remember(state, c, `The council let them pull down a building we tried to save on ${site.name}.`, 2, 'grievance'); } }
  approve(state, a, a.decision, finance);
}

// The court weighs the building's documented importance.
judgmentHandlers.heritage = (state, c, j) => {
  const plot = plotById(state, c.details.plotId);
  const { score, reasons } = plot ? heritageScore(state, plot) : { score: 0, reasons: [] };
  if (plot?.building && score >= LISTING_SCORE) {
    list(state, plot, `ordered by the court (${reasons.slice(0, 2).join('; ')})`);
    j.outcome = 'injunction';
    j.reason = `${plot.name}'s records show ${reasons.join('; ') || 'great age'} (historic importance ${score}); the building is listed and the work may not go ahead`;
  } else {
    j.outcome = 'dismissed';
    j.reason = `the building's historic importance (${score}) falls short of listing; the scheme may proceed`;
  }
};

/** Yearly, under the Heritage Act: the council lists the most important buildings. */
function yearlyListing(state) {
  if (!lawInForce(state, 'heritage')) return;
  designateConservation(state);
  const candidates = state.plots.filter((p) => p.building && !isListed(state, p.id) && !p.projectId).map((p) => ({ p, ...heritageScore(state, p) })).filter((x) => x.score >= LISTING_SCORE)
    .sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id)).slice(0, 3);
  for (const x of candidates) list(state, x.p, x.reasons.slice(0, 2).join('; ') || 'its great age');
}

// The government proposes the Act once notable buildings have been lost or fought over.
lawHooks.reason.heritage = (state) => {
  const h = state.civ?.heritage;
  if (!h || (state.civ.age ?? 1) < 2) return null;
  if (h.lost.length >= 2) return `${h.lost.length} old buildings have been pulled down (${h.lost.slice(-2).map((l) => l.label.toLowerCase()).join(', ')})`;
  if (h.disputes.length >= 1) return `the town has argued over the fate of its old buildings`;
  return null;
};

/** A finished rebuild of an old building is a loss the town remembers (and may legislate against). */
export function noteLoss(state, plot, project) {
  const old = project.oldBuilding;
  if (!old || ownAge(state, old) < 70) return;
  const h = ensureHeritage(state);
  h.lost.push({ day: state.day, plotId: plot.id, label: formLabel(old), years: Math.round(ownAge(state, old)) });
  if (h.lost.length > 30) h.lost.shift();
}
lawHooks.stance.heritage = (state, c) => heritageAffinity(state, c) - 0.2;

/** For the UI: listed buildings and the landmark list. */
export function landmarks(state) {
  const h = ensureHeritage(state);
  const listed = Object.entries(h.listed).map(([id, l]) => ({ plot: plotById(state, id), ...l })).filter((x) => x.plot);
  const notable = state.plots.filter((p) => p.building && !h.listed[p.id]).map((p) => ({ plot: p, ...heritageScore(state, p) })).filter((x) => x.score >= CONCERN_SCORE).sort((a, b) => b.score - a.score).slice(0, 8);
  return { listed, notable, memorial: (state.monuments ?? []).some((m) => m.id === 'founders'), disputes: h.disputes.slice(-8).reverse(), year: yearOf(state.day) };
}
