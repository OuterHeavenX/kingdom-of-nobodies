// Milestone 5 — guilds and faith communities (Phase D).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/Simulation.js';
import { deserialize, serialize } from '../src/core/Serialization.js';
import { totalMoney, transfer, balance } from '../src/economy/Transactions.js';
import { qty } from '../src/economy/Inventory.js';
import { ageOf } from '../src/citizens/Citizen.js';
import { FOOD_GOODS } from '../src/core/Config.js';
import { ensureGuilds, activeGuilds, guildKeyFor, GUILD_TYPES, elect, seasonalGuilds, guildByKey, guildEndorsements } from '../src/institutions/GuildManager.js';
import { guildEconomy } from '../src/institutions/GuildEconomy.js';
import { activeCommunities, membersOf, charity, dailyFaith, consoleBereaved } from '../src/institutions/ReligiousInstitutions.js';
import { beliefOf, TRADITIONS } from '../src/institutions/FaithManager.js';
import { openCampaign } from '../src/politics/Government.js';
import { platformFor, defaultPolicies } from '../src/politics/Policies.js';

const fixture = () => deserialize(readFileSync(new URL('./fixtures/m4-save.json', import.meta.url), 'utf8'));
const toSeasonStart = (s) => { while ((s.day - 1) % 3 !== 0) s.day++; };

function grownWorld() {
  const s = fixture();
  const sim = new Simulation(s);
  sim.runDays(12 * 3);
  return { s, sim };
}

test('guilds form from real trades, with valid and exclusive membership', () => {
  const { s } = grownWorld();
  const guilds = activeGuilds(s);
  assert.ok(guilds.length >= 2, `guilds formed (${guilds.map((g) => g.name).join(', ')})`);
  const seen = new Set();
  for (const g of guilds) {
    for (const id of g.members) {
      const c = s.citizens.find((x) => x.id === id);
      assert.ok(c, `${g.name} member ${id} lives here`);
      assert.ok(!seen.has(id), `${c.firstName} belongs to one guild only`);
      seen.add(id);
      assert.ok(ageOf(s, c) >= 18);
      assert.ok(GUILD_TYPES[g.key].professions.includes(c.profession.replace(/^Retired /, '')) || /^Retired/.test(c.profession), `${c.firstName} (${c.profession}) practises the trade`);
    }
    if (g.members.length) assert.ok(g.members.includes(g.leaderId), `${g.name}'s master is a member`);
    assert.ok(Number.isInteger(balance(s, g.id)) && balance(s, g.id) >= 0);
  }
});

test('dues move real coins into the guild fund; an election produces a valid master', () => {
  const { s } = grownWorld();
  const g = activeGuilds(s).find((x) => x.members.length >= 2);
  assert.ok(g);
  const money = totalMoney(s);
  for (const id of g.members) transfer(s, 'outside', id, 10, 'grant', 'test');
  const before = balance(s, g.id);
  const members = g.members.length;
  toSeasonStart(s); s.day += 3;
  seasonalGuilds(s);
  assert.ok(balance(s, g.id) - before >= 2 * Math.min(members, g.members.length), 'dues were paid');
  assert.equal(totalMoney(s), money, 'no coins created');
  const winner = elect(s, g, 'test');
  assert.ok(g.members.includes(winner.id));
  const last = g.elections.at(-1);
  const top = Math.max(...Object.values(last.votes));
  assert.equal(last.votes[winner.id], top, 'the master won the most votes');
  assert.equal(Object.values(last.votes).reduce((a, b) => a + b, 0), last.turnout, 'every member voted once');
});

test('acceptance: the Merchants\' Guild builds a hall and backs the low-tariff candidate; a faith community feeds struggling families in winter', () => {
  const { s, sim } = grownWorld();
  const money = totalMoney(s);
  let g = guildByKey(s, 'merchants');
  if (!g) {
    const merchants = s.citizens.filter((c) => ageOf(s, c) >= 18).slice(0, 4);
    for (const c of merchants) c.profession = 'Merchant';
    toSeasonStart(s); s.day += 3; seasonalGuilds(s);
    g = guildByKey(s, 'merchants');
  }
  assert.ok(g, 'a Merchants\' Guild exists');
  // A prosperous guild: members' dues have built up a fund.
  for (const id of g.members.slice(0, 4)) transfer(s, 'outside', id, 200, 'grant', 'test: a good year of trade');
  for (const id of g.members.slice(0, 4)) transfer(s, id, g.id, 100, 'dues', 'test: subscriptions for the hall');
  while (g.members.length < 4) { const c = s.citizens.find((x) => !g.members.includes(x.id) && !activeGuilds(s).some((y) => y.members.includes(x.id)) && ageOf(s, x) >= 18); c.profession = 'Merchant'; g.members.push(c.id); }
  const hasHall = () => g.plotId && s.plots.find((p) => p.id === g.plotId)?.building?.type === 'guildhall';
  for (let i = 0; i < 60 && !hasHall(); i++) sim.runDays(1);
  assert.ok(hasHall(), 'the guild hall was built');
  assert.ok(s.chronicle.some((e) => /Merchants' Guild Hall opened/.test(e.text)), 'the Chronicle records the hall');
  // Election: the guild backs the candidate promising lower tariffs.
  const low = { id: 'x1', platform: { ...defaultPolicies(), tariffLevel: 'low', reducedFees: true } };
  const high = { id: 'x2', platform: { ...defaultPolicies(), tariffLevel: 'high' } };
  const backing = guildEndorsements(s, [high, low]);
  assert.ok((backing.x1 ?? []).includes(g.id), 'the guild supports reduced tariffs');
  // Winter charity: real food, from a real store, to real households.
  const f = activeCommunities(s)[0];
  assert.ok(f, 'a faith community exists');
  transfer(s, 'outside', f.id, 120, 'donation', 'test: a generous year of offerings');
  const poor = s.citizens.filter((c) => ageOf(s, c) >= 18).slice(0, 3);
  for (const c of poor) { c.needs.hunger = 20; for (const fg of FOOD_GOODS) c.inventory[fg] = 0; }
  const fundsBefore = balance(s, f.id);
  const res = charity(s, f, { festival: true });
  assert.ok(res && res.meals > 0, 'food was given');
  assert.ok(balance(s, f.id) < fundsBefore, 'the food was bought with the community\'s funds');
  const got = poor.filter((c) => FOOD_GOODS.some((fg) => qty(c.inventory, fg) > 0));
  assert.ok(got.length >= 1, 'struggling villagers received food into their own stores');
  assert.ok(got.some((c) => c.memories.some((m) => m.text.includes(f.name))), 'and remember who helped them');
  assert.match(res.entry.text, /winter charity/);
  assert.equal(totalMoney(s), money, 'money moved, never made');
});

test('donations, rites and consolation touch real accounts and real people; belief never changes character', () => {
  const { s } = grownWorld();
  const f = activeCommunities(s)[0];
  assert.ok(f);
  const members = membersOf(s, f).filter((c) => ageOf(s, c) >= 18);
  for (const c of members) transfer(s, 'outside', c.id, 300, 'grant', 'test');
  const honesty = s.citizens.map((c) => [c.id, c.reputation.honesty, JSON.stringify(c.traits)]);
  const before = balance(s, f.id);
  toSeasonStart(s); s.day += 3;
  dailyFaith(s);
  assert.ok(balance(s, f.id) > before || f.stats.donations > 0, 'members gave offerings');
  for (const [id, h, t] of honesty) { const c = s.citizens.find((x) => x.id === id); assert.equal(c.reputation.honesty, h); assert.equal(JSON.stringify(c.traits), t); }
  // Every citizen has a belief, which may be none.
  for (const c of s.citizens) { const b = beliefOf(s, c); assert.ok(['devout', 'casual', 'skeptical', 'none'].includes(b.stance)); if (b.tradition) assert.ok(TRADITIONS[b.tradition]); }
  assert.ok(s.citizens.some((c) => c.belief.stance === 'none' || c.belief.stance === 'skeptical'), 'not everyone is religious');
  // Grief: the elder sits with the bereaved.
  const dead = members.find((c) => c.family.spouseId && s.citizens.some((x) => x.id === c.family.spouseId));
  if (dead && f.leaderId && f.leaderId !== dead.id) {
    const spouse = s.citizens.find((x) => x.id === dead.family.spouseId);
    const mood = spouse.mood;
    consoleBereaved(s, dead);
    assert.ok(spouse.mood > mood || !membersOf(s, f).includes(spouse));
  }
});

test('guilds and faith survive save/load without duplicating members, funds or events', () => {
  const { s } = grownWorld();
  const back = deserialize(serialize(s));
  assert.equal(JSON.stringify(back.guilds), JSON.stringify(s.guilds));
  assert.equal(JSON.stringify(back.faith), JSON.stringify(s.faith));
  const a = new Simulation(s), b = new Simulation(back);
  a.runDays(13); b.runDays(13);
  assert.equal(JSON.stringify(back.guilds), JSON.stringify(s.guilds), 'continues identically');
  assert.equal(JSON.stringify(back.faith), JSON.stringify(s.faith));
  for (const g of ensureGuilds(s).list) assert.equal(new Set(g.members).size, g.members.length);
  assert.ok(guildKeyFor({ profession: 'Merchant' }) === 'merchants');
  assert.ok(platformFor);
  assert.ok(openCampaign);
  assert.ok(guildEconomy);
});
