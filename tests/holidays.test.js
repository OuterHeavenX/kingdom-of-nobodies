// Milestone 5.1 — the living calendar: holiday dates, the kingdom's
// celebrations, saves, accelerated time and the systems around them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { deserialize, serialize } from '../src/core/Serialization.js';
import { totalMoney } from '../src/economy/Transactions.js';
import { GameClock } from '../src/core/GameClock.js';
import { DAYS_PER_YEAR, SAVE_VERSION, TIME } from '../src/core/Config.js';
import { seasonIndex } from '../src/core/Calendar.js';
import { HOLIDAYS, HOLIDAY_BY_ID } from '../src/holidays/HolidayRegistry.js';
import { holidayAt, occurrencesBetween, seasonProgress, realWorldTheme, easter, gratitudeDay, yearMinutes, absMinute, nextHoliday } from '../src/holidays/HolidayCalendar.js';
import { ensureHolidays, holidayNow, hourlyHolidays, celebrationWish, setHolidayEnabled } from '../src/culture/Holidays.js';
import { normalizeSettings, DEFAULTS } from '../src/holidays/HolidaySettings.js';
import { untilText } from '../src/ui/CelebrationsPanel.js';
import { checkInvariants } from './longevity.mjs';

const at = (season, dayOfSeason, hour, year = 1) => ({ day: (year - 1) * DAYS_PER_YEAR + season * 3 + dayOfSeason, minute: hour * 60 });
/** Run the simulation tick by tick until it reaches a given day and minute. */
function advanceTo(sim, { day, minute }) {
  const s = sim.state;
  while (s.day < day || (s.day === day && s.minute < minute)) sim.step();
}
const m5Fixture = () => deserialize(readFileSync(new URL('./fixtures/m5-save.json', import.meta.url), 'utf8'));

test('2. every holiday falls in its season, in order, without overlapping, and New Year meets the year boundary', () => {
  const list = occurrencesBetween(1, 1 + DAYS_PER_YEAR * 3);
  assert.equal(list.length, HOLIDAYS.length * 3, 'each holiday once a year');
  for (let i = 1; i < list.length; i++) assert.ok(list[i].start >= list[i - 1].end - 1e-6, `${list[i - 1].key} ends before ${list[i].key} begins`);
  for (const o of list) {
    const day = Math.floor(o.start / 1440) + 1;
    assert.equal(seasonIndex(day), o.def.season, `${o.key} starts in its season`);
  }
  for (const o of list.filter((x) => x.id === 'newyear')) assert.equal(o.midnight % yearMinutes(), 0, 'midnight is the start of a kingdom year');
  // Spot checks against the calendar a player sees.
  const hw = at(2, 3, 12);
  assert.equal(holidayAt(hw.day, hw.minute).id, 'halloween');
  const v = at(0, 1, 15, 4);
  assert.equal(holidayAt(v.day, v.minute).id, 'valentine');
  const quiet = at(1, 2, 12, 2);
  assert.equal(holidayAt(quiet.day, quiet.minute)?.id, 'solstice');
  assert.equal(holidayAt(at(1, 3, 2).day, at(1, 3, 2).minute), null, 'some hours belong to no holiday');
  // A disabled holiday is skipped; the next one is reported.
  assert.equal(holidayAt(hw.day, hw.minute, { enabled: { halloween: false } }), null);
  assert.equal(nextHoliday(hw.day, hw.minute).id, 'gratitude');
});

test('2b. real-world dates map to the familiar holidays (visual only)', () => {
  assert.deepEqual(easter(2026), [4, 5]);
  assert.deepEqual(easter(2024), [3, 31]);
  assert.deepEqual(gratitudeDay(2026), [11, 26]);
  assert.equal(realWorldTheme(new Date(2026, 9, 25)).holiday.id, 'halloween');
  assert.equal(realWorldTheme(new Date(2026, 9, 25)).season, 2);
  const eve = realWorldTheme(new Date(2026, 11, 31)).holiday;
  assert.equal(eve.id, 'newyear'); assert.equal(eve.phase, 'eve');
  const nyd = realWorldTheme(new Date(2027, 0, 1)).holiday;
  assert.equal(nyd.id, 'newyear'); assert.equal(nyd.phase, 'day');
  assert.equal(realWorldTheme(new Date(2026, 1, 14)).holiday.id, 'valentine');
  assert.equal(realWorldTheme(new Date(2026, 3, 2)).holiday.id, 'spring', 'the week before Easter');
  assert.equal(realWorldTheme(new Date(2026, 11, 20)).holiday.id, 'winter');
  assert.equal(realWorldTheme(new Date(2026, 6, 4)).holiday.id, 'founders');
  assert.equal(realWorldTheme(new Date(2026, 4, 20)).holiday, null);
});

test('3. shortened and lengthened calendars and leap years keep holidays in place', () => {
  for (const daysPerSeason of [2, 5, 7]) {
    const calendar = { daysPerSeason, seasons: ['Spring', 'Summer', 'Autumn', 'Winter'] };
    const list = occurrencesBetween(1, 1 + daysPerSeason * 4 * 2, { calendar });
    assert.equal(list.length, HOLIDAYS.length * 2, `${daysPerSeason}-day seasons: every holiday each year`);
    const ids = list.slice(0, HOLIDAYS.length).map((o) => o.id);
    assert.deepEqual(ids, occurrencesBetween(1, 13).map((o) => o.id), 'same order as the standard calendar');
    for (const o of list) {
      const season = seasonProgress(Math.floor(o.start / 1440) + 1, o.start % 1440, calendar).season;
      assert.equal(season, o.def.season, `${o.key} stays in its season`);
      if (o.midnight != null) assert.equal(o.midnight % yearMinutes(calendar), 0);
    }
  }
  // 29 February is an ordinary late-winter day; no holiday is lost or doubled across a leap year.
  const leap = realWorldTheme(new Date(2028, 1, 29));
  assert.equal(leap.season, 3);
  assert.equal(leap.holiday, null);
  assert.equal(realWorldTheme(new Date(2024, 2, 30)).holiday.id, 'spring', 'Easter 2024 fell on 31 March');
});

test('9. the New Year countdown counts kingdom minutes to midnight', () => {
  const eve = at(3, 3, 22);
  const h = holidayAt(eve.day, eve.minute);
  assert.equal(h.id, 'newyear');
  assert.equal(h.phase, 'eve');
  assert.equal(h.minutesToMidnight, 120);
  assert.equal(untilText(h.minutesToMidnight), '2h 00m');
  const late = holidayAt(eve.day, 23 * 60 + 50);
  assert.equal(untilText(late.minutesToMidnight), '10 min');
  const after = holidayAt(eve.day + 1, 30);
  assert.equal(after.phase, 'day');
  assert.equal(after.name, "New Year's Day");
  assert.equal(after.minutesToMidnight, null);
});

test('10 & 15. fireworks are recorded once per occurrence, at 1× or 20×, and never replayed after a load', () => {
  // Run two identical kingdoms through two New Years: one ticked as at 1×, one through the clock at 20×.
  const a = new Simulation(createKingdom(31));
  const b = new Simulation(createKingdom(31));
  const days = DAYS_PER_YEAR * 2 + 1;
  a.runDays(days);
  const clock = new GameClock(() => b.step());
  clock.speed = 20;
  const target = days * TIME.ticksPerDay;
  let ticks = 0;
  while (ticks < target) ticks += clock.advance(Math.min(0.1, (target - ticks) * TIME.realSecondsPerTick / 20));
  assert.equal(b.state.tick, a.state.tick, 'the same ticks were simulated');
  assert.equal(serialize(b.state).length > 0, true);
  assert.deepEqual(b.state.holidays.fireworks, a.state.holidays.fireworks, 'accelerated time changes nothing');
  const keys = a.state.holidays.fireworks.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, 'no show twice');
  assert.ok(keys.includes('newyear-Y1') && keys.includes('newyear-Y2') && keys.includes('founders-Y2'));
  // Save just after midnight and load: the hour is not replayed.
  const s = deserialize(serialize(a.state));
  const before = s.holidays.fireworks.length;
  hourlyHolidays(s);
  hourlyHolidays(s);
  assert.equal(s.holidays.fireworks.length, before);
  // A world that starts (or loads) after the hour has passed never sets them off late.
  const fresh = createKingdom(5);
  fresh.minute = 9 * 60; // 09:00 on New Year's Day
  hourlyHolidays(fresh);
  assert.equal(fresh.holidays.fireworks.length, 0);
});

test('15. holiday records stay bounded across generations', () => {
  const sim = new Simulation(createKingdom(12));
  sim.runDays(DAYS_PER_YEAR * 4);
  const h = sim.state.holidays;
  assert.ok(h.log.length <= 24 && h.fireworks.length <= 8);
  const keys = h.log.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, 'each occurrence logged once');
  assert.ok(h.log.filter((e) => e.closed).every((e) => !e.people), 'finished celebrations keep counts, not lists of people');
  for (const c of sim.state.citizens) assert.ok(!c.holiday || typeof c.holiday.key === 'string');
});

test('10b. citizens choose to celebrate, within reason, and celebrations make no money or goods', () => {
  const sim = new Simulation(createKingdom(8));
  sim.runDays(DAYS_PER_YEAR * 2);
  const s = sim.state;
  const money = totalMoney(s);
  const v = at(0, 1, 18, 3);
  advanceTo(sim, v);
  assert.equal(holidayNow(s)?.id, 'valentine');
  const base = s.citizens.find((x) => x.romance?.partnerId || x.family?.spouseId) ?? s.citizens[0];
  const c = { ...base, away: null, holiday: null, health: { ...base.health, sickUntil: 0 }, needs: { ...base.needs, hunger: 90 } };
  const wish = celebrationWish(s, c);
  assert.ok(wish && wish.factors.length > 0, 'a reasoned wish');
  // The hungry eat first.
  const hungry = { ...c, needs: { ...c.needs, hunger: 20 } };
  assert.equal(celebrationWish(s, hungry), null);
  // Faith: a devout follower of another tradition keeps their own observances at the Winter Festival.
  const w = at(3, 2, 15, 3);
  advanceTo(sim, w);
  assert.equal(holidayNow(s)?.id, 'winter');
  const devout = { ...s.citizens[0], away: null, holiday: null, health: { ...s.citizens[0].health, sickUntil: 0 }, belief: { tradition: 'dawn', stance: 'devout' }, needs: { ...s.citizens[0].needs, hunger: 90 } };
  const keeper = { ...devout, belief: { tradition: 'hearthkin', stance: 'devout' } };
  assert.ok(celebrationWish(s, devout).factors.some(([t]) => /own observances/.test(t)));
  assert.ok(celebrationWish(s, keeper).score > celebrationWish(s, devout).score);
  // Over the year people celebrated, and every coin is still accounted for.
  assert.ok(s.holidays.log.some((e) => e.celebrants > 0));
  assert.equal(totalMoney(s), money);
});

test('14. holiday choices and records survive save and load; a version 6 save migrates', () => {
  const sim = new Simulation(createKingdom(21));
  sim.runDays(DAYS_PER_YEAR + 9);
  const s = sim.state;
  assert.ok(setHolidayEnabled(s, 'halloween', false));
  const back = deserialize(serialize(s));
  assert.equal(back.holidays.enabled.halloween, false);
  assert.deepEqual(back.holidays.log, s.holidays.log);
  assert.deepEqual(back.holidays.fireworks, s.holidays.fireworks);
  const hw = at(2, 3, 12, 3);
  assert.equal(holidayAt(hw.day, hw.minute, { enabled: back.holidays.enabled }), null, 'a disabled holiday stays off after loading');
  // A real save from v0.5.0 (format 6).
  const raw = JSON.parse(JSON.parse(readFileSync(new URL('./fixtures/m5-save.json', import.meta.url), 'utf8')).data);
  assert.equal(raw.version, 6);
  const m = m5Fixture();
  assert.equal(m.version, SAVE_VERSION);
  assert.equal(SAVE_VERSION, 8); // v0.5.2 raised it again (civilization ages); v6 still migrates forward
  assert.ok(HOLIDAYS.every((d) => m.holidays.enabled[d.id] === true), 'every holiday is kept after migrating');
  assert.equal(m.citizens.length, raw.citizens.length);
  assert.equal(totalMoney(m), totalMoney(raw));
  assert.ok(m.migrationNotes.some((n) => n.version === 7));
  const sim2 = new Simulation(m);
  sim2.runDays(DAYS_PER_YEAR);
  assert.equal(totalMoney(sim2.state), totalMoney(raw), 'and it runs on with money conserved');
  // Device display settings round-trip and reject nonsense.
  const settings = normalizeSettings(JSON.parse(JSON.stringify({ ...DEFAULTS, density: 'high', snow: false, linger: 999, duration: 'forever' })));
  assert.equal(settings.density, 'high'); assert.equal(settings.snow, false); assert.equal(settings.linger, 180); assert.equal(settings.duration, 'normal');
});

test('19. the rest of the world carries on through the holidays, deterministically', () => {
  const a = new Simulation(createKingdom(44));
  a.runDays(DAYS_PER_YEAR * 2 + 5);
  const money = totalMoney(a.state);
  // Save mid-way through Halloween and continue in two copies: identical futures.
  const hw = at(2, 3, 9, 3);
  advanceTo(a, hw);
  assert.equal(holidayNow(a.state)?.id, 'halloween');
  const b = new Simulation(deserialize(serialize(a.state)));
  a.runDays(6); b.runDays(6);
  assert.equal(JSON.stringify({ ...a.state, events: [] }), JSON.stringify({ ...b.state, events: [] }));
  assert.equal(totalMoney(a.state), money);
  assert.equal(checkInvariants(a.state, 'holidays', 3), 0, 'every invariant of the stress test holds');
  assert.ok(a.state.businesses.some((x) => x.status === 'OPEN' || x.status === 'STRUGGLING'));
  assert.ok(Object.values(HOLIDAY_BY_ID).length === 10);
  ensureHolidays(a.state);
  assert.equal(absMinute(a.state.day, a.state.minute) > 0, true);
});
