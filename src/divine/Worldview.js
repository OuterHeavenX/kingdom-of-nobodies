import { LIFE, DAYS_PER_YEAR } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { yearOf } from '../core/Calendar.js';
import { TRADITIONS, beliefOf, isAdherent } from '../institutions/FaithManager.js';
import { INTERPRETATIONS, INTERPRETATION_IDS, OUTLOOKS } from './Config.js';
import { roll, clamp01, r2, ensureDivine, hiddenRecord } from './State.js';

// Worldviews. Every villager carries a small, persistent model of how they
// meet the unknown, alongside the tradition FaithManager already tracks:
//
//   outlook   - for those who keep no tradition: reason, agnostic, atheist or personal
//   cur       - curiosity (wants to look into things)
//   skep      - scepticism (wants evidence before believing)
//   open      - openness to new evidence and other people's views
//   tol       - tolerance of views unlike their own
//   stone     - what they know and think of the Mysterious Stone, if anything
//   exp       - a few significant experiences that bear on belief
//
// Temperament, prior belief, trust, experience, evidence and conversation
// produce each person's explanation. Honesty, generosity, intelligence and
// standing are never inputs, and belief never changes them: believers and
// sceptics are equally honest, capable and worthy. Education makes someone
// more likely to take the stone seriously and to study it; it never pushes
// them toward or away from belief.

const FAITHS_OF_THE_STONE = ['hand', 'light', 'silence'];
export const stoneFaith = (c) => FAITHS_OF_THE_STONE.some((t) => isAdherent(c, t));
export const isBelieverOfStone = (c) => c.worldview?.stone?.interp === 'divine' || stoneFaith(c);

export function worldviewOf(state, c) {
  if (c.worldview) return c.worldview;
  const b = beliefOf(state, c);
  const h = (k) => roll(state, c.id, 'wv', k);
  const devout = b.stance === 'devout';
  const wv = {
    cur: r2(clamp01(0.2 + trait(c, 'curious') * 0.55 + trait(c, 'creative') * 0.1 + h('c') * 0.3 - trait(c, 'lazy') * 0.15)),
    skep: r2(clamp01(0.12 + trait(c, 'stubborn') * 0.25 + h('s') * 0.45 + (b.stance === 'skeptical' ? 0.2 : b.stance === 'none' ? 0.15 : 0) - (devout ? 0.12 : 0))),
    open: r2(clamp01(0.3 + trait(c, 'curious') * 0.2 + trait(c, 'creative') * 0.15 + trait(c, 'friendly') * 0.1 - trait(c, 'stubborn') * 0.3 + h('o') * 0.3)),
    tol: 0,
    outlook: null,
    stone: null,
    exp: [],
    role: null,
  };
  wv.tol = r2(clamp01(0.4 + trait(c, 'friendly') * 0.15 + wv.open * 0.3 - trait(c, 'stubborn') * 0.15 + h('t') * 0.2));
  c.worldview = wv;
  wv.outlook = outlookFor(state, c);
  return wv;
}

/** For someone outside every tradition: which way of meeting the world fits them. */
function outlookFor(state, c) {
  const b = beliefOf(state, c);
  const wv = c.worldview;
  if (b.tradition && (b.stance === 'devout' || b.stance === 'casual')) return null;
  const h = roll(state, c.id, 'outlook', b.since ?? 0);
  if (b.stance === 'skeptical') return wv.skep > 0.5 && wv.cur > 0.45 ? 'reason' : 'agnostic';
  return h < 0.42 ? 'atheist' : h < 0.72 ? (wv.cur > 0.5 ? 'reason' : 'agnostic') : 'personal';
}

/** The single worldview a villager is counted under: their tradition if they practise one, otherwise their outlook. */
export function primaryWorldview(state, c) {
  const b = beliefOf(state, c);
  if (b.tradition && (b.stance === 'devout' || b.stance === 'casual')) return b.tradition;
  return worldviewOf(state, c).outlook ?? 'agnostic';
}

export const worldviewLabel = (key) => TRADITIONS[key]?.name ?? OUTLOOKS[key]?.label ?? key;

/** Note a significant experience (kept to the few that matter). */
export function experience(state, c, kind, interp, text = null) {
  const wv = worldviewOf(state, c);
  wv.exp.unshift({ day: state.day, kind, interp, ...(text ? { text } : {}) });
  if (wv.exp.length > 8) wv.exp.length = 8;
}

const recentExp = (state, wv, interp) => wv.exp.filter((e) => e.interp === interp && state.day - e.day < DAYS_PER_YEAR * 4).length;

/**
 * Weigh each explanation of the stone for one villager. Returns the scores
 * and, for each, the reasons that produced it (shown on the citizen's page,
 * so the explanation always matches the numbers).
 *
 * ctx: { saw, fromInterp, trust (0..100), social: {interp: weight} }
 */
export function weigh(state, c, ctx = {}) {
  const wv = worldviewOf(state, c);
  const b = beliefOf(state, c);
  const stone = state.divine?.stone;
  const adherent = !!b.tradition && (b.stance === 'devout' || b.stance === 'casual');
  const findings = stone?.public ? stone.findings ?? {} : {};
  const civAge = state.civ?.age ?? 1;
  const yearsSince = stone ? Math.max(0, yearOf(state.day) - yearOf(stone.placedDay)) : 0;
  const busy = Math.min(1, (c.needs?.hunger < 40 ? 0.5 : 0) + (c.employment ? 0.2 : 0) + (c.family?.childIds?.length ?? 0) * 0.05);
  const edu = c.education?.level ?? 0.3;
  const F = Object.fromEntries(INTERPRETATION_IDS.map((k) => [k, []]));
  const add = (k, w, why) => { if (Math.abs(w) >= 0.005) F[k].push([why, r2(w)]); };

  add('divine', 0.18, 'it is clearly not ordinary');
  // A faith of one's own makes the unseen thinkable, but each old tradition reads the stone in its own way.
  if (adherent) add('divine', 0.08 + b.devotion * 0.25, `my faith (${TRADITIONS[b.tradition].name}) teaches that more is at work in the world`);
  if (adherent && ['hand', 'light', 'silence'].includes(b.tradition)) add('divine', 0.3, 'my faith is built on the stone');
  if (adherent && b.tradition === 'dawn') add('divine', 0.1, 'the Dawnlight looks for signs of the light');
  if (adherent && b.tradition === 'furrow') add('natural', 0.08, 'the Furrow teaches that the land itself makes wonders');
  if (adherent && b.tradition === 'openhand') add('indifferent', 0.06, 'the Open Hand cares for people, not stones');
  if (wv.outlook === 'personal') add('divine', 0.3, 'I have always sensed something beyond us');
  if (wv.outlook === 'atheist') add('divine', -0.2, 'I do not believe in gods');
  add('divine', -wv.skep * 0.3, 'I want evidence before I believe');
  add('divine', Math.min(0.24, recentExp(state, wv, 'divine') * 0.06), 'things have happened to me that felt like answers');

  add('cosmic', 0.1 + wv.cur * 0.25, 'the carvings look like nothing ever made here');
  add('cosmic', trait(c, 'creative') * 0.15, 'I can imagine people beyond the sky');
  add('cosmic', (civAge - 1) * 0.04, civAge >= 3 ? 'we know now how much lies beyond our world' : '');
  add('cosmic', -(adherent ? b.devotion * 0.1 : 0), '');
  add('cosmic', Math.min(0.24, recentExp(state, wv, 'cosmic') * 0.06), 'I have seen things in the sky that I cannot explain');

  add('ancient', 0.13 + wv.cur * 0.12, 'stones do not carve themselves; someone made it long ago');
  if (state.region?.discovered?.landmarks?.includes('old-caer')) add('ancient', 0.12, 'the Ruins of Old Caer prove a forgotten people lived here');
  if (b.tradition === 'hearthkin' && adherent) add('ancient', 0.12, 'our ancestors left more than we remember');
  if (b.tradition === 'lantern' && adherent) add('ancient', 0.06, 'the Lantern teaches us to read what the past left');

  add('prank', 0.1 + wv.skep * 0.35, 'people love to fool each other');
  add('prank', trait(c, 'jealous') * 0.2, 'I suspect whoever stands to gain from the fuss');
  if (!ctx.saw && yearsSince < 6) add('prank', 0.1, 'it appeared out of nowhere, so somebody must have put it there');
  if (ctx.saw) add('prank', -0.1, 'I saw it: it looks older than anyone living');
  add('prank', -Math.min(0.25, yearsSince * 0.005), yearsSince > 10 ? 'no prank lasts this long' : '');

  add('natural', 0.08 + wv.skep * 0.28, 'we do not know enough to say');
  if (wv.outlook === 'reason') add('natural', 0.15, 'reason asks for evidence, not stories');
  if (wv.outlook === 'agnostic') add('natural', 0.12, 'I am not sure of anything unseen');
  add('natural', Math.min(0.24, recentExp(state, wv, 'natural') * 0.05), 'the odd things I have seen had ordinary explanations');

  add('indifferent', 0.16 + (1 - wv.cur) * 0.35, 'I have more pressing things to think about');
  add('indifferent', trait(c, 'lazy') * 0.15, '');
  add('indifferent', busy * 0.15, busy > 0.3 ? 'work and family keep me busy' : '');
  add('indifferent', -edu * 0.15, ''); // educated people take it seriously — in every direction
  if (!ctx.saw) add('indifferent', 0.08, 'I have only heard of it');
  // Interest that fades leaves people not caring either way.
  if (ctx.interest !== undefined) add('indifferent', (0.45 - ctx.interest) * 0.4, ctx.interest < 0.3 ? 'I have stopped thinking about it' : '');

  for (const k of ['ancient', 'cosmic', 'natural', 'prank']) if (findings[k]) add(k, Math.min(0.2, findings[k] * 0.25), `the scholars' findings point that way`);
  if (ctx.fromInterp && ctx.fromInterp !== 'indifferent') add(ctx.fromInterp, 0.12 * ((ctx.trust ?? 45) / 100) * (0.5 + wv.open), 'someone I trust told me so');
  for (const [k, w] of Object.entries(ctx.social ?? {})) if (w > 0 && F[k]) add(k, Math.min(0.22, w), 'people close to me see it this way');
  // Each mind has its own leanings no reason captures.
  for (const k of INTERPRETATION_IDS) add(k, (roll(state, c.id, 'lean', k) - 0.5) * 0.2, '');

  const scores = Object.fromEntries(INTERPRETATION_IDS.map((k) => [k, r2(F[k].reduce((s, [, w]) => s + w, 0))]));
  return { scores, factors: F };
}

const best = (scores) => INTERPRETATION_IDS.reduce((a, k) => (scores[k] > scores[a] ? k : a), INTERPRETATION_IDS[0]);
const marginOf = (scores, top) => scores[top] - Math.max(...INTERPRETATION_IDS.filter((k) => k !== top).map((k) => scores[k]));

/** The reasons behind a villager's current view, strongest first (for their page). */
export function reasonsFor(state, c) {
  const k = worldviewOf(state, c).stone;
  if (!k) return [];
  const { factors } = weigh(state, c, { saw: k.seen, social: k.social });
  return factors[k.interp].filter(([why, w]) => why && w > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([why]) => why);
}

/**
 * A villager learns of the stone: by seeing it, being told, reading of it or
 * being taught as a child. Returns their knowledge record (or null if they knew).
 */
export function learnOfStone(state, c, { how = 'heard', from = null } = {}) {
  const wv = worldviewOf(state, c);
  if (wv.stone) {
    if (how === 'saw' && !wv.stone.seen) { wv.stone.seen = true; wv.stone.interest = r2(clamp01(wv.stone.interest + 0.15)); }
    return null;
  }
  const teller = from ? byId(state.citizens, from) : null;
  const fromInterp = teller?.worldview?.stone?.interp ?? null;
  const trust = teller ? state.relationships[`${c.id}|${teller.id}`]?.trust ?? 45 : 45;
  const { scores } = weigh(state, c, { saw: how === 'saw', fromInterp, trust });
  const interp = best(scores);
  const enthusiasm = teller?.worldview?.stone?.interest ?? 0.4;
  wv.stone = {
    day: state.day, how, from: teller?.id ?? null, seen: how === 'saw', interp,
    conf: r2(clamp01(0.3 + marginOf(scores, interp) * 1.5)),
    interest: r2(clamp01((how === 'saw' ? 0.45 : 0.2) + wv.cur * 0.4 + (how === 'heard' ? enthusiasm * 0.1 : 0) - (interp === 'indifferent' ? 0.2 : 0))),
    social: {}, visits: 0, lastVisit: null,
  };
  const s = state.divine?.stone;
  if (s) s.known = (s.known ?? 0) + 1;
  return wv.stone;
}

/** How a villager describes their view of the stone, in their own words. */
export function viewPhrase(interp) {
  return {
    divine: 'the work of an unseen god', cosmic: 'the work of someone from beyond the sky', ancient: 'the work of a people long forgotten',
    prank: 'somebody\'s elaborate joke', natural: 'a puzzle we cannot answer yet', indifferent: 'not worth the fuss',
  }[interp] ?? 'a mystery';
}

/**
 * Build, once per pass, each villager's closest relations among those who
 * hold a view of the stone (a single sweep of the relationship table).
 */
export function socialIndex(state) {
  const holders = new Map(state.citizens.filter((c) => c.worldview?.stone).map((c) => [c.id, c]));
  const idx = new Map();
  for (const [key, r] of Object.entries(state.relationships)) {
    if (r.friendship < 35 && r.trust < 55) continue;
    const bar = key.indexOf('|');
    const to = key.slice(bar + 1);
    const other = holders.get(to);
    if (!other) continue;
    const from = key.slice(0, bar);
    let list = idx.get(from);
    if (!list) idx.set(from, (list = []));
    list.push({ c: other, w: (r.friendship / 100) * 0.6 + (r.trust / 100) * 0.4 });
  }
  for (const list of idx.values()) list.sort((a, b) => b.w - a.w || a.c.id.localeCompare(b.c.id)).splice(5);
  return idx;
}

/**
 * Seasonal: a villager turns their view over. Friends' views, membership of a
 * community or society, experiences and scholars' findings move it slowly;
 * the view they already hold resists change (so nobody flips on one event),
 * and it can change in any direction.
 */
export function reconsider(state, c, idx, membershipOf = () => null) {
  const wv = worldviewOf(state, c);
  const k = wv.stone;
  if (!k) return null;
  const social = { ...k.social };
  for (const { c: o, w } of idx.get(c.id) ?? []) {
    const oi = o.worldview.stone.interp;
    if (oi !== 'indifferent') social[oi] = (social[oi] ?? 0) + w * 0.06 * (0.4 + wv.open) * (0.5 + o.worldview.stone.conf);
  }
  const member = membershipOf(c);
  if (member) social[member] = (social[member] ?? 0) + 0.08;
  const { scores } = weigh(state, c, { saw: k.seen, social, interest: k.interest });
  scores[k.interp] += 0.12 + k.conf * 0.18; // the view one holds is not dropped lightly
  const top = best(scores);
  const margin = marginOf(scores, top);
  let changed = null;
  if (top !== k.interp) {
    changed = { from: k.interp, to: top };
    k.interp = top;
    k.conf = 0.3;
    k.changedDay = state.day;
    remember(state, c, `Came to think the stone is ${viewPhrase(top)}${changed.from !== 'indifferent' ? `, no longer ${viewPhrase(changed.from)}` : ''}.`, 2, 'life');
  } else {
    const target = clamp01(0.3 + margin * 1.2);
    k.conf = r2(k.conf + Math.max(-0.08, Math.min(0.08, target - k.conf)));
  }
  // Talk fades, and so does interest that nothing renews.
  for (const key of Object.keys(k.social)) { k.social[key] = r2(k.social[key] * 0.6); if (k.social[key] < 0.01) delete k.social[key]; }
  k.interest = r2(clamp01(k.interest - 0.025 + (k.interp === 'indifferent' ? -0.02 : 0)));
  return changed;
}

/** Yearly: those outside every tradition may drift between outlooks as life goes on. */
export function evolveOutlook(state, c) {
  const wv = worldviewOf(state, c);
  const b = beliefOf(state, c);
  const adherent = b.tradition && (b.stance === 'devout' || b.stance === 'casual');
  if (adherent) return;
  if (!wv.outlook) { wv.outlook = outlookFor(state, c); return; }
  const r = roll(state, c.id, 'outlook-drift', state.day);
  const k = wv.stone;
  const was = wv.outlook;
  // Evidence-minded agnostics may settle on reason; a personal faith may fade, or a doubter find one.
  if (was === 'agnostic' && wv.cur > 0.55 && wv.skep > 0.5 && r < 0.06) wv.outlook = 'reason';
  else if (was === 'personal' && (!k || k.interp !== 'divine') && wv.skep > 0.55 && r < 0.04) wv.outlook = 'agnostic';
  else if ((was === 'agnostic' || was === 'atheist') && recentExp(state, wv, 'divine') >= 2 && r < 0.05 + wv.open * 0.05) wv.outlook = 'personal';
  else if (was === 'reason' && r < 0.015) wv.outlook = 'agnostic';
  if (wv.outlook !== was) remember(state, c, `Came to see the world as ${OUTLOOKS[wv.outlook].label.toLowerCase().replace(/^the /, 'the ')} (${OUTLOOKS[wv.outlook].theme}).`, 2, 'life');
}

/**
 * Seasonal: whether a believer in the stone's divine origin joins (or a
 * member leaves) the faith of the Hidden Hand. Joining requires the
 * villager's own settled conviction; a devout follower of another tradition
 * may believe without leaving it. Leaving is as free as joining.
 */
export function considerFaith(state, c, { encouragement = 0 } = {}) {
  if (ageOf(state, c) < LIFE.adultAge) return null;
  const wv = worldviewOf(state, c);
  const b = beliefOf(state, c);
  const k = wv.stone;
  const d = ensureDivine(state);
  if (stoneFaith(c)) {
    if (k && k.interp === 'divine' && k.interest >= 0.12) return null;
    const keepsFaith = k?.interp === 'divine';
    const was = TRADITIONS[b.tradition].name;
    Object.assign(b, { tradition: null, stance: keepsFaith ? 'none' : 'skeptical', devotion: keepsFaith ? 0.25 : 0.15, since: state.day });
    wv.outlook = keepsFaith ? 'personal' : wv.skep > 0.5 ? 'reason' : 'agnostic';
    if (wv.role === 'preacher' || wv.role === 'missionary' || wv.role === 'pilgrim') wv.role = null;
    remember(state, c, keepsFaith ? `Stopped gathering with ${was}, though I still believe in my own way.` : `Left ${was}: I no longer think the stone was a god's work.`, 2, 'life');
    d.stats.leavings++;
    if ((c.reputation?.standing ?? 0) > 60) hiddenRecord(state, 'conversion', `${c.firstName} ${c.lastName} left ${was}.`, { citizens: [c.id] }, 1);
    return 'left';
  }
  if (!k || k.interp !== 'divine' || k.conf < 0.6 || k.interest < 0.45) return null;
  const adherent = b.tradition && (b.stance === 'devout' || b.stance === 'casual');
  if (adherent && b.devotion >= 0.55) { wv.syncretic = true; return null; } // believes, and stays with their own tradition
  const p = 0.04 + (k.conf - 0.6) * 0.2 + Math.min(0.08, (k.social.divine ?? 0) * 0.15) + encouragement;
  if (roll(state, c.id, 'join-hand', state.day) >= p) return null;
  const was = adherent ? TRADITIONS[b.tradition].name : null;
  Object.assign(b, { tradition: 'hand', stance: k.conf > 0.8 && b.devotion > 0.5 ? 'devout' : 'casual', devotion: r2(Math.max(0.45, b.devotion)), since: state.day });
  wv.outlook = null;
  remember(state, c, `Joined the faith of the Hidden Hand${was ? `, leaving ${was}` : ''}: I believe the stone is the work of an unseen god.`, 3, 'life');
  d.stats.conversions++;
  hiddenRecord(state, 'conversion', `${c.firstName} ${c.lastName} came to believe in the Hidden Hand${was ? ` (once of ${was})` : ''}.`, { citizens: [c.id] }, (c.reputation?.standing ?? 0) > 60 ? 2 : 1);
  return 'joined';
}

/**
 * How a villager explains something that happened to them or that they saw.
 * Only their worldview and circumstances decide; whether the player had a
 * hand in it is unknown to them and never consulted.
 * kind: 'recovery' | 'harvest' | 'return' | 'fortune' | 'omen' | 'calm'
 */
export function interpretOutcome(state, c, kind, { prayed = false, treated = false, sky = false } = {}) {
  const wv = worldviewOf(state, c);
  const k = wv.stone;
  const believer = isBelieverOfStone(c) || (c.belief?.stance === 'devout') || wv.outlook === 'personal';
  const h = roll(state, c.id, 'explain', kind, state.day);
  if (believer && (prayed || kind === 'omen' || h < 0.5)) return { interp: 'divine', phrase: prayed ? 'an answered prayer' : 'a sign' };
  if (sky && (k?.interp === 'cosmic' || (wv.cur > 0.6 && h < 0.35))) return { interp: 'cosmic', phrase: 'a sign that someone beyond the sky is watching' };
  if (treated && kind === 'recovery') return { interp: 'natural', phrase: 'good care and medicine' };
  if (wv.skep > 0.5 || wv.outlook === 'reason' || wv.outlook === 'atheist') return { interp: 'natural', phrase: kind === 'omen' ? 'an unusual but natural event' : 'coincidence' };
  if (wv.cur < 0.3 && h < 0.5) return { interp: 'indifferent', phrase: 'nothing remarkable' };
  return { interp: 'natural', phrase: kind === 'recovery' ? 'a natural recovery' : kind === 'harvest' ? 'good weather' : 'luck' };
}

/** Counts for the panels and the long-run statistics. */
export function worldviewCounts(state) {
  const out = {};
  for (const c of state.citizens) { const k = primaryWorldview(state, c); out[k] = (out[k] ?? 0) + 1; }
  return out;
}

export function stoneCounts(state) {
  const out = Object.fromEntries([...INTERPRETATION_IDS, 'unaware'].map((k) => [k, 0]));
  for (const c of state.citizens) out[c.worldview?.stone?.interp ?? 'unaware']++;
  return out;
}

export { INTERPRETATIONS };
