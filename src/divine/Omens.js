import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { seasonOf } from '../core/Calendar.js';
import { DIVINE } from './Config.js';
import { ensureDivine, spendWhispers, hiddenRecord, nextDivineId } from './State.js';
import { worldviewOf, interpretOutcome, experience } from './Worldview.js';
import { stoneOf } from './Stone.js';

// Signs and omens: ambiguous, harmless events the player may cause. Each is
// drawn in the 3D view, and whoever is awake and in a position to see it
// does — and explains it their own way. A sign never raises anyone's faith
// by itself: a believer may see a message, a sceptic a rare natural event, a
// stargazer a visitor from beyond, and many people nothing worth a thought.

const night = (state) => state.minute / 60 >= 20.5 || state.minute / 60 < 5;
const raining = (state) => state.weather?.today?.kind === 'rain' || (state.weather?.today?.kind === 'wind' && state.weather.today.intensity > 0.7);
const rainedLately = (state) => raining(state) || (state.weather?.history ?? []).slice(-2).some((h) => h.kind === 'rain');

export const OMENS = {
  skylights: { name: 'Lights in the night sky', icon: '🌌', cost: 2, cooldown: 4, scope: 'sky', when: (s) => (night(s) ? null : 'Only at night.'), seen: 'strange lights moving across the night sky' },
  stoneglow: { name: 'A glow around the stone', icon: '🗿', cost: 1, cooldown: 3, scope: 'stone', when: (s) => (stoneOf(s) ? null : 'The stone has not been placed.'), seen: 'the carved stone glowing softly' },
  rainbow: { name: 'A double rainbow', icon: '🌈', cost: 1, cooldown: 4, scope: 'sky', when: (s) => (night(s) ? 'Only by day.' : !rainedLately(s) ? 'A rainbow needs recent rain.' : null), seen: 'a rare double rainbow' },
  bloom: { name: 'A sudden field of flowers', icon: '🌼', cost: 2, cooldown: 6, scope: 'local', when: (s) => (seasonOf(s.day) === 'Winter' ? 'Nothing blooms in winter.' : null), seen: 'a field suddenly full of flowers' },
  tone: { name: 'A mysterious musical tone', icon: '🎐', cost: 1, cooldown: 3, scope: 'local', when: () => null, seen: 'a clear, unexplained musical tone' },
  stars: { name: 'A cluster of falling stars', icon: '🌠', cost: 2, cooldown: 4, scope: 'sky', when: (s) => (night(s) ? null : 'Only at night.'), seen: 'a cluster of falling stars' },
  clouds: { name: 'A strange cloud', icon: '☁', cost: 1, cooldown: 3, scope: 'sky', when: (s) => (night(s) ? 'Only by day.' : null), seen: 'a strange spiral of cloud' },
  calm: { name: 'Calm in the storm', icon: '🌤', cost: 2, cooldown: 5, scope: 'sky', when: (s) => (raining(s) ? null : 'There is no storm to calm.'), seen: 'the rain stopping and the clouds parting for a while' },
};
export const OMEN_IDS = Object.keys(OMENS);

export const omenCooldown = (state, id) => Math.max(0, (state.divine?.cooldowns?.['omen:' + id] ?? 0) - state.day);

export function omenProblem(state, id) {
  const def = OMENS[id];
  const d = ensureDivine(state);
  if (!def) return 'Unknown sign.';
  if (omenCooldown(state, id)) return `Again in ${omenCooldown(state, id)} day${omenCooldown(state, id) === 1 ? '' : 's'}.`;
  if (d.whispers + 1e-9 < def.cost) return `It needs ${def.cost} Whispers.`;
  return def.when(state);
}

/** Who sees a sign: everyone awake outdoors for the sky, those nearby for a local one. */
function observers(state, def, x, z) {
  return state.citizens.filter((c) => {
    if (c.away || ageOf(state, c) < 4) return false;
    const a = c.activity;
    if ((a?.kind === 'sleep' && a.phase === 'perform') || a?.kind === 'cradle') return false;
    if (def.scope === 'sky') return true;
    return Math.hypot(c.x - x, c.z - z) < (def.scope === 'stone' ? 16 : 22);
  });
}

/**
 * Cause a sign at (x, z) (the stone's own place for stone signs). Returns
 * { ok, message, omen }. The kingdom's Chronicle records what people saw and
 * how they explained it; the Hidden Chronicle records that it was you.
 */
export function sendOmen(state, id, { x = 0, z = 0 } = {}) {
  const problem = omenProblem(state, id);
  if (problem) return { ok: false, message: problem };
  const def = OMENS[id];
  const d = ensureDivine(state);
  const s = stoneOf(state);
  if (def.scope === 'stone' && s) { x = s.x; z = s.z; }
  spendWhispers(state, def.cost);
  d.cooldowns['omen:' + id] = state.day + def.cooldown;
  const seen = observers(state, def, x, z);
  const omen = { id: nextDivineId(state, 'o'), kind: id, day: state.day, minute: state.minute, tick: state.tick, x, z, seen: seen.length, views: {} };
  d.omens.push(omen);
  if (d.omens.length > DIVINE.kept.omens) d.omens.splice(0, d.omens.length - DIVINE.kept.omens);
  d.stats.omens++;
  const voices = {};
  for (const c of seen) {
    const v = interpretOutcome(state, c, 'omen', { sky: def.scope === 'sky' || id === 'stoneglow' });
    omen.views[v.interp] = (omen.views[v.interp] ?? 0) + 1;
    if (v.interp === 'indifferent') continue;
    experience(state, c, 'omen', v.interp);
    remember(state, c, `Saw ${def.seen} — ${v.phrase}.`, v.interp === 'divine' ? 2 : 1, 'event');
    if (c.worldview?.stone) c.worldview.stone.interest = Math.min(1, Math.round((c.worldview.stone.interest + 0.05) * 100) / 100);
    (voices[v.interp] = voices[v.interp] ?? []).push(c);
  }
  const named = Object.entries(voices).map(([k, list]) => {
    const who = list[0];
    const say = { divine: 'called it a sign', cosmic: 'wondered whether someone beyond the sky was watching', natural: 'said it was rare but natural' }[k] ?? 'saw nothing in it';
    return `${who.firstName} ${who.lastName}${list.length > 1 ? ` and ${list.length - 1} other${list.length > 2 ? 's' : ''}` : ''} ${say}`;
  });
  if (seen.length >= 3) record(state, 'culture', `${seen.length} villagers saw ${def.seen}. ${named.length ? named.join('; ') + '.' : 'Nobody made much of it.'}`, { citizens: Object.values(voices).map((l) => l[0].id) }, 1);
  const views = Object.entries(omen.views).map(([k, n]) => `${n} ${k}`).join(', ') || 'nobody';
  hiddenRecord(state, 'omen', `You sent ${def.name.toLowerCase()}. ${seen.length} saw it (${views}).`, { omen: omen.id }, 2).actual = true;
  return { ok: true, message: `${def.icon} ${def.name} — ${seen.length} saw it.`, omen };
}

/** Omens still worth drawing (the renderer plays each for a while once it appears). */
export const recentOmens = (state, withinTicks = 72) => (state.divine?.omens ?? []).filter((o) => state.tick - o.tick <= withinTicks);

export { byId, worldviewOf };
