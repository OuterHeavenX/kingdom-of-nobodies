import { CALENDAR } from '../core/Config.js';
import { HOLIDAYS, HOLIDAY_BY_ID, holidayName } from './HolidayRegistry.js';

// The visual and festive calendar laid over the kingdom's own calendar. It
// only reads the date: nothing here changes simulation time, ages or the
// economy. A moment is an absolute minute, (day - 1) * 1440 + minute, so it
// is the same before and after a save and load.
//
// Holidays are placed by their part of the season (see HolidayRegistry), so
// a calendar with shorter or longer seasons still has every holiday in the
// right place and order. New Year's midnight is always the year boundary.

const REF_SEASON_HOURS = 72;
export const DAY_MINUTES = 1440;

const calendarOf = (cal) => ({ daysPerSeason: cal?.daysPerSeason ?? CALENDAR.daysPerSeason, seasons: (cal?.seasons ?? CALENDAR.seasons).length });
const seasonMinutes = (cal) => calendarOf(cal).daysPerSeason * DAY_MINUTES;
export const yearMinutes = (cal) => seasonMinutes(cal) * calendarOf(cal).seasons;
export const absMinute = (day, minute) => (day - 1) * DAY_MINUTES + minute;

/** Start (minutes into the year) and length of a holiday's window. `scale` lengthens or shortens it. */
export function windowOf(def, scale = 1, cal) {
  const S = seasonMinutes(cal);
  const start = def.season * S + (((def.day - 1) * 24 + def.hour) / REF_SEASON_HOURS) * S;
  let length = (def.hours / REF_SEASON_HOURS) * S * scale;
  // New Year's Eve always reaches midnight; only the morning after shortens or lengthens.
  if (def.midnight) length = Math.max(length, yearMinutes(cal) - start + 60);
  return { start, length };
}

/** The moment of a holiday's fireworks (absolute minute), if it has any. */
function fireworksAt(def, start, yearIndex, cal) {
  if (def.fireworks === 'midnight') return (yearIndex + 1) * yearMinutes(cal);
  if (typeof def.fireworks === 'number') return start + ((def.fireworks - def.hour) / REF_SEASON_HOURS) * seasonMinutes(cal);
  return null;
}

/** One occurrence of a holiday: the year it began in, its window in absolute minutes and its key moments. */
export function occurrence(def, yearIndex, scale = 1, cal) {
  const { start, length } = windowOf(def, scale, cal);
  const s = yearIndex * yearMinutes(cal) + start;
  return { def, id: def.id, key: `${def.id}-Y${yearIndex + 1}`, year: yearIndex + 1, start: s, end: s + length, fireworks: fireworksAt(def, s, yearIndex, cal), midnight: def.midnight ? (yearIndex + 1) * yearMinutes(cal) : null };
}

/**
 * The holiday in progress at a moment, or null. When windows overlap (a long
 * duration setting), the one that began most recently is shown.
 * opts: { enabled: {id: bool}, scale, calendar }
 */
export function holidayAt(day, minute, opts = {}) {
  const t = absMinute(day, minute);
  const Y = yearMinutes(opts.calendar);
  const n = Math.floor(t / Y);
  let best = null;
  for (const def of HOLIDAYS) {
    if (opts.enabled && opts.enabled[def.id] === false) continue;
    for (const yi of [n - 1, n]) {
      const o = occurrence(def, yi, opts.scale ?? 1, opts.calendar);
      if (t >= o.start && t < o.end && (!best || o.start > best.start)) best = o;
    }
  }
  return best ? describe(best, t) : null;
}

function describe(o, t) {
  const phase = o.midnight != null ? (t < o.midnight ? 'eve' : 'day') : 'on';
  return {
    ...o, phase, name: holidayName(o.def, phase), icon: o.def.icon,
    progress: Math.max(0, Math.min(1, (t - o.start) / (o.end - o.start))),
    minutesToMidnight: o.midnight != null && t < o.midnight ? o.midnight - t : null,
  };
}

/** The next holiday to begin after a moment (for "coming up" in the panel). */
export function nextHoliday(day, minute, opts = {}) {
  const t = absMinute(day, minute);
  const n = Math.floor(t / yearMinutes(opts.calendar));
  let best = null;
  for (const def of HOLIDAYS) {
    if (opts.enabled && opts.enabled[def.id] === false) continue;
    for (const yi of [n, n + 1]) {
      const o = occurrence(def, yi, opts.scale ?? 1, opts.calendar);
      if (o.start > t && (!best || o.start < best.start)) best = o;
    }
  }
  return best && { ...best, name: best.def.name, icon: best.def.icon, minutesUntil: best.start - t };
}

/** All occurrences that begin within [fromDay, toDay), in order (used by tests and the panel). */
export function occurrencesBetween(fromDay, toDay, opts = {}) {
  const a = absMinute(fromDay, 0), b = absMinute(toDay, 0);
  const Y = yearMinutes(opts.calendar);
  const out = [];
  for (let yi = Math.floor(a / Y) - 1; yi <= Math.floor(b / Y); yi++) {
    for (const def of HOLIDAYS) {
      if (opts.enabled && opts.enabled[def.id] === false) continue;
      const o = occurrence(def, yi, opts.scale ?? 1, opts.calendar);
      if (o.start >= a && o.start < b) out.push(o);
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/**
 * Where in its season a moment falls: { season, t } with t in [0, 1). The
 * renderer blends towards the next season over the last part of each one,
 * so the land changes gradually instead of overnight.
 */
export function seasonProgress(day, minute, cal) {
  const S = seasonMinutes(cal), Y = yearMinutes(cal);
  const inYear = ((absMinute(day, minute) % Y) + Y) % Y;
  const season = Math.floor(inYear / S);
  return { season, t: (inYear - season * S) / S };
}

// --- Real-world dates, for the optional "match my calendar" visuals ----------------------

/** Western Easter Sunday for a year (anonymous Gregorian algorithm). Returns [month, day]. */
export function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** The fourth Thursday of November (the familiar Thanksgiving). Returns [11, day]. */
export function gratitudeDay(year) {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return [11, 1 + ((4 - first + 7) % 7) + 21];
}

const dayIndex = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86400000);

function realWindow(def, year) {
  if (def.real === 'easter') { const [m, d] = easter(year); const e = dayIndex(year, m, d); return [e - 7, e + 1]; }
  if (def.real === 'thanksgiving') { const [m, d] = gratitudeDay(year); const e = dayIndex(year, m, d); return [e - 3, e + 1]; }
  const [[m1, d1], [m2, d2]] = def.real;
  // New Year runs from 31 December into 1 January.
  return [dayIndex(year, m1, d1), m2 < m1 ? dayIndex(year + 1, m2, d2) : dayIndex(year, m2, d2)];
}

/**
 * The season and holiday for a real calendar date (northern hemisphere
 * seasons). Visual only: the simulation never sees this.
 */
export function realWorldTheme(date, opts = {}) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const today = dayIndex(y, m, d);
  const season = m >= 3 && m <= 5 ? 0 : m >= 6 && m <= 8 ? 1 : m >= 9 && m <= 11 ? 2 : 3;
  const startMonth = [3, 6, 9, 12][season];
  const startYear = season === 3 && m < 3 ? y - 1 : y;
  const seasonStart = dayIndex(startYear, startMonth, 1);
  const t = Math.min(0.999, (today - seasonStart) / 91);
  let holiday = null;
  for (const def of HOLIDAYS) {
    if (opts.enabled && opts.enabled[def.id] === false) continue;
    for (const yy of [y - 1, y]) {
      const [a, b] = realWindow(def, yy);
      if (today >= a && today <= b) {
        const phase = def.midnight ? (m === 12 ? 'eve' : 'day') : 'on';
        holiday = { def, id: def.id, key: `${def.id}-R${yy}`, phase, name: holidayName(def, phase), icon: def.icon, progress: (today - a) / Math.max(1, b - a), minutesToMidnight: null, real: true };
      }
    }
  }
  return { season, t, holiday };
}

export const holidayDef = (id) => HOLIDAY_BY_ID[id] ?? null;
