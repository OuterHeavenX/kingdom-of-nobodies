import { DIVINE } from './Config.js';
import { yearOf } from '../core/Calendar.js';

// The divine layer's own state, kept apart from everything citizens can know.
// `state.divine` holds the player's resource (Whispers), cooldowns, active
// bounded effects, the prayers villagers actually made, omens, missionary
// journeys, the stone and the private Hidden Chronicle. Citizens' own beliefs
// live on each citizen (`c.worldview`), and they never read this object.

export function ensureDivine(state) {
  if (!state.divine) {
    state.divine = {
      whispers: DIVINE.whispers.start, maxWhispers: DIVINE.whispers.max,
      unlocked: false, unlockedDay: null, pendingNotice: false, postponed: false,
      stone: null, cooldowns: {}, effects: [], prayers: [], omens: [], missions: [], societies: [], hidden: [],
      foreign: {}, nextId: 0, stats: { blessings: 0, omens: 0, whispersSpent: 0, prayersMade: 0, prayersAnswered: 0, prayersUnanswered: 0, missions: 0, conversions: 0, leavings: 0, splits: 0, debates: 0, investigations: 0 },
    };
  }
  const d = state.divine;
  // A world that has already reached Year 200 (a fresh unlock or an older save) may now place the stone.
  if (!d.unlocked && yearOf(state.day) >= DIVINE.unlockYear) unlock(state);
  return d;
}

export function unlock(state) {
  const d = state.divine;
  d.unlocked = true;
  d.unlockedDay = state.day;
  if (!d.stone) d.pendingNotice = true;
  hiddenRecord(state, 'awakening', `Year ${yearOf(state.day)}: after two centuries of watching unseen, you may leave a question carved in stone.`, {}, 3);
}

export const nextDivineId = (state, prefix) => `${prefix}${++ensureDivine(state).nextId}`;

/**
 * Deterministic 0..1 roll from the world seed and any keys. Divine decisions
 * use this instead of the shared random stream, so the old simulation's
 * sequence of events is untouched by a system the player may never use.
 */
export function roll(state, ...keys) {
  const s = `${state.seed ?? 0}|${keys.join('|')}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const r2 = (v) => Math.round(v * 100) / 100;

/** Daily: Whispers return with time alone, up to the store's limit. */
export function regenerateWhispers(state) {
  const d = ensureDivine(state);
  d.whispers = r2(Math.min(d.maxWhispers, d.whispers + DIVINE.whispers.perDay));
}

export function spendWhispers(state, n) {
  const d = ensureDivine(state);
  if (d.whispers + 1e-9 < n) return false;
  d.whispers = r2(d.whispers - n);
  d.stats.whispersSpent = r2(d.stats.whispersSpent + n);
  return true;
}

/**
 * The Hidden Chronicle: the player's private record of interventions and of
 * the developments that followed. Separate from the kingdom's Chronicle.
 */
export function hiddenRecord(state, kind, text, refs = {}, importance = 1) {
  const d = state.divine ?? ensureDivine(state);
  const entry = { id: nextDivineId(state, 'h'), day: state.day, minute: state.minute, kind, text, refs, importance };
  d.hidden.push(entry);
  if (d.hidden.length > DIVINE.kept.hidden) {
    // Ordinary notes go first; the player's own interventions and milestones stay longest.
    const i = d.hidden.findIndex((e) => e.importance < 2 && !e.actual);
    d.hidden.splice(i >= 0 ? i : 0, 1);
  }
  return entry;
}

/** Bounded effects of the player's blessings, read by the simulation's hooks. */
export const activeEffects = (state, kind) => (state.divine?.effects ?? []).filter((e) => e.kind === kind && e.until >= state.day && !e.spent);
export const effectOn = (state, kind, targetId) => activeEffects(state, kind).find((e) => e.target === targetId) ?? null;

export function pruneEffects(state) {
  const d = ensureDivine(state);
  d.effects = d.effects.filter((e) => e.until >= state.day && !e.spent);
}
