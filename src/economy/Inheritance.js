import { noteEstateDispute } from '../law/Courts.js';
import { byId } from '../core/EntityRegistry.js';
import { transfer, balance } from './Transactions.js';
import { qty, moveGoods } from './Inventory.js';
import { businessById, isTrading } from './Businesses.js';
import { closeBusiness } from './EconomyManager.js';
import { leaveJob } from './Employment.js';
import { listForSale } from '../property/Ownership.js';
import { plotById, plotHistory } from '../property/LandRegistry.js';
import { skillFor, PROFESSION_FOR_BUSINESS } from '../citizens/Careers.js';
import { ageOf, achieve } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { LIFE } from '../core/Config.js';

// Estates. When a citizen dies (or retires from a business) their assets pass
// to heirs through ordinary transfers, so no coin or title is ever created or
// duplicated. Order of succession: spouse and children; then parents; then
// siblings; otherwise the estate is unclaimed and passes to the council.

const living = (state, id) => state.citizens.find((c) => c.id === id && c.alive !== false) ?? null;

export function heirsOf(state, c) {
  const spouse = living(state, c.family.spouseId);
  const children = c.family.childIds.map((id) => living(state, id)).filter(Boolean).sort((a, b) => a.birthDay - b.birthDay);
  if (spouse || children.length) return { tier: 'family', spouse, children };
  const parents = c.family.parentIds.map((id) => living(state, id)).filter(Boolean);
  if (parents.length) return { tier: 'parents', spouse: null, children: parents };
  const siblings = state.citizens.filter((o) => o.id !== c.id && o.family.parentIds.some((p) => c.family.parentIds.includes(p)));
  if (siblings.length) return { tier: 'siblings', spouse: null, children: siblings };
  return { tier: 'none', spouse: null, children: [] };
}

/** How willing and able someone is to run an inherited business (0-100). */
export function successionScore(state, heir, b) {
  if (ageOf(state, heir) < LIFE.adultAge) return -1;
  let s = skillFor(heir, b.type) * 50 + trait(heir, 'ambitious') * 20 + trait(heir, 'hardworking') * 10 + trait(heir, 'loyal') * 10;
  if (b.employees.includes(heir.id)) s += 20;
  if (heir.employment?.role === 'owner') s -= 25; // already runs a business
  if (heir.retired) s -= 40;
  return s;
}

/** Choose who takes over a business. Returns { heir, outcome: 'successor'|'trust'|'sell' }. */
export function chooseSuccessor(state, b, candidates) {
  const adults = candidates.filter((h) => ageOf(state, h) >= LIFE.adultAge && h.id !== b.ownerId)
    .map((h) => ({ h, s: successionScore(state, h, b) })).sort((x, y) => y.s - x.s);
  if (adults.length && adults[0].s >= 22) return { heir: adults[0].h, outcome: 'successor' };
  const minors = candidates.filter((h) => ageOf(state, h) < LIFE.adultAge);
  if (minors.length && b.employees.length) return { heir: minors.sort((a, z) => a.birthDay - z.birthDay)[0], outcome: 'trust' };
  if (adults.length) return { heir: adults[0].h, outcome: 'sell' };
  return { heir: null, outcome: 'sell' };
}

/** Hand a business to a new owner (inheritance or retirement). */
export function transferBusiness(state, b, from, to, outcome, why) {
  b.ownerId = to.id;
  b.inTrust = outcome === 'trust';
  b.trusteeId = outcome === 'trust' ? (to.family.guardianId ?? null) : null;
  const plot = plotById(state, b.plotId);
  if (plot) {
    plot.ownerId = to.id;
    // Any expansion or repair under way on the premises continues under the new owner.
    const project = plot.projectId ? state.projects.find((j) => j.id === plot.projectId) : null;
    if (project) project.ownerId = to.id;
    plotHistory(state, plot, `${b.name} passed to ${to.firstName} (${why}).`);
  }
  if (outcome === 'successor') {
    if (to.employment && to.employment.businessId !== b.id) leaveJob(state, to, `took over ${b.name}`);
    if (to.employment?.businessId === b.id) b.employees = b.employees.filter((id) => id !== to.id);
    to.employment = { businessId: b.id, role: 'owner', wage: 0, since: state.day, unpaid: 0 };
    to.employmentHistory.push({ businessId: b.id, name: b.name, from: state.day, to: null, role: 'owner' });
    to.profession = PROFESSION_FOR_BUSINESS[b.type] ?? to.profession;
    if (to.venture && !to.venture.businessId && to.dream.businessType === b.type) to.venture.businessId = b.id;
    achieve(state, to, 'inherited_business', `Took over ${b.name} from ${from.firstName}`, { business: b.id });
    remember(state, to, `Took over ${b.name} from ${from.firstName}.`, 3, 'career');
  }
  record(state, 'business', outcome === 'trust'
    ? `${b.name} passed to young ${to.firstName}, held in trust until they come of age.`
    : `${to.firstName} took over ${b.name} from ${from.firstName} (${why}).`, { citizens: [from.id, to.id], business: b.id, plot: b.plotId }, 3);
}

/**
 * Settle a deceased citizen's estate exactly once. Businesses are resolved
 * first (closing one returns its cash to the estate), then coins, goods and
 * land are divided. Returns the estate record.
 */
export function settleEstate(state, c) {
  if (c.estateId) return state.estates.find((e) => e.id === c.estateId) ?? null;
  const estate = { id: 'e' + (state.estates.length + 1), deceasedId: c.id, day: state.day, coins: 0, heirs: [], businesses: [], plots: [], status: 'settled' };
  c.estateId = estate.id;
  state.estates.push(estate);
  if (state.estates.length > 400) state.estates.splice(0, state.estates.length - 400);
  const { tier, spouse, children } = heirsOf(state, c);
  const family = [spouse, ...children].filter(Boolean);

  for (const b of state.businesses.filter((x) => x.ownerId === c.id && isTrading(x))) {
    const { heir, outcome } = tier === 'none' ? { heir: null, outcome: 'sell' } : chooseSuccessor(state, b, family);
    if (heir && outcome !== 'sell') {
      transferBusiness(state, b, c, heir, outcome, 'inheritance');
      if (outcome === 'trust') estate.status = 'trust';
      estate.businesses.push({ id: b.id, to: heir.id, outcome });
    } else {
      closeBusiness(state, b, 'CLOSED');
      record(state, 'business', `${b.name} closed after ${c.firstName}'s death; ${heir ? `${heir.firstName} chose to sell rather than run it` : 'no heir could take it on'}.`, { citizens: [c.id], business: b.id }, 2);
      estate.businesses.push({ id: b.id, to: null, outcome: 'closed' });
    }
  }

  const coins = balance(state, c.id);
  estate.coins = coins;
  const primary = spouse ?? children.find((h) => ageOf(state, h) >= LIFE.adultAge) ?? children[0] ?? null;
  if (coins > 0) {
    if (tier === 'none') transfer(state, c.id, 'treasury', coins, 'inheritance', `Unclaimed estate of ${c.firstName}`);
    else {
      const shares = [];
      if (spouse && children.length) {
        const half = Math.floor(coins / 2);
        shares.push([spouse, coins - half]);
        const each = Math.floor(half / children.length);
        children.forEach((h, i) => shares.push([h, each + (i === 0 ? half - each * children.length : 0)]));
      } else {
        const each = Math.floor(coins / family.length);
        family.forEach((h, i) => shares.push([h, each + (i === 0 ? coins - each * family.length : 0)]));
      }
      for (const [h, amount] of shares) {
        if (amount > 0 && transfer(state, c.id, h.id, amount, 'inheritance', `Inheritance from ${c.firstName}`)) estate.heirs.push({ id: h.id, coins: amount });
      }
    }
  }
  for (const [good, n] of Object.entries({ ...c.inventory })) {
    if (primary) moveGoods(c.inventory, primary.inventory, good, n);
    else moveGoods(c.inventory, state.council.pantry, good, qty(c.inventory, good));
  }
  for (const p of state.plots.filter((x) => x.ownerId === c.id)) {
    const heir = p.id === c.homePlotId && spouse ? spouse : primary;
    const project = p.projectId ? state.projects.find((j) => j.id === p.projectId) : null;
    if (project) project.ownerId = heir ? heir.id : 'council';
    if (heir) {
      p.ownerId = heir.id;
      p.reservedBy = null;
      plotHistory(state, p, `Inherited by ${heir.firstName} from ${c.firstName}.`);
      estate.plots.push({ id: p.id, to: heir.id });
    } else {
      p.ownerId = 'council';
      listForSale(state, p.id);
      plotHistory(state, p, `Passed to the council as part of ${c.firstName}'s unclaimed estate.`);
      estate.plots.push({ id: p.id, to: 'council' });
    }
  }
  // Children left with nothing while one heir took several plots may go to court.
  const landed = new Set(estate.plots.map((p) => p.to));
  const main = estate.plots.length >= 2 && landed.size === 1 ? byId(state.citizens, [...landed][0]) : null;
  if (main) for (const sib of children.filter((h) => h !== main && ageOf(state, h) >= LIFE.adultAge)) {
    if (trait(sib, 'greedy') + trait(sib, 'jealous') + trait(sib, 'stubborn') > 0.6) noteEstateDispute(state, estate, sib, main);
  }
  if (estate.heirs.length || estate.plots.length || estate.businesses.length) {
    const names = [...new Set([...estate.heirs.map((h) => h.id), ...estate.plots.map((p) => p.to), ...estate.businesses.map((b) => b.to)])]
      .filter(Boolean).map((id) => (id === 'council' ? 'the council' : byId(state.citizens, id)?.firstName)).filter(Boolean);
    record(state, 'economy', `${c.firstName}'s estate (${coins} coins${estate.plots.length ? `, ${estate.plots.length} propert${estate.plots.length === 1 ? 'y' : 'ies'}` : ''}) passed to ${names.join(', ') || 'the council'}.`,
      { citizens: [c.id, ...estate.heirs.map((h) => h.id)] }, 2);
  }
  return estate;
}

/** A minor heir comes of age: take over the business held in trust, or sell it. */
export function resolveTrusts(state, c) {
  for (const b of state.businesses.filter((x) => x.ownerId === c.id && x.inTrust && isTrading(x))) {
    b.inTrust = false;
    if (successionScore(state, c, b) >= 22) transferBusiness(state, b, c, c, 'successor', 'came of age');
    else {
      closeBusiness(state, b, 'CLOSED');
      record(state, 'business', `${c.firstName} came of age and chose to sell ${b.name} rather than run it.`, { citizens: [c.id], business: b.id }, 2);
    }
  }
}
