import { seasonIndex } from '../core/Calendar.js';
import { nextRandom } from '../core/Random.js';

// The weather, decided once a day from the season and yesterday's weather
// (weather tends to persist). It is simulation state, so a reloaded world
// has the same skies, and it has real effects: rain waters the crops in the
// growing months, snow and fog slow the roads, wind fans fires, and a clear
// day lifts spirits. The renderer draws whatever the simulation decided.

// Chance of each kind by season [spring, summer, autumn, winter].
const ODDS = {
  clear: [0.4, 0.55, 0.35, 0.3],
  rain: [0.35, 0.2, 0.35, 0.15],
  fog: [0.12, 0.05, 0.18, 0.15],
  wind: [0.13, 0.2, 0.12, 0.1],
  snow: [0, 0, 0, 0.3],
};
export const WEATHER_LABEL = { clear: 'Clear skies', rain: 'Rain', fog: 'Fog', wind: 'Windy', snow: 'Snow' };
export const WEATHER_ICON = { clear: '☀️', rain: '🌧️', fog: '🌫️', wind: '💨', snow: '❄️' };

export function ensureWeather(state) {
  if (!state.weather) state.weather = { today: { kind: 'clear', intensity: 0.5, day: state.day }, history: [] };
  return state.weather;
}

/** Daily: tomorrow's weather follows from today's, more often than not. */
export function dailyWeather(state) {
  const w = ensureWeather(state);
  const season = seasonIndex(state.day);
  const prev = w.today.kind;
  let kind;
  if (nextRandom(state) < 0.45 && ODDS[prev][season] > 0) kind = prev;
  else {
    let r = nextRandom(state);
    kind = 'clear';
    for (const [k, odds] of Object.entries(ODDS)) { r -= odds[season]; if (r <= 0) { kind = k; break; } }
  }
  w.today = { kind, intensity: Math.round((0.3 + nextRandom(state) * 0.7) * 100) / 100, day: state.day };
  w.history.push({ day: state.day, kind });
  if (w.history.length > 12) w.history.shift();
  if (kind === 'clear') for (const c of state.citizens) c.mood = Math.min(100, c.mood + 0.5);
  return w.today;
}

/** Farm output factor for today's weather. */
export function farmWeather(state) {
  const k = state.weather?.today?.kind;
  const season = seasonIndex(state.day);
  if (k === 'rain' && (season === 0 || season === 1)) return 1.1;
  if (k === 'snow') return 0.8;
  if (k === 'wind' && season === 2) return 0.95;
  return 1;
}

/** Travel speed factor on the regional roads. */
export function roadWeather(state) {
  const t = state.weather?.today;
  if (!t) return 1;
  return t.kind === 'snow' ? 0.8 - t.intensity * 0.1 : t.kind === 'fog' ? 0.9 : t.kind === 'rain' ? 0.95 : 1;
}

/** Fire spreads more easily in a wind and less in the rain. */
export function fireWeather(state) {
  const k = state.weather?.today?.kind;
  return k === 'wind' ? 1.6 : k === 'rain' || k === 'snow' ? 0.4 : 1;
}
