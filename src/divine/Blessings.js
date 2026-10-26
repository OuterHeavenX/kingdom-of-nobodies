import { LIFE, DAYS_PER_YEAR } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { isTrading } from '../economy/Businesses.js';
import { plotById } from '../property/LandRegistry.js';
import { seasonOf } from '../core/Calendar.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';
import { relationScore, adjustRelation } from '../diplomacy/Diplomacy.js';
import { ensureDivine, spendWhispers, hiddenRecord, nextDivineId, effectOn, activeEffects, roll, r2 } from './State.js';

// The player's blessings: ten subtle influences, each with a cost in
// Whispers, a cooldown, eligibility drawn from the world as it is, a limited
// duration and a bounded effect on one simulation number. A blessing never
// decides anything for anyone: it cannot make a villager believe, vote,
// befriend, love or convert, and it cannot raise the dead or guarantee an
// outcome. Villagers never learn that a blessing happened.

const adult = (state, c) => ageOf(state, c) >= LIFE.adultAge;
const name = (c) => `${c.firstName} ${c.lastName}`;
const living = (state) => state.citizens.filter((c) => !c.away);
const hasLoss = (state, c) => c.memories.some((m) => m.kind === 'loss' && state.day - m.day < DAYS_PER_YEAR);

/** Hazards that Unseen Protection can soften, as they stand today. */
export function hazardOf(state, c) {
  if (c.health.sickUntil > state.day) return 'illness';
  if (c.away?.reason === 'militia') return 'battle';
  if (c.health.starvingDays > 0) return 'hunger';
  if ((state.fires ?? []).some((f) => f.plotId === c.homePlotId)) return 'fire';
  if (state.season?.harshWinter && seasonOf(state.day) === 'Winter' && (ageOf(state, c) >= 60 || ageOf(state, c) < 3)) return 'winter';
  if (c.away?.reason === 'mission') return 'the road';
  return null;
}

export const BLESSINGS = {
  fortune: {
    name: 'Gentle Fortune', icon: '🍀', cost: 3, cooldown: 6, days: 6,
    about: 'Slightly improves the odds of one near-future opportunity: being taken on for work, a better yield from their own fields, or trade at a struggling business. Success is never guaranteed.',
    targets: (state) => state.citizens.filter((c) => adult(state, c)).map((c) => {
      const job = c.employment && state.businesses.find((b) => b.id === c.employment.businessId);
      const own = state.businesses.find((b) => b.ownerId === c.id && b.status === 'STRUGGLING');
      if (!c.employment && !c.retired && ageOf(state, c) < LIFE.retireAge) return { id: c.id, label: name(c), why: 'looking for work' };
      if (own) return { id: c.id, label: name(c), why: `${own.name} is struggling` };
      if (job?.type === 'farm') return { id: c.id, label: name(c), why: `works the fields at ${job.name}` };
      return null;
    }).filter(Boolean),
  },
  healing: {
    name: 'The Healing Whisper', icon: '🌿', cost: 4, cooldown: 4, days: 5,
    about: 'May improve a sick villager\'s chance of recovering, and lowers the danger of the illness. It cannot cure every condition or bring back the dead.',
    targets: (state) => state.citizens.filter((c) => c.health.sickUntil > state.day).map((c) => ({ id: c.id, label: name(c), why: 'ill with fever' })),
  },
  harvest: {
    name: 'Favorable Harvest', icon: '🌾', cost: 5, cooldown: 12, days: 6,
    about: 'For six days the farms in one small area yield about a quarter more grain. Every extra sheaf is recorded; it cannot make food from nothing.',
    targets: (state) => state.businesses.filter((b) => b.type === 'farm' && isTrading(b)).map((b) => ({ id: b.id, label: b.name, why: state.season?.cropFailureYear ? 'the harvest is failing' : 'fields in the area' })),
  },
  courage: {
    name: 'A Moment of Courage', icon: '🔥', cost: 2, cooldown: 3, days: 3,
    about: 'For a few days a villager facing a hard choice feels steadier and bolder. What they decide is still entirely theirs.',
    targets: (state) => living(state).filter((c) => adult(state, c) && (!c.homePlotId || (!c.employment && !c.retired) || state.businesses.some((b) => b.ownerId === c.id && b.status === 'STRUGGLING') || hasLoss(state, c) || c.mood < 35))
      .map((c) => ({ id: c.id, label: name(c), why: !c.homePlotId ? 'without a home' : !c.employment && !c.retired ? 'without work' : hasLoss(state, c) ? 'grieving' : 'facing hard times' })),
  },
  passage: {
    name: 'Safe Passage', icon: '🧭', cost: 3, cooldown: 6, days: 8,
    about: 'Modestly lowers the dangers of a journey already under way — a militia march or a missionary\'s road. It does not shorten the way.',
    targets: (state) => state.citizens.filter((c) => c.away?.reason === 'militia' || c.away?.reason === 'mission').map((c) => ({ id: c.id, label: name(c), why: c.away.reason === 'militia' ? 'marching with the militia' : 'on a journey to speak of the stone' })),
  },
  inspiration: {
    name: 'Inspiration', icon: '💡', cost: 3, cooldown: 6, days: 6,
    about: 'Someone learning, teaching or studying learns faster for a while. They still have to do the work.',
    targets: (state) => living(state).filter((c) => c.education?.masterId || c.worldview?.role === 'scholar' || c.profession === 'Teacher' || (ageOf(state, c) >= 6 && ageOf(state, c) < 13))
      .map((c) => ({ id: c.id, label: name(c), why: c.worldview?.role === 'scholar' ? 'studying the stone' : c.education?.masterId ? 'an apprentice' : c.profession === 'Teacher' ? 'a teacher' : 'at lessons' })),
  },
  comfort: {
    name: 'Comfort', icon: '🕊', cost: 2, cooldown: 3, days: 4,
    about: 'A little peace for someone grieving or in distress. Grief and memories stay; the weight eases slightly.',
    targets: (state) => living(state).filter((c) => ageOf(state, c) >= 4 && (hasLoss(state, c) || c.mood < 30)).map((c) => ({ id: c.id, label: name(c), why: hasLoss(state, c) ? 'grieving' : 'in low spirits' })),
  },
  encounter: {
    name: 'A Chance Encounter', icon: '✨', cost: 3, cooldown: 6, days: 2,
    about: 'Puts two strangers in each other\'s way for a day or two. Whether they talk, and what comes of it, is up to them.',
    targets: (state) => living(state).filter((c) => adult(state, c) && c.needs.social < 55).map((c) => ({ id: c.id, label: name(c), why: c.romance.partnerId ? 'could use a friend' : 'lonely' })),
  },
  peace: {
    name: 'Peaceful Winds', icon: '🌬', cost: 6, cooldown: 24, days: 8,
    about: 'For a time tempers cool between First Hearth and a kingdom it quarrels with. No ruler is made to sign anything.',
    targets: (state) => Object.keys(KINGDOMS).filter((k) => relationScore(state, HEARTH, k) < 25 || (state.military?.wars ?? []).some((w) => w.status === 'ACTIVE' && [...(w.attackers ?? []), ...(w.defenders ?? [])].includes(k)))
      .map((k) => ({ id: k, label: KINGDOMS[k].name, why: `relations ${relationScore(state, HEARTH, k)}` })),
  },
  protection: {
    name: 'Unseen Protection', icon: '🛡', cost: 4, cooldown: 8, days: 8,
    about: 'Slightly improves someone\'s chance of coming through one danger they face now — an illness, a battle, hunger, a fire, a bitter winter. It is not invulnerability.',
    targets: (state) => state.citizens.map((c) => ({ c, h: hazardOf(state, c) })).filter((x) => x.h).map(({ c, h }) => ({ id: c.id, label: name(c), why: `facing ${h}` })),
  },
};
export const BLESSING_IDS = Object.keys(BLESSINGS);

/** Days until a blessing may be used again (0 = ready). */
export const cooldownLeft = (state, id) => Math.max(0, (state.divine?.cooldowns?.[id] ?? 0) - state.day);

/** Why a blessing cannot be given to this target now (null if it can). */
export function blessingProblem(state, id, targetId) {
  const def = BLESSINGS[id];
  const d = ensureDivine(state);
  if (!def) return 'Unknown blessing.';
  if (cooldownLeft(state, id)) return `${def.name} can be used again in ${cooldownLeft(state, id)} day${cooldownLeft(state, id) === 1 ? '' : 's'}.`;
  if (d.whispers + 1e-9 < def.cost) return `It needs ${def.cost} Whispers; you have ${Math.floor(d.whispers)}.`;
  if (!def.targets(state).some((t) => t.id === targetId)) return 'That is not possible for them now.';
  if (effectOn(state, id, targetId)) return 'They already have this blessing.';
  return null;
}

/** Choose a stranger for a Chance Encounter: an unrelated adult of a similar age whom they barely know. */
function strangerFor(state, c) {
  const kin = new Set([c.family.spouseId, ...c.family.childIds, ...c.family.parentIds].filter(Boolean));
  return living(state).filter((o) => o !== c && adult(state, o) && !kin.has(o.id) && (state.relationships[`${c.id}|${o.id}`]?.friendship ?? 0) < 30 && Math.abs(o.birthDay - c.birthDay) < 15 * 12)
    .sort((a, b) => roll(state, c.id, a.id, 'meet', state.day) - roll(state, c.id, b.id, 'meet', state.day))[0] ?? null;
}

/**
 * Give a blessing. Returns { ok, message }. The record goes only into the
 * Hidden Chronicle; nothing a villager can see mentions it.
 */
export function bestow(state, id, targetId, { prayerId = null } = {}) {
  const problem = blessingProblem(state, id, targetId);
  if (problem) return { ok: false, message: problem };
  const def = BLESSINGS[id];
  const d = ensureDivine(state);
  const effect = { id: nextDivineId(state, 'b'), kind: id, target: targetId, day: state.day, until: state.day + def.days, prayerId };
  const c = byId(state.citizens, targetId);
  if (id === 'encounter') {
    const other = strangerFor(state, c);
    if (!other) return { ok: false, message: 'There is nobody new for them to meet just now.' };
    effect.partner = other.id;
  }
  if (id === 'harvest') { const b = state.businesses.find((x) => x.id === targetId); const p = plotById(state, b?.plotId); effect.x = p?.x ?? 0; effect.z = p?.z ?? 0; effect.radius = 22; effect.extra = 0; }
  if (id === 'protection') effect.hazard = hazardOf(state, c);
  spendWhispers(state, def.cost);
  d.cooldowns[id] = state.day + def.cooldown;
  d.effects.push(effect);
  d.stats.blessings++;
  // Effects felt at once (still bounded): a lift of spirits.
  if (id === 'comfort' && c) c.mood = Math.min(100, c.mood + 8);
  if (id === 'courage' && c) c.mood = Math.min(100, c.mood + 5);
  const label = id === 'harvest' || id === 'peace' ? (state.businesses.find((b) => b.id === targetId)?.name ?? KINGDOMS[targetId]?.name ?? targetId) : c ? name(c) : targetId;
  const prayer = prayerId ? d.prayers.find((p) => p.id === prayerId) : null;
  if (prayer) { prayer.response = id; prayer.responseLabel = def.name; prayer.viewed = true; }
  const entry = hiddenRecord(state, 'blessing', `You gave ${def.name} to ${label}${prayer ? `, in answer to ${prayer.name}'s prayer` : ''}${effect.partner ? ` (crossing paths with ${name(byId(state.citizens, effect.partner))})` : ''}.`, { citizens: [targetId, effect.partner].filter((x) => byId(state.citizens, x)), effect: effect.id }, 2);
  entry.actual = true;
  return { ok: true, message: `${def.icon} ${def.name}: ${label}. No one will know.`, effect };
}

/** Who a blessing offered in answer to a prayer would go to: the person (or farm, or kingdom) the prayer is about. */
export function prayerTarget(state, p, blessing) {
  if (blessing === 'harvest') return p.world?.businessId ?? null;
  if (blessing === 'peace') {
    const war = (state.military?.wars ?? []).find((w) => w.id === p.world?.warId && w.status === 'ACTIVE');
    const foe = war ? [...(war.attackers ?? []), ...(war.defenders ?? [])].find((k) => k !== HEARTH && KINGDOMS[k]) : null;
    return foe ?? BLESSINGS.peace.targets(state)[0]?.id ?? null;
  }
  return p.targetId ?? p.citizenId;
}

/** The player chooses not to answer a prayer (no cost, no consequence). */
export function keepSilence(state, prayerId) {
  const p = ensureDivine(state).prayers.find((x) => x.id === prayerId);
  if (!p || p.response) return false;
  p.response = 'silence';
  p.viewed = true;
  return true;
}

// --- Effects, read by the simulation's hooks ---------------------------------------------

/** Illness danger multiplier for one citizen (Healing Whisper). */
export const illnessFactor = (state, c) => (effectOn(state, 'healing', c.id) ? 0.45 : 1);

/** Whole-day danger multiplier while facing the hazard Protection was given for. */
export const protectFactor = (state, c) => (effectOn(state, 'protection', c.id) && hazardOf(state, c) ? 0.7 : 1);

/** Battle danger multiplier for a militia member. */
export const battleFactor = (state, c) => (effectOn(state, 'passage', c.id) ? 0.6 : 1) * (effectOn(state, 'protection', c.id) ? 0.7 : 1);

/** Production multiplier for a business (Favorable Harvest for nearby farms; Gentle Fortune for a blessed worker's farm or owner's business). */
export function productionFactor(state, b, plot) {
  if (!state.divine?.effects?.length) return 1;
  let m = 1;
  if (b.type === 'farm' && plot) for (const e of activeEffects(state, 'harvest')) if (Math.hypot(plot.x - e.x, plot.z - e.z) <= e.radius) { m *= 1.25; break; }
  for (const e of activeEffects(state, 'fortune')) {
    const c = byId(state.citizens, e.target);
    if (!c) continue;
    if (b.ownerId === c.id && b.status === 'STRUGGLING') { m *= 1.12; break; }
    if (b.type === 'farm' && c.employment?.businessId === b.id) { m *= 1.15; break; }
  }
  return m;
}

/** Account for the extra a Favorable Harvest really produced (recorded on its effect). */
export function noteProduced(state, b, made, plot) {
  if (b.type !== 'farm' || !made || !plot || !state.divine?.effects?.length) return;
  for (const e of activeEffects(state, 'harvest')) if (Math.hypot(plot.x - e.x, plot.z - e.z) <= e.radius) { e.extra = r2((e.extra ?? 0) + made * (1 - 1 / 1.25)); break; }
}

/** Points added to an application's score for a blessed job-seeker (bounded). */
export const hiringBonus = (state, c) => (!c.employment && effectOn(state, 'fortune', c.id) ? 10 : 0);

/** Daily: the slow, bounded effects of blessings, and their ending. */
export function dailyBlessings(state) {
  const d = ensureDivine(state);
  for (const e of d.effects) {
    if (e.until < state.day || e.spent) continue;
    const c = byId(state.citizens, e.target);
    if (e.kind === 'healing') {
      if (!c) { e.spent = true; e.outcome = 'died'; continue; }
      if (c.health.sickUntil <= state.day) { e.spent = true; e.outcome = 'recovered'; continue; }
      // A better chance each day that the fever breaks a day early.
      if (roll(state, e.id, state.day) < 0.45) c.health.sickUntil = Math.max(state.day, c.health.sickUntil - 1);
    } else if (e.kind === 'comfort' && c) c.mood = Math.min(100, c.mood + 1);
    else if (e.kind === 'peace') {
      e.given = e.given ?? 0;
      if (e.given < 8 && relationScore(state, HEARTH, e.target) < 40) { adjustRelation(state, HEARTH, e.target, 1, 'tempers cooled'); e.given++; }
    } else if (e.kind === 'protection') {
      if (!c) { e.spent = true; e.outcome = 'lost'; continue; }
      if (!hazardOf(state, c)) { e.spent = true; e.outcome = 'came through'; }
    } else if ((e.kind === 'passage' || e.kind === 'encounter' || e.kind === 'courage' || e.kind === 'fortune' || e.kind === 'inspiration') && !c) e.spent = true;
  }
  for (const e of d.effects.filter((x) => (x.until < state.day || x.spent) && !x.closed)) {
    e.closed = true;
    const after = e.kind === 'harvest' ? `the fields yielded about ${Math.round(e.extra ?? 0)} extra grain` : e.outcome ?? 'it ran its course';
    hiddenRecord(state, 'aftermath', `${BLESSINGS[e.kind].name} (${e.id}) ended: ${after}.`, { effect: e.id }, 1);
  }
}

export { r2 };
