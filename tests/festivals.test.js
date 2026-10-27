// Milestone 4 — seasons, festivals and traditions (brief items 30–34).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { CALENDAR } from '../src/core/Config.js';
import { balance, totalMoney, transfer } from '../src/economy/Transactions.js';
import { produce } from '../src/economy/Businesses.js';
import { die } from '../src/citizens/Lifecycle.js';
import { dailyFestivals, attendanceScore, ensureCulture } from '../src/culture/Festivals.js';
import { considerTraditions } from '../src/culture/Traditions.js';

const fresh = (seed = 9) => new Simulation(createKingdom(seed));
const toDayOfSeason = (sim, n) => { while ((sim.state.day - 1) % CALENDAR.daysPerSeason !== n - 1) sim.runDays(1); };

test('30. festivals cost real money and food, and are cancelled when there is none', () => {
  const sim = fresh();
  const s = sim.state;
  sim.runDays(CALENDAR.daysPerSeason * 4);
  toDayOfSeason(sim, 1);
  // A broke council cannot hold one.
  s.accounts.outside += s.accounts.treasury; s.accounts.treasury = 0;
  ensureCulture(s).current = null;
  dailyFestivals(s);
  assert.equal(s.culture.current.phase, 'CANCELLED');
  // A funded one buys food from local sellers.
  s.accounts.outside -= 300; s.accounts.treasury = 300;
  s.culture.current = null;
  const money = totalMoney(s);
  const sellerStock = s.businesses.reduce((t, b) => t + Object.values(b.inventory).reduce((a, n) => a + n, 0), 0);
  dailyFestivals(s);
  const f = s.culture.current;
  assert.equal(f.phase, 'PREPARING');
  assert.ok(f.spent > 0 && balance(s, 'treasury') === 300 - f.spent + (f.sponsor?.gift ?? 0), 'the treasury paid for it');
  assert.ok(Object.values(f.stock).reduce((a, n) => a + n, 0) > 0, 'there is food for the feast');
  assert.ok(s.businesses.reduce((t, b) => t + Object.values(b.inventory).reduce((a, n) => a + n, 0), 0) < sellerStock, 'it came out of real stock');
  assert.equal(totalMoney(s), money);
});

test('31. attendance is each villager\'s own decision', () => {
  const sim = fresh(1);
  const s = sim.state;
  // The council can afford this festival (whether it can is test 30's business).
  sim.runDays(CALENDAR.daysPerSeason * 4 - 1);
  transfer(s, 'outside', 'treasury', 100, 'grant', 'test: a funded festival');
  sim.runDays(1);
  toDayOfSeason(sim, 2);
  while (s.minute / 60 !== 15) sim.step();
  const f = s.culture.current;
  assert.equal(f.phase, 'ACTIVE');
  const [a, b] = s.citizens;
  a.traits.friendly = 1; a.traits.shy = 0; a.needs.social = 10;
  b.traits.friendly = 0; b.traits.shy = 1; b.needs.social = 95;
  assert.ok(attendanceScore(s, a).score > attendanceScore(s, b).score, 'a lonely, friendly villager wants it more than a shy, contented one');
  b.health.sickUntil = s.day + 2;
  assert.equal(attendanceScore(s, b), null, 'the sick stay home');
  for (let i = 0; i < 30; i++) sim.step();
  assert.ok(f.attendees.length > 0 && f.attendees.length < s.citizens.length, 'some came and some did not');
  assert.ok(f.attendees.every((id) => s.citizens.some((c) => c.id === id) || s.archive[id]));
});

test('32. farms follow the seasons', () => {
  const s = fresh().state;
  const farm = s.businesses.find((b) => b.type === 'farm');
  const at = (seasonDay) => { s.day = seasonDay; farm.inventory.grain = 0; return produce(s, farm, 1); };
  const autumn = at(1 + 2 * CALENDAR.daysPerSeason), winter = at(1 + 3 * CALENDAR.daysPerSeason), summer = at(1 + CALENDAR.daysPerSeason);
  assert.ok(autumn > summer && summer > winter, `harvest ${autumn} > summer ${summer} > winter ${winter}`);
});

test('33. a festival is held once, even across a save and reload', () => {
  const sim = fresh(1);
  sim.runDays(CALENDAR.daysPerSeason * 4);
  toDayOfSeason(sim, 2);
  while (sim.state.minute / 60 !== 16) sim.step();
  const copy = new Simulation(deserialize(serialize(sim.state, 'test')));
  sim.runDays(CALENDAR.daysPerSeason + 1);
  copy.runDays(CALENDAR.daysPerSeason + 1);
  assert.equal(JSON.stringify(copy.state.culture), JSON.stringify(sim.state.culture));
  const key = (h) => `${h.name}/${h.year}`;
  const keys = copy.state.culture.history.map(key);
  assert.equal(new Set(keys).size, keys.length, 'no festival was concluded twice');
});

test('34. traditions come from history and outlive the people who began them', () => {
  const sim = fresh(1);
  const s = sim.state;
  const culture = ensureCulture(s);
  const house = s.citizens[0].lastName;
  culture.sponsors.push({ year: 3, season: 2, house, id: s.citizens[0].id }, { year: 4, season: 2, house, id: s.citizens[0].id });
  considerTraditions(s);
  const t = culture.traditions.find((x) => x.kind === 'sponsorship');
  assert.ok(t, 'two harvests in a row made it a tradition');
  assert.match(t.origin, /two years running/);
  // A child of the house carries it on after the founder dies.
  const founder = s.citizens[0];
  const child = s.citizens.find((c) => c !== founder);
  child.lastName = house;
  die(s, founder, 'old age');
  considerTraditions(s);
  assert.equal(t.active, true, 'the family still lives, so the tradition does');
  const loaded = deserialize(serialize(s, 'test'));
  assert.equal(loaded.culture.traditions.find((x) => x.id === t.id).active, true);
  // Founders' Day appears only once every founder has passed.
  assert.ok(!culture.traditions.some((x) => x.id === 'founders-day'));
  for (const c of s.citizens.filter((x) => x.founder)) die(s, c, 'old age');
  considerTraditions(s);
  assert.ok(culture.traditions.some((x) => x.id === 'founders-day'));
});
