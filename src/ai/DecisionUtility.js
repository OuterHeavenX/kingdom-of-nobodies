import { TIME, GOODS, FOOD_GOODS, BUILD } from '../core/Config.js';
import { balance } from '../economy/Transactions.js';
import { qty } from '../economy/Inventory.js';
import { businessById, retailPrice } from '../economy/Businesses.js';
import { bestFoodOffer, ownStockFood, isOpenNow, businessLocation, rankSellers } from '../economy/Marketplace.js';
import { openPositions } from '../economy/Employment.js';
import { needsLabour, canPayBuilder, projectById } from '../property/Construction.js';
import { plotById } from '../property/LandRegistry.js';
import { peekRel } from '../citizens/Relationships.js';
import { trait } from './Personality.js';

// Utility scoring. Each generator proposes candidate actions with a numeric
// score and the factors that produced it. The factors are the raw material
// for the explanation shown to the player, so explanations always reflect the
// numbers that actually drove the choice.
//
// Tuning: scores are on a rough 0-100 scale. Needs dominate when urgent,
// work and goals dominate in daytime, social life in the evening.

export const hourOf = (state) => state.minute / 60;
export const isWorkHours = (state) => hourOf(state) >= TIME.workStartHour && hourOf(state) < 15.5;
export const isNight = (state) => hourOf(state) >= TIME.nightStartHour || hourOf(state) < 5.5;

function candidate(kind, score, factors, extra = {}) {
  return { kind, score: Math.round(score * 10) / 10, factors, ...extra };
}

/** Coins the citizen is trying to save, as a 0..1 pressure. */
export function moneyPressure(state, c) {
  const money = balance(state, c.id);
  let p = Math.min(1, (c.plan?.need ?? 0) / 60);
  if (money < 8) p = Math.max(p, 0.6);
  return p * (0.6 + trait(c, 'ambitious') * 0.4 + trait(c, 'greedy') * 0.3);
}

function maxShifts(c) {
  let n = 2;
  if (trait(c, 'hardworking') > 0.5 || (trait(c, 'ambitious') > 0.6 && (c.plan?.need ?? 0) > 0)) n++;
  if (trait(c, 'lazy') > 0.5) n--;
  return n;
}

export function generateCandidates(state, c, plan) {
  const out = [];
  const money = balance(state, c.id);
  const h = hourOf(state);
  const { hunger, energy, social } = c.needs;
  const pressure = moneyPressure(state, c);

  // --- Eating -------------------------------------------------------------
  if (hunger < 72) {
    const urgency = ((100 - hunger) / 100) ** 2 * 140;
    const own = FOOD_GOODS.filter((g) => qty(c.inventory, g) > 0).sort((a, b) => GOODS[b].food - GOODS[a].food)[0];
    if (own) {
      out.push(candidate('eat_own', urgency + 6, [[`hunger is ${hungerWord(hunger)} (fullness ${Math.round(hunger)}%)`, urgency], [`I have ${GOODS[own].label.toLowerCase()} with me`, 6]], { good: own }));
    } else if (ownStockFood(state, c)) {
      const own = ownStockFood(state, c);
      out.push(candidate('eat_stock', urgency + 4, [[`hunger is ${hungerWord(hunger)} (fullness ${Math.round(hunger)}%)`, urgency], [`${own.business.name} has ${GOODS[own.good].label.toLowerCase()} in stock`, 4]], { businessId: own.business.id, good: own.good }));
    } else {
      const offer = bestFoodOffer(state, c);
      if (offer?.pantry) {
        out.push(candidate('buy_food', urgency - 4, [[`hunger is ${hungerWord(hunger)} (fullness ${Math.round(hunger)}%)`, urgency],
          [`no shop has food, but the council pantry sells ${GOODS[offer.good].label.toLowerCase()} for ${offer.price} coins`, 0]], { pantry: true, good: offer.good, price: offer.price }));
      } else if (offer) {
        const thrift = trait(c, 'frugal') * 4 + pressure * 6;
        out.push(candidate('buy_food', urgency - thrift, [[`hunger is ${hungerWord(hunger)} (fullness ${Math.round(hunger)}%)`, urgency],
          [`${offer.business.name} sells ${GOODS[offer.good].label.toLowerCase()} for ${offer.price} coin${offer.price > 1 ? 's' : ''}`, 0],
          ...(thrift > 2 ? [[`I'm careful with money`, -thrift]] : [])], { businessId: offer.business.id, good: offer.good, price: offer.price }));
      } else if (hunger < 45 && state.commons.berries > 2 && h > 5 && h < 20) {
        out.push(candidate('forage', urgency * 0.8, [[`I'm hungry but ${money < 2 ? 'have no money' : 'nobody is selling food'}`, urgency], ['wild berries grow in the forest', 0]], { hungry: true }));
      }
    }
  }

  // --- Sleep and rest ------------------------------------------------------
  if (isNight(state) && energy < 92) {
    const s = 58 + (100 - energy) * 0.4 + trait(c, 'lazy') * 8;
    out.push(candidate('sleep', s, [[`it's ${h >= 12 ? 'late' : 'the middle of the night'}`, 58], [`energy is ${Math.round(energy)}%`, (100 - energy) * 0.4]]));
  } else if (energy < 35) {
    const s = (100 - energy) * 1.05 + trait(c, 'lazy') * 10;
    out.push(candidate('sleep', s, [[`I'm exhausted (energy ${Math.round(energy)}%)`, s]]));
  }

  // --- Work at a job or own business --------------------------------------
  const job = c.employment;
  if (job && isWorkHours(state) && c.shiftsToday < maxShifts(c)) {
    const b = businessById(state, job.businessId);
    if (b && isOpenNow(state, b)) {
      const owner = job.role === 'owner';
      let s = 46 + pressure * 22 + trait(c, 'hardworking') * 12 - trait(c, 'lazy') * 15 + (owner ? 8 : 0) - c.shiftsToday * 7;
      const factors = [];
      if (owner) factors.push([`${b.name} is mine and needs running`, 54]);
      else factors.push([`${b.name} pays me ${job.wage} coins a shift`, 46]);
      if (c.plan?.need > 0) factors.push([`I need ${c.plan.need} more coins to ${lowerFirst(c.plan.goal)}`, pressure * 22]);
      else if (money < 8) factors.push([`I only have ${money} coins`, pressure * 22]);
      if (trait(c, 'hardworking') > 0.4) factors.push(['I like to work hard', trait(c, 'hardworking') * 12]);
      if (c.shiftsToday) factors.push([`already worked ${c.shiftsToday} shift${c.shiftsToday > 1 ? 's' : ''} today`, -c.shiftsToday * 7]);
      out.push(candidate('work', s, factors, { businessId: b.id }));
    }
  }

  // --- Construction work ---------------------------------------------------
  if (isWorkHours(state) && c.shiftsToday < maxShifts(c)) {
    for (const goal of plan.actions.filter((a) => a.kind === 'build')) {
      const p = projectById(state, goal.projectId);
      if (p && needsLabour(state, p)) out.push(candidate('build', goal.score, goal.factors, { projectId: p.id }));
    }
    if (c.profession === 'Builder') {
      for (const p of state.projects) {
        if (p.ownerId === c.id || !needsLabour(state, p) || !canPayBuilder(state, p)) continue;
        const plot = plotById(state, p.plotId);
        const owner = state.citizens.find((o) => o.id === p.ownerId);
        const friend = owner ? (peekRel(state, c.id, owner.id)?.friendship ?? 20) * 0.1 : 3;
        const s = 50 + (c.skills.building ?? 0) * 10 + trait(c, 'creative') * 6 + friend + pressure * 10 - c.shiftsToday * 6;
        out.push(candidate('build', s, [[`${owner ? owner.firstName + "'s" : 'the council\'s'} site on ${plot.name} needs hands at the ${p.stage.toLowerCase()} stage`, 50],
          [`it pays ${BUILD.builderWage} coins a shift`, pressure * 10], ...(trait(c, 'creative') > 0.4 ? [['I love shaping the village', trait(c, 'creative') * 6]] : [])], { projectId: p.id }));
      }
    }
  }

  // --- Job search ----------------------------------------------------------
  const selfEmployed = c.profession === 'Builder' || c.profession === 'Forager';
  if (!job && isWorkHours(state) && (!selfEmployed || money < 6)) {
    const pos = openPositions(state, c).filter((p) => !(c.rejectedBy?.[p.business.id] > state.day - 3))[0];
    if (pos) {
      const s = 56 + pressure * 15;
      out.push(candidate('seek_job', s, [[`I have no job and ${pos.business.name} is hiring`, 56], [`it would pay about ${pos.wage} coins a shift`, pressure * 15]], { businessId: pos.business.id }));
    }
  }

  // --- Foraging ------------------------------------------------------------
  const carrying = qty(c.inventory, 'berries');
  if (isWorkHours(state) && state.commons.berries > 4 && c.shiftsToday < maxShifts(c) && carrying < 14 && !out.some((o) => o.kind === 'forage')) {
    const forager = c.profession === 'Forager';
    const s = 20 + (job ? 0 : 22) + (c.skills.foraging ?? 0) * 25 + (forager ? 16 : 0) + pressure * 10 + trait(c, 'curious') * 5 - c.shiftsToday * 6 - carrying * 1.5;
    out.push(candidate('forage', s, [[forager ? 'foraging is my trade' : job ? 'the forest could earn me a little extra' : 'I have no job, but the forest provides', 20 + (job ? 0 : 22) + (forager ? 16 : 0)],
      [`berries in the woods: ${Math.round(state.commons.berries)}`, 0]]));
  }

  // --- Selling gathered goods ---------------------------------------------
  const sellable = ['berries', 'timber'].find((g) => qty(c.inventory, g) >= (g === 'berries' ? 5 : 1));
  if (sellable && h >= TIME.shopOpenHour && h < TIME.shopCloseHour - 1) {
    out.push(candidate('sell_goods', 52 + pressure * 10 + qty(c.inventory, sellable) * 1.5, [[`I'm carrying ${qty(c.inventory, sellable)} ${GOODS[sellable].label.toLowerCase()} to sell`, 52]], { good: sellable }));
  }

  // --- Social life ---------------------------------------------------------
  if (social < 70 && !isNight(state)) {
    const evening = h >= 17 ? 10 : 0;
    const s = (100 - social) * 0.7 + trait(c, 'friendly') * 15 - trait(c, 'shy') * 10 + evening;
    const partnerId = c.romance.partnerId ?? c.romance.courtingId;
    const tavern = state.businesses.find((b) => b.type === 'tavern' && isOpenNow(state, b) && qty(b.inventory, 'meal') > 0 && b.ownerId !== c.id);
    if (tavern && h >= 16 && money >= retailPrice(tavern, 'meal') + 2) {
      out.push(candidate('tavern', s + 6, [[`I'm lonely (social ${Math.round(social)}%)`, s - evening], ['an evening at the tavern sounds good', 6 + evening]], { businessId: tavern.id }));
    }
    const target = partnerId ? state.citizens.find((o) => o.id === partnerId) : bestCompanion(state, c);
    out.push(candidate('socialize', s, [[`I'm lonely (social ${Math.round(social)}%)`, s - evening],
      ...(target ? [[partnerId ? `I want to see ${target.firstName}` : `${target.firstName} is good company`, 0]] : []),
      ...(evening ? [['evenings are for company', evening]] : [])], { citizenId: target?.id ?? null }));
  }

  // --- Helping others ------------------------------------------------------
  const generous = trait(c, 'generous');
  if (generous > 0.3 && money >= 22 && !isNight(state)) {
    const needy = state.citizens.filter((o) => o.id !== c.id && balance(state, o.id) < 4 && o.needs.hunger < 45)
      .sort((a, b) => (peekRel(state, c.id, b.id)?.friendship ?? 0) - (peekRel(state, c.id, a.id)?.friendship ?? 0))[0];
    if (needy) {
      const s = 32 + generous * 40;
      out.push(candidate('help', s, [[`${needy.firstName} is hungry and nearly penniless`, 32], ['I believe in helping neighbours', generous * 40]], { citizenId: needy.id }));
    }
  }

  // --- Festival ------------------------------------------------------------
  if (state.council.festivalUntil > state.tick && !isNight(state)) {
    out.push(candidate('festival', 72 + trait(c, 'friendly') * 10, [['the council is hosting a festival in the square', 72]]));
  }

  // --- Goals (buying property, starting construction) ---------------------
  for (const a of plan.actions) {
    if (a.kind === 'build') continue;
    if (a.kind === 'buy_plot' && !(h >= 7 && h < 18)) continue;
    out.push(candidate(a.kind, a.score, a.factors, a));
  }

  // --- Low-key options -----------------------------------------------------
  if (!isNight(state)) {
    out.push(candidate('explore', 8 + trait(c, 'curious') * 18, [['nothing pressing, so I can wander', 8], ...(trait(c, 'curious') > 0.4 ? [['I am curious about everything', trait(c, 'curious') * 18]] : [])]));
  }
  out.push(candidate('idle', 4, [['taking a moment', 4]]));
  return out;
}

function bestCompanion(state, c) {
  let best = null, bestScore = -1;
  for (const o of state.citizens) {
    if (o.id === c.id || o.activity?.kind === 'sleep') continue;
    const r = peekRel(state, c.id, o.id);
    const s = (r?.friendship ?? 15) + (r?.affection ?? 0) * 0.5 - (r?.rivalry ?? 0) - Math.hypot(o.x - c.x, o.z - c.z) * 0.3;
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return best;
}

const hungerWord = (h) => (h < 15 ? 'desperate' : h < 30 ? 'pressing' : h < 50 ? 'growing' : 'mild');
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Build a first-person explanation from the factors that produced the winning score. */
export function explain(chosen) {
  const parts = chosen.factors.filter(([, w]) => w >= 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  const against = chosen.factors.filter(([, w]) => w < 0).map(([t]) => t);
  let text = parts.length ? capitalise(parts.join(', and ')) : 'It seemed right';
  if (against.length) text += ` (even though ${against.join(', ')})`;
  return text + '.';
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export { rankSellers, businessLocation };
