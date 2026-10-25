import { holidayAt, absMinute } from '../holidays/HolidayCalendar.js';
import { HOLIDAY_BY_ID, SWEETHEART_SPOTS, defaultEnabled, holidayName } from '../holidays/HolidayRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { LIFE } from '../core/Config.js';
import { trait } from '../ai/Personality.js';
import { byId } from '../core/EntityRegistry.js';
import { yearOf } from '../core/Calendar.js';
import { record } from '../society/Chronicle.js';
import { remember } from '../ai/MemorySystem.js';
import { balance } from '../economy/Transactions.js';
import { buyRetail, isOpenNow } from '../economy/Marketplace.js';
import { qty } from '../economy/Inventory.js';

// Holidays with a market: a villager with coins to spare may buy a treat at an
// open stall (an ordinary sale: the coins go to the business, the food leaves its stock).
const MARKET_DAYS = new Set(['winter', 'harvest', 'solstice', 'founders']);

// The kingdom's holidays as the simulation sees them. Which holidays the
// kingdom keeps is part of the save (state.holidays.enabled), and the
// calendar is the kingdom's own: device settings such as preview, longer
// visuals or matching the real-world calendar never reach this file, so
// they cannot change what citizens do or when.
//
// Celebrating is a choice each citizen makes against everything else they
// need to do (see DecisionUtility): the hungry eat, workers finish shifts and
// people of other faiths may keep to their own observances. Celebrations
// move no coins and create no goods; they bring company, friendship,
// memories and a little cheer.

const LOG_MAX = 24;
const FIREWORKS_MAX = 8;
const SESSIONS_PER_HOLIDAY = 3;

export function ensureHolidays(state) {
  if (!state.holidays) state.holidays = { enabled: defaultEnabled(), log: [], fireworks: [], current: null };
  const h = state.holidays;
  for (const [id, on] of Object.entries(defaultEnabled())) if (h.enabled[id] === undefined) h.enabled[id] = on;
  return h;
}

/**
 * The holiday the kingdom is keeping right now, or null. Every citizen asks
 * this when deciding what to do, so the answer is kept for the current
 * minute (a derived value: it is never saved and never goes stale).
 */
let cached = { state: null, tick: -1, day: -1, minute: -1, rev: -1, value: null };
export function holidayNow(state) {
  const h = state.holidays;
  const rev = h?.rev ?? 0;
  if (cached.state === state && cached.tick === state.tick && cached.day === state.day && cached.minute === state.minute && cached.rev === rev) return cached.value;
  const value = holidayAt(state.day, state.minute, { enabled: h?.enabled ?? null });
  cached = { state, tick: state.tick, day: state.day, minute: state.minute, rev, value };
  return value;
}

const entryFor = (state, key) => ensureHolidays(state).log.find((e) => e.key === key) ?? null;

/**
 * Hourly: note when a holiday begins and ends, and fire its fireworks once.
 * Every record is keyed by the occurrence (e.g. "halloween-Y12"), so saving,
 * loading or racing through time at 20× can never repeat one.
 */
export function hourlyHolidays(state) {
  const h = ensureHolidays(state);
  const now = holidayNow(state);
  const t = absMinute(state.day, state.minute);
  if (h.current && h.current !== now?.key) close(state, h.current);
  if (now && !entryFor(state, now.key)) {
    h.log.push({ key: now.key, id: now.id, year: now.year, day: state.day, celebrants: 0, couples: 0, gifts: 0, people: [] });
    if (h.log.length > LOG_MAX) h.log.shift();
  }
  h.current = now?.key ?? null;
  // Fireworks go up in the hour they are due. A world created or loaded after
  // that hour has passed has missed them; they are never set off late.
  if (now?.fireworks != null && t >= now.fireworks && t - now.fireworks < 60 && !h.fireworks.some((f) => f.key === now.key)) {
    h.fireworks.push({ key: now.key, id: now.id, minute: now.fireworks, tick: state.tick });
    if (h.fireworks.length > FIREWORKS_MAX) h.fireworks.shift();
    if (now.id === 'newyear') {
      const gathered = state.citizens.filter((c) => c.activity?.kind === 'celebrate' && c.activity.holiday === 'newyear').length;
      record(state, 'culture', `Fireworks lit the sky over First Hearth as Year ${yearOf(state.day)} began${gathered ? `, ${gathered === 1 ? 'one villager' : `${gathered} villagers`} counting down in the square` : ''}.`, {}, 2);
    }
  }
}

function close(state, key) {
  const e = entryFor(state, key);
  if (!e || e.closed) return;
  e.closed = state.day;
  delete e.people; // only the counts are kept once it is over
}

/**
 * How much a citizen wants to celebrate the current holiday, with reasons.
 * Returns null when they will not (ill, away, starving, or already had their fill).
 */
export function celebrationWish(state, c, now = holidayNow(state)) {
  if (!now || c.away || (c.health?.sickUntil ?? 0) > state.day || c.needs.hunger < 40) return null;
  const age = ageOf(state, c);
  if (age < 3) return null;
  if (c.holiday?.key === now.key && c.holiday.sessions >= SESSIONS_PER_HOLIDAY) return null;
  const def = now.def;
  const hour = state.minute / 60;
  const night = hour < 6 || hour >= 22;
  const name = holidayName(def, now.phase);
  const factors = [[`it's ${name}`, 26]];
  factors.push(['I enjoy company', trait(c, 'friendly') * 18 - trait(c, 'shy') * 14]);
  factors.push([`I've been lonely`, (100 - c.needs.social) * 0.2]);
  if (c.employment && c.shiftsToday === 0 && hour >= 6 && hour < 18) factors.push(['I still owe a shift today', -24 * (0.5 + trait(c, 'hardworking'))]);
  if (night && !(def.id === 'newyear' && now.phase === 'eve')) factors.push(['it is late', -30]);
  if (def.id === 'newyear' && now.phase === 'eve' && hour >= 21) factors.push(['midnight is coming', 40]);
  if (def.id === 'halloween' && age < LIFE.adultAge) factors.push(['lanterns and costumes!', 18]);
  if (def.romance) {
    const partner = byId(state.citizens, c.romance?.partnerId ?? c.family?.spouseId);
    if (partner && !partner.away) factors.push([`a walk out with ${partner.firstName}`, 22]);
  }
  if (def.religious) {
    const b = c.belief;
    if (b?.tradition && def.traditions.includes(b.tradition)) factors.push(['it is a feast of my faith', b.stance === 'devout' ? 22 : 12]);
    else if (b?.stance === 'devout') factors.push(['I keep my own observances', -22]);
    else if (b?.stance === 'skeptical') factors.push(['I come for the lights, not the rites', -6]);
  }
  factors.push(['my spirits', (c.mood - 50) * 0.15]);
  const score = factors.reduce((t, [, v]) => t + v, 0);
  return { score, factors: factors.filter(([, v]) => Math.abs(v) >= 1), now };
}

/** Where a citizen goes to celebrate. `pick(lo, hi)` draws from the simulation's random stream. */
export function celebrationSpot(state, c, now, pick) {
  const def = now.def;
  if (def.gather === 'sweethearts') {
    const partnerId = c.romance?.partnerId ?? c.family?.spouseId ?? null;
    // A couple meets at the same bench: the one fixed by their pair of ids.
    const pairKey = [c.id, partnerId ?? c.id].sort().join('');
    let h = 0;
    for (let i = 0; i < pairKey.length; i++) h = (h * 31 + pairKey.charCodeAt(i)) >>> 0;
    const [x, z] = SWEETHEART_SPOTS[h % SWEETHEART_SPOTS.length];
    return { x: x + pick(-0.6, 0.6), z: z + pick(-0.6, 0.6), label: partnerId ? 'Walking out with their sweetheart' : 'Celebrating with friends', partnerId };
  }
  if (def.gather === 'houses') {
    // Visiting a friend's door, lantern in hand.
    const friends = state.citizens.filter((o) => o.id !== c.id && o.homePlotId && o.homePlotId !== c.homePlotId);
    const o = friends.length ? friends[Math.floor(pick(0, friends.length - 0.001))] : null;
    const plot = o && state.plots.find((p) => p.id === o.homePlotId);
    if (plot) {
      const off = { south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0] }[plot.facing ?? 'south'];
      const reach = (off[1] ? plot.d : plot.w) / 2 + 1.4;
      return { x: plot.x + off[0] * reach + pick(-1, 1), z: plot.z + off[1] * reach + pick(-1, 1), label: `Lantern-visiting at the ${o.lastName}s'` };
    }
  }
  const label = def.id === 'newyear' ? 'Counting down to the New Year' : def.gather === 'feast' ? 'At the Gratitude Feast' : `Celebrating ${holidayName(def, now.phase)}`;
  return { x: pick(-4.2, 4.2), z: pick(-4.2, 4.2), label };
}

/**
 * A citizen has spent time celebrating: company, a memory, perhaps a token for
 * a sweetheart or a small handmade gift for a friend. No coins or goods move.
 * `others` are the citizens close by; `social` raises friendship as in any chat.
 */
export function celebrated(state, c, a, others, social) {
  const now = holidayNow(state);
  if (!now || now.key !== a.key) return;
  const entry = entryFor(state, a.key);
  const def = HOLIDAY_BY_ID[a.holiday];
  c.holiday = c.holiday?.key === a.key ? { key: a.key, sessions: c.holiday.sessions + 1 } : { key: a.key, sessions: 1 };
  c.needs.social = Math.min(100, c.needs.social + 22);
  c.mood = Math.min(100, c.mood + 3);
  social(others.slice(0, 3));
  if (entry && entry.people && !entry.people.includes(c.id)) { entry.people.push(c.id); entry.celebrants++; }
  if (MARKET_DAYS.has(def.id) && c.holiday.sessions === 1 && ageOf(state, c) >= LIFE.adultAge && balance(state, c.id) > 20 && trait(c, 'frugal') < 0.5) {
    const stall = state.businesses.find((b) => isOpenNow(state, b) && (qty(b.inventory, 'meal') > 0 || qty(b.inventory, 'bread') > 0));
    if (stall) {
      const res = buyRetail(state, c, stall, qty(stall.inventory, 'meal') > 0 ? 'meal' : 'bread', 1);
      if (res.ok && entry) entry.sales = (entry.sales ?? 0) + res.paid;
    }
  }
  const partner = def.romance ? byId(state.citizens, a.partnerId) : null;
  if (partner && others.includes(partner)) {
    // Gentle: a little affection, and one memory for each, once per holiday.
    for (const [x, y] of [[c, partner], [partner, c]]) {
      const r = state.relationships[`${x.id}|${y.id}`];
      if (r) r.affection = Math.min(100, Math.round((r.affection + 2) * 10) / 10);
    }
    if (c.holiday.sessions === 1 && entry) entry.couples++;
    if (c.holiday.sessions === 1) remember(state, c, `Spent ${def.name} with ${partner.firstName}.`, 1, 'holiday');
  } else if (def.id === 'winter' && others.length && c.holiday.sessions === 1) {
    const friend = others[0];
    const r = state.relationships[`${c.id}|${friend.id}`];
    if (r) r.friendship = Math.min(100, Math.round((r.friendship + 2) * 10) / 10);
    if (entry) entry.gifts++;
    remember(state, c, `Exchanged small handmade gifts with ${friend.firstName} at the ${def.name}.`, 1, 'holiday');
  } else if (c.holiday.sessions === 1) {
    remember(state, c, others.length ? `Celebrated ${holidayName(def, now.phase)} with ${others[0].firstName}${others[1] ? ` and ${others[1].firstName}` : ''}.` : `Celebrated ${holidayName(def, now.phase)}.`, 1, 'holiday');
  }
}

/** Turn a holiday on or off for the kingdom (saved with it). */
export function setHolidayEnabled(state, id, on) {
  const h = ensureHolidays(state);
  if (!(id in h.enabled)) return false;
  h.enabled[id] = !!on;
  h.rev = (h.rev ?? 0) + 1; // the cached answer to "which holiday is it?" is now out of date
  return true;
}
