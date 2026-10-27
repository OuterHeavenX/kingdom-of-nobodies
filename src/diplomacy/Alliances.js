import { HEARTH, KINGDOMS } from '../region/RegionData.js';
import { isNewSeason } from '../core/Calendar.js';
import { chance } from '../core/Random.js';
import { ensureDiplomacy, relationScore, hasTreaty, signTreaty, embargoBetween, activeTreaties, adjustRelation, partyName, diplomacyNote, PARTIES } from './Diplomacy.js';

// Alliances. Kingdoms that share a rival and get on with each other sign
// defensive alliances; close friends add military assistance; when one
// kingdom has started wars, the others band together into a coalition. An
// alliance is a promise with real consequences: it deters an aggressor
// (WarManager counts allies before declaring war), and when the attack comes
// an ally must answer the call or break the treaty.

export const AGGRESSION_FADE = 0.025; // per season
const rulerOf = (state, party) => (party === HEARTH ? null : state.foreign?.people[state.region.settlements[party]?.leader?.citizenId] ?? null);

/** Does a party's government want a military treaty with another? */
export function militaryWilling(state, a, b, kind) {
  const score = relationScore(state, a, b);
  if (a === HEARTH) {
    // First Hearth commits its people to war only by policy and for a trusted friend.
    if (!(state.government?.policies?.openDiplomacy ?? true)) return false;
    return score > (kind === 'defense' ? 50 : 65) && state.citizens.length >= 40;
  }
  const r = rulerOf(state, a);
  const caution = r?.personality.caution ?? 0.5;
  const warmth = r?.personality.warmth ?? 0.5;
  return score > (kind === 'defense' ? 30 : 50) + caution * 10 - warmth * 10;
}

export const alliesOf = (state, party) => activeTreaties(state, party).filter((t) => t.kind === 'defense' || t.kind === 'assistance_mil').map((t) => t.parties.find((p) => p !== party));
export const defensiveAllies = (state, party) => activeTreaties(state, party).filter((t) => t.kind === 'defense').map((t) => t.parties.find((p) => p !== party));

/** Common rivals bring friends together. */
function sharedRival(state, a, b) {
  return PARTIES.find((c) => c !== a && c !== b && relationScore(state, a, c) < -5 && relationScore(state, b, c) < -5) ?? null;
}

/** Seasonal: new alliances where interests align; old ones lapse if friendship fails. */
export function seasonalAlliances(state) {
  if (!isNewSeason(state.day)) return;
  const d = ensureDiplomacy(state);
  // A record of aggression fades: about one war forgotten in ten years of peace.
  const agg = state.military?.aggressions ?? {};
  for (const p of Object.keys(agg)) agg[p] = Math.max(0, Math.round((agg[p] - AGGRESSION_FADE) * 1000) / 1000);
  for (let i = 0; i < PARTIES.length; i++) for (let j = i + 1; j < PARTIES.length; j++) {
    const a = PARTIES[i], b = PARTIES[j];
    if (embargoBetween(state, a, b) || state.military?.wars.some((w) => w.status === 'ACTIVE' && ((w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a))))) continue;
    const rival = sharedRival(state, a, b);
    const aggressor = state.military?.aggressions ? Object.entries(state.military.aggressions).find(([p, n]) => n >= 2 && p !== a && p !== b)?.[0] : null;
    if (!hasTreaty(state, a, b, 'defense') && (rival || aggressor || relationScore(state, a, b) > 55) && militaryWilling(state, a, b, 'defense') && militaryWilling(state, b, a, 'defense') && chance(state, 0.5)) {
      const t = signTreaty(state, 'defense', a, b);
      if (t) {
        t.reason = aggressor ? `a coalition against ${partyName(aggressor)}, which has started ${Math.round(state.military.aggressions[aggressor])} wars of late` : rival ? `a shared rival in ${partyName(rival)}` : 'long friendship';
        diplomacyNote(state, `${partyName(a)} and ${partyName(b)} formed a defensive alliance: ${t.reason}.`, 2);
      }
    } else if (hasTreaty(state, a, b, 'defense') && !hasTreaty(state, a, b, 'assistance_mil') && relationScore(state, a, b) > 65 && militaryWilling(state, a, b, 'assistance_mil') && militaryWilling(state, b, a, 'assistance_mil') && chance(state, 0.3)) {
      signTreaty(state, 'assistance_mil', a, b);
    }
  }
  // An alliance between parties that have fallen out is renounced.
  for (const t of d.treaties.filter((x) => x.status === 'ACTIVE' && (x.kind === 'defense' || x.kind === 'assistance_mil'))) {
    const [a, b] = t.parties;
    if (relationScore(state, a, b) < 5) {
      t.status = 'BROKEN'; t.endedDay = state.day;
      adjustRelation(state, a, b, -4, 'an alliance renounced');
      diplomacyNote(state, `The ${t.kind === 'defense' ? 'defensive alliance' : 'military assistance treaty'} between ${partyName(a)} and ${partyName(b)} was renounced as relations soured.`, 2);
    }
  }
}

export { KINGDOMS };
