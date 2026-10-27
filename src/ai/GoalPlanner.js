import { byId } from '../core/EntityRegistry.js';
import { ECONOMY } from '../core/Config.js';
import { spendable } from '../finance/BankAccounts.js';
import { BUSINESS_TYPES, businessById, isTrading, workingCapital, maxOpenOfType } from '../economy/Businesses.js';
import { plotById, plotsForSale, buildingClass, BUILDING_INFO, bedsAt } from '../property/LandRegistry.js';
import { projectById, estimateMaterialsCost, canStart } from '../property/Construction.js';
import { ownedPlots } from '../property/Ownership.js';
import { trait } from './Personality.js';
import { remember } from './MemorySystem.js';

// Turns a citizen's long-term dream into concrete steps and, when a step is
// actionable right now, into candidate actions for the decision system.
// Plans are recomputed from live state on every decision, so they adapt
// automatically when a job is lost, a plot is sold to someone else, etc.

export const DREAM_TYPES = {
  business: (d) => `Open a ${BUSINESS_TYPES[d.businessType].label.toLowerCase()}`,
  homestead: () => 'Build a home and own land',
  master_builder: () => 'Become a master builder',
  wealth: (d) => `Save ${d.target} coins`,
  partner: () => 'Find a life partner',
  respected: () => 'Be respected by everyone',
};

const step = (label, done) => ({ label, done: !!done });

export function planFor(state, c) {
  const d = c.dream;
  let plan = PLANNERS[d.type]?.(state, c, d) ?? { steps: [], goal: 'Living day to day', need: 0, actions: [] };
  // A family without a home of its own puts that first, whatever the long-term dream.
  if (d.type !== 'homestead' && needsFamilyHome(state, c)) {
    const home = PLANNERS.homestead(state, c);
    if (home.actions.length || home.need > 0) plan = { ...home, goal: `Find a home for the family (${home.goal.toLowerCase()})`, dreamPlan: plan };
  }
  const firstOpen = plan.steps.find((s) => !s.done);
  plan.goal = plan.goal ?? firstOpen?.label ?? 'Dream achieved';
  plan.next = firstOpen?.label ?? 'Enjoy what I have built';
  c.plan = { goal: plan.goal, next: plan.next, need: plan.need, steps: plan.steps };
  return plan;
}

const hasEarned = (c) => c.employment || c.stats.earned > 0;

function needsFamilyHome(state, c) {
  if (!c.family.spouseId && !state.citizens.some((k) => k.family.guardianId === c.id || (k.family.parentIds.includes(c.id) && k.birthDay > state.day - 18 * 12))) return false;
  const home = plotById(state, c.homePlotId);
  return !home || home.building?.type !== 'cottage' || (home.ownerId !== c.id && home.ownerId !== c.family.spouseId && home.ownerId !== 'council');
}

/** Cheapest way to get premises for a business type: buy and refit an empty building, or buy land and build. */
function premisesOptions(state, c, type) {
  const wantClass = buildingClass(BUSINESS_TYPES[type].building);
  const options = [];
  for (const p of plotsForSale(state, BUSINESS_TYPES[type].building, c.id)) {
    if (p.businessId) continue;
    let kind = 'construction';
    if (p.building) {
      if (p.building.type === BUSINESS_TYPES[type].building) kind = 'reopen';
      else if (buildingClass(p.building.type) === wantClass) kind = 'refit';
      else kind = 'demolish';
    }
    const works = kind === 'reopen' ? 0 : kind === 'refit' ? estimateMaterialsCost(state, 'refit') : estimateMaterialsCost(state, 'construction') + (kind === 'demolish' ? 6 : 0);
    options.push({ plot: p, kind, cost: p.price + works });
  }
  return options.sort((a, b) => a.cost - b.cost);
}

const PLANNERS = {
  business(state, c, d) {
    const type = d.businessType;
    const label = BUSINESS_TYPES[type].label.toLowerCase();
    const v = c.venture ?? (c.venture = {});
    const money = spendable(state, c.id);
    const actions = [];
    const b = v.businessId ? businessById(state, v.businessId) : null;
    if (b && isTrading(b)) {
      const profitable = b.totals.revenue > b.totals.expenses;
      return {
        goal: !profitable ? `Make ${b.name} profitable` : b.employees.length ? `Grow ${b.name}` : `Hire help at ${b.name}`,
        need: 0,
        steps: [step('Find employment', true), step('Save money', true), step('Acquire premises', true), step(`Build the ${label}`, true),
          step('Open for business', true), step('Earn a profit', profitable), step('Expand: hire workers', b.employees.length > 0)],
        actions,
      };
    }
    if (v.failedDay && state.day - v.failedDay < 10) {
      return { goal: 'Recover from the failed business', need: 20, steps: [step('Find work again', c.employment), step('Rebuild savings', money > 30)], actions };
    }
    const project = v.projectId ? projectById(state, v.projectId) : null;
    if (v.projectId && !project) v.projectId = null;
    const ownPlot = v.plotId ? plotById(state, v.plotId) : null;
    // Never treat one's own home as a business site.
    if (ownPlot && (ownPlot.ownerId !== c.id || ownPlot.id === c.homePlotId || ownPlot.building?.type === 'cottage')) { v.plotId = null; }
    const saturated = state.businesses.filter((x) => x.type === type && isTrading(x)).length >= maxOpenOfType(state);
    const steps = [step('Find employment', hasEarned(c))];
    if (project) {
      const what = project.kind === 'demolition' ? 'Clear the old building' : `Build the ${label}`;
      steps.push(step('Save money', true), step('Acquire premises', true), step(what, false), step('Open for business', false));
      actions.push({ kind: 'build', projectId: project.id, score: 62 + trait(c, 'ambitious') * 15, factors: [[`my ${project.kind === 'demolition' ? 'demolition' : label} site needs work (${project.stage.toLowerCase()})`, 30]] });
      const short = project.waiting ? Math.max(0, 16 - money) : 0;
      return { goal: project.waiting ? `Earn money for timber (${what.toLowerCase()})` : what, need: short, steps, actions };
    }
    if (ownPlot && v.plotId) {
      steps.push(step('Save money', true), step('Acquire premises', true));
      let kind = 'construction';
      if (ownPlot.building) {
        if (ownPlot.building.type === BUSINESS_TYPES[type].building) kind = 'reopen';
        else if (buildingClass(ownPlot.building.type) === buildingClass(BUSINESS_TYPES[type].building)) kind = 'refit';
        else kind = 'demolition';
      }
      const blocked = kind !== 'reopen' && canStart(state, ownPlot, c.id, kind, kind === 'demolition' ? null : BUSINESS_TYPES[type].building);
      // Work starts only with half the business's working capital put by (opening draws the
      // rest from savings, and a building still to be raised gives time to earn it). Holding out
      // for all of it kept the first shops shut and the council paying idle hands in year one.
      // A risk-taker starts a little leaner.
      const capital = workingCapital(type);
      const upFront = Math.ceil(capital / 2);
      const ready = upFront - Math.round(Math.max(0, trait(c, 'riskTaking')) * upFront * 0.25);
      steps.push(step(`Save ${ready} coins of working capital (have ${money})`, money >= ready));
      steps.push(step(kind === 'reopen' ? `Reopen the ${label}` : kind === 'demolition' ? 'Demolish the old building' : `Build the ${label}`, false));
      if (!blocked && money >= ready) actions.push({ kind: 'start_project', plotId: ownPlot.id, projectKind: kind, businessType: type, score: 78, factors: [[`I own ${ownPlot.name} and have the working capital to start`, 40]] });
      const goal = blocked ? `Wait to start work on ${ownPlot.name} (${blocked})` : money < ready ? `Save working capital for ${ownPlot.name}` : steps.at(-1).label;
      return { goal, need: Math.max(0, ready - money), steps, actions };
    }
    if (saturated) {
      steps.push(step(`Wait for room in the market (${maxOpenOfType(state)} ${label}s already)`, false));
      return { goal: 'Keep working while the market is crowded', need: 0, steps, actions };
    }
    const options = premisesOptions(state, c, type);
    const best = options[0];
    // Enough for the premises and a little over; the working capital is saved once the land is
    // owned, before work starts (see above), so buying land is not put off for it.
    const required = best ? best.cost + ECONOMY.startingCapital - Math.round(trait(c, 'riskTaking') * 12) : 999;
    steps.push(step(best ? `Save ${required} coins (have ${money})` : 'Find available land', money >= required));
    steps.push(step('Acquire premises', false), step(`Build the ${label}`, false), step('Open for business', false));
    if (best && money >= required) {
      actions.push({ kind: 'buy_plot', plotId: best.plot.id, score: 80 + trait(c, 'riskTaking') * 10, factors: [[`I have ${money} coins, enough for ${best.plot.name} (${best.plot.price}) plus ${best.kind === 'reopen' ? 'opening costs' : 'materials'}`, 40]] });
    }
    return { goal: best ? (money >= required ? `Buy ${best.plot.name}` : `Save for ${best.plot.name}`) : 'Find available land', need: Math.max(0, required - money), steps, actions, target: best?.plot };
  },

  homestead(state, c) {
    const money = spendable(state, c.id);
    const home = c.homePlotId ? plotById(state, c.homePlotId) : null;
    const ownsHome = home && home.ownerId === c.id && home.building?.type === 'cottage';
    const owned = ownedPlots(state, c.id);
    const v = c.homeVenture ?? (c.homeVenture = {});
    const project = v.projectId ? projectById(state, v.projectId) : null;
    if (v.projectId && !project) v.projectId = null;
    const steps = [step('Earn a living', hasEarned(c))];
    const actions = [];
    if (!ownsHome) {
      if (project) {
        steps.push(step('Save for land and timber', true), step('Buy a residential plot', true), step('Build a cottage', false));
        actions.push({ kind: 'build', projectId: project.id, score: 58, factors: [['my cottage needs building', 25]] });
        return { goal: project.waiting ? 'Earn money for timber' : 'Build my cottage', need: project.waiting ? Math.max(0, 16 - money) : 0, steps, actions };
      }
      const myLand = owned.find((p) => p.landType === 'residential' && !p.building && !p.projectId);
      if (myLand) {
        steps.push(step('Save for land and timber', true), step('Buy a residential plot', true), step('Build a cottage', false));
        if (!canStart(state, myLand, c.id, 'construction', 'cottage')) actions.push({ kind: 'start_project', plotId: myLand.id, projectKind: 'construction', home: true, score: 72, factors: [[`I own ${myLand.name} and can start my cottage`, 35]] });
        return { goal: 'Start building my cottage', need: 0, steps, actions };
      }
      // A finished cottage on the market (often built by a developer) can be bought outright.
      const forSale = plotsForSale(state, 'cottage', c.id);
      const house = forSale.filter((p) => p.building?.type === 'cottage' && p.constructionStatus === 'COMPLETE' && !p.residents.length && !p.businessId)[0];
      if (house && money >= house.price) {
        steps.push(step(`Buy the cottage on ${house.name} (${house.price} coins)`, false));
        actions.push({ kind: 'buy_plot', plotId: house.id, home: true, moveIn: true, score: 76, factors: [[`a finished cottage on ${house.name} is for sale at ${house.price}, and I can pay`, 38]] });
        return { goal: `Buy the cottage on ${house.name}`, need: 0, steps, actions, target: house };
      }
      const land = forSale.filter((p) => !p.building)[0];
      const required = land ? land.price + estimateMaterialsCost(state, 'construction') + 8 : 999;
      steps.push(step(`Save ${required} coins for land and timber (have ${money})`, money >= required), step('Buy a residential plot', false), step('Build a cottage', false));
      if (land && money >= required) actions.push({ kind: 'buy_plot', plotId: land.id, home: true, score: 74, factors: [[`I can afford ${land.name} (${land.price}) and the timber`, 35]] });
      return { goal: land ? `Save for ${land.name}` : 'Wait for land to come up', need: Math.max(0, required - money), steps, actions };
    }
    steps.push(step('Build a cottage', true), step('Own a second property', owned.length >= 2 || owned.some((p) => p.businessId)));
    // A growing family enlarges the cottage into a house.
    const crowded = home.residents.length >= bedsAt(state, home) - 1 && (home.building.level ?? 1) < 2 && !home.projectId;
    if (crowded && money >= 45 && !canStart(state, home, c.id, 'upgrade')) {
      actions.push({ kind: 'start_project', plotId: home.id, projectKind: 'upgrade', score: 64, factors: [['our cottage is too small for the family', 30]] });
    }
    return { goal: owned.length >= 2 ? 'Enjoy the homestead' : 'Tend the homestead', need: 0, steps, actions };
  },

  master_builder(state, c, d) {
    const built = c.stats.buildingsCompleted;
    return {
      goal: built >= d.target ? 'Keep the village beautiful' : `Help raise ${d.target - built} more building${d.target - built === 1 ? '' : 's'}`,
      need: 0,
      steps: [step('Work as a builder', c.stats.shiftsWorked > 0), step(`Complete ${d.target} buildings (${built})`, built >= d.target), step('Earn the respect of the village', c.reputation.competence >= 70)],
      actions: [],
    };
  },

  wealth(state, c, d) {
    const money = spendable(state, c.id);
    return {
      goal: money >= d.target ? 'Enjoy my savings' : `Save ${d.target - money} more coins`,
      need: Math.max(0, d.target - money),
      steps: [step('Earn a living', hasEarned(c)), step(`Save ${Math.round(d.target / 2)} coins`, money >= d.target / 2), step(`Save ${d.target} coins`, money >= d.target)],
      actions: [],
    };
  },

  partner(state, c) {
    const partner = byId(state.citizens, c.romance.partnerId);
    const courting = byId(state.citizens, c.romance.courtingId);
    return {
      goal: partner ? `Build a life with ${partner.firstName}` : courting ? `Win ${courting.firstName}'s heart` : 'Meet someone special',
      need: 0,
      steps: [step('Make friends', (c.social?.bestFriendship ?? 0) > 50),
        step('Start courting', courting || partner), step('Become partners', partner)],
      actions: [],
    };
  },

  growing(state, c) {
    const age = Math.floor((state.day - c.birthDay) / 12);
    return {
      goal: age < 13 ? 'Learn and play' : c.education.masterId ? `Learn ${c.education.trade === 'trade' ? 'trading' : c.education.trade}` : 'Find a trade to learn',
      need: 0,
      steps: [step('Learn my letters', c.education.level > 0.3), step('Choose a trade', !!c.education.trade), step('Find a master', !!c.education.masterId), step('Come of age', age >= 18)],
      actions: [],
    };
  },

  respected(state, c) {
    return {
      goal: c.reputation.standing >= 75 ? 'Remain a pillar of the village' : 'Earn the village\'s respect',
      need: 0,
      steps: [step('Help neighbours in need', c.stats.gifts >= 2), step('Reach high standing (75)', c.reputation.standing >= 75)],
      actions: [],
    };
  },
};

/** Called when a citizen completes their dream: remember it and set a follow-up ambition. */
export function checkDreamFulfilled(state, c) {
  const done = c.plan.steps.length && c.plan.steps.every((s) => s.done);
  if (done && !c.dream.fulfilledDay) {
    c.dream.fulfilledDay = state.day;
    remember(state, c, `Fulfilled my dream: ${c.dream.text}.`, 3, 'milestone');
    c.mood = Math.min(100, c.mood + 20);
    return true;
  }
  return false;
}

export function describeBuildingPlan(kind, type) {
  return kind === 'refit' ? `Refit as ${BUILDING_INFO[type].label}` : `Build ${BUILDING_INFO[type].label}`;
}
