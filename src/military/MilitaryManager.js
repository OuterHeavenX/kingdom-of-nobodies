import { MILITARY, LIFE, FOOD_GOODS } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { qty, removeGoods, addGoods } from '../economy/Inventory.js';
import { isTrading } from '../economy/Businesses.js';
import { leaveJob } from '../economy/Employment.js';
import { ageOf, achieve } from '../citizens/Citizen.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { isNewSeason } from '../core/Calendar.js';
import { HEARTH, KINGDOMS, FOOD_COMMODITIES, COMMODITIES } from '../region/RegionData.js';
import { available } from '../region/Settlement.js';
import { buyFood, foodIn, takeFood } from '../institutions/CommunityEvents.js';
import { ensureMilitary, createArmy, liveArmies, note } from './Army.js';

// The military strength of each party, recruitment and logistics. Soldiers
// are people: a kingdom that mobilises takes workers out of its fields and
// mines (its production falls), and First Hearth's militia is made of real
// villagers who leave their jobs. Armies eat real food from real stores and
// cost coins every day they are kept in the field.

const BASE = {
  hearth: { training: 0.3, equipment: 0.35 },
  greenvale: { training: 0.4, equipment: 0.45 },
  ironhold: { training: 0.55, equipment: 0.7 },
  saltmere: { training: 0.45, equipment: 0.55 },
};
const PARTIES = [HEARTH, ...Object.keys(KINGDOMS)];
const accountOf = (party) => (party === HEARTH ? 'treasury' : KINGDOMS[party].account);
export const populationOf = (state, party) => (party === HEARTH ? state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge).length : state.region.settlements[party].population);

export function forcesOf(state, party) {
  const m = ensureMilitary(state);
  return m.forces[party] ?? (m.forces[party] = { party, ...BASE[party], morale: 0.65, mobilised: 0, drills: 0 });
}

/** Soldiers a party could put in the field, and how good they would be. */
export function potentialStrength(state, party) {
  const f = forcesOf(state, party);
  const people = populationOf(state, party);
  const soldiers = party === HEARTH ? Math.max(0, Math.floor(people * 0.12)) * 6 : Math.floor(people * MILITARY.mobiliseShare);
  // First Hearth's militia counts each villager as a small company of their neighbours (the abstraction behind the numbers).
  const funds = balance(state, accountOf(party));
  const sustain = Math.min(1, funds / Math.max(1, soldiers * MILITARY.soldierUpkeep * 30));
  return Math.round(soldiers * (0.6 + f.training * 0.8) * (0.6 + f.equipment * 0.8) * (0.5 + f.morale) * (0.5 + sustain * 0.5));
}

/** Food a party can send with its army (and the store it comes from). */
function foodStock(state, party) {
  if (party === HEARTH) return (state.council.pantry ? foodIn(state.council.pantry) : 0) + qty(state.council.stores ?? {}, 'grain');
  const k = state.region.settlements[party];
  return FOOD_COMMODITIES.reduce((s, g) => s + available(k, g), 0);
}

/** Draw `n` food units from a party's stores into an army's supply. Returns the units drawn. */
export function drawFood(state, party, n) {
  let got = 0;
  if (party === HEARTH) {
    const store = state.council.pantry;
    while (got < n && foodIn(store) > 6 + state.citizens.length / 2) { takeFood(store); got++; }
    if (got < n) {
      // Buy the rest from the village's shops with treasury coins.
      const bought = {};
      const { units } = buyFood(state, 'treasury', Math.min(n - got, 40), bought, 'the militia');
      got += units;
    }
    return got;
  }
  const k = state.region.settlements[party];
  for (const g of [...FOOD_COMMODITIES].sort((a, b) => available(k, b) - available(k, a))) {
    if (got >= n) break;
    const take = Math.min(n - got, Math.max(0, available(k, g) - 10));
    k.inventory[g] -= take;
    got += take;
  }
  return Math.floor(got);
}

/** Raise an army: soldiers leave civilian work, equipment and food are drawn from stores. */
export function raiseArmy(state, party, war, target, { share = 1 } = {}) {
  const f = forcesOf(state, party);
  let soldiers, citizenIds = [], commander = null;
  if (party === HEARTH) {
    const recruits = state.citizens.filter((c) => {
      const age = ageOf(state, c);
      return age >= LIFE.adultAge && age < 46 && !c.away && !c.retired && !c.pregnancy && c.employment?.role !== 'owner' && state.government?.leaderId !== c.id;
    }).sort((a, b) => (b.skills.leadership ?? 0) - (a.skills.leadership ?? 0) || a.id.localeCompare(b.id));
    const n = Math.min(recruits.length, Math.max(3, Math.floor(populationOf(state, HEARTH) * 0.1 * share)));
    for (const c of recruits.slice(0, n)) {
      if (c.employment) leaveJob(state, c, 'called up to the militia');
      c.away = { until: null, reason: 'militia', warId: war.id };
      c.militia = { since: state.day, warId: war.id };
      remember(state, c, `Was called up to the militia for the ${war.name}.`, 3, 'life');
      citizenIds.push(c.id);
    }
    soldiers = citizenIds.length * 6;
    commander = citizenIds[0] ?? null;
  } else {
    const k = state.region.settlements[party];
    soldiers = Math.floor(k.population * MILITARY.mobiliseShare * share * (0.7 + f.morale * 0.4));
    k.mobilised = (k.mobilised ?? 0) + soldiers;
    // Equipment: tools and iron from the kingdom's stores.
    const want = Math.ceil(soldiers / 25);
    const iron = Math.min(want, Math.floor(available(k, 'iron')));
    const tools = Math.min(want - iron, Math.floor(available(k, 'tools')));
    k.inventory.iron -= iron; k.inventory.tools -= tools;
    // A kingdom without its own mines buys arms abroad for the shortfall, if its treasury allows.
    const bought = buyArms(state, party, want - iron - tools);
    f.equipment = Math.min(0.95, Math.max(0.2, f.equipment + ((iron + tools + bought) / Math.max(1, want) - 0.5) * 0.15));
    commander = state.foreign?.people ? Object.values(state.foreign.people).filter((p) => p.kingdom === party && p.status === 'alive' && p.role === 'notable').sort((a, b) => b.standing - a.standing)[0]?.id ?? null : null;
  }
  if (soldiers < 6) return null;
  const supplies = drawFood(state, party, Math.ceil(soldiers / 100 * MILITARY.foodPerHundredSoldiers * 10));
  f.mobilised += soldiers;
  const army = createArmy(state, { owner: party, soldiers, commander, training: f.training, equipment: f.equipment, morale: f.morale, supplies, warId: war.id, target, citizenIds });
  note(army, state, `Raised ${soldiers} soldiers${citizenIds.length ? ` (${citizenIds.length} villagers leading companies of their neighbours)` : ''}, carrying ${supplies} rations.`);
  return army;
}

export const IMPORTED_ARMS_CEILING = 0.8;

/**
 * Buy `units` of arms (iron and tools) from the lands beyond the region at the
 * kingdom's own market price, keeping a reserve in the treasury. Returns the units bought.
 */
export function buyArms(state, party, units, reserve = 400) {
  if (party === HEARTH || units <= 0) return 0;
  const k = state.region.settlements[party];
  const price = Math.max(COMMODITIES.iron.base, k.prices?.iron ?? COMMODITIES.iron.base);
  const n = Math.min(units, Math.floor((balance(state, accountOf(party)) - reserve) / price));
  if (n <= 0 || !transfer(state, accountOf(party), 'outside', Math.ceil(n * price), 'expense', `${KINGDOMS[party].name} arms bought abroad`)) return 0;
  return n;
}

/** Disband an army: soldiers go home to their work, militia villagers to their village. */
export function disband(state, army, why) {
  if (army.status === 'DISBANDED') return;
  army.status = 'DISBANDED';
  army.disbandedDay = state.day;
  const f = forcesOf(state, army.owner);
  f.mobilised = Math.max(0, f.mobilised - army.startSoldiers);
  if (army.owner !== HEARTH) {
    const k = state.region.settlements[army.owner];
    // Losses and desertions were taken off as they happened; the survivors come home now.
    k.mobilised = Math.max(0, (k.mobilised ?? 0) - army.soldiers);
    // Unused food goes back into the stores.
    if (army.supplies > 0) k.inventory.grain = (k.inventory.grain ?? 0) + army.supplies;
  } else if (army.supplies > 0) addGoods(state.council.pantry, 'grain', Math.floor(army.supplies));
  army.supplies = 0;
  for (const id of army.citizenIds) {
    const c = byId(state.citizens, id);
    if (!c) continue;
    c.away = null;
    delete c.militia;
    c.x = 0; c.z = -80;
    c.needs.hunger = Math.max(c.needs.hunger, 40);
    remember(state, c, `Came home from the militia (${why}).`, 3, 'life');
    achieve(state, c, 'militia', `Served in the militia in the ${state.military.wars.find((w) => w.id === army.warId)?.name ?? 'war'}`);
  }
  note(army, state, `Disbanded: ${why}.`);
}

/**
 * Daily logistics: armies eat, are paid and are resupplied along open roads.
 * Hunger saps morale and soldiers desert; the costs are charged to the war.
 */
export function supplyArmies(state) {
  const m = ensureMilitary(state);
  for (const army of liveArmies(state)) {
    if (army.status === 'HOME') { disband(state, army, 'the campaign is over'); continue; }
    if (army.status === 'MUSTERING' && state.day >= army.musterUntil) army.status = 'READY';
    const eat = Math.max(1, Math.round(army.soldiers / 100 * MILITARY.foodPerHundredSoldiers));
    if (army.supplies >= eat) { army.supplies -= eat; army.hungry = 0; }
    else {
      army.supplies = 0;
      army.hungry = (army.hungry ?? 0) + 1;
      army.morale = Math.max(0.05, Math.round((army.morale - 0.06) * 100) / 100);
      const deserters = Math.floor(army.soldiers * 0.03);
      if (deserters > 0) { army.soldiers -= deserters; note(army, state, `${deserters} soldiers deserted for want of food.`); if (army.owner !== HEARTH) state.region.settlements[army.owner].mobilised -= deserters; }
    }
    // Every third day a supply train comes up from home if the roads allow.
    if (state.day % 3 === 0 && army.supplies < eat * 6) {
      const got = drawFood(state, army.owner, eat * 6);
      army.supplies += got;
      if (got && army.legIndex > 0) note(army, state, `A supply train brought ${got} days of food.`);
    }
    // Pay and upkeep.
    const pay = army.owner === HEARTH ? army.citizenIds.length * MILITARY.militiaWage : Math.ceil(army.soldiers * MILITARY.soldierUpkeep);
    const acct = accountOf(army.owner);
    const n = Math.min(pay, balance(state, acct));
    if (army.owner === HEARTH) {
      for (const id of army.citizenIds) if (byId(state.citizens, id)) transfer(state, 'treasury', id, Math.min(MILITARY.militiaWage, balance(state, 'treasury')), 'wage', 'Militia pay');
    } else if (n > 0) transfer(state, acct, 'outside', n, 'expense', `${KINGDOMS[army.owner].name} army pay and equipment`);
    army.costs += n;
    const war = m.wars.find((w) => w.id === army.warId);
    if (war) war.costs[army.owner] = (war.costs[army.owner] ?? 0) + n;
    if (n < pay) { army.morale = Math.max(0.05, army.morale - 0.03); }
    // Militia villagers are fed from the army's supply, not the village market.
    for (const id of army.citizenIds) { const c = byId(state.citizens, id); if (c) c.needs.hunger = army.supplies > 0 ? Math.max(c.needs.hunger, 55) : Math.max(5, c.needs.hunger - 10); }
  }
  if (m.armies.length > 40) m.armies = m.armies.filter((a) => a.status !== 'DISBANDED').concat(m.armies.filter((a) => a.status === 'DISBANDED').slice(-15));
}

/** Seasonal peacetime: drills cost a little and improve training; morale returns toward normal. */
export function peacetimeForces(state) {
  if (!isNewSeason(state.day)) return;
  for (const party of PARTIES) {
    const f = forcesOf(state, party);
    const atWar = state.military.wars.some((w) => w.status === 'ACTIVE' && [...w.attackers, ...w.defenders].includes(party));
    f.morale = Math.round((f.morale + ((atWar ? 0.55 : 0.68) - f.morale) * 0.3) * 100) / 100;
    if (party === HEARTH) continue;
    const k = state.region.settlements[party];
    const garrison = Math.floor(k.population * MILITARY.garrisonShare);
    const cost = Math.ceil(garrison * MILITARY.soldierUpkeep * 3);
    if (balance(state, accountOf(party)) > cost + 400 && transfer(state, accountOf(party), 'outside', cost, 'expense', `${KINGDOMS[party].name} garrison drills`)) {
      f.training = Math.min(0.9, Math.round((f.training + 0.01) * 1000) / 1000);
      f.drills++;
    } else f.training = Math.max(0.2, Math.round((f.training - 0.01) * 1000) / 1000);
    // Smiths keep the armouries stocked: equipment drifts up when the kingdom has metal
    // enough for its garrison (from its own mines, or bought abroad), and down when it has not.
    // Arms bought abroad keep an armoury in fair order, but not as well as a kingdom's own smiths.
    const need = Math.max(1, Math.ceil(garrison / 10));
    const metal = available(k, 'iron') + available(k, 'tools');
    const own = metal >= need * 2;
    const ceiling = own ? 0.95 : IMPORTED_ARMS_CEILING;
    const stocked = own || (f.equipment < ceiling && buyArms(state, party, need) >= need);
    const drift = stocked ? 0.01 : f.equipment >= ceiling && !own ? 0 : -0.01;
    f.equipment = Math.round(Math.max(0.2, Math.min(0.95, f.equipment + drift)) * 1000) / 1000;
  }
}

export { PARTIES as MILITARY_PARTIES, accountOf as partyAccount, isTrading };
