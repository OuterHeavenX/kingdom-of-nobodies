// Milestone 4 — saves across the regional systems, migration from Milestone 3,
// and the mandatory acceptance scenario, played out by the ordinary simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { totalMoney, balance } from '../src/economy/Transactions.js';
import { DAYS_PER_YEAR, CALENDAR, TIME, SAVE_VERSION } from '../src/core/Config.js';
import { ROUTES, COMMODITIES } from '../src/region/RegionData.js';
import { findPath } from '../src/navigation/Pathfinding.js';
import { relation } from '../src/diplomacy/Diplomacy.js';
import { checkInvariants } from './longevity.mjs';

const reload = (sim) => new Simulation(deserialize(serialize(sim.state, 'test')));
const chronicleIds = (s) => s.chronicle.map((e) => e.id);

/** Save now, then run the original and the reloaded copy side by side: they must not diverge. */
function assertReloadsIdentically(sim, ticks, what) {
  const copy = reload(sim);
  for (let i = 0; i < ticks; i++) { sim.step(); copy.step(); }
  assert.equal(JSON.stringify(copy.state), JSON.stringify(sim.state), `${what}: the reloaded world continues identically`);
  const ids = chronicleIds(copy.state);
  assert.equal(new Set(ids).size, ids.length, `${what}: no history entry duplicated`);
}

test('39. a real Milestone 3 save (version 4) migrates into a working Milestone 4 world', () => {
  const text = readFileSync(new URL('./fixtures/m3-save.json', import.meta.url), 'utf8');
  const old = JSON.parse(JSON.parse(text).data);
  assert.equal(old.version, 4);
  const s = deserialize(text);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(SAVE_VERSION, 5);
  assert.equal(s.citizens.length, old.citizens.length, 'nobody is lost');
  for (const [acct, coins] of Object.entries(old.accounts)) if (acct !== 'outside') assert.equal(s.accounts[acct], coins, `${acct} keeps its coins`);
  assert.equal(totalMoney(s), totalMoney(old), 'the new kingdoms are funded from outside, not created from nothing');
  for (const p of old.plots) assert.equal(s.plots.find((x) => x.id === p.id).ownerId, p.ownerId, `${p.name} keeps its owner`);
  assert.deepEqual(Object.keys(s.region.settlements).sort(), ['greenvale', 'ironhold', 'saltmere']);
  for (const d of old.districts.opened) assert.ok(s.roads.some((r) => r.name === `${d} Road`), `${d} has its road`);
  for (const key of ['trade', 'diplomacy', 'law', 'culture', 'navigation']) assert.ok(s[key], `${key} state created`);
  const sim = new Simulation(s);
  const c = s.citizens.find((x) => !x.away);
  assert.ok(!findPath(s, { x: c.x, z: c.z }, { x: 7, z: 3.4 }).failed, 'villagers can find their way to the market');
  const money = totalMoney(s);
  sim.runDays(DAYS_PER_YEAR);
  assert.equal(totalMoney(sim.state), money);
  assert.equal(checkInvariants(sim.state, 'm3', 1), 0, 'all invariants hold a year later');
  assert.ok(sim.state.trade.stats.deliveries > 0, 'the migrated village takes part in regional trade');
});

test('saving during caravan unloading, a pending court case, road works, a festival and a season change never duplicates anything', () => {
  const sim = new Simulation(createKingdom(1));
  const s = () => sim.state;
  const moments = {
    'a caravan unloading': () => s().trade.caravans.some((cv) => cv.status === 'UNLOADING'),
    'a caravan on the road': () => s().trade.caravans.some((cv) => cv.leg && cv.leg.progress > 0 && Object.keys(cv.cargo).length),
    'a scheduled court case': () => s().law.cases.some((c) => c.status === 'SCHEDULED'),
    'road works under way': () => (s().roadProjects ?? []).some((p) => p.status === 'BUILDING' && p.work > 0),
    'a festival in full swing': () => s().culture.current?.phase === 'ACTIVE' && s().culture.current.attendees.length > 0,
    'the last hour before a new season': () => (s().day - 1) % CALENDAR.daysPerSeason === CALENDAR.daysPerSeason - 1 && s().minute >= 23 * 60,
  };
  const pending = new Set(Object.keys(moments));
  const limit = 80 * TIME.ticksPerDay;
  for (let i = 0; i < limit && pending.size; i++) {
    sim.step();
    for (const what of [...pending]) {
      if (!moments[what]()) continue;
      pending.delete(what);
      const deliveries = s().trade.stats.deliveries, judged = s().law.stats.judged;
      assertReloadsIdentically(sim, TIME.ticksPerDay, what);
      assert.ok(s().trade.stats.deliveries >= deliveries && s().law.stats.judged >= judged);
    }
  }
  assert.deepEqual([...pending], [], 'every moment arose in ordinary play');
  assert.equal(checkInvariants(s(), 'reloads', 0), 0);
});

test('acceptance: Ironhold goes hungry, a First Hearth merchant brings Greenvale food, a wage dispute is judged, the harvest is celebrated, and a reload keeps it all consistent', () => {
  // Seeds are tried in turn: the scenario must arise from ordinary play, and which seed's
  // history produces it first depends on everything else the village does.
  let sim = null, money = 0;
  const s = () => sim.state;
  const isTheTrade = (c) => c.merchantHome === 'hearth' && c.merchantId.startsWith('c') && c.origin === 'greenvale' && c.destination === 'ironhold' && ['grain', 'provisions'].includes(c.commodity) && /short of food/.test(c.reason);
  let contract = null, merchantBefore = 0, grainBefore = 0, departTick = 0, reloadedMidJourney = false, delivered = null;
  for (const seed of [1, 2, 3, 4]) {
    if (delivered) break;
    sim = new Simulation(createKingdom(seed));
    money = totalMoney(s());
    contract = null; departTick = 0; reloadedMidJourney = false;
    for (let i = 0; i < 400 * TIME.ticksPerDay && !delivered; i++) {
      const iron = s().region.settlements.ironhold;
      if (contract?.status === 'IN_TRANSIT') { merchantBefore = balance(s(), contract.merchantAccount); grainBefore = iron.inventory[contract.commodity]; }
      sim.step();
      contract = contract ?? s().trade.contracts.find((c) => isTheTrade(c) && c.status === 'AGREED') ?? null;
      if (!contract) continue;
      contract = s().trade.contracts.find((c) => c.id === contract.id) ?? null;
      // A trade that falls through (cancelled, embargoed, partly lost) is not the one we follow.
      if (!contract || !['AGREED', 'IN_TRANSIT', 'DELIVERED'].includes(contract.status)) { contract = null; departTick = 0; continue; }
      const cv = s().trade.caravans.find((x) => x.id === contract.caravanId);
      if (contract.status === 'IN_TRANSIT' && !departTick) departTick = s().tick;
      // Save and reload halfway along the road: the journey resumes exactly where it was.
      if (!reloadedMidJourney && cv?.leg && cv.leg.to === 'ironhold' && cv.leg.progress > cv.leg.km / 2) {
        assertReloadsIdentically(sim, 6, 'mid-journey');
        reloadedMidJourney = true;
      }
      if (contract.status === 'DELIVERED') delivered = { contract, cv, tick: s().tick, minute: s().minute };
    }
  }
  assert.ok(delivered, 'a First Hearth merchant delivered Greenvale food to hungry Ironhold');
  const c = delivered.contract;
  const merchant = s().citizens.find((x) => x.id === c.merchantId);
  assert.ok(merchant, `${c.merchantName} is a villager of First Hearth`);
  assert.match(c.reason, /Ironhold is short of food; Greenvale sells at [\d.]+ a unit, Ironhold pays [\d.]+/, 'the merchant weighed the opportunity');
  assert.ok(c.paidSeller > 0, 'the merchant paid Greenvale for the grain from their own funds');
  assert.ok(reloadedMidJourney, 'the game was saved and reloaded while the caravan was on the road');
  // A real regional route, and real time on it.
  const legs = delivered.cv.log.map((l) => l.text).filter((t) => /Set out on/.test(t));
  assert.ok(legs.length >= 2, 'the caravan travelled out to Greenvale and on to Ironhold');
  for (const t of legs) assert.ok(ROUTES.some((r) => t.includes(r.name)), `"${t}" names a real road`);
  assert.ok((delivered.tick - departTick) * TIME.minutesPerTick / 60 >= 12, 'the journey took simulated hours');
  // Goods and money changed hands exactly once.
  if (delivered.minute !== 0) assert.equal(s().region.settlements.ironhold.inventory[c.commodity] - grainBefore, c.delivered, "Ironhold's food store grew by the delivery");
  assert.equal(balance(s(), c.merchantAccount) - merchantBefore, c.revenue - c.tariffPaid, 'the merchant was paid, less the tariff');
  assert.equal(s().chronicle.filter((e) => e.category === 'trade' && e.text.includes(`delivered ${c.delivered} ${COMMODITIES[c.commodity].label.toLowerCase()} from Greenvale to Ironhold`)).length >= 1, true, 'the Chronicle records the delivery');
  assert.ok(relation(s(), 'hearth', 'ironhold').log.some((l) => l.why === 'profitable trade'), 'the trade warmed relations');
  // Meanwhile, in the village: a wage dispute and the Harvest Festival.
  const wage = s().law.cases.find((x) => x.kind === 'wages' && x.status === 'JUDGED' && x.judgment.outcome === 'restitution');
  assert.ok(wage, 'a worker sued for unpaid wages and won');
  assert.ok(wage.evidence.some((e) => /employ|shift|wage/i.test(e.text)), 'the court examined the wage records');
  assert.ok(wage.judgment.transfers.some((t) => t.kind === 'restitution' && t.amount > 0 && t.to === wage.plaintiff.id), 'restitution moved real coins to the worker');
  const harvest = s().culture.history.findLast((h) => h.name === 'Harvest Festival');
  assert.ok(harvest && harvest.cost > 0 && harvest.attendance > 0 && harvest.attendance < harvest.population, 'the Harvest Festival cost the treasury and drew some, not all');
  assert.equal(totalMoney(s()), money, 'no coin was created or lost');
  assert.equal(checkInvariants(s(), 'acceptance', 0), 0);
  // One last save: every caravan, case, treaty, festival, road project and record survives as it was.
  const loaded = deserialize(serialize(s(), 'test'));
  for (const key of ['trade', 'law', 'diplomacy', 'culture', 'roadProjects', 'chronicle', 'archive', 'region']) assert.deepEqual(loaded[key], s()[key], `${key} survives saving`);
});
