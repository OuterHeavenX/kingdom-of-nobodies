// v0.5.3 — The Hidden Hand in the multigenerational stress test: a scripted
// player (or none), the divine layer's invariants, and the statistics the
// release brief asks for (worldviews, interpretations, institutions,
// conversions, missions, prayers, blessings). Used by tests/longevity.mjs.
import { ageOf } from '../src/citizens/Citizen.js';
import { LIFE } from '../src/core/Config.js';
import { yearOf } from '../src/core/Calendar.js';
import { byId } from '../src/core/EntityRegistry.js';
import { roadRect } from '../src/navigation/RoadNetwork.js';
import { TRADITIONS } from '../src/institutions/FaithManager.js';
import { activeCommunities, membersOf } from '../src/institutions/ReligiousInstitutions.js';
import { DIVINE, INTERPRETATIONS, OUTLOOKS, SOCIETIES } from '../src/divine/Config.js';
import { ensureDivine } from '../src/divine/State.js';
import { placeStone, suggestedSites } from '../src/divine/Stone.js';
import { bestow, blessingProblem, prayerTarget, BLESSINGS } from '../src/divine/Blessings.js';
import { sendOmen, omenProblem, OMEN_IDS } from '../src/divine/Omens.js';
import { openPrayers } from '../src/divine/Prayers.js';
import { worldviewCounts, stoneCounts } from '../src/divine/Worldview.js';
import { activeSocieties, societyMembers } from '../src/divine/Movements.js';

export const PLAYER_MODES = ['none', 'stone', 'active'];
/** `auto`: odd seeds have an active player, even seeds a player who never intervenes. */
export const playerFor = (mode, seed) => (mode && mode !== 'auto' ? mode : seed % 2 ? 'active' : 'none');

const SITES = ['hilltop', 'forest', 'meadow', 'square', 'valley', 'historic'];

/**
 * Yearly, as a player might: place the stone as soon as Year 200 allows (at a
 * site chosen by the seed), and in `active` mode answer a prayer or two with
 * a blessing and now and then send a sign. Never more than Whispers allow.
 */
export function scriptedPlayer(state, mode, seed) {
  if (mode === 'none') return;
  const d = ensureDivine(state);
  if (d.unlocked && !d.stone) {
    const sites = suggestedSites(state).filter((x) => !x.problem);
    const want = SITES[seed % SITES.length];
    const site = sites.find((x) => x.key === want) ?? sites[0];
    if (site) placeStone(state, { x: site.x, z: site.z, inscription: ['watcher', 'question', 'light', 'silence', 'glyphs'][seed % 5] });
  }
  if (mode !== 'active') return;
  let acted = 0;
  for (const p of openPrayers(state)) {
    if (acted >= 2) break;
    const b = p.blessings.find((x) => !blessingProblem(state, x, prayerTarget(state, p, x)));
    if (b && bestow(state, b, prayerTarget(state, p, b), { prayerId: p.id }).ok) acted++;
  }
  if (yearOf(state.day) % 3 === 0) {
    const id = OMEN_IDS.find((o) => !omenProblem(state, o));
    if (id) sendOmen(state, id, { x: d.stone?.x ?? 0, z: d.stone?.z ?? 0 });
  }
}

/** Every invariant of the divine layer; `fail(msg)` records a violation. */
export function divineInvariants(s, fail) {
  const d = s.divine;
  if (!d) return fail('divine state missing');
  if (!Number.isFinite(d.whispers) || d.whispers < 0 || d.whispers > d.maxWhispers + 1e-9) fail(`whispers out of range (${d.whispers})`);
  if (d.prayers.length > DIVINE.kept.prayers) fail(`prayer list unbounded (${d.prayers.length})`);
  if (d.hidden.length > DIVINE.kept.hidden) fail(`Hidden Chronicle unbounded (${d.hidden.length})`);
  if (d.missions.length > DIVINE.kept.missions) fail(`mission list unbounded (${d.missions.length})`);
  if (d.effects.some((e) => !Number.isFinite(e.until) || s.day - e.day > 60)) fail('a blessing effect has outlived its bound');
  for (const p of d.prayers.filter((x) => !x.resolvedDay)) if (!byId(s.citizens, p.citizenId)) fail(`open prayer ${p.id} belongs to nobody present`);
  const ids = new Set();
  for (const m of d.missions) {
    if (ids.has(m.id)) fail(`duplicate mission ${m.id}`);
    ids.add(m.id);
    if (m.status !== 'OUT') continue;
    const c = byId(s.citizens, m.missionaryId);
    if (c && c.away?.missionId !== m.id) fail(`${m.name} is on mission ${m.id} but not away on it`);
  }
  if (d.stone) {
    const st = d.stone;
    if (st.id !== 'stone-1') fail('the stone has a second identity');
    const h = DIVINE.stone.halfSize;
    const rect = [st.x - h, st.z - h, st.x + h, st.z + h];
    const hit = (r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1];
    for (const p of s.plots) if (hit([p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2])) fail(`plot ${p.name} was laid over the stone`);
    for (const r of s.roads ?? []) if (hit(roadRect(r))) fail(`road ${r.name} runs over the stone`);
  }
  const active = new Set(activeSocieties(s).map((x) => x.id));
  for (const c of s.citizens) {
    const wv = c.worldview;
    if (!wv) { fail(`${c.firstName} has no worldview`); continue; }
    if (wv.outlook && !OUTLOOKS[wv.outlook]) fail(`${c.firstName} has unknown outlook ${wv.outlook}`);
    if (c.belief?.tradition && !TRADITIONS[c.belief.tradition]) fail(`${c.firstName} has unknown tradition ${c.belief.tradition}`);
    if (wv.stone) {
      if (!INTERPRETATIONS[wv.stone.interp]) fail(`${c.firstName} holds unknown view ${wv.stone.interp}`);
      for (const k of ['conf', 'interest']) if (!(wv.stone[k] >= 0 && wv.stone[k] <= 1)) fail(`${c.firstName}'s ${k} out of range`);
      if (!d.stone) fail(`${c.firstName} knows of a stone that does not exist`);
    }
    if (wv.society && !active.has(wv.society)) fail(`${c.firstName} belongs to a society that no longer exists`);
  }
  for (const soc of d.societies) if (!SOCIETIES[soc.kind]) fail(`society ${soc.id} has unknown kind`);
  // Religion never swallows everyone (while there are enough adults to tell).
  const adults = s.citizens.filter((c) => ageOf(s, c) >= LIFE.adultAge);
  if (adults.length >= 20 && adults.every((c) => ['hand', 'light', 'silence'].includes(c.belief?.tradition) && ['devout', 'casual'].includes(c.belief?.stance))) fail('every adult belongs to a faith of the stone');
}

/** The statistics for each report row. */
export function divineStats(s) {
  const d = s.divine;
  if (!d) return null;
  const wv = worldviewCounts(s);
  const stone = d.stone ? stoneCounts(s) : null;
  const total = Math.max(1, s.citizens.length);
  const pct = (n) => Math.round(((n ?? 0) / total) * 100);
  const nonreligious = (wv.reason ?? 0) + (wv.agnostic ?? 0) + (wv.atheist ?? 0);
  return {
    worldviews: wv,
    shares: { stoneFaiths: pct((wv.hand ?? 0) + (wv.light ?? 0) + (wv.silence ?? 0)), oldTraditions: pct(['furrow', 'hearthkin', 'dawn', 'openhand', 'lantern'].reduce((t, k) => t + (wv[k] ?? 0), 0)), nonreligious: pct(nonreligious), atheist: pct(wv.atheist), agnostic: pct(wv.agnostic), personal: pct(wv.personal) },
    stone: d.stone ? { placedYear: yearOf(d.stone.placedDay), discoveredYear: d.stone.discovered ? yearOf(d.stone.discoveredDay) : null, known: d.stone.known, visits: d.stone.visits, studies: d.stone.studies.length, site: Object.keys(d.stone.site), views: stone } : null,
    communities: activeCommunities(s).map((f) => `${f.tradition}:${membersOf(s, f).length}${f.tier ? `:${f.tier}` : ''}`),
    religiousBuildings: s.plots.filter((p) => ['shrine', 'chapel', 'temple'].includes(p.building?.type)).length,
    donations: (s.faith?.communities ?? []).reduce((t, f) => t + (f.stats?.donations ?? 0), 0),
    charityMeals: (s.faith?.communities ?? []).reduce((t, f) => t + (f.stats?.meals ?? 0), 0) + d.societies.reduce((t, x) => t + (x.stats?.meals ?? 0), 0),
    societies: activeSocieties(s).map((x) => `${x.kind}:${societyMembers(s, x).length}`), societiesEver: d.societies.length,
    laws: (s.law?.laws ?? []).filter((l) => ['conscience', 'stone'].includes(l.key)).map((l) => `${l.key}:${l.status}`),
    ...d.stats,
    foreign: Object.fromEntries(Object.entries(d.foreign).map(([k, f]) => [k, `${f.believers}b/${f.interested}i/${f.rejected}r${f.circle ? '+circle' : ''}`])),
  };
}

export { BLESSINGS };
