import { LIFE, DAYS_PER_YEAR } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { adjust } from '../citizens/Relationships.js';
import { record } from '../society/Chronicle.js';
import { balance, transfer } from '../economy/Transactions.js';
import { spendable } from '../finance/BankAccounts.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';
import { planJourney, settlementName } from '../region/RegionManager.js';
import { relationScore } from '../diplomacy/Diplomacy.js';
import { warHooks } from '../diplomacy/Diplomacy.js';
import { peopleOf } from '../region/ForeignCitizenManager.js';
import { GATES } from '../navigation/RoadNetwork.js';
import { beliefOf, isAdherent, TRADITIONS } from '../institutions/FaithManager.js';
import { activeCommunities } from '../institutions/ReligiousInstitutions.js';
import { DIVINE, ROLES } from './Config.js';
import { ensureDivine, roll, r2, clamp01, hiddenRecord, nextDivineId, effectOn } from './State.js';
import { worldviewOf, learnOfStone, viewPhrase, stoneFaith, isBelieverOfStone } from './Worldview.js';

// How ideas travel: through real conversations between villagers who meet,
// through parents and children, and on the road with missionaries who choose
// to go. Hearing an idea is never the same as accepting it: every listener
// weighs it against their own trust, temperament and convictions.

const zeal = (c) => (c.worldview?.role === 'preacher' || c.worldview?.role === 'missionary' ? 1.6 : c.worldview?.role === 'philosopher' ? 1.3 : 1);

/**
 * A conversation (CitizenBrain's chat): news of the stone may pass from one
 * to the other, and two who both know of it may talk it over.
 */
export function chatAboutStone(state, a, b) {
  const stone = state.divine?.stone;
  if (!stone?.discovered) return;
  const ka = a.worldview?.stone, kb = b.worldview?.stone;
  if (!ka && !kb) return;
  const t = state.tick;
  if (ka && !kb) return tell(state, a, b, t);
  if (kb && !ka) return tell(state, b, a, t);
  // Both know: they may discuss it, each hearing the other's view.
  const p = 0.12 + (ka.interest + kb.interest) * 0.18;
  if (roll(state, a.id, b.id, 'discuss', t) >= p) return;
  hear(state, b, a);
  hear(state, a, b);
}

function tell(state, teller, listener, t) {
  if (ageOf(state, listener) < 6) return;
  const k = teller.worldview.stone;
  const p = (0.04 + k.interest * 0.2) * (0.6 + trait(teller, 'friendly') * 0.6) * zeal(teller);
  if (roll(state, teller.id, listener.id, 'tell', t) >= p) return;
  learnOfStone(state, listener, { how: 'heard', from: teller.id });
  remember(state, listener, `${teller.firstName} told me about a strange carved stone; ${teller.firstName} thinks it is ${viewPhrase(k.interp)}.`, 1, 'gossip');
}

/** `listener` hears `speaker`'s view: its weight depends on trust, openness and the speaker's conviction. */
export function hear(state, listener, speaker, strength = 1) {
  const kl = listener.worldview?.stone, ks = speaker.worldview?.stone;
  if (!kl || !ks || ks.interp === 'indifferent') return;
  const wv = listener.worldview;
  const trust = state.relationships[`${listener.id}|${speaker.id}`]?.trust ?? 45;
  const w = 0.05 * (trust / 100) * (0.4 + wv.open) * (0.5 + ks.conf) * zeal(speaker) * strength;
  kl.social[ks.interp] = r2((kl.social[ks.interp] ?? 0) + w);
  // A confirmed sceptic pressed with talk of gods pushes back toward evidence instead.
  if (ks.interp === 'divine' && kl.interp !== 'divine' && wv.skep > 0.6) kl.social.natural = r2((kl.social.natural ?? 0) + w * 0.6);
  kl.interest = r2(clamp01(kl.interest + 0.02 * strength));
  // Disagreement handled without tolerance strains a friendship a little; with tolerance it does not.
  if (kl.interp !== ks.interp && kl.interp !== 'indifferent' && wv.tol < 0.35 && kl.conf > 0.6) adjust(state, listener.id, speaker.id, { respect: -1 });
}

/**
 * Yearly: convictions may lead someone to take up a role — preaching,
 * travelling, studying, teaching, debating, pilgrimage — or to set it down.
 * The player cannot assign any of these.
 */
export function reviewRoles(state) {
  const d = ensureDivine(state);
  if (!d.stone?.discovered) return;
  for (const c of state.citizens) {
    const age = ageOf(state, c);
    const wv = c.worldview;
    const k = wv?.stone;
    if (!k || age < LIFE.adultAge) { if (wv) wv.role = null; continue; }
    const b = beliefOf(state, c);
    const believer = isBelieverOfStone(c) && k.interp === 'divine';
    const h = roll(state, c.id, 'role', state.day);
    const was = wv.role;
    let role = null;
    if (believer && k.conf > 0.65 && k.interest > 0.55 && (trait(c, 'friendly') > 0.35 || b.stance === 'devout')) {
      role = age <= 58 && (trait(c, 'riskTaking') > 0.35 || wv.cur > 0.6) && h < 0.6 ? 'missionary' : 'preacher';
    } else if ((c.education?.level ?? 0) >= 0.55 && wv.cur >= 0.5 && k.interest > 0.45 && k.interp !== 'indifferent') role = 'scholar';
    else if ((wv.outlook === 'reason' || wv.outlook === 'agnostic') && wv.cur >= 0.5 && k.interest > 0.4) role = 'philosopher';
    else if (believer && b.stance === 'devout' && k.interest > 0.5) role = 'pilgrim';
    else if (trait(c, 'creative') > 0.5 && k.interest > 0.5 && k.interp !== 'indifferent') role = 'storyteller';
    // People keep a calling for a while rather than changing it every year.
    if (was && role !== was && h < 0.5 && k.interest > 0.3) role = was;
    if (role === was) continue;
    wv.role = role;
    if (role) remember(state, c, `Took up a new calling: ${ROLES[role].toLowerCase()}.`, 2, 'life');
    else if (was) remember(state, c, `Set aside my calling as ${ROLES[was].toLowerCase()}.`, 2, 'life');
    if (role === 'missionary' && !d.stone.firsts.missionary) hiddenRecord(state, 'missionary', `${c.firstName} ${c.lastName} resolved to carry word of the stone beyond the valley.`, { citizens: [c.id] }, 2);
  }
}

/** Yearly: children hear their parents' view of the stone (they will weigh it for themselves when grown). */
export function teachChildren(state) {
  if (!state.divine?.stone?.discovered) return;
  for (const child of state.citizens) {
    const age = ageOf(state, child);
    if (age < 6 || age >= LIFE.adultAge || child.worldview?.stone) continue;
    const parent = child.family.parentIds.map((id) => byId(state.citizens, id)).find((p) => p?.worldview?.stone && p.worldview.stone.interp !== 'indifferent');
    if (!parent) continue;
    learnOfStone(state, child, { how: 'taught', from: parent.id });
  }
}

/** First Hearth is at war with a kingdom (missionaries do not walk into a war). */
const atWar = (state, kid) => !!warHooks.between?.(state, HEARTH, kid);

/**
 * Seasonal: a missionary with no recent journey may set out for a kingdom
 * reachable by an open, known road, paying for provisions or helped by their
 * community. They are away for the journey's real length.
 */
export function considerMissions(state) {
  const d = ensureDivine(state);
  if (!d.stone?.discovered) return;
  for (const c of state.citizens) {
    if (c.worldview?.role !== 'missionary' || c.away || ageOf(state, c) > 60) continue;
    const last = d.missions.filter((m) => m.missionaryId === c.id).at(-1);
    if (last && state.day - last.departDay < DAYS_PER_YEAR * 2) continue;
    if (roll(state, c.id, 'mission', state.day) > 0.35) continue;
    const options = Object.keys(KINGDOMS)
      .filter((kid) => !atWar(state, kid))
      .map((kid) => ({ kid, plan: planJourney(state, HEARTH, kid) }))
      .filter((o) => o.plan)
      .map((o) => ({ ...o, score: (d.foreign[o.kid]?.visits ?? 0) * -1 + relationScore(state, HEARTH, o.kid) / 50 + roll(state, c.id, o.kid, state.day) }))
      .sort((a, b) => b.score - a.score);
    const pick = options[0];
    if (!pick) continue;
    const travelDays = Math.max(1, Math.ceil(pick.plan.hours / 9));
    const days = travelDays * 2 + 2;
    const cost = 4 + travelDays * 3;
    const community = activeCommunities(state).find((f) => isAdherent(c, f.tradition));
    let sponsor = null;
    if (spendable(state, c.id) >= cost + 10 && balance(state, c.id) >= cost) transfer(state, c.id, 'outside', cost, 'expense', `${c.firstName}'s provisions for a journey to ${settlementName(pick.kid)}`);
    else if (community && balance(state, community.id) >= cost + 30) { transfer(state, community.id, 'outside', cost, 'expense', `Provisions for ${c.firstName}'s journey to ${settlementName(pick.kid)}`); sponsor = community.name; }
    else continue;
    const m = { id: nextDivineId(state, 'm'), missionaryId: c.id, name: `${c.firstName} ${c.lastName}`, to: pick.kid, departDay: state.day, returnDay: state.day + days, status: 'OUT', sponsor, legs: pick.plan.legs.map((l) => l.route), results: null };
    d.missions.push(m);
    if (d.missions.length > DIVINE.kept.missions) d.missions.splice(0, d.missions.length - DIVINE.kept.missions);
    d.stats.missions++;
    if (c.employment) c.employment.onLeaveUntil = m.returnDay;
    c.away = { until: m.returnDay, reason: 'mission', missionId: m.id };
    c.activity = null;
    const gate = GATES.west;
    c.x = gate.x; c.z = gate.z;
    remember(state, c, `Set out for ${settlementName(pick.kid)} to tell its people about the stone.`, 3, 'milestone');
    const first = !d.stone.firsts.missionary;
    if (first) d.stone.firsts.missionary = state.day;
    record(state, 'culture', `${c.firstName} ${c.lastName} set out for ${settlementName(pick.kid)} to speak of the carved stone${sponsor ? `, the ${sponsor} paying for provisions` : ''}${first ? ' — the first to carry its story beyond the valley' : ''}. Expected back in ${days} days.`, { citizens: [c.id] }, first ? 3 : 2);
    hiddenRecord(state, 'missionary', `${c.firstName} left for ${settlementName(pick.kid)} (journey ${m.id}).`, { citizens: [c.id], mission: m.id }, 1);
  }
}

/** How a kingdom's own culture disposes its people to a stranger's tale (small, by design). */
const RECEPTIVE = { greenvale: 0, ironhold: -0.08, saltmere: 0.08 };

/**
 * Daily: missionaries come home. Each named foreigner they spoke with
 * decided for themselves: interested, unconvinced, undecided, or (rarely)
 * persuaded. One visit never converts a kingdom.
 */
export function returnMissions(state) {
  const d = ensureDivine(state);
  for (const m of d.missions.filter((x) => x.status === 'OUT')) {
    const c = byId(state.citizens, m.missionaryId);
    if (!c) { m.status = 'LOST'; continue; }
    if (state.day < m.returnDay) continue;
    m.status = 'RETURNED';
    c.away = null;
    if (c.employment) delete c.employment.onLeaveUntil;
    c.x = GATES.west.x * 0.9; c.z = GATES.west.z * 0.9;
    c.needs.hunger = Math.max(c.needs.hunger, 45);
    // The road has its own hazards (robbery, fever on the way); Safe Passage makes them rarer.
    const risk = 0.1 * (effectOn(state, 'passage', c.id) ? 0.5 : 1) * (effectOn(state, 'protection', c.id) ? 0.7 : 1);
    const mishap = roll(state, m.id, 'mishap') < risk;
    const f = (d.foreign[m.to] = d.foreign[m.to] ?? { visits: 0, heard: 0, interested: 0, believers: 0, rejected: 0, undecided: 0, circle: null });
    f.visits++;
    const people = peopleOf(state, m.to, { includeAway: false }).filter((p) => p.role !== 'child').sort((a, b) => roll(state, m.id, a.id) - roll(state, m.id, b.id)).slice(0, mishap ? 3 : 6);
    const tally = { believer: 0, interested: 0, undecided: 0, rejected: 0 };
    const wv = c.worldview;
    for (const p of people) {
      const prior = p.hand?.view;
      const score = 0.28 + roll(state, m.id, p.id, 'listen') * 0.45 + relationScore(state, HEARTH, m.to) / 400 + (RECEPTIVE[m.to] ?? 0)
        + (wv?.stone?.conf ?? 0.5) * 0.08 + (prior === 'interested' ? 0.12 : prior === 'rejected' ? -0.15 : 0)
        - (p.role === 'faith' ? 0.25 : 0) - (p.role === 'ruler' || p.role === 'notable' ? 0.08 : 0);
      const view = score > 0.84 ? 'believer' : score > 0.62 ? 'interested' : score > 0.42 ? 'undecided' : 'rejected';
      if (!prior) f.heard++;
      if (prior && f[prior === 'believer' ? 'believers' : prior] > 0) f[prior === 'believer' ? 'believers' : prior]--;
      f[view === 'believer' ? 'believers' : view]++;
      p.hand = { view, day: state.day, from: c.id };
      tally[view]++;
    }
    m.results = { ...tally, mishap };
    const parts = [tally.believer && `${tally.believer} came to share ${c.firstName}'s belief`, tally.interested && `${tally.interested} listened with interest`, tally.undecided && `${tally.undecided} were undecided`, tally.rejected && `${tally.rejected} turned the idea away`].filter(Boolean);
    const story = `${c.firstName} ${c.lastName} came home from ${settlementName(m.to)}${mishap ? ', robbed of provisions and short of breath from fever on the road,' : ''}: ${parts.length ? parts.join(', ') : 'nobody would listen'}.`;
    remember(state, c, story, 3, 'milestone');
    record(state, 'culture', story, { citizens: [c.id] }, 2);
    hiddenRecord(state, 'missionary', story, { citizens: [c.id], mission: m.id }, tally.believer ? 2 : 1);
    if (!f.circle && f.believers >= 3) {
      f.circle = state.day;
      record(state, 'culture', `In ${settlementName(m.to)}, a small circle now meets to talk of the stone of First Hearth (${f.believers} believers).`, {}, 2);
      hiddenRecord(state, 'movement', `A circle of believers formed in ${settlementName(m.to)}.`, {}, 2);
    }
    if (mishap) c.mood = Math.max(0, c.mood - 8);
  }
}

/** A short line for a citizen's page. */
export function roleLine(c) {
  const r = c.worldview?.role;
  return r ? ROLES[r] : null;
}

export { stoneFaith, TRADITIONS };
