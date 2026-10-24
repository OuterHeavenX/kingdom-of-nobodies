import { POPULATION } from '../core/Config.js';
import { intRange, pick, nextRandom } from '../core/Random.js';
import { transfer, balance } from '../economy/Transactions.js';
import { isTrading, BUSINESS_TYPES } from '../economy/Businesses.js';
import { bedsAt } from '../property/LandRegistry.js';
import { randomTraits } from '../ai/Personality.js';
import { createCitizen } from './Citizen.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { moveHome } from '../property/Construction.js';

// Population growth. Newcomers arrive when there are beds, the village is in
// decent spirits and there is work or an obvious gap in the market.

const FIRST = ['Hale', 'Mira', 'Osric', 'Tamsin', 'Wyn', 'Gareth', 'Isolde', 'Rowan', 'Fenna', 'Aldric', 'Bryony', 'Cedric', 'Edda', 'Lorne', 'Maud', 'Piers', 'Sabine', 'Tobin'];
const LAST = ['Fletcher', 'Hearn', 'Marsh', 'Cooper', 'Vane', 'Dunmore', 'Reed', 'Stroud', 'Penrose', 'Kettle', 'Ashby', 'Wren'];
const COLORS = ['#d98c5f', '#8fb3d9', '#c49bd6', '#e0c46c', '#7fcdb0', '#e58f9e', '#9fd07a', '#d6a15f', '#88a4e0'];
const HAIR = ['short', 'long', 'bun', 'bald', 'braid', 'curly'];
const HAIR_COLORS = ['#3b2a1e', '#6b4226', '#a8763e', '#d9b36c', '#2a2a2a', '#8c3b22', '#b8b0a2'];
const SKIN = ['#f2cfab', '#e0b48c', '#c68e64', '#9a6844', '#f5d9c0'];

export function housingCapacity(state) {
  return state.plots.reduce((s, p) => s + bedsAt(state, p), 0);
}

export function assignHomes(state) {
  for (const c of state.citizens) {
    if (c.homePlotId) continue;
    const home = state.plots.find((p) => bedsAt(state, p) > p.residents.length && (p.ownerId === 'council' || p.ownerId === c.id));
    if (home) moveHome(state, c, home);
  }
}

function neededProfession(state) {
  const open = (type) => state.businesses.some((b) => b.type === type && isTrading(b));
  const planned = (type) => state.citizens.some((c) => c.dream.type === 'business' && c.dream.businessType === type && !c.dream.fulfilledDay);
  for (const [type, prof] of [['farm', 'Farmer'], ['bakery', 'Baker'], ['blacksmith', 'Blacksmith'], ['general_store', 'Merchant'], ['tavern', 'Innkeeper']]) {
    if (!open(type) && !planned(type)) return { profession: prof, dream: { type: 'business', businessType: type, text: `Open a ${BUSINESS_TYPES[type].label.toLowerCase()}` } };
  }
  const hiring = state.businesses.find((b) => isTrading(b) && b.openings > 0);
  if (hiring) return { profession: 'Laborer', dream: pick(state, [{ type: 'wealth', target: 120, text: 'Save 120 coins' }, { type: 'partner', text: 'Find a life partner' }, { type: 'respected', text: 'Be respected by everyone' }]) };
  const builders = state.citizens.filter((c) => c.profession === 'Builder').length;
  if (state.projects.length > builders && builders < 3) return { profession: 'Builder', dream: { type: 'master_builder', target: 3, text: 'Become a master builder' } };
  return null;
}

/** Check whether a newcomer arrives today. Returns the citizen or null. */
export function maybeImmigrate(state) {
  if (state.citizens.length >= POPULATION.max) return null;
  if (state.day % POPULATION.immigrationEveryDays !== 0) return null;
  const residents = state.plots.reduce((s, p) => s + p.residents.length, 0);
  if (housingCapacity(state) <= residents) return null;
  const mood = state.citizens.reduce((s, c) => s + c.mood, 0) / state.citizens.length;
  if (mood < 45) return null;
  const need = neededProfession(state);
  if (!need) return null;
  const rand = () => nextRandom(state);
  const c = createCitizen(state, {
    firstName: FIRST[intRange(state, 0, FIRST.length - 1)],
    lastName: pick(state, LAST),
    age: intRange(state, 19, 50),
    color: pick(state, COLORS),
    appearance: { hair: pick(state, HAIR), hairColor: pick(state, HAIR_COLORS), skin: pick(state, SKIN) },
    profession: need.profession,
    traits: randomTraits(rand),
    dream: need.dream,
    x: -34, z: 0,
  });
  if (state.citizens.filter((o) => o.firstName === c.firstName).length > 1) c.firstName = FIRST[(FIRST.indexOf(c.firstName) + 7) % FIRST.length];
  const coins = intRange(state, POPULATION.immigrantMinCoins, POPULATION.immigrantMaxCoins);
  transfer(state, 'outside', c.id, Math.min(coins, balance(state, 'outside')), 'immigration', `${c.firstName}'s savings`);
  assignHomes(state);
  record(state, 'citizen', `${c.firstName} ${c.lastName}, a ${c.profession.toLowerCase()}, arrived hoping to ${c.dream.text.toLowerCase()}.`, { citizens: [c.id] }, 2);
  remember(state, c, `Arrived in the village with ${balance(state, c.id)} coins.`, 2, 'milestone');
  return c;
}
