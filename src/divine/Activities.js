import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { adjust } from '../citizens/Relationships.js';
import { record } from '../society/Chronicle.js';
import { dayOfSeason, seasonIndex } from '../core/Calendar.js';
import { plotById, frontOf } from '../property/LandRegistry.js';
import { homeOf } from '../ai/CitizenBrain.js';
import { TRADITIONS, beliefOf, isAdherent } from '../institutions/FaithManager.js';
import { activeCommunities } from '../institutions/ReligiousInstitutions.js';
import { ensureDivine, roll, effectOn, r2, clamp01 } from './State.js';
import { worldviewOf, learnOfStone, stoneFaith, viewPhrase } from './Worldview.js';
import { stoneOf, seeStone, investigate, stoneEvent, placeName } from './Stone.js';
import { hear } from './Spread.js';

// What villagers actually do about the stone and their beliefs, as ordinary
// activities that compete with work, food, sleep and company in the same
// utility scoring as everything else: go and look at the stone, study it,
// pray, preach in the square, hold a public discussion, keep a vigil. Each
// is the villager's own choice, explained by the reasons that scored it.

const square = (state, c, key) => ({ x: (roll(state, c.id, key, state.tick) - 0.5) * 7, z: (roll(state, c.id, key + 'z', state.tick) - 0.5) * 7 });
const ring = (state, c, s, r = 1.8) => { const a = roll(state, c.id, 'ring', state.tick) * Math.PI * 2; return { x: s.x + Math.cos(a) * r, z: s.z + Math.sin(a) * r }; };
const openPrayer = (state, c) => (state.divine?.prayers ?? []).find((p) => p.citizenId === c.id && !p.resolvedDay && p.prayedDay !== state.day);
const communityPlace = (state, c) => { const f = activeCommunities(state).find((x) => isAdherent(c, x.tradition) && x.plotId); return f ? plotById(state, f.plotId) : null; };

/** Candidates the divine layer adds to a villager's choices (DecisionUtility.candidateHooks). */
export function proposeActivities(state, c, { minor, h, sick }) {
  const out = [];
  if (sick || !state.divine) return out;
  const s = stoneOf(state);
  const wv = c.worldview;
  const day = !(h < 7 || h >= 19);
  if (s && wv) {
    const k = wv.stone;
    if (day && !k?.seen && wv.glimpsed && state.day - wv.glimpsed < 3 && ageOf(state, c) >= 8) {
      const sc = 26 + wv.cur * 34;
      out.push({ kind: 'visit_stone', score: sc, factors: [[`I glimpsed a strange carved stone ${placeName(state)} and want a closer look`, sc]] });
    } else if (day && k && k.interest > 0.42 && !minor) {
      const gap = wv.role === 'pilgrim' ? 6 : wv.role === 'scholar' ? 6 : 24;
      if (k.lastVisit === null || state.day - k.lastVisit >= gap) {
        const bonus = wv.role === 'pilgrim' ? 14 : wv.role === 'scholar' ? 12 : 0;
        const sc = 4 + k.interest * 26 + bonus;
        out.push({ kind: 'visit_stone', score: sc, study: wv.role === 'scholar' || !!(wv.studyFunded && state.day - wv.studyFunded < 4), factors: [[wv.role === 'scholar' ? 'I want to study the carvings further' : wv.role === 'pilgrim' ? 'I make a pilgrimage to the stone' : `the stone is on my mind: ${viewPhrase(k.interp)}`, sc]] });
      }
    }
    // A vigil at the stone on the first evening of the faith's rite season.
    if (k && stoneFaith(c) && h >= 17 && h < 21 && dayOfSeason(state.day) === 1 && seasonIndex(state.day) === TRADITIONS[c.belief.tradition].season) {
      const sc = 30 + c.belief.devotion * 20;
      out.push({ kind: 'vigil', score: sc, factors: [[`it is ${TRADITIONS[c.belief.tradition].rite}`, sc]] });
    }
    if (day && !minor && k && (wv.role === 'preacher' || wv.role === 'missionary') && roll(state, c.id, 'preach', state.day) < 0.34 && h >= 9 && h < 18) {
      const sc = 20 + k.interest * 16;
      out.push({ kind: 'preach', score: sc, factors: [['I want people to hear what the stone means', sc]] });
    }
    if (day && !minor && k && wv.role === 'philosopher' && state.day - (wv.lastDebate ?? -99) >= 3 && h >= 10 && h < 17 && roll(state, c.id, 'debate', state.day) < 0.4) {
      const sc = 22 + wv.cur * 14;
      out.push({ kind: 'debate', score: sc, factors: [['the stone deserves an honest public argument', sc]] });
    }
  }
  if (h >= 6 && h < 22 && wv) {
    const p = openPrayer(state, c);
    if (p) {
      const devotion = beliefOf(state, c).devotion ?? 0;
      const sc = 12 + devotion * 24;
      out.push({ kind: 'pray', score: sc, prayerId: p.id, factors: [[`I want to pray: “${p.text}”`, sc]] });
    }
  }
  for (const e of state.divine.effects) {
    if (e.kind !== 'encounter' || e.until < state.day || e.spent) continue;
    const other = e.target === c.id ? e.partner : e.partner === c.id ? e.target : null;
    const o = other && byId(state.citizens, other);
    if (!o || o.away || !day) continue;
    const sc = 18 + (100 - c.needs.social) * 0.25;
    out.push({ kind: 'socialize', score: sc, citizenId: o.id, factors: [[`I keep crossing paths with ${o.firstName} and feel like talking`, sc]] });
  }
  return out;
}

/** A Moment of Courage: bold choices weigh a little more for a few days (DecisionUtility.candidateHooks.adjust). */
export function adjustForCourage(state, c, candidates) {
  if (!state.divine?.effects?.length || !effectOn(state, 'courage', c.id)) return;
  for (const k of candidates) {
    if (!['seek_job', 'buy_plot', 'start_project', 'campaign'].includes(k.kind)) continue;
    const plus = Math.round(k.score * 0.15 * 10) / 10;
    k.score = Math.round((k.score + plus) * 10) / 10;
    k.factors = [...k.factors, ['I feel steadier and braver than I have in a while', plus]];
  }
}

// --- Beginning and finishing the activities (CitizenBrain.activityHooks) -------------------

export const BEGIN = {
  visit_stone: (state, c, k) => { const s = stoneOf(state); return s ? { label: k.study ? 'Studying the carved stone' : 'Visiting the carved stone', loc: ring(state, c, s), duration: k.study ? 12 : 6, extra: { study: !!k.study } } : null; },
  vigil: (state, c) => { const s = stoneOf(state); return s ? { label: `Keeping ${TRADITIONS[c.belief.tradition]?.rite ?? 'a vigil'}`, loc: ring(state, c, s, 2.4), duration: 8 } : null; },
  preach: (state, c) => ({ label: 'Preaching in the square', loc: square(state, c, 'preach'), duration: 8 }),
  debate: (state, c) => ({ label: 'Holding a public discussion', loc: square(state, c, 'debate'), duration: 10 }),
  pray: (state, c, k) => {
    const place = communityPlace(state, c);
    const s = stoneOf(state);
    if (place?.building) return { label: `Praying at the ${place.building.name ?? 'temple'}`, loc: frontOf(place, (roll(state, c.id, 'pf', state.tick) - 0.5) * 2, 0.6), duration: 3, extra: { prayerId: k.prayerId } };
    if (s && stoneFaith(c) && Math.hypot(s.x - c.x, s.z - c.z) < 30) return { label: 'Praying at the stone', loc: ring(state, c, s, 1.5), duration: 3, extra: { prayerId: k.prayerId, atStone: true } };
    return { label: 'Praying at home', loc: homeOf(state, c), duration: 3, extra: { prayerId: k.prayerId } };
  },
};

const near = (state, c, r) => state.citizens.filter((o) => o !== c && !o.away && !(o.activity?.kind === 'sleep' && o.activity.phase === 'perform') && Math.hypot(o.x - c.x, o.z - c.z) < r);

export const FINISH = {
  visit_stone(state, c, a) {
    const s = stoneOf(state);
    if (!s || Math.hypot(c.x - s.x, c.z - s.z) > 6) return;
    seeStone(state, c);
    const k = c.worldview.stone;
    k.visits++; k.lastVisit = state.day;
    k.interest = r2(clamp01(k.interest + 0.04));
    s.visits++;
    c.worldview.glimpsed = null;
    if (a.study) investigate(state, c, { boost: effectOn(state, 'inspiration', c.id) ? 1.5 : 1 });
    if (c.worldview.role === 'pilgrim' && !s.firsts.pilgrimage) stoneEvent(state, 'pilgrimage', `${c.firstName} ${c.lastName} made the first pilgrimage to the stone ${placeName(state)}.`, { citizens: [c.id], first: 'pilgrimage' });
    // Others at the stone talk it over.
    const there = near(state, c, 5).filter((o) => o.worldview?.stone);
    for (const o of there.slice(0, 3)) { hear(state, o, c); hear(state, c, o); }
    const believers = [c, ...there].filter((o) => o.worldview?.stone?.interp === 'divine');
    if (believers.length >= 3) stoneEvent(state, 'gathering', `${believers.slice(0, 3).map((o) => o.firstName).join(', ')}${believers.length > 3 ? ` and ${believers.length - 3} others` : ''} met at the stone, the first gathering of those who believe it sacred.`, { citizens: believers.map((o) => o.id), first: 'gathering' });
  },
  vigil(state, c) {
    c.mood = Math.min(100, c.mood + 4);
    c.needs.social = Math.min(100, c.needs.social + 15);
    if (c.worldview?.stone) c.worldview.stone.interest = r2(clamp01(c.worldview.stone.interest + 0.03));
    const others = near(state, c, 6).filter((o) => o.activity?.kind === 'vigil');
    if (others.length >= 2) stoneEvent(state, 'vigil', `Followers of ${TRADITIONS[c.belief.tradition]?.name ?? 'the Hidden Hand'} kept their first vigil at the stone; ${others.length + 1} gathered.`, { citizens: [c.id, ...others.map((o) => o.id)], first: 'vigil' });
  },
  pray(state, c, a) {
    const p = (state.divine?.prayers ?? []).find((x) => x.id === a.prayerId);
    if (!p) return;
    p.prayedDay = state.day;
    p.times = (p.times ?? 0) + 1;
    const devout = c.belief?.stance === 'devout';
    // Prayer is a comfort to those who pray, answered or not.
    c.mood = Math.min(100, c.mood + (devout ? 3 : 2));
    if (p.times === 1) remember(state, c, `Prayed: “${p.text}”`, 1, 'life');
    if (a.atStone) stoneEvent(state, 'prayer', `${c.firstName} ${c.lastName} knelt and prayed at the stone — the first known prayer there.`, { citizens: [c.id], first: 'prayer' });
  },
  preach(state, c) {
    const k = c.worldview?.stone;
    if (!k) return;
    const listeners = near(state, c, 7).filter((o) => ageOf(state, o) >= 10).slice(0, 7);
    let reached = 0, declined = 0;
    for (const o of listeners) {
      const wv = worldviewOf(state, o);
      if (!wv.stone) { learnOfStone(state, o, { how: 'heard', from: c.id }); reached++; continue; }
      if (wv.skep > 0.6 && wv.tol < 0.4 && wv.stone.interp !== 'divine') { declined++; adjust(state, o.id, c.id, { respect: -1 }); if (roll(state, o.id, c.id, 'decline', state.day) < 0.3) remember(state, o, `${c.firstName} preached at me about the stone again. I walked away.`, 1, 'gossip'); continue; }
      hear(state, o, c, 1.2);
      reached++;
    }
    c.worldview.preached = (c.worldview.preached ?? 0) + 1;
    if (reached >= 3) stoneEvent(state, 'preaching', `${c.firstName} ${c.lastName} preached in the square that the stone is the work of an unseen god; ${reached} stopped to listen${declined ? ` and ${declined} walked away` : ''}.`, { citizens: [c.id], first: 'preaching' });
  },
  debate(state, c) {
    c.worldview.lastDebate = state.day;
    const audience = near(state, c, 8).filter((o) => o.worldview?.stone && ageOf(state, o) >= 14).slice(0, 9);
    if (audience.length < 2) return;
    const d = ensureDivine(state);
    d.stats.debates++;
    let surer = 0, lessSure = 0;
    for (const o of [c, ...audience]) {
      const k = o.worldview.stone;
      for (const other of audience.filter((x) => x !== o).slice(0, 3)) hear(state, o, other, 0.8);
      // Hearing every side unsettles the open-minded and hardens the stubborn.
      if (o.worldview.open > 0.5) { k.conf = r2(Math.max(0.1, k.conf - 0.05)); lessSure++; } else if (trait(o, 'stubborn') > 0.3) { k.conf = r2(Math.min(1, k.conf + 0.03)); surer++; }
      k.interest = r2(clamp01(k.interest + 0.03));
    }
    const views = new Set([c, ...audience].map((o) => o.worldview.stone.interp));
    const text = `${c.firstName} ${c.lastName} held a public discussion about the stone in the square; ${audience.length} took part, holding ${views.size} different views. ${lessSure} left less certain than they came${surer ? `, ${surer} more certain` : ''}.`;
    if (!stoneEvent(state, 'debate', text, { citizens: [c.id], first: 'debate' })) record(state, 'culture', text, { citizens: [c.id] }, 1);
  },
};

export { learnOfStone };
