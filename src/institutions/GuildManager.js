import { INSTITUTIONS, LIFE, DAYS_PER_YEAR } from '../core/Config.js';
import { balance, transfer } from '../economy/Transactions.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { peekRel, adjust } from '../citizens/Relationships.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { bump } from '../society/Reputation.js';
import { yearOf, isNewSeason, isNewYear } from '../core/Calendar.js';
import { raiseCash, spendable } from '../finance/BankAccounts.js';

// Professional guilds. People who share a trade band together once there are
// enough of them: they pay dues into a common fund (a real ledger account),
// elect a master from among themselves, train apprentices, help members in
// hardship, set standards, build a hall, and take positions on the questions
// the village votes on. Guilds disagree with each other when their trades
// want different things, and those disagreements show up in elections.

export const GUILD_TYPES = {
  merchants: { name: "Merchants' Guild", professions: ['Merchant', 'Innkeeper', 'Baker'], positions: { tariffLevel: 'low', reducedFees: true }, interests: { trade: 0.35, business: 0.25 }, cause: 'lower tariffs and fees' },
  builders: { name: "Builders' Guild", professions: ['Builder', 'Laborer'], positions: { publicWorks: true, constructionGrants: true }, interests: { works: 0.4 }, cause: 'public works and building grants' },
  smiths: { name: "Blacksmiths' Guild", professions: ['Blacksmith'], positions: { tariffLevel: 'high' }, interests: { trade: -0.35 }, cause: 'protection from imported tools' },
  farmers: { name: "Farmers' Association", professions: ['Farmer', 'Forager'], positions: { foodAssistance: true, taxLevel: 'low' }, interests: { taxes: 0.2, welfare: 0.1 }, cause: 'low taxes and a full granary' },
  carpenters: { name: "Carpenters' Guild", professions: ['Woodcutter'], positions: { publicWorks: true }, interests: { works: 0.3 }, cause: 'steady building work' },
};

const tradeOf = (c) => String(c.profession ?? '').replace(/^Retired /, '');
export const guildKeyFor = (c) => Object.entries(GUILD_TYPES).find(([, g]) => g.professions.includes(tradeOf(c)))?.[0] ?? null;

export function ensureGuilds(state) {
  if (state.guilds) return state.guilds;
  state.guilds = { list: [], nextId: 0, disputes: [] };
  return state.guilds;
}

export const activeGuilds = (state) => ensureGuilds(state).list.filter((g) => g.status === 'ACTIVE');
export const guildOf = (state, c) => activeGuilds(state).find((g) => g.members.includes(c.id)) ?? null;
export const guildByKey = (state, key) => activeGuilds(state).find((g) => g.key === key) ?? null;

function note(state, g, text, importance = 1) {
  g.history.push({ day: state.day, text });
  if (g.history.length > 24) g.history.shift();
  record(state, 'economy', text, { citizens: g.leaderId ? [g.leaderId] : [] }, importance);
}

/** Seasonal: a trade with enough practitioners forms a guild. */
function foundGuilds(state) {
  for (const [key, def] of Object.entries(GUILD_TYPES)) {
    if (guildByKey(state, key)) continue;
    const people = state.citizens.filter((c) => ageOf(state, c) >= LIFE.adultAge && !c.away && def.professions.includes(tradeOf(c)) && !tradeOf(c).startsWith('Retired'));
    if (people.length < INSTITUTIONS.guildMinMembers) continue;
    const founder = [...people].sort((a, b) => skillIn(b, key) - skillIn(a, key) || b.reputation.standing - a.reputation.standing || a.id.localeCompare(b.id))[0];
    const g = ensureGuilds(state);
    const id = 'gld' + ++g.nextId;
    state.accounts[id] = 0;
    const guild = { id, key, name: def.name, status: 'ACTIVE', foundedDay: state.day, members: [], leaderId: founder.id, elections: [], plotId: null, missed: {}, joined: {},
      stats: { dues: 0, aid: 0, training: 0, sponsored: 0, members: 0 }, privileges: [], history: [] };
    g.list.push(guild);
    for (const c of people.filter((p) => wantsToJoin(state, p, guild) || p === founder)) join(state, guild, c);
    note(state, guild, `The ${def.name} was founded with ${guild.members.length} members; ${founder.firstName} ${founder.lastName} is its first master (Year ${yearOf(state.day)}).`, 3);
    remember(state, founder, `Founded the ${def.name}.`, 3, 'milestone');
  }
}

const SKILL = { merchants: 'trade', builders: 'building', smiths: 'smithing', farmers: 'farming', carpenters: 'forestry' };
const skillIn = (c, key) => c.skills[SKILL[key]] ?? 0;

/** Whether a practitioner thinks membership is worth the dues. */
function wantsToJoin(state, c, g) {
  const money = spendable(state, c.id);
  const friends = g.members.filter((id) => (peekRel(state, c.id, id)?.friendship ?? 0) > 30).length;
  const score = 0.35 + trait(c, 'loyal') * 0.3 + trait(c, 'ambitious') * 0.25 + trait(c, 'friendly') * 0.2 - trait(c, 'frugal') * 0.25 - trait(c, 'stubborn') * 0.15
    + friends * 0.1 + (money < 15 ? 0.2 : 0) + (g.plotId ? 0.15 : 0) - (money < 3 ? 0.4 : 0);
  return score > 0.45;
}

export function join(state, g, c) {
  if (g.members.includes(c.id) || guildOf(state, c)) return false;
  g.members.push(c.id);
  g.joined[c.id] = state.day;
  remember(state, c, `Joined the ${g.name}.`, 2, 'career');
  for (const id of g.members) if (id !== c.id) adjust(state, c.id, id, { friendship: 1, trust: 1 });
  return true;
}

export function leave(state, g, id, why) {
  g.members = g.members.filter((m) => m !== id);
  delete g.joined[id];
  delete g.missed[id];
  const c = byId(state.citizens, id);
  if (c && why) remember(state, c, `Left the ${g.name} (${why}).`, 1, 'career');
  if (g.leaderId === id) { g.leaderId = null; elect(state, g, `${c ? c.firstName : 'the master'} ${why === 'died' ? 'died' : 'left'}`); }
}

/** Members elect their master: experience, standing and friendship decide each vote. */
export function elect(state, g, why = 'the yearly election') {
  const members = g.members.map((id) => byId(state.citizens, id)).filter((c) => c && ageOf(state, c) >= LIFE.adultAge);
  if (!members.length) { g.leaderId = null; return null; }
  const tenure = (c) => (state.day - (g.joined[c.id] ?? state.day)) / DAYS_PER_YEAR;
  const candidates = [...members].sort((a, b) => (b.reputation.standing + skillIn(b, g.key) * 40 + tenure(b) * 3) - (a.reputation.standing + skillIn(a, g.key) * 40 + tenure(a) * 3) || a.id.localeCompare(b.id)).slice(0, 3);
  const votes = Object.fromEntries(candidates.map((c) => [c.id, 0]));
  for (const v of members) {
    let best = null, bestS = -Infinity;
    for (const cand of candidates) {
      const r = peekRel(state, v.id, cand.id);
      const s = cand.id === v.id ? 1000 : (r?.friendship ?? 20) / 10 + (r?.respect ?? 30) / 8 + cand.reputation.standing / 15 + skillIn(cand, g.key) * 6 - (r?.rivalry ?? 0) / 10;
      if (s > bestS || (s === bestS && cand.id < best.id)) { bestS = s; best = cand; }
    }
    votes[best.id]++;
  }
  const ranked = [...candidates].sort((a, b) => votes[b.id] - votes[a.id] || b.reputation.standing - a.reputation.standing || a.id.localeCompare(b.id));
  const winner = ranked[0];
  const previous = g.leaderId;
  g.leaderId = winner.id;
  g.elections.push({ day: state.day, why, winnerId: winner.id, votes: { ...votes }, turnout: members.length });
  if (g.elections.length > 12) g.elections.shift();
  if (previous !== winner.id) {
    bump(winner, 'standing', 4);
    remember(state, winner, `Elected master of the ${g.name}.`, 3, 'career');
    note(state, g, `${winner.firstName} ${winner.lastName} was elected master of the ${g.name} with ${votes[winner.id]} of ${members.length} votes (${why}).`, 2);
    const loser = byId(state.citizens, previous);
    if (loser) adjust(state, loser.id, winner.id, { rivalry: 6 });
  }
  return winner;
}

/** Seasonal dues: each member pays into the fund; two missed seasons and membership lapses. */
function collectDues(state, g) {
  for (const id of [...g.members]) {
    const c = byId(state.citizens, id);
    if (!c) { leave(state, g, id, null); continue; }
    const due = INSTITUTIONS.guildDuesPerSeason;
    if (balance(state, c.id) < due) raiseCash(state, c.id, due);
    if (transfer(state, c.id, g.id, due, 'dues', `${c.firstName}'s dues to the ${g.name}`)) { g.stats.dues += due; delete g.missed[id]; }
    else if ((g.missed[id] = (g.missed[id] ?? 0) + 1) >= 2) leave(state, g, id, 'could not pay the dues');
  }
}

/** Seasonal recruitment and departures as people change trades. */
function membership(state, g) {
  const def = GUILD_TYPES[g.key];
  for (const id of [...g.members]) {
    const c = byId(state.citizens, id);
    if (c && !def.professions.includes(tradeOf(c)) && !tradeOf(c).startsWith('Retired') && !String(c.profession).startsWith('Retired')) leave(state, g, id, `took up work as a ${c.profession.toLowerCase()}`);
  }
  for (const c of state.citizens) {
    if (ageOf(state, c) < LIFE.adultAge || c.away || g.members.includes(c.id) || !def.professions.includes(tradeOf(c))) continue;
    if (wantsToJoin(state, c, g)) join(state, g, c);
  }
  g.stats.members = g.members.length;
  if (g.members.length === 0 && state.day - g.foundedDay > DAYS_PER_YEAR) dissolve(state, g, 'it had no members left');
}

export function dissolve(state, g, why) {
  g.status = 'DISSOLVED';
  g.dissolvedDay = state.day;
  const cash = balance(state, g.id);
  if (cash > 0) transfer(state, g.id, 'treasury', cash, 'grant', `The ${g.name}'s remaining fund`);
  if (g.plotId) { const p = state.plots.find((x) => x.id === g.plotId); if (p) { p.ownerId = 'council'; p.marketStatus = 'FOR_SALE'; } }
  note(state, g, `The ${g.name} was dissolved: ${why}.`, 2);
}

/**
 * Election season: each guild backs the candidate whose platform best serves
 * its trade. Called from the campaign; returns guild ids per candidate.
 */
export function guildEndorsements(state, candidates) {
  const out = {};
  for (const g of activeGuilds(state)) {
    if (g.members.length < 2) continue;
    const pos = GUILD_TYPES[g.key].positions;
    let best = null, bestS = 0;
    for (const cand of candidates) {
      let s = 0;
      for (const [k, v] of Object.entries(pos)) s += cand.platform[k] === v ? 1 : 0;
      if (s > bestS || (s === bestS && best && cand.id < best.id)) { bestS = s; best = cand; }
    }
    if (best) { (out[best.id] ??= []).push(g.id); }
  }
  // Rival guilds backing different candidates over the same question is a recorded dispute.
  const backers = Object.entries(out);
  if (backers.length >= 2) {
    const [a, b] = backers.slice(0, 2).map(([, ids]) => byId(activeGuilds(state), ids[0]));
    const shared = Object.keys(GUILD_TYPES[a.key].positions).filter((k) => k in GUILD_TYPES[b.key].positions && GUILD_TYPES[a.key].positions[k] !== GUILD_TYPES[b.key].positions[k]);
    if (shared.length) {
      const d = ensureGuilds(state);
      d.disputes.push({ day: state.day, guilds: [a.id, b.id], over: shared });
      if (d.disputes.length > 20) d.disputes.shift();
      record(state, 'council', `The ${a.name} and the ${b.name} backed rival candidates: they disagree over ${shared.map((k) => k === 'tariffLevel' ? 'tariffs' : k).join(' and ')}.`, {}, 2);
      const la = byId(state.citizens, a.leaderId), lb = byId(state.citizens, b.leaderId);
      if (la && lb) adjust(state, la.id, lb.id, { rivalry: 4 });
    }
  }
  return out;
}

/** How guild membership colours what a citizen wants from government (Opinion.priorities). */
export function guildInterests(state, c) {
  const g = guildOf(state, c);
  return g ? GUILD_TYPES[g.key].interests : null;
}

/** After an election, a guild whose candidate won may be granted the privilege it asked for. */
export function grantPrivileges(state, winnerId, endorsements) {
  for (const id of endorsements[winnerId] ?? []) {
    const g = byId(activeGuilds(state), id);
    if (!g || g.key !== 'merchants' || g.privileges.includes('market-levy')) continue;
    g.privileges.push('market-levy');
    note(state, g, `The new government granted the ${g.name} a reduced market levy for its members' shops, in return for its support.`, 2);
  }
  // Privileges lapse when the guild's candidate loses.
  for (const g of activeGuilds(state)) if (!(endorsements[winnerId] ?? []).includes(g.id) && g.privileges.length) {
    g.privileges = [];
    note(state, g, `The ${g.name} lost its privileges with the change of government.`, 1);
  }
}

/** Is this business owned by a member of a guild holding the market-levy privilege? */
export function levyRelief(state, b) {
  const owner = byId(state.citizens, b.ownerId);
  const g = owner && guildOf(state, owner);
  return g?.privileges.includes('market-levy') ? 1 : 0;
}

export function seasonalGuilds(state) {
  // Anyone who has changed trade leaves at once (and may join their new trade's guild next season).
  for (const g of activeGuilds(state)) for (const id of [...g.members]) {
    const c = byId(state.citizens, id);
    if (c && !GUILD_TYPES[g.key].professions.includes(tradeOf(c)) && !String(c.profession).startsWith('Retired')) leave(state, g, id, `took up work as a ${String(c.profession).toLowerCase()}`);
  }
  if (!isNewSeason(state.day)) return;
  foundGuilds(state);
  for (const g of activeGuilds(state)) {
    membership(state, g);
    if (g.status !== 'ACTIVE') continue;
    collectDues(state, g);
    if (!g.leaderId || !byId(state.citizens, g.leaderId) || (isNewYear(state.day) && (state.day - g.foundedDay) >= DAYS_PER_YEAR)) elect(state, g, g.leaderId ? 'the yearly election' : 'the master was gone');
  }
}

export function onGuildMemberGone(state, c) {
  for (const g of activeGuilds(state)) if (g.members.includes(c.id)) leave(state, g, c.id, 'died');
}
