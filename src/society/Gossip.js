import { byId } from '../core/EntityRegistry.js';
import { SOCIAL } from '../core/Config.js';
import { chance, nextRandom } from '../core/Random.js';
import { trait } from '../ai/Personality.js';
import { peekRel, adjust } from '../citizens/Relationships.js';
import { rumorIndex } from './Reputation.js';

// Village gossip. A rumor is a claim about a citizen. Each citizen holds beliefs
// about rumors with a confidence and a source: 'witnessed' (they saw it) or
// 'heard' (someone told them). Rumors can be false when a jealous gossip invents one.

/** Create a rumor about something that really happened, known first-hand by witnesses. */
export function createFact(state, kind, subjectId, text, witnesses = [], otherId = null) {
  return createRumor(state, { kind, subjectId, otherId, text, truth: true, witnesses });
}

export function createRumor(state, { kind, subjectId, otherId = null, text, truth, witnesses = [], origin = null }) {
  const rumor = { id: 'r' + ++state.nextId.rumor, kind, subjectId, otherId, text, truth, day: state.day, origin };
  state.rumors.push(rumor);
  for (const id of witnesses) {
    const c = byId(state.citizens, id);
    if (c) believe(state, c, rumor, 1, 'witnessed', null);
  }
  return rumor;
}

function believe(state, c, rumor, confidence, source, fromId) {
  const existing = c.beliefs[rumor.id];
  if (existing && existing.confidence >= confidence) return false;
  c.beliefs[rumor.id] = { confidence: Math.round(confidence * 100) / 100, source, from: fromId, day: state.day };
  const keys = Object.keys(c.beliefs);
  if (keys.length > SOCIAL.maxBeliefs) {
    keys.sort((a, b) => c.beliefs[a].day - c.beliefs[b].day);
    delete c.beliefs[keys[0]];
  }
  // Hearing about dishonesty damages trust in the subject.
  if (rumor.kind === 'cheat' && rumor.subjectId !== c.id) adjust(state, c.id, rumor.subjectId, { trust: -8 * confidence, respect: -4 * confidence });
  if (rumor.kind === 'business_opened' && rumor.subjectId !== c.id) adjust(state, c.id, rumor.subjectId, { respect: 4 * confidence });
  if (rumor.kind === 'gift' && rumor.subjectId !== c.id) adjust(state, c.id, rumor.subjectId, { respect: 3 * confidence, trust: 2 * confidence });
  return true;
}

/** During a conversation the speaker may pass on something they know or invent something. */
export function shareGossip(state, speaker, listener) {
  if (!chance(state, SOCIAL.rumorShareChance)) return null;
  // A jealous speaker with a rival may invent a damaging rumor.
  if (trait(speaker, 'jealous') > 0.3 || trait(speaker, 'dishonest') > 0.4) {
    const rival = state.citizens.find((o) => o.id !== speaker.id && o.id !== listener.id && (peekRel(state, speaker.id, o.id)?.rivalry ?? 0) > 45);
    if (rival && chance(state, 0.12 + trait(speaker, 'dishonest') * 0.1)) {
      const rumor = createRumor(state, {
        kind: 'cheat', subjectId: rival.id, truth: false, origin: speaker.id,
        text: `${rival.firstName} has been cheating customers.`,
      });
      believe(state, speaker, rumor, 0.9, 'invented', null);
      return passOn(state, speaker, listener, rumor);
    }
  }
  const known = Object.entries(speaker.beliefs)
    .filter(([id, b]) => !listener.beliefs[id] && b.confidence > 0.25)
    .map(([id]) => rumorIndex(state).get(id))
    .filter((r) => r && r.subjectId !== listener.id);
  if (!known.length) return null;
  const rumor = known[Math.floor(nextRandom(state) * known.length)];
  return passOn(state, speaker, listener, rumor);
}

function passOn(state, speaker, listener, rumor) {
  const trust = (peekRel(state, listener.id, speaker.id)?.trust ?? 45) / 100; // a stranger's word carries default trust
  const skeptic = trait(listener, 'honest') * 0.2 + trait(listener, 'stubborn') * 0.2;
  const confidence = speaker.beliefs[rumor.id].confidence * SOCIAL.rumorDecay * (0.4 + trust) - skeptic;
  if (confidence < 0.15) return null;
  believe(state, listener, rumor, Math.min(0.95, confidence), 'heard', speaker.id);
  return rumor;
}

/** Daily cleanup: forget rumors nobody believes any more and fade old hearsay. */
export function decayRumors(state) {
  for (const c of state.citizens) {
    for (const [id, b] of Object.entries(c.beliefs)) {
      if (b.source !== 'witnessed' && state.day - b.day > 12) b.confidence = Math.round(b.confidence * 0.85 * 100) / 100;
      if (b.confidence < 0.1) delete c.beliefs[id];
    }
  }
  const alive = new Set(state.citizens.flatMap((c) => Object.keys(c.beliefs)));
  state.rumors = state.rumors.filter((r) => alive.has(r.id) || state.day - r.day < 3);
}

export const believersOf = (state, rumorId) => state.citizens.filter((c) => c.beliefs[rumorId]).length;
