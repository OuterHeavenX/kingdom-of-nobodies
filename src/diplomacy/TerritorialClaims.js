import { DAYS_PER_YEAR } from '../core/Config.js';
import { isNewSeason, yearOf } from '../core/Calendar.js';
import { nextRandom } from '../core/Random.js';
import { transfer, balance } from '../economy/Transactions.js';
import { DISPUTED_LANDS, KINGDOMS } from '../region/RegionData.js';
import { routeById } from '../region/RegionManager.js';
import { relationScore, hasTreaty, embargoBetween, adjustRelation, signTreaty, ensureDiplomacy, diplomacyNote } from './Diplomacy.js';
import { ensureMilitary } from '../military/Army.js';

// Territorial disputes. Each contested land has a holder and a claimant, and
// a tension that rises and falls for stated reasons: sour relations, quarrels
// over tolls on the road through it, the claimant's need for what the land
// yields, an embargo, a proud ruler — and falls with treaties and time. When
// tension is high the land is formally disputed and the two governments
// negotiate each season. Talks can settle it (with compensation and a treaty
// recognising the border); failed talks are what wars are made of.

const name = (p) => KINGDOMS[p]?.name ?? p;
const ruler = (state, p) => state.foreign?.people[state.region.settlements[p]?.leader?.citizenId] ?? null;

export function ensureDisputes(state) {
  const m = ensureMilitary(state);
  if (!m.disputes.length) {
    for (const land of DISPUTED_LANDS) m.disputes.push({ id: land.id, name: land.name, claimants: [...land.claimants], controller: land.controller, tension: 2, status: 'DORMANT', failures: 0, history: [], causes: [] });
  }
  return m.disputes;
}

export const disputeById = (state, id) => ensureDisputes(state).find((d) => d.id === id) ?? null;
export const landOf = (id) => DISPUTED_LANDS.find((l) => l.id === id);
export const claimantOf = (d) => d.claimants.find((p) => p !== d.controller);

function log(state, d, text, importance = 2) {
  d.history.push({ day: state.day, text });
  if (d.history.length > 16) d.history.shift();
  diplomacyNote(state, text, importance);
}

/** Why tension over a land rose or fell this season, with the amounts. */
export function tensionFactors(state, d) {
  const land = landOf(d.id);
  const holder = d.controller, claimant = claimantOf(d);
  const rel = relationScore(state, holder, claimant);
  const k = state.region.settlements[claimant];
  const route = routeById(land.route);
  const out = [];
  out.push(rel < 0 ? [`relations between ${name(holder)} and ${name(claimant)} stand at ${Math.round(rel)}`, Math.round(-rel / 12 * 10) / 10] : ['relations are cordial', -1]);
  if (k.shortages[land.resource] || k.shortages.food) out.push([`${name(claimant)} is short of ${k.shortages[land.resource] ? land.resource : 'food'}`, 1.5]);
  const quarrels = (state.diplomacy?.history ?? []).filter((h) => state.day - h.day <= 3 && h.text.includes(route.name) && /quarrel/.test(h.text)).length;
  if (quarrels) out.push([`a quarrel over tolls on the ${route.name}`, 2]);
  if (embargoBetween(state, holder, claimant)) out.push(['an embargo between them', 2]);
  const r = ruler(state, claimant);
  if (r && r.personality.pride > 0.6) out.push([`${r.firstName} ${r.lastName} of ${name(claimant)} is a proud ruler`, 0.8]);
  if (r && r.personality.warmth > 0.7) out.push([`${r.firstName} ${r.lastName} prefers friendship`, -0.8]);
  if (hasTreaty(state, holder, claimant, 'peace')) out.push(['a non-aggression pact', -1.5]);
  if (hasTreaty(state, holder, claimant, 'border')) out.push(['a treaty recognising the border', -3]);
  return out;
}

/** Seasonal: tension moves; high tension opens a dispute; open disputes are negotiated. */
export function seasonalClaims(state, { considerWar = () => null } = {}) {
  if (!isNewSeason(state.day)) return;
  for (const d of ensureDisputes(state)) {
    if (d.status === 'WAR') continue;
    if (d.status === 'SETTLED') {
      if (state.day - (d.settledDay ?? 0) > DAYS_PER_YEAR * 6) { d.status = 'DORMANT'; d.tension = Math.min(d.tension, 3); }
      continue;
    }
    const factors = tensionFactors(state, d);
    const delta = factors.reduce((s, [, v]) => s + v, 0);
    d.tension = Math.round(Math.max(0, Math.min(30, d.tension + delta)) * 10) / 10;
    d.causes = factors.filter(([, v]) => v > 0).map(([t]) => t);
    const holder = d.controller, claimant = claimantOf(d);
    if (d.status === 'DORMANT' && d.tension >= 8) {
      d.status = 'DISPUTED';
      d.openedDay = state.day;
      d.failures = 0;
      log(state, d, `${name(claimant)} laid claim to ${d.name}, held by ${name(holder)}: ${d.causes.slice(0, 2).join('; ') || 'old grievances'} (Year ${yearOf(state.day)}).`, 3);
      continue;
    }
    if (d.status !== 'DISPUTED') continue;
    if (d.tension < 4) { d.status = 'DORMANT'; log(state, d, `The quarrel between ${name(holder)} and ${name(claimant)} over ${d.name} has faded.`, 1); continue; }
    negotiate(state, d, considerWar);
  }
}

/** One round of talks between holder and claimant. */
export function negotiate(state, d, considerWar = () => null) {
  const holder = d.controller, claimant = claimantOf(d);
  const rel = relationScore(state, holder, claimant);
  const rs = [ruler(state, holder), ruler(state, claimant)];
  const warmth = rs.reduce((s, r) => s + (r?.personality.warmth ?? 0.5), 0) / 2;
  const pride = rs.reduce((s, r) => s + (r?.personality.pride ?? 0.5), 0) / 2;
  const odds = Math.max(0.05, Math.min(0.85, 0.3 + rel / 150 + warmth * 0.25 - pride * 0.2 - d.failures * 0.05));
  d.lastTalks = { day: state.day, odds: Math.round(odds * 100) };
  if (nextRandom(state) < odds) {
    // The holder keeps the land and pays the claimant for access, as far as its treasury allows.
    const comp = Math.min(Math.round(landOf(d.id).value * 0.4), Math.max(0, balance(state, KINGDOMS[holder].account) - 500));
    if (comp > 0) transfer(state, KINGDOMS[holder].account, KINGDOMS[claimant].account, comp, 'gift', `${name(holder)} compensated ${name(claimant)} over ${d.name}`);
    settle(state, d, holder, `talks succeeded: ${name(holder)} keeps ${d.name}${comp > 0 ? ` and pays ${name(claimant)} ${comp} coins for rights of way` : ''}`);
    adjustRelation(state, holder, claimant, 6, `a settlement over ${d.name}`);
    return 'settled';
  }
  d.failures++;
  adjustRelation(state, holder, claimant, -3, `failed talks over ${d.name}`);
  log(state, d, `Talks between ${name(holder)} and ${name(claimant)} over ${d.name} failed (${d.failures} time${d.failures > 1 ? 's' : ''}).`, 2);
  if (d.failures >= 2) return considerWar(state, d) ? 'war' : 'failed';
  return 'failed';
}

/** A dispute ends: the border is recognised by treaty and tension falls away. */
export function settle(state, d, controller, how) {
  const before = d.controller;
  d.controller = controller;
  d.status = 'SETTLED';
  d.settledDay = state.day;
  d.tension = 0;
  d.failures = 0;
  const [a, b] = d.claimants;
  if (!hasTreaty(state, a, b, 'border')) signTreaty(state, 'border', a, b);
  log(state, d, `${d.name.charAt(0).toUpperCase() + d.name.slice(1)}: ${how}.${before !== controller ? ` It passes from ${name(before)} to ${name(controller)}.` : ''}`, 3);
  // Whoever holds the land collects the tolls on its road.
  const route = DISPUTED_LANDS.find((l) => l.id === d.id).route;
  ensureDiplomacy(state).territory = { ...(ensureDiplomacy(state).territory ?? {}), [route]: controller };
}
