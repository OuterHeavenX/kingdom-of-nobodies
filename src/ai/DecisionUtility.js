import { byId } from '../core/EntityRegistry.js';
import { TIME, GOODS, FOOD_GOODS, BUILD, LIFE } from '../core/Config.js';
import { ageOf } from '../citizens/Citizen.js';
import { stageForAge } from '../core/Calendar.js';
import { guardianOf } from '../citizens/Families.js';
import { schoolOpen } from '../education/Education.js';
import { isCandidate, electionToday, currentLeader } from '../politics/Government.js';
import { balance } from '../economy/Transactions.js';
import { qty } from '../economy/Inventory.js';
import { businessById, retailPrice } from '../economy/Businesses.js';
import { bestFoodOffer, ownStockFood, isOpenNow, businessLocation, rankSellers } from '../economy/Marketplace.js';
import { openPositions } from '../economy/Employment.js';
import { needsLabour, canPayBuilder, projectById } from '../property/Construction.js';
import { plotById } from '../property/LandRegistry.js';
import { peekRel, attracted } from '../citizens/Relationships.js';
import { pairHash } from '../core/Random.js';
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
  const age = ageOf(state, c);
  const stage = stageForAge(age).id;
  if (stage === 'infant') return [candidate('cradle', 100, [['I am a baby and my family looks after me', 100]])];
  const minor = age < LIFE.adultAge;
  const guardian = minor ? guardianOf(state, c) : null;
  const payer = minor ? guardian?.id ?? 'treasury' : c.id; // the council pays for its wards
  const money = payer ? balance(state, payer) : 0;
  const h = hourOf(state);
  const { hunger, energy, social } = c.needs;
  const pressure = minor ? 0 : moneyPressure(state, c);
  const sick = c.health.sickUntil > state.day;
  if (sick) out.push(candidate('rest_sick', 90 - Math.max(0, 40 - hunger), [['I am ill and need to rest', 90]]));

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
      const offer = payer ? bestFoodOffer(state, c, payer) : null;
      if (offer?.pantry) {
        out.push(candidate('buy_food', urgency - 4, [[`hunger is ${hungerWord(hunger)} (fullness ${Math.round(hunger)}%)`, urgency],
          [offer.relief ? `I have no money, but the council pantry feeds the hungry` : `no shop has food I can afford, but the council pantry sells ${GOODS[offer.good].label.toLowerCase()} for ${offer.price} coins`, 0]],
          { pantry: true, relief: !!offer.relief, good: offer.good, price: offer.price, payer }));
      } else if (offer) {
        const thrift = trait(c, 'frugal') * 4 + pressure * 6;
        out.push(candidate('buy_food', urgency - thrift, [[`hunger is ${hungerWord(hunger)} (fullness ${Math.round(hunger)}%)`, urgency],
          [`${offer.business.name} sells ${GOODS[offer.good].label.toLowerCase()} for ${offer.price} coin${offer.price > 1 ? 's' : ''}`, 0],
          ...(thrift > 2 ? [[`I'm careful with money`, -thrift]] : [])], { businessId: offer.business.id, good: offer.good, price: offer.price, payer }));
      } else if (hunger < 50 && age >= 8 && state.commons.berries > 2 && h > 5 && h < 20) {
        out.push(candidate('forage', urgency * 0.95, [[`I'm hungry but ${money < 2 ? 'have no money' : 'nobody is selling food'}`, urgency], ['wild berries grow in the forest', 0]], { hungry: true }));
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
  if (job && !minor && !sick && isWorkHours(state) && c.shiftsToday < maxShifts(c)) {
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
  const mayBuild = !sick && (!minor || (c.education.trade === 'building' && age >= LIFE.apprenticeAge));
  if (mayBuild && isWorkHours(state) && c.shiftsToday < maxShifts(c)) {
    for (const goal of plan.actions.filter((a) => a.kind === 'build')) {
      const p = projectById(state, goal.projectId);
      if (p && needsLabour(state, p)) out.push(candidate('build', goal.score, goal.factors, { projectId: p.id }));
    }
    if (c.profession === 'Builder' || (minor && c.education.trade === 'building')) {
      for (const p of state.projects) {
        if (p.ownerId === c.id || !needsLabour(state, p) || !canPayBuilder(state, p)) continue;
        const plot = plotById(state, p.plotId);
        const owner = byId(state.citizens, p.ownerId);
        const friend = owner ? (peekRel(state, c.id, owner.id)?.friendship ?? 20) * 0.1 : 3;
        const s = 50 + (c.skills.building ?? 0) * 10 + trait(c, 'creative') * 6 + friend + pressure * 10 - c.shiftsToday * 6;
        out.push(candidate('build', s, [[`${owner ? owner.firstName + "'s" : 'the council\'s'} site on ${plot.name} needs hands at the ${p.stage.toLowerCase()} stage`, 50],
          [`it pays ${BUILD.builderWage} coins a shift`, pressure * 10], ...(trait(c, 'creative') > 0.4 ? [['I love shaping the village', trait(c, 'creative') * 6]] : [])], { projectId: p.id }));
      }
    }
  }

  // --- Job search ----------------------------------------------------------
  const selfEmployed = c.profession === 'Builder' || c.profession === 'Forager';
  if (!job && !minor && !c.retired && !sick && isWorkHours(state) && (!selfEmployed || money < 6)) {
    const pos = openPositions(state, c).filter((p) => !(c.rejectedBy?.[p.business.id] > state.day - 3))[0];
    if (pos) {
      const s = 56 + pressure * 15;
      out.push(candidate('seek_job', s, [[`I have no job and ${pos.business.name} is hiring`, 56], [`it would pay about ${pos.wage} coins a shift`, pressure * 15]], { businessId: pos.business.id }));
    }
  }

  // --- Foraging ------------------------------------------------------------
  const carrying = qty(c.inventory, 'berries');
  if (age >= LIFE.apprenticeAge && !sick && isWorkHours(state) && state.commons.berries > 4 && c.shiftsToday < maxShifts(c) && carrying < 14 && !out.some((o) => o.kind === 'forage')) {
    const forager = c.profession === 'Forager';
    const s = 20 + (job ? 0 : 22) + (c.skills.foraging ?? 0) * 25 + (forager ? 16 : 0) + pressure * 10 + trait(c, 'curious') * 5 - c.shiftsToday * 6 - carrying * 1.5;
    out.push(candidate('forage', s, [[forager ? 'foraging is my trade' : job ? 'the forest could earn me a little extra' : 'I have no job, but the forest provides', 20 + (job ? 0 : 22) + (forager ? 16 : 0)],
      [`berries in the woods: ${Math.round(state.commons.berries)}`, 0]]));
  }

  // --- Selling gathered goods ---------------------------------------------
  const sellable = ['berries', 'timber'].find((g) => qty(c.inventory, g) >= (g === 'berries' ? 5 : 1));
  if (sellable && age >= LIFE.apprenticeAge && h >= TIME.shopOpenHour && h < TIME.shopCloseHour - 1) {
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
    const target = partnerId ? byId(state.citizens, partnerId) : bestCompanion(state, c);
    out.push(candidate('socialize', s, [[`I'm lonely (social ${Math.round(social)}%)`, s - evening],
      ...(target ? [[partnerId ? `I want to see ${target.firstName}` : `${target.firstName} is good company`, 0]] : []),
      ...(evening ? [['evenings are for company', evening]] : [])], { citizenId: target?.id ?? null }));
  }

  // --- Courtship: young singles seek out someone they are drawn to ----------
  if (!minor && !sick && !isNight(state) && h >= 12 && !c.romance.partnerId && age < 42 && social < 95) {
    const sweetheart = c.romance.courtingId ? byId(state.citizens, c.romance.courtingId) : bestSweetheart(state, c);
    if (sweetheart) {
      const r = peekRel(state, c.id, sweetheart.id);
      const s = 36 + (r?.affection ?? 0) * 0.35 + trait(c, 'friendly') * 8 - trait(c, 'shy') * 10 + (c.romance.courtingId ? 12 : 0);
      out.push(candidate('socialize', s, [[c.romance.courtingId ? `I'm courting ${sweetheart.firstName}` : `I'm drawn to ${sweetheart.firstName}`, s]], { citizenId: sweetheart.id }));
    }
  }

  // --- Helping others ------------------------------------------------------
  const generous = trait(c, 'generous');
  if (!minor && generous > 0.3 && money >= 22 && !isNight(state)) {
    const needy = state.citizens.filter((o) => o.id !== c.id && balance(state, o.id) < 4 && o.needs.hunger < 45)
      .sort((a, b) => (peekRel(state, c.id, b.id)?.friendship ?? 0) - (peekRel(state, c.id, a.id)?.friendship ?? 0))[0];
    if (needy) {
      const s = 32 + generous * 40;
      out.push(candidate('help', s, [[`${needy.firstName} is hungry and nearly penniless`, 32], ['I believe in helping neighbours', generous * 40]], { citizenId: needy.id }));
    }
  }

  // --- Growing up: lessons, apprenticeships, mentoring, family -------------
  if (minor && age >= 5 && !sick && isWorkHours(state) && c.shiftsToday < 2) {
    const master = byId(state.citizens, c.education.masterId);
    if (master && age >= LIFE.apprenticeAge) {
      out.push(candidate('apprentice', 60 + trait(c, 'hardworking') * 10 - trait(c, 'lazy') * 10,
        [[`I'm learning ${c.education.trade === 'trade' ? 'trading' : c.education.trade} from ${master.firstName}`, 60]], { citizenId: master.id }));
    } else {
      const school = schoolOpen(state);
      out.push(candidate('lessons', 56 + trait(c, 'curious') * 12 - trait(c, 'lazy') * 12,
        [[school ? `lessons at ${school.name}` : `${guardian ? guardian.firstName : 'my elders'} teach${guardian ? 'es' : ''} me at home`, 56],
          ...(trait(c, 'curious') > 0.4 ? [['I love learning', trait(c, 'curious') * 12]] : [])]));
    }
  }
  if (!minor && !sick && (age >= 60 || c.retired) && !isNight(state)) {
    const [skill, level] = Object.entries(c.skills).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (level >= 0.55) {
      const student = state.citizens.filter((s) => s !== c && ageOf(state, s) >= 12 && ageOf(state, s) < 30 && (s.skills[skill] ?? 0) < level - 0.15 &&
        (s.education.trade === skill || (s.skills[skill] ?? 0) > 0.1)).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
      if (student) out.push(candidate('mentor', 38 + (c.skills.teaching ?? 0) * 20 + trait(c, 'generous') * 10,
        [[`${student.firstName} could learn ${skill} from me`, 38], ['passing on what I know matters', (c.skills.teaching ?? 0) * 20]], { citizenId: student.id, skill }));
    }
  }
  if (!minor && h >= 16 && h < 21 && state.citizens.some((k) => k.family.parentIds.includes(c.id) && ageOf(state, k) < LIFE.adultAge && ageOf(state, k) >= 1)) {
    out.push(candidate('family_time', 34 + (c.familyWish ?? 0.5) * 30, [['evenings belong to my children', 34 + (c.familyWish ?? 0.5) * 30]]));
  }

  // --- Emergencies -----------------------------------------------------------
  if (age >= 14 && !sick && state.fires?.length) {
    for (const f of state.fires) {
      const p = plotById(state, f.plotId);
      if (!p || f.responders.length >= 8 || f.responders.includes(c.id)) continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < 30) out.push(candidate('fight_fire', 96 - d + trait(c, 'generous') * 5, [[`${p.building?.name ?? p.name} is on fire nearby`, 96 - d]], { plotId: p.id }));
    }
  }

  // --- Politics --------------------------------------------------------------
  if (!minor && !sick && !isNight(state) && h >= 7 && h < 19) {
    const gov = state.government;
    if (electionToday(state) && !gov.campaign.ballots[c.id]) {
      out.push(candidate('vote', 74 + (c.skills.leadership ?? 0) * 5, [[`it's election day for ${gov.title}`, 74]]));
    } else if (gov?.campaign && isCandidate(state, c) && c.shiftsToday < 2) {
      out.push(candidate('campaign', 50 + trait(c, 'ambitious') * 18 + trait(c, 'friendly') * 6, [[`I'm standing for ${gov.title} and need votes`, 50], ['I want this badly', trait(c, 'ambitious') * 18]]));
    } else if (currentLeader(state)?.id === c.id && (c.governedDay ?? 0) < state.day && h < 15) {
      out.push(candidate('govern', 57 + trait(c, 'hardworking') * 8, [[`as ${gov.title} the village's business needs me`, 57]]));
    }
  }

  // --- Festival ------------------------------------------------------------
  if (state.council.festivalUntil > state.tick && !isNight(state)) {
    out.push(candidate('festival', 72 + trait(c, 'friendly') * 10, [['the council is hosting a festival in the square', 72]]));
  }

  // --- Goals (buying property, starting construction) ---------------------
  for (const a of minor ? [] : plan.actions) {
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

function bestSweetheart(state, c) {
  let best = null, bestScore = 0;
  for (const o of state.citizens) {
    if (o === c || o.romance.partnerId || !attracted(c, o) || Math.abs(o.birthDay - c.birthDay) > 12 * 12 || ageOf(state, o) < LIFE.marriageMinAge) continue;
    if (o.romance.courtingId && o.romance.courtingId !== c.id) continue;
    const r = peekRel(state, c.id, o.id);
    const s = pairHash(c.id, o.id) * 40 + (r?.affection ?? 0) + (r?.friendship ?? 0) * 0.3 - Math.hypot(o.x - c.x, o.z - c.z) * 0.15;
    if (s > bestScore) { bestScore = s; best = o; }
  }
  return bestScore > 18 ? best : null;
}

function bestCompanion(state, c) {
  let best = null, bestScore = -1;
  const lonelyHeart = !c.romance.partnerId && ageOf(state, c) >= LIFE.marriageMinAge;
  for (const o of state.citizens) {
    if (o.id === c.id || o.activity?.kind === 'sleep' || o.activity?.kind === 'cradle') continue;
    const r = peekRel(state, c.id, o.id);
    let s = (r?.friendship ?? 15) + (r?.affection ?? 0) * 0.5 - (r?.rivalry ?? 0) - Math.hypot(o.x - c.x, o.z - c.z) * 0.3;
    // Single adults seek out others who might return their interest.
    if (lonelyHeart && !o.romance.partnerId && ageOf(state, o) >= LIFE.marriageMinAge && attracted(c, o) && Math.abs(o.birthDay - c.birthDay) < 15 * 12) s += 18 + pairHash(c.id, o.id) * 20;
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
