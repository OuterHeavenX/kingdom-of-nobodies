import { LIFE, DAYS_PER_YEAR } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { yearOf } from '../core/Calendar.js';
import { isTrading } from '../economy/Businesses.js';
import { balance } from '../economy/Transactions.js';
import { beliefOf } from '../institutions/FaithManager.js';
import { DIVINE } from './Config.js';
import { ensureDivine, roll, hiddenRecord, nextDivineId } from './State.js';
import { worldviewOf, interpretOutcome, experience, isBelieverOfStone } from './Worldview.js';

// Prayers. Some villagers, in some troubles, choose to pray; others turn to
// friends, the council or nobody. Every prayer is about something real in the
// prayer's life right now — a named child's fever, a journey a brother is
// really on, a business that really is struggling — and is stored with the
// world facts it refers to. The player may answer with a subtle blessing or
// an ambiguous sign, or leave it unanswered; silence is never punished.

const kinOf = (state, c) => [c.family.spouseId, ...c.family.childIds, ...c.family.parentIds].map((id) => byId(state.citizens, id)).filter(Boolean);
const relationTo = (c, o) => (c.family.spouseId === o.id ? (o.sex === 'F' ? 'wife' : 'husband') : c.family.childIds.includes(o.id) ? (o.sex === 'F' ? 'daughter' : 'son') : c.family.parentIds.includes(o.id) ? (o.sex === 'F' ? 'mother' : 'father') : 'friend');

/** How inclined someone is to pray at all, from their own worldview. */
export function prayerDisposition(state, c) {
  const b = beliefOf(state, c);
  const wv = worldviewOf(state, c);
  const adherent = b.tradition && (b.stance === 'devout' || b.stance === 'casual');
  let p = adherent ? (b.stance === 'devout' ? 0.55 : 0.28) : ({ personal: 0.3, agnostic: 0.04, reason: 0.015, atheist: 0.004 }[wv.outlook] ?? 0.05);
  if (isBelieverOfStone(c)) p += 0.12;
  return Math.min(0.8, p);
}

/**
 * The troubles (or joys) in a villager's life that a prayer could be about,
 * most pressing first. Each is checked against the world as it is today.
 */
export function troublesOf(state, c) {
  const out = [];
  const kin = kinOf(state, c);
  const sick = [c, ...kin].filter((k) => k.health.sickUntil > state.day);
  for (const k of sick) out.push({ subject: 'illness', weight: 0.45, target: k, text: k === c ? 'Please let this fever pass, and let me be well again.' : `Please let my ${relationTo(c, k)} ${k.firstName}'s fever pass.`, blessings: ['healing', 'protection'] });
  for (const k of kin.filter((x) => x.away)) {
    const why = { militia: 'from the war', mission: 'from the journey', scouting: 'from scouting the wild country' }[k.away.reason] ?? 'from the journey';
    out.push({ subject: 'journey', weight: 0.3, target: k, text: `I hope my ${relationTo(c, k)} ${k.firstName} returns safely ${why}.`, blessings: ['passage', 'protection'] });
  }
  const war = (state.military?.wars ?? []).find((w) => w.status === 'ACTIVE' && (w.attackers?.includes('hearth') || w.defenders?.includes('hearth')));
  if (war) out.push({ subject: 'peace', weight: 0.15, target: null, warId: war.id, text: 'Let there be peace between our kingdoms.', blessings: ['peace'] });
  const job = c.employment && state.businesses.find((b) => b.id === c.employment.businessId);
  if (job?.type === 'farm' && state.season?.cropFailureYear === yearOf(state.day)) out.push({ subject: 'harvest', weight: 0.25, target: c, businessId: job.id, text: `Our farm cannot survive another bad harvest. Let ${job.name} yield again.`, blessings: ['harvest', 'fortune'] });
  if (!c.employment && !c.retired && ageOf(state, c) >= LIFE.adultAge && ageOf(state, c) < LIFE.retireAge && balance(state, c.id) < 25) out.push({ subject: 'work', weight: 0.12, target: c, text: 'Help me find honest work before my last coins are gone.', blessings: ['fortune', 'courage'] });
  const own = state.businesses.find((b) => b.ownerId === c.id && b.status === 'STRUGGLING');
  if (own) out.push({ subject: 'business', weight: 0.15, target: c, businessId: own.id, text: `${own.name} is failing. Let it find its customers again.`, blessings: ['fortune', 'courage'] });
  const loss = c.memories.find((m) => m.kind === 'loss' && state.day - m.day < DAYS_PER_YEAR);
  if (loss) out.push({ subject: 'grief', weight: 0.15, target: c, memoryDay: loss.day, text: `Give me strength to bear it: ${loss.text.replace(/\.$/, '').toLowerCase()}.`, blessings: ['comfort'] });
  if (!c.homePlotId && ageOf(state, c) >= LIFE.adultAge) out.push({ subject: 'courage', weight: 0.15, target: c, text: 'Give me the courage to begin again.', blessings: ['courage', 'fortune'] });
  if (ageOf(state, c) >= 24 && ageOf(state, c) < 50 && !c.romance.partnerId && !c.family.spouseId && c.needs.social < 35) out.push({ subject: 'companion', weight: 0.07, target: c, text: 'I am so alone. Let me find a friend who understands me.', blessings: ['encounter'] });
  if (c.education?.masterId || (c.worldview?.role === 'scholar')) out.push({ subject: 'learning', weight: 0.05, target: c, text: c.worldview?.role === 'scholar' ? 'Let me understand what the carvings say.' : 'Help me learn my trade well.', blessings: ['inspiration'] });
  const born = state.citizens.find((k) => c.family.childIds.includes(k.id) && state.day - k.birthDay <= 6 && state.day - k.birthDay >= 0);
  if (born) out.push({ subject: 'gratitude', weight: 0.1, target: born, text: `Thank you for ${born.firstName}, born healthy.`, blessings: [] });
  const outbreak = state.season?.outbreak;
  if (outbreak && !sick.length) out.push({ subject: 'protection', weight: 0.08, target: c, text: 'Keep the fever from our door.', blessings: ['protection'] });
  return out;
}

/**
 * Daily: villagers in trouble who are inclined to pray may do so. At most one
 * new prayer per person every few days, and only one open prayer per subject.
 */
export function dailyPrayers(state) {
  const d = ensureDivine(state);
  for (const c of state.citizens) {
    if (c.away || ageOf(state, c) < 10) continue;
    const mine = d.prayers.filter((p) => p.citizenId === c.id);
    const open = mine.filter((p) => !p.resolvedDay);
    if (mine.some((p) => state.day - p.day < 3)) continue;
    const disposition = prayerDisposition(state, c);
    if (disposition < 0.01) continue;
    for (const t of troublesOf(state, c)) {
      // One open prayer per trouble, and not the same prayer again straight after the last was settled.
      if (mine.some((p) => p.subject === t.subject && (p.targetId ?? null) === (t.target?.id ?? null) && (!p.resolvedDay || state.day - p.resolvedDay < 9))) continue;
      if (roll(state, c.id, 'pray', t.subject, state.day) >= disposition * t.weight) continue;
      makePrayer(state, c, t);
      break;
    }
  }
  resolvePrayers(state);
}

function makePrayer(state, c, t) {
  const d = state.divine;
  const p = {
    id: nextDivineId(state, 'p'), citizenId: c.id, name: `${c.firstName} ${c.lastName}`, day: state.day, subject: t.subject, text: t.text,
    targetId: t.target?.id ?? null, targetName: t.target ? `${t.target.firstName} ${t.target.lastName}` : null,
    world: { ...(t.businessId ? { businessId: t.businessId } : {}), ...(t.warId ? { warId: t.warId } : {}), ...(t.memoryDay ? { memoryDay: t.memoryDay } : {}), sick: t.target ? t.target.health.sickUntil > state.day : false, away: t.target?.away?.reason ?? null },
    blessings: t.blessings, viewed: false, response: null, outcome: null, resolvedDay: null,
  };
  d.prayers.push(p);
  d.stats.prayersMade++;
  // Keep the list bounded: drop the oldest resolved prayers first, then the oldest of all.
  while (d.prayers.length > DIVINE.kept.prayers) {
    const i = d.prayers.findIndex((x) => x.resolvedDay);
    d.prayers.splice(i >= 0 ? i : 0, 1);
  }
  c.worldview.lastPrayer = state.day;
  return p;
}

/** Which prayers the player can still answer (open, recent, and with something to answer). */
export const openPrayers = (state) => (state.divine?.prayers ?? []).filter((p) => !p.resolvedDay && !p.response).slice().reverse();

/** The outcome of a prayer, judged from the world (never from whether the player answered). */
function outcomeOf(state, p) {
  const t = byId(state.citizens, p.targetId);
  const c = byId(state.citizens, p.citizenId);
  const late = state.day - p.day >= DIVINE.prayerWindowDays;
  switch (p.subject) {
    case 'illness': return !t ? 'died' : t.health.sickUntil <= state.day ? 'recovered' : late ? 'still ill' : null;
    case 'journey': return !t ? 'died' : !t.away ? 'returned' : late ? 'still away' : null;
    case 'peace': return !(state.military?.wars ?? []).some((w) => w.id === p.world.warId && w.status === 'ACTIVE') ? 'peace came' : late ? 'the war goes on' : null;
    case 'harvest': return state.season?.cropFailureYear !== yearOf(state.day) ? 'the fields recovered' : late ? 'the harvest failed' : null;
    case 'work': return c?.employment ? 'found work' : late ? 'still without work' : null;
    case 'business': { const b = state.businesses.find((x) => x.id === p.world.businessId); return !b || !isTrading(b) ? 'it closed' : b.status === 'OPEN' ? 'it recovered' : late ? 'still struggling' : null; }
    case 'companion': return c && (c.romance.partnerId || c.needs.social > 60) ? 'found company' : late ? 'still alone' : null;
    case 'gratitude': return 'given thanks';
    default: return late ? (c && c.mood >= 55 ? 'found some peace' : 'still troubled') : null;
  }
}

const GOOD = new Set(['recovered', 'returned', 'peace came', 'the fields recovered', 'found work', 'it recovered', 'found company', 'found some peace']);

/**
 * Daily: prayers whose outcome is known are closed. The one who prayed
 * explains the outcome in their own way (an answered prayer, good care,
 * coincidence), whatever the player did. Those near them may explain it
 * differently. The Hidden Chronicle records what the player actually did.
 */
function resolvePrayers(state) {
  const d = state.divine;
  for (const p of d.prayers) {
    if (p.resolvedDay) continue;
    const outcome = outcomeOf(state, p);
    if (!outcome) continue;
    p.outcome = outcome;
    p.resolvedDay = state.day;
    const answered = p.response && p.response !== 'silence';
    if (answered) d.stats.prayersAnswered++; else d.stats.prayersUnanswered++;
    hiddenRecord(state, answered ? 'prayer-answered' : 'prayer-unanswered', `${p.name}'s prayer (“${p.text}”) — ${answered ? `you answered with ${p.responseLabel ?? 'a blessing'}` : 'you did not answer'}; ${outcome}.`, { citizens: [p.citizenId], prayer: p.id }, answered ? 2 : 1);
    const c = byId(state.citizens, p.citizenId);
    if (!c || p.subject === 'gratitude') continue;
    const good = GOOD.has(outcome);
    if (!good) { remember(state, c, `My prayer went unanswered: ${outcome}.`, 2, 'life'); experience(state, c, 'prayer', 'natural'); continue; }
    explainRecovery(state, p, c, outcome);
  }
}

/** A good outcome after a prayer: who says what about it. */
function explainRecovery(state, p, c, outcome) {
  const hospital = state.plots.some((x) => x.building?.type === 'hospital');
  const mine = interpretOutcome(state, c, p.subject === 'illness' ? 'recovery' : p.subject === 'harvest' ? 'harvest' : 'fortune', { prayed: true, treated: hospital && p.subject === 'illness' });
  remember(state, c, `${outcome[0].toUpperCase()}${outcome.slice(1)} — ${mine.interp === 'divine' ? 'my prayer was answered' : `I put it down to ${mine.phrase}`}.`, 2, 'life');
  experience(state, c, 'prayer', mine.interp);
  if (p.subject !== 'illness' || !p.targetId || p.targetId === c.id) return;
  // A recovery others noticed: a sceptic, and whoever cared for the patient, may see it otherwise.
  const t = byId(state.citizens, p.targetId);
  const voices = [{ who: c, view: mine }];
  const carer = state.citizens.find((o) => o !== c && o !== t && hospital && o.worldview && (o.worldview.skep > 0.35 || o.worldview.outlook === 'reason') && (state.relationships[`${o.id}|${c.id}`]?.friendship ?? 0) > 25);
  if (carer) voices.push({ who: carer, view: { interp: 'natural', phrase: 'the care at the hospital' } });
  const sceptic = state.citizens.find((o) => o !== c && o !== t && o !== carer && o.worldview && o.worldview.skep > 0.55 && (state.relationships[`${o.id}|${c.id}`]?.friendship ?? 0) > 20);
  if (sceptic) { const v = interpretOutcome(state, sceptic, 'recovery', {}); voices.push({ who: sceptic, view: v }); experience(state, sceptic, 'witness', v.interp); }
  const distinct = new Set(voices.map((v) => v.view.phrase));
  if (voices.length < 2 || distinct.size < 2) return;
  const said = voices.map(({ who, view }) => `${who.firstName} ${who === c ? (view.interp === 'divine' ? 'gave thanks for an answered prayer' : `put it down to ${view.phrase}`) : view.phrase === 'the care at the hospital' ? 'credited the care at the hospital' : `called it ${view.phrase}`}`);
  record(state, 'citizen', `${t?.firstName ?? 'The patient'} recovered from the fever. ${said.join('; ')}.`, { citizens: voices.map((v) => v.who.id).concat(t ? [t.id] : []) }, 1);
}

/** Someone who prayed has died or left the valley: their open prayers are closed (no one is left to answer). */
export function closePrayersOf(state, c, why) {
  for (const p of state.divine?.prayers ?? []) if (p.citizenId === c.id && !p.resolvedDay) { p.outcome = why; p.resolvedDay = state.day; }
}

export { GOOD };
