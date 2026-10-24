import { transfer } from '../economy/Transactions.js';
import { yearOf, isNewSeason } from '../core/Calendar.js';
import { DAYS_PER_YEAR } from '../core/Config.js';
import { chance, pick } from '../core/Random.js';
import { record } from '../society/Chronicle.js';
import { HEARTH, KINGDOMS, ROUTES } from '../region/RegionData.js';

// Foreign relations between First Hearth and the three kingdoms (and among
// the kingdoms themselves). Every change to a relationship carries a cause:
// trade, tariffs, aid, gifts, quarrels, broken promises. Treaties change the
// actual trade rules; embargoes close markets and roads; the elected
// government's policies decide First Hearth's own stance.

export const PARTIES = [HEARTH, ...Object.keys(KINGDOMS)];
const nameOf = (id) => (id === HEARTH ? 'First Hearth' : KINGDOMS[id]?.name ?? id);
const pairKey = (a, b) => [a, b].sort().join('|');

export const TREATY_KINDS = {
  trade: { label: 'Trade agreement', noun: 'trade agreement', years: 4, effect: 'Tariffs between the parties are halved.' },
  tariff: { label: 'Reduced tariffs', noun: 'pact abolishing tariffs', years: 2, effect: 'No tariffs between the parties.' },
  assistance: { label: 'Mutual assistance', noun: 'mutual assistance treaty', years: 4, effect: 'Each sends food when the other faces famine.' },
  transit: { label: 'Transit rights', noun: 'transit rights treaty', years: 4, effect: 'Caravans cross each other\'s lands without transit fees.' },
  peace: { label: 'Non-aggression pact', noun: 'non-aggression pact', years: 6, effect: 'No embargoes; border quarrels are settled quietly.' },
};

export function ensureDiplomacy(state) {
  if (state.diplomacy) return state.diplomacy;
  const relations = {};
  for (let i = 0; i < PARTIES.length; i++) for (let j = i + 1; j < PARTIES.length; j++) relations[pairKey(PARTIES[i], PARTIES[j])] = { score: 15, log: [] };
  relations[pairKey('greenvale', 'ironhold')].score = 22; // old trading partners
  relations[pairKey('ironhold', 'saltmere')].score = 4; // rival merchant powers
  state.diplomacy = { relations, treaties: [], embargoes: [], history: [], flows: {}, tradeLog: {}, nextId: 0 };
  return state.diplomacy;
}

export const relation = (state, a, b) => ensureDiplomacy(state).relations[pairKey(a, b)];
export const relationScore = (state, a, b) => (a === b ? 100 : relation(state, a, b)?.score ?? 0);

/** Change a relationship for a stated reason. Small changes are merged to keep the log short. */
export function adjustRelation(state, a, b, delta, why) {
  if (a === b || !delta) return;
  const r = relation(state, a, b);
  if (!r) return;
  r.score = Math.max(-100, Math.min(100, Math.round((r.score + delta) * 10) / 10));
  const last = r.log[r.log.length - 1];
  if (last && last.why === why && state.day - last.day < 12) { last.delta = Math.round((last.delta + delta) * 10) / 10; last.day = state.day; }
  else { r.log.push({ day: state.day, delta: Math.round(delta * 10) / 10, why }); if (r.log.length > 12) r.log.shift(); }
}

function say(state, text, importance = 2) {
  const d = ensureDiplomacy(state);
  d.history.push({ day: state.day, text });
  if (d.history.length > 60) d.history.shift();
  record(state, 'diplomacy', text, {}, importance);
}

export const activeTreaties = (state, a, b) => ensureDiplomacy(state).treaties.filter((t) => t.status === 'ACTIVE' && t.parties.includes(a) && (!b || t.parties.includes(b)));
export const hasTreaty = (state, a, b, kind) => activeTreaties(state, a, b).some((t) => t.kind === kind);
export const embargoBetween = (state, a, b) => ensureDiplomacy(state).embargoes.find((e) => e.status === 'ACTIVE' && ((e.by === a && e.against === b) || (e.by === b && e.against === a))) ?? null;

// --- Rules trade asks about -----------------------------------------------------------

const LOCAL_TARIFF = { low: 0.03, normal: 0.06, high: 0.12 };

/** Import tariff a destination charges a trader from `fromHome`. */
export function tariffRate(state, destination, fromHome) {
  if (destination === fromHome) return 0;
  let rate = destination === HEARTH ? LOCAL_TARIFF[state.government?.policies?.tariffLevel ?? 'normal'] ?? 0.06 : state.region.settlements[destination].tariff;
  if (hasTreaty(state, destination, fromHome, 'tariff')) rate = 0;
  else if (hasTreaty(state, destination, fromHome, 'trade')) rate /= 2;
  return Math.round(rate * 1000) / 1000;
}

/** Why a trader from `home` may not buy in `origin` and sell in `destination` (null if allowed). */
export function tradeBlocked(state, origin, destination, home) {
  for (const [a, b] of [[destination, origin], [destination, home], [origin, home], [origin, destination]]) {
    if (a === b) continue;
    const e = embargoBetween(state, a, b);
    if (e) return `${nameOf(e.by)} has an embargo on ${nameOf(e.against)}`;
  }
  return null;
}

/** Roads through a kingdom are closed to traders from a land it has embargoed. */
export const routeAllowed = (state, home) => (route) => !route.territory || route.territory === home || !embargoBetween(state, route.territory, home);

/** Fee for crossing a third party's land without transit rights. */
export function transitFee(state, route, home) {
  if (!route.territory || route.territory === home || hasTreaty(state, route.territory, home, 'transit')) return 0;
  return 4;
}

/** A completed delivery warms relations between trading partners. */
export function noteTrade(state, from, to, value) {
  if (from === to) return;
  const d = ensureDiplomacy(state);
  const key = pairKey(from, to);
  d.tradeLog[key] = (d.tradeLog[key] ?? 0) + value;
  adjustRelation(state, from, to, Math.min(1.5, value / 160), 'profitable trade');
}

// --- Treaties and embargoes -----------------------------------------------------------

/** Does a party's government want this? First Hearth follows its elected policies. */
function willing(state, party, other, kind) {
  const score = relationScore(state, party, other);
  if (party === HEARTH) {
    const open = state.government?.policies?.openDiplomacy ?? true;
    if (!open) return false;
    const tariffs = state.government?.policies?.tariffLevel ?? 'normal';
    if ((kind === 'tariff' || kind === 'trade') && tariffs === 'high') return score > 60;
    return score > 30;
  }
  const stance = state.region.settlements[party].leader.stance;
  const need = { cooperative: 25, mercantile: 32, protectionist: 55 }[stance];
  if (kind === 'tariff' && stance === 'protectionist') return false;
  if (kind === 'assistance') return score > (stance === 'cooperative' ? 20 : 40);
  return score > need;
}

export function signTreaty(state, kind, a, b, proposedBy = a) {
  const d = ensureDiplomacy(state);
  if (hasTreaty(state, a, b, kind)) return null;
  const t = { id: 'tr' + ++d.nextId, kind, parties: [a, b], startDay: state.day, endDay: state.day + TREATY_KINDS[kind].years * DAYS_PER_YEAR, status: 'ACTIVE', proposedBy, terms: TREATY_KINDS[kind].effect };
  d.treaties.push(t);
  adjustRelation(state, a, b, 5, `signed a ${TREATY_KINDS[kind].noun}`);
  say(state, `${nameOf(a)} and ${nameOf(b)} signed a ${TREATY_KINDS[kind].noun} (Year ${yearOf(state.day)}): ${t.terms}`, 3);
  return t;
}

export function imposeEmbargo(state, by, against, reason) {
  const d = ensureDiplomacy(state);
  if (embargoBetween(state, by, against)) return null;
  if (hasTreaty(state, by, against, 'peace')) return null;
  // Any treaty between them is broken.
  for (const t of activeTreaties(state, by, against)) { t.status = 'BROKEN'; t.endedDay = state.day; }
  const e = { id: 'em' + ++d.nextId, by, against, startDay: state.day, status: 'ACTIVE', reason };
  d.embargoes.push(e);
  adjustRelation(state, by, against, -12, `${nameOf(by)} imposed an embargo`);
  for (const other of PARTIES) if (other !== by && other !== against) adjustRelation(state, by, other, -2, 'an embargo unsettled the region');
  say(state, `${nameOf(by)} placed an embargo on ${nameOf(against)}: ${reason}. Contracts not yet loaded are void; caravans already on the road will be turned away at the border.`, 3);
  return e;
}

export function liftEmbargo(state, e, why) {
  e.status = 'LIFTED';
  e.endDay = state.day;
  adjustRelation(state, e.by, e.against, 4, 'an embargo was lifted');
  say(state, `${nameOf(e.by)} lifted its embargo on ${nameOf(e.against)} (${why}).`, 2);
}

/** A gift to a kingdom (council action): coins from the treasury, goodwill in return. */
export function sendGift(state, to, coins = 40) {
  if (!KINGDOMS[to]) return { ok: false, message: 'Unknown kingdom.' };
  if (!transfer(state, 'treasury', KINGDOMS[to].account, coins, 'gift', `Diplomatic gift to ${nameOf(to)}`)) return { ok: false, message: 'The treasury cannot afford a gift.' };
  adjustRelation(state, HEARTH, to, 7, 'a diplomatic gift');
  say(state, `First Hearth sent ${nameOf(to)} a gift of ${coins} coins and good wishes.`, 2);
  return { ok: true, message: `Relations with ${nameOf(to)} warmed.` };
}

/** Food aid under a mutual assistance treaty: real grain, carried as a gift contract. */
function sendAid(state, from, to) {
  const giver = state.region.settlements[from];
  const taker = state.region.settlements[to];
  if (!giver || !taker) return false;
  const n = Math.floor(Math.min(40, (giver.inventory.grain ?? 0) - (giver.reserved.grain ?? 0) - 60));
  if (n < 10) return false;
  giver.inventory.grain -= n;
  taker.inventory.grain = (taker.inventory.grain ?? 0) + n;
  adjustRelation(state, from, to, 8, 'food aid in a famine');
  say(state, `${nameOf(from)} sent ${n} grain to famine-struck ${nameOf(to)} under their mutual assistance treaty.`, 2);
  return true;
}

/** Daily: treaties expire or renew, quarrels flare, embargoes come and go. */
export function dailyDiplomacy(state) {
  const d = ensureDiplomacy(state);
  for (const t of d.treaties.filter((x) => x.status === 'ACTIVE' && x.endDay <= state.day)) {
    const [a, b] = t.parties;
    if (willing(state, a, b, t.kind) && willing(state, b, a, t.kind)) {
      t.endDay = state.day + TREATY_KINDS[t.kind].years * DAYS_PER_YEAR;
      say(state, `${nameOf(a)} and ${nameOf(b)} renewed their ${TREATY_KINDS[t.kind].noun}.`, 1);
    } else {
      t.status = 'EXPIRED';
      t.endedDay = state.day;
      say(state, `The ${TREATY_KINDS[t.kind].noun} between ${nameOf(a)} and ${nameOf(b)} expired and was not renewed.`, 2);
    }
  }
  if (d.treaties.length > 40) d.treaties = d.treaties.filter((t) => t.status === 'ACTIVE').concat(d.treaties.filter((t) => t.status !== 'ACTIVE').slice(-20));
  // Mutual assistance in famine.
  for (const t of d.treaties.filter((x) => x.status === 'ACTIVE' && x.kind === 'assistance')) {
    for (const [a, b] of [t.parties, [...t.parties].reverse()]) {
      const k = state.region.settlements[b];
      if (k && k.shortages.food && (t.lastAid?.[b] ?? -99) < state.day - 6 && sendAid(state, a, b)) t.lastAid = { ...(t.lastAid ?? {}), [b]: state.day };
    }
  }
  if (!isNewSeason(state.day)) return;
  seasonalDiplomacy(state);
}

function seasonalDiplomacy(state) {
  const d = ensureDiplomacy(state);
  const kingdoms = Object.keys(KINGDOMS);
  // Standing frictions and affinities.
  for (const a of kingdoms) {
    const k = state.region.settlements[a];
    if (k.tariff >= 0.15) for (const b of PARTIES) if (b !== a) adjustRelation(state, a, b, -1.5, `${nameOf(a)}'s high tariffs`);
    for (const b of kingdoms) {
      if (b <= a) continue;
      const s1 = k.leader.stance, s2 = state.region.settlements[b].leader.stance;
      if (s1 === s2 && s1 !== 'protectionist') adjustRelation(state, a, b, 1, 'like-minded leaders');
      if ((s1 === 'protectionist') !== (s2 === 'protectionist')) adjustRelation(state, a, b, -1, 'clashing trade policies');
    }
  }
  // First Hearth's own tariffs annoy exporters.
  if ((state.government?.policies?.tariffLevel ?? 'normal') === 'high') for (const k of kingdoms) adjustRelation(state, HEARTH, k, -2, "First Hearth's high tariffs");
  // Border quarrels between neighbours whose roads cross each other's land.
  if (chance(state, 0.25)) {
    const route = pick(state, ROUTES.filter((r) => r.territory && state.region.discovered.routes.includes(r.id)));
    const other = route.a === route.territory ? route.b : route.a;
    if (other !== HEARTH) {
      const calm = hasTreaty(state, route.territory, other, 'peace');
      adjustRelation(state, route.territory, other, calm ? -2 : -7, `a quarrel over tolls on the ${route.name}`);
      say(state, `${nameOf(route.territory)} and ${nameOf(other)} quarrelled over tolls on the ${route.name}${calm ? ', but their pact kept it civil' : ''}.`, 1);
    }
  }
  // Treaties: partners who trade and get along formalise it.
  for (let i = 0; i < PARTIES.length; i++) for (let j = i + 1; j < PARTIES.length; j++) {
    const a = PARTIES[i], b = PARTIES[j];
    const volume = d.tradeLog[pairKey(a, b)] ?? 0;
    for (const kind of ['trade', 'transit', 'assistance', 'tariff', 'peace']) {
      if (hasTreaty(state, a, b, kind) || embargoBetween(state, a, b)) continue;
      const enough = kind === 'trade' ? volume >= 300 : kind === 'tariff' ? volume >= 900 && hasTreaty(state, a, b, 'trade') : kind === 'transit' ? volume >= 200 : kind === 'assistance' ? relationScore(state, a, b) > 45 : relationScore(state, a, b) > 55;
      if (enough && willing(state, a, b, kind) && willing(state, b, a, kind)) { signTreaty(state, kind, a, b); break; }
    }
    d.tradeLog[pairKey(a, b)] = Math.round(volume * 0.5);
  }
  // Embargoes: protectionist leaders punish bitter rivals; they lift when tempers cool.
  for (const e of d.embargoes.filter((x) => x.status === 'ACTIVE')) {
    if (relationScore(state, e.by, e.against) > -15 || state.day - e.startDay > DAYS_PER_YEAR * 2) liftEmbargo(state, e, relationScore(state, e.by, e.against) > -15 ? 'relations have improved' : 'it had outlived its purpose');
  }
  for (const a of kingdoms) for (const b of PARTIES) {
    if (a === b || embargoBetween(state, a, b)) continue;
    const stance = state.region.settlements[a].leader.stance;
    if (relationScore(state, a, b) < -45 && (stance === 'protectionist' || relationScore(state, a, b) < -70)) imposeEmbargo(state, a, b, `relations had sunk to ${Math.round(relationScore(state, a, b))}`);
  }
  if (state.government?.policies?.tariffLevel === 'high' && state.government?.policies?.openDiplomacy === false) {
    for (const b of kingdoms) if (relationScore(state, HEARTH, b) < -60 && !embargoBetween(state, HEARTH, b)) imposeEmbargo(state, HEARTH, b, 'the government closed the market to a hostile neighbour');
  }
  if (d.embargoes.length > 30) d.embargoes = d.embargoes.filter((e) => e.status === 'ACTIVE').concat(d.embargoes.filter((e) => e.status !== 'ACTIVE').slice(-15));
}

/** Record people moving between settlements. */
export function noteMigration(state, from, to, n) {
  const d = ensureDiplomacy(state);
  const key = `${from}>${to}`;
  d.flows[key] = (d.flows[key] ?? 0) + n;
}

export { nameOf as partyName, pairKey };
