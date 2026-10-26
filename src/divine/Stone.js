import { LIFE, DAYS_PER_YEAR } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { yearOf, dateLabel } from '../core/Calendar.js';
import { roadRect, RIVER } from '../navigation/RoadNetwork.js';
import { markNavDirty } from '../navigation/NavigationGrid.js';
import { plotById } from '../property/LandRegistry.js';
import { solidRects } from '../property/Footprints.js';
import { DIVINE, INSCRIPTIONS } from './Config.js';
import { ensureDivine, roll, hiddenRecord, clamp01, r2 } from './State.js';
import { worldviewOf, learnOfStone, viewPhrase, experience } from './Worldview.js';

// The Mysterious Stone. Placed by the player on open land (never on a plot,
// road or planned street), it is a single persistent entity with an id; it
// cannot be duplicated by saving and loading because there is only ever one
// slot for it. Nobody knows it is there until someone walks past it or sees
// it from the road, and what they do next is their own decision.

const FOREST = [13, -30, 32, -21];
const MEMORIAL = { x: -4.6, z: -4.6 };
const overlaps = (a, b, pad = 0) => a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad;
const plotRect = (p) => [p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2];

export const stoneOf = (state) => state.divine?.stone ?? null;

/** The stone's footprint (for navigation, streets and roads), or nothing if it is not placed. */
export function stoneRects(state) {
  const s = stoneOf(state);
  if (!s) return [];
  const h = DIVINE.stone.halfSize;
  return [[s.x - h, s.z - h, s.x + h, s.z + h]];
}

/** Why the stone cannot stand at (x, z), or null if it can. */
export function siteProblem(state, x, z) {
  const { bounds, halfSize, roadPad, plotPad } = DIVINE.stone;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 'That is not a place in the valley.';
  if (Math.abs(x) > bounds || Math.abs(z) > bounds) return 'That is beyond the edge of the valley.';
  const rect = [x - halfSize, z - halfSize, x + halfSize, z + halfSize];
  if (rect[3] > RIVER.zMin - 1.5 && rect[1] < RIVER.zMax + 1.5) return 'The river runs there.';
  if (Math.hypot(x - MEMORIAL.x, z - MEMORIAL.z) < 2.5) return "The Founders' Memorial stands there.";
  if (Math.hypot(x, z) < 2) return 'The market square\'s centre must stay clear.';
  const plot = state.plots.find((p) => overlaps(rect, plotRect(p), plotPad));
  if (plot) return `That is ${plot.name}, a property${plot.ownerId === 'council' ? ' of the council' : ''}${plot.building ? ` with ${plot.building.name ?? 'a building'} on it` : ''}.`;
  if (state.plots.some((p) => solidRects(p).some((s) => overlaps(rect, s, 0.5)))) return 'A building stands there.';
  if ((state.roads ?? []).some((r) => overlaps(rect, roadRect(r), roadPad))) return 'A road runs there.';
  if ((state.roadProjects ?? []).some((r) => r.status !== 'COMPLETE' && r.status !== 'REJECTED' && overlaps(rect, roadRect(r), roadPad))) return 'A road is being laid there.';
  const planned = (state.city?.proposals ?? []).filter((p) => ['PROPOSED', 'APPROVED', 'BUILDING'].includes(p.status));
  if (planned.some((p) => overlaps(rect, roadRect(p.road), roadPad) || p.plots.some((q) => overlaps(rect, plotRect(q), plotPad)))) return 'The town planners have marked that land for a new street.';
  if ((state.fires ?? []).length && state.fires.some((f) => { const p = plotById(state, f.plotId); return p && Math.hypot(p.x - x, p.z - z) < 10; })) return 'A fire is burning close by.';
  return null;
}

const SITE_ANCHORS = [
  { key: 'hilltop', label: 'A rise above the northern fields', x: -24, z: -50 },
  { key: 'forest', label: 'A clearing in the forest', x: 22, z: -25.5 },
  { key: 'meadow', label: 'An open meadow west of the town', x: -66, z: 20 },
  { key: 'square', label: 'Beside the market square', x: 4.5, z: -4.5 },
  { key: 'valley', label: 'A remote valley in the far east', x: 76, z: -64 },
  { key: 'historic', label: 'In the oldest district, near the Hearth Hall', x: null, z: null },
];

/** Nearest open spot to (x, z): a spiral search outwards. */
function nearestOpen(state, x, z, maxR = 22) {
  if (!siteProblem(state, x, z)) return { x, z };
  for (let r = 1.5; r <= maxR; r += 1.5) {
    const steps = Math.max(8, Math.round(r * 4));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = Math.round((x + Math.cos(a) * r) * 10) / 10, pz = Math.round((z + Math.sin(a) * r) * 10) / 10;
      if (!siteProblem(state, px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/** Suggested places to raise the stone, each checked against the land as it stands today. */
export function suggestedSites(state) {
  const hall = state.plots[0];
  return SITE_ANCHORS.map((a) => {
    const ax = a.x ?? (hall ? hall.x - hall.w / 2 - 3 : -10), az = a.z ?? (hall ? hall.z : 0);
    const spot = nearestOpen(state, ax, az);
    return spot ? { key: a.key, label: a.label, ...spot, problem: null } : { key: a.key, label: a.label, x: ax, z: az, problem: 'No open land is left near there.' };
  });
}

/** Describe where the stone stands, in the words a villager would use. */
export function placeName(state, s = stoneOf(state)) {
  if (!s) return 'nowhere';
  if (overlaps([s.x, s.z, s.x, s.z], FOREST, 1.5)) return 'in a clearing in the forest';
  if (Math.hypot(s.x, s.z) < 9) return 'beside the market square';
  const near = state.plots.map((p) => ({ p, d: Math.hypot(p.x - s.x, p.z - s.z) })).sort((a, b) => a.d - b.d)[0];
  if (near && near.d < 16) return `near ${near.p.name}`;
  const dir = Math.abs(s.x) > Math.abs(s.z) ? (s.x > 0 ? 'east' : 'west') : (s.z > 0 ? 'south' : 'north');
  return Math.hypot(s.x, s.z) > 55 ? `far out in the ${dir} of the valley` : `on open land to the ${dir}`;
}

/**
 * The player raises the stone. Returns { ok, message, stone }. Allowed once,
 * from Year 200, on open land; the inscription's meaning stays with the player.
 */
export function placeStone(state, { x, z, inscription = 'glyphs' } = {}) {
  const d = ensureDivine(state);
  if (!d.unlocked) return { ok: false, message: `The stone cannot be placed before Year ${DIVINE.unlockYear}.` };
  if (d.stone) return { ok: false, message: 'The stone already stands in the world.' };
  if (!INSCRIPTIONS[inscription]) return { ok: false, message: 'Choose an inscription.' };
  x = Math.round(Number(x) * 10) / 10; z = Math.round(Number(z) * 10) / 10;
  const problem = siteProblem(state, x, z);
  if (problem) return { ok: false, message: problem };
  d.stone = {
    id: 'stone-1', x, z, inscription, placedDay: state.day, rotation: r2(0.58 + (roll(state, 'stone-rot') - 0.5) * 0.6), // a carved face turned towards the usual view
    discovered: false, discoveredDay: null, discovererId: null, discovererName: null, known: 0, visits: 0, reported: false, public: false,
    investigations: 0, progress: 0, findings: {}, studies: [], site: {}, firsts: {}, history: [], anniversaries: [],
  };
  d.pendingNotice = false;
  markNavDirty?.(state);
  hiddenRecord(state, 'stone', `You raised the stone ${placeName(state)}, carved with ${INSCRIPTIONS[inscription].text ? `“${INSCRIPTIONS[inscription].text}” in a script no one living can read` : 'symbols that mean nothing in any tongue'}. Nobody saw it arrive.`, { stone: true }, 3).actual = true;
  return { ok: true, message: 'The stone stands. Nobody knows it is there.', stone: d.stone };
}

/** The player answers the Year 200 whisper with "Not yet": the ability stays, for as long as they like. */
export function postponeStone(state) {
  const d = ensureDivine(state);
  if (!d.unlocked || d.stone) return false;
  if (!d.postponed) hiddenRecord(state, 'awakening', 'You chose to wait. The stone can be raised whenever you wish.', {}, 1);
  d.pendingNotice = false;
  d.postponed = true;
  return true;
}

/**
 * The stone's own history, made only of things villagers really did. Firsts
 * are kept once each; every entry also enters the kingdom's Chronicle.
 */
export function stoneEvent(state, kind, text, { citizens = [], importance = 2, first = null } = {}) {
  const s = stoneOf(state);
  if (!s) return null;
  if (first) { if (s.firsts[first]) return null; s.firsts[first] = state.day; }
  s.history.push({ day: state.day, kind, text, citizens });
  if (s.history.length > 60) {
    const i = s.history.findIndex((h, j) => j > 0 && !Object.values(s.firsts).includes(h.day));
    s.history.splice(i > 0 ? i : 1, 1);
  }
  const entry = record(state, 'culture', text, { citizens }, importance);
  hiddenRecord(state, 'development', text, { citizens }, importance >= 3 ? 2 : 1);
  return entry;
}

const occupation = (c) => { const p = c.profession ? c.profession.toLowerCase() : 'villager'; return `${/^[aeiou]/.test(p) ? 'an' : 'a'} ${p}`; };

/** A villager sees the stone with their own eyes. The very first is its discovery. */
export function seeStone(state, c) {
  const s = stoneOf(state);
  if (!s) return null;
  const known = worldviewOf(state, c).stone;
  learnOfStone(state, c, { how: 'saw' });
  const k = c.worldview.stone;
  if (!known) remember(state, c, `Came upon a strange standing stone ${placeName(state)}, carved with signs I cannot read. I think it is ${viewPhrase(k.interp)}.`, 3, 'milestone');
  if (!s.discovered) return discover(state, c);
  return null;
}

/** The first discovery: recorded, and the discoverer decides what to do about it. */
function discover(state, c) {
  const s = stoneOf(state);
  Object.assign(s, { discovered: true, discoveredDay: state.day, discovererId: c.id, discovererName: `${c.firstName} ${c.lastName}` });
  const k = c.worldview.stone;
  k.interest = r2(clamp01(k.interest + 0.15));
  const choice = discovererChoice(state, c);
  const did = act(state, c, choice);
  stoneEvent(state, 'discovery', `${c.firstName} ${c.lastName}, ${occupation(c)}, came upon a strange standing stone ${placeName(state)}: weathered, mossy and carved with symbols no one can read.${did ? ' ' + did : ''}`, { citizens: [c.id], importance: 3, first: 'discovery' });
  return choice;
}

/** What the discoverer chooses to do, from their temperament and first impression. */
export function discovererChoice(state, c) {
  const wv = worldviewOf(state, c);
  const k = wv.stone;
  const h = (key) => roll(state, c.id, 'found', key) * 0.25;
  const scholar = state.citizens.find((o) => o !== c && (o.education?.level ?? 0) >= 0.6 && ageOf(state, o) >= LIFE.adultAge && (state.relationships[`${c.id}|${o.id}`]?.friendship ?? 0) > 30);
  const options = {
    ignore: (k.interp === 'indifferent' ? 0.5 : 0) + (1 - wv.cur) * 0.3 + trait(c, 'lazy') * 0.2 + h('i'),
    investigate: wv.cur * 0.6 + h('v'),
    tell: trait(c, 'friendly') * 0.5 + 0.15 + h('t'),
    report: trait(c, 'loyal') * 0.4 + trait(c, 'hardworking') * 0.2 + (state.government?.leaderId ? 0.15 : 0.1) + h('r'),
    scholar: scholar ? 0.25 + wv.cur * 0.3 + h('s') : -1,
    share: k.interp === 'divine' || k.interp === 'cosmic' || k.interp === 'prank' ? 0.35 + k.conf * 0.3 + h('p') : -1,
  };
  return Object.entries(options).sort((a, b) => b[1] - a[1])[0][0];
}

/** Carry out the discoverer's choice; returns a sentence describing what really happened. */
function act(state, c, choice) {
  const s = stoneOf(state);
  const k = c.worldview.stone;
  const friend = closeFriend(state, c);
  switch (choice) {
    case 'ignore':
      remember(state, c, 'Decided the old stone was none of my business.', 1, 'event');
      return `${c.firstName} shrugged and went on their way.`;
    case 'investigate':
      k.interest = r2(clamp01(k.interest + 0.2));
      return `${c.firstName} spent a long while tracing the carvings, and means to come back.`;
    case 'tell':
      if (friend) { learnOfStone(state, friend, { how: 'heard', from: c.id }); return `${c.firstName} hurried to tell ${friend.firstName} ${friend.lastName}.`; }
      return null;
    case 'report': {
      s.reported = true;
      const leader = byId(state.citizens, state.government?.leaderId);
      if (leader && leader !== c) learnOfStone(state, leader, { how: 'heard', from: c.id });
      if ((state.civ?.age ?? 1) >= 2) s.public = true;
      return `${c.firstName} reported it to ${leader && leader !== c ? `${leader.firstName} ${leader.lastName}` : 'the council'}${s.public ? ', and the news was printed' : ''}.`;
    }
    case 'scholar': {
      const scholar = state.citizens.find((o) => o !== c && (o.education?.level ?? 0) >= 0.6 && ageOf(state, o) >= LIFE.adultAge && (state.relationships[`${c.id}|${o.id}`]?.friendship ?? 0) > 30);
      if (!scholar) return null;
      learnOfStone(state, scholar, { how: 'heard', from: c.id });
      scholar.worldview.glimpsed = state.day;
      return `${c.firstName} asked the learned ${scholar.firstName} ${scholar.lastName} to come and look at the markings.`;
    }
    case 'share': {
      const said = { divine: 'declared it a sign from an unseen god', cosmic: 'wondered aloud whether someone from beyond the sky had left it', prank: 'suspected somebody of an elaborate prank' }[k.interp];
      if (friend) learnOfStone(state, friend, { how: 'heard', from: c.id });
      return `${c.firstName} ${said}${friend ? `, and told ${friend.firstName}` : ''}.`;
    }
    default: return null;
  }
}

function closeFriend(state, c) {
  let best = null, bestW = 30;
  for (const o of state.citizens) {
    if (o === c || o.worldview?.stone || o.away) continue;
    const r = state.relationships[`${c.id}|${o.id}`];
    const w = r ? r.friendship + r.trust * 0.3 : 0;
    if (w > bestW) { bestW = w; best = o; }
  }
  return best;
}

/** Hourly: anyone awake who comes within sight of the stone notices it. */
export function hourlyStone(state) {
  const s = stoneOf(state);
  if (!s) return;
  const R = DIVINE.stone.noticeRadius;
  for (const c of state.citizens) {
    if (c.away || (c.activity?.kind === 'sleep' && c.activity.phase === 'perform') || c.activity?.kind === 'cradle') continue;
    if (Math.abs(c.x - s.x) > R || Math.abs(c.z - s.z) > R || Math.hypot(c.x - s.x, c.z - s.z) > R) continue;
    if (c.worldview?.stone?.seen) continue;
    if (ageOf(state, c) < 4) continue;
    seeStone(state, c);
  }
}

/** How close a villager's daily round (home, work, the roads) passes to the stone. */
function roundDistance(state, c, roads) {
  const s = stoneOf(state);
  let d = Infinity;
  for (const id of [c.homePlotId, c.employment ? state.businesses.find((b) => b.id === c.employment.businessId)?.plotId : null]) {
    const p = id && plotById(state, id);
    if (p) d = Math.min(d, Math.hypot(p.x - s.x, p.z - s.z));
  }
  for (const r of roads) {
    const dx = Math.max(r[0] - s.x, 0, s.x - r[2]), dz = Math.max(r[1] - s.z, 0, s.z - r[3]);
    d = Math.min(d, Math.hypot(dx, dz) * 1.4);
  }
  if (c.profession === 'Forager' || (c.skills?.foraging ?? 0) > 0.4) d = Math.min(d, Math.hypot(22 - s.x, -25.5 - s.z));
  return d;
}

/**
 * Daily: passers-by may glimpse the stone from their road or fields (they
 * then choose whether to go and look), news is printed once it is public,
 * and the stone's anniversaries are kept by those who care about it.
 */
export function dailyStone(state) {
  const s = stoneOf(state);
  if (!s) return;
  const roads = (state.roads ?? []).map(roadRect);
  for (const c of state.citizens) {
    if (c.away || c.worldview?.stone?.seen || ageOf(state, c) < 8) continue;
    const wv = worldviewOf(state, c);
    if (wv.glimpsed && state.day - wv.glimpsed < 3) continue;
    const d = roundDistance(state, c, roads);
    const p = 0.035 * Math.exp(-d / 14) * (0.6 + wv.cur * 0.8);
    if (roll(state, c.id, 'glimpse', state.day) < p) wv.glimpsed = state.day;
  }
  publications(state);
  anniversaries(state);
  if (s.discovered && !s.firsts.landmark && (s.known ?? 0) >= 40 && s.visits >= 150 && state.day - s.discoveredDay >= DAYS_PER_YEAR * 5) stoneEvent(state, 'landmark', `The carved stone ${placeName(state)} has become a landmark of the kingdom: ${s.known} villagers know of it and it has had ${s.visits} visits.`, { importance: 3, first: 'landmark' });
}

/** Printed news: once the stone is public, the papers carry it (faster as communications improve). */
function publications(state) {
  const s = stoneOf(state);
  const age = state.civ?.age ?? 1;
  if (!s.public || age < 2) return;
  const tech = state.civ?.tech ?? {};
  const p = tech.digital_networks ? 0.08 : tech.telephone ? 0.045 : tech.telegraph ? 0.03 : 0.012;
  for (const c of state.citizens) {
    if (c.worldview?.stone || c.away || ageOf(state, c) < 12) continue;
    if (roll(state, c.id, 'read', state.day) < p) {
      learnOfStone(state, c, { how: 'read' });
      if (!s.firsts.printed) stoneEvent(state, 'publication', `The stone ${placeName(state)} is in the news: ${tech.digital_networks ? 'pictures of its carvings are passed around the networks' : tech.telephone ? 'the papers and the wireless carry the story' : 'the papers carry the story'}.`, { first: 'printed', importance: 2 });
    }
  }
}

/** Every quarter century after its discovery, those who care about the stone mark the day together. */
function anniversaries(state) {
  const s = stoneOf(state);
  if (!s.discovered || state.day <= s.discoveredDay) return;
  const years = (state.day - s.discoveredDay) / DAYS_PER_YEAR;
  if (!Number.isInteger(years) || years % 25 !== 0) return;
  const caring = state.citizens.filter((c) => !c.away && (c.worldview?.stone?.interest ?? 0) > 0.35 && c.worldview.stone.interp !== 'indifferent');
  if (caring.length < 4) return;
  const tally = {};
  for (const c of caring) { tally[c.worldview.stone.interp] = (tally[c.worldview.stone.interp] ?? 0) + 1; c.mood = Math.min(100, c.mood + 4); c.needs.social = Math.min(100, c.needs.social + 10); }
  s.anniversaries.push({ day: state.day, years, attended: caring.length, tally });
  const views = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${{ divine: 'believing it sacred', cosmic: 'convinced it came from beyond', ancient: 'sure it is ancient', prank: 'still calling it a hoax', natural: 'undecided' }[k] ?? k}`).join(', ');
  stoneEvent(state, 'anniversary', `${years} years since ${s.discovererName} found the stone, ${caring.length} villagers gathered at it: ${views}.`, { importance: years % 100 === 0 ? 3 : 2 });
}

/**
 * A scholar studies the stone. Progress depends on their learning and the
 * tools of the age; each new finding is real evidence (the stone does look
 * ancient, its rock matches nothing in the valley), yet none can settle what
 * it is, so the disagreement goes on.
 */
const FINDINGS = [
  { id: 'weathering', age: 1, need: 8, text: 'the weathering suggests great age', shift: { ancient: 0.3, prank: -0.25 } },
  { id: 'script', age: 1, need: 18, text: 'the carvings repeat in patterns, like writing', shift: { ancient: 0.15, cosmic: 0.1, prank: -0.1 } },
  { id: 'quarry', age: 2, need: 30, text: 'no quarry in the region matches its rock', shift: { cosmic: 0.2, ancient: -0.05 } },
  { id: 'lichen', age: 3, need: 44, text: 'its lichen and weathering disagree: it seems both ancient and newly set', shift: { natural: 0.3, ancient: -0.1 } },
  { id: 'glow', age: 3, need: 60, text: 'the faint glow of the markings has no known chemistry', shift: { cosmic: 0.2, natural: 0.1 } },
  { id: 'language', age: 4, need: 80, text: 'frequency analysis says the script behaves like a real language that matches none on record', shift: { ancient: 0.15, cosmic: 0.15 } },
  { id: 'mineral', age: 4, need: 104, text: 'the mineral composition is unlike any sample ever catalogued', shift: { cosmic: 0.2, natural: 0.05 } },
  { id: 'untranslated', age: 5, need: 130, text: 'every attempt at translation has failed; the meaning remains unknown', shift: { natural: 0.2 } },
];

export function investigate(state, c, { boost = 1 } = {}) {
  const s = stoneOf(state);
  if (!s) return null;
  const d = ensureDivine(state);
  const age = state.civ?.age ?? 1;
  s.investigations++;
  d.stats.investigations++;
  s.progress = r2(s.progress + (0.4 + (c.education?.level ?? 0.3) * 0.8) * (0.7 + age * 0.15) * boost);
  if (!s.firsts.investigation) stoneEvent(state, 'investigation', `${c.firstName} ${c.lastName} made the first careful study of the stone, copying its symbols into a notebook.`, { citizens: [c.id], first: 'investigation' });
  const next = FINDINGS.find((f) => !s.studies.some((x) => x.id === f.id));
  if (!next || next.age > age || s.progress < next.need) return null;
  s.studies.push({ id: next.id, day: state.day, by: c.id, byName: `${c.firstName} ${c.lastName}` });
  for (const [k, v] of Object.entries(next.shift)) s.findings[k] = r2(Math.max(0, Math.min(1, (s.findings[k] ?? 0) + v)));
  s.public = s.public || age >= 2 || s.studies.length >= 2;
  const view = c.worldview?.stone?.interp;
  remember(state, c, `My study of the stone found that ${next.text}.`, 3, 'milestone');
  experience(state, c, 'study', next.shift.cosmic > (next.shift.ancient ?? 0) ? 'cosmic' : next.shift.natural ? 'natural' : 'ancient');
  stoneEvent(state, 'study', `${c.firstName} ${c.lastName}${view && view !== 'indifferent' ? ` (who thinks it is ${viewPhrase(view)})` : ''} reported that ${next.text}.`, { citizens: [c.id], importance: 2 });
  if (next.id === 'untranslated' || s.studies.length === 1) s.firsts.translation = s.firsts.translation ?? state.day;
  return next;
}

/** Text for the panels: how long ago, by whom. */
export function stoneSummary(state) {
  const s = stoneOf(state);
  if (!s) return null;
  return { placed: dateLabel(s.placedDay), where: placeName(state), discovered: s.discovered ? `${dateLabel(s.discoveredDay)} by ${s.discovererName}` : null, years: yearOf(state.day) - yearOf(s.placedDay) };
}

export { FINDINGS };
