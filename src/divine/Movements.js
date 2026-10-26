import { LIFE, DAYS_PER_YEAR } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { ageOf } from '../citizens/Citizen.js';
import { trait } from '../ai/Personality.js';
import { remember } from '../ai/MemorySystem.js';
import { record } from '../society/Chronicle.js';
import { yearOf, seasonIndex, isNewYear } from '../core/Calendar.js';
import { balance, transfer } from '../economy/Transactions.js';
import { spendable } from '../finance/BankAccounts.js';
import { isTrading } from '../economy/Businesses.js';
import { LAWS, lawHooks, lawInForce } from '../law/LegalCode.js';
import { beliefOf, isAdherent, TRADITIONS } from '../institutions/FaithManager.js';
import { activeCommunities, membersOf, charity } from '../institutions/ReligiousInstitutions.js';
import { SOCIETIES, SITE_WORKS } from './Config.js';
import { ensureDivine, roll, hiddenRecord, nextDivineId, r2 } from './State.js';
import { worldviewOf, primaryWorldview, stoneFaith } from './Worldview.js';
import { stoneEvent, placeName } from './Stone.js';

// Movements. Out of shared convictions villagers may found voluntary
// societies — a Rational Inquiry Society, the Seekers Beyond, an Ancestral
// Circle — each with real members who joined of their own accord, dues in a
// real purse, a leader and a history. The faith of the Hidden Hand may split
// over emphasis into the Children of the Light and the Keepers of the
// Silence. Communities, societies and the council may improve the stone's
// surroundings, always paying for the work. None of this is scripted: a
// movement appears only when enough people want it.

export const activeSocieties = (state) => (state.divine?.societies ?? []).filter((s) => s.status === 'ACTIVE');
export const societyMembers = (state, soc) => state.citizens.filter((c) => c.worldview?.society === soc.id);

/** Who would want to belong to a society of this kind. */
function eligible(state, c, kind) {
  const wv = c.worldview;
  const k = wv?.stone;
  if (!k || ageOf(state, c) < LIFE.adultAge || k.interest < 0.3) return false;
  if (kind === 'inquiry') return (wv.outlook === 'reason' || wv.outlook === 'agnostic' || ['natural', 'ancient', 'prank'].includes(k.interp)) && wv.cur >= 0.4 && k.interp !== 'divine';
  if (kind === 'seekers') return k.interp === 'cosmic' && k.conf >= 0.45;
  if (kind === 'ancestral') return isAdherent(c, 'hearthkin') && (k.interp === 'ancient' || k.interp === 'divine');
  return false;
}

/** The interpretation a society's membership lends weight to (institutional credibility). */
export function membershipLean(state, c) {
  const soc = c.worldview?.society && activeSocieties(state).find((s) => s.id === c.worldview.society);
  if (soc) return { inquiry: 'natural', seekers: 'cosmic', ancestral: 'ancient' }[soc.kind];
  return stoneFaith(c) ? 'divine' : null;
}

function note(state, soc, text, importance = 1, citizens = []) {
  soc.history.push({ day: state.day, text });
  if (soc.history.length > 24) soc.history.shift();
  return record(state, 'culture', text, { citizens: [...(soc.leaderId ? [soc.leaderId] : []), ...citizens] }, importance);
}

function chooseLeader(state, soc) {
  const pick = societyMembers(state, soc).filter((c) => ageOf(state, c) >= 22)
    .map((c) => ({ c, s: (c.worldview.stone?.interest ?? 0) * 40 + c.reputation.standing * 0.4 + trait(c, 'ambitious') * 10 + trait(c, 'friendly') * 6 }))
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id))[0]?.c;
  if (pick && pick.id !== soc.leaderId) { soc.leaderId = pick.id; remember(state, pick, `Chosen to lead the ${soc.name}.`, 2, 'life'); }
}

/** Seasonal: found, join, leave, pay dues, act, dissolve. */
export function seasonalSocieties(state) {
  const d = ensureDivine(state);
  if (!d.stone?.discovered) return;
  for (const kind of Object.keys(SOCIETIES)) {
    if (activeSocieties(state).some((s) => s.kind === kind)) continue;
    const want = state.citizens.filter((c) => eligible(state, c, kind) && !c.worldview.society);
    const organiser = want.find((c) => trait(c, 'friendly') >= 0.35 || trait(c, 'ambitious') >= 0.35 || c.worldview.role === 'philosopher' || c.worldview.role === 'scholar');
    if (want.length < 3 || !organiser) continue;
    const id = nextDivineId(state, 'soc');
    state.accounts[id] = 0;
    const soc = { id, kind, name: SOCIETIES[kind].name, status: 'ACTIVE', foundedDay: state.day, founderId: organiser.id, leaderId: organiser.id, history: [], stats: { dues: 0, debates: 0, studies: 0, meals: 0, families: 0, works: 0, endorsements: 0 }, stores: {}, helped: {} };
    d.societies.push(soc);
    for (const c of want.slice(0, 8)) { c.worldview.society = id; remember(state, c, `Helped found the ${soc.name}.`, 2, 'life'); }
    note(state, soc, `${organiser.firstName} ${organiser.lastName} and ${Math.min(8, want.length) - 1} others founded the ${soc.name}, ${SOCIETIES[kind].theme}.`, 2);
    hiddenRecord(state, 'movement', `The ${soc.name} was founded (Year ${yearOf(state.day)}).`, { citizens: [organiser.id] }, 2);
  }
  for (const soc of activeSocieties(state)) {
    for (const c of state.citizens) {
      const mine = c.worldview?.society === soc.id;
      if (mine && !eligible(state, c, soc.kind) && roll(state, c.id, soc.id, 'leave', state.day) < 0.6) { c.worldview.society = null; remember(state, c, `Left the ${soc.name}; it no longer speaks for what I think.`, 1, 'life'); }
      else if (!mine && !c.worldview?.society && eligible(state, c, soc.kind) && roll(state, c.id, soc.id, 'join', state.day) < 0.3) { c.worldview.society = soc.id; remember(state, c, `Joined the ${soc.name}.`, 2, 'life'); }
    }
    const members = societyMembers(state, soc);
    if (members.length < 2) {
      soc.status = 'DISSOLVED';
      soc.endedDay = state.day;
      for (const c of members) c.worldview.society = null;
      const n = balance(state, soc.id);
      if (n > 0) transfer(state, soc.id, 'treasury', n, 'grant', `Remaining funds of the ${soc.name}`);
      note(state, soc, `The ${soc.name} disbanded; too few members remained.`, 2);
      continue;
    }
    if (!members.some((c) => c.id === soc.leaderId)) chooseLeader(state, soc);
    for (const c of members) {
      const gift = spendable(state, c.id) > 30 ? 1 : 0;
      if (gift && balance(state, c.id) >= gift && transfer(state, c.id, soc.id, gift, 'donation', `${c.firstName}'s dues to the ${soc.name}`)) soc.stats.dues += gift;
    }
    societyWork(state, soc, members);
  }
}

/** What a society does with its season: studies, debates, sky-watching, remembrance, charity. */
function societyWork(state, soc, members) {
  const leader = byId(state.citizens, soc.leaderId);
  if (soc.kind === 'inquiry') {
    const scholar = members.find((c) => c.worldview.role === 'scholar') ?? members.find((c) => (c.education?.level ?? 0) >= 0.5);
    if (scholar && balance(state, soc.id) >= 8 && transfer(state, soc.id, scholar.id, 3, 'wage', `The ${soc.name} paid ${scholar.firstName} to study the stone`)) { scholar.worldview.studyFunded = state.day; soc.stats.studies++; }
    // Charity is not only for the faithful: a secular society keeps a winter table too.
    if (seasonIndex(state.day) === 3 && balance(state, soc.id) >= 25) charity(state, soc);
  }
  if (soc.kind === 'seekers' && seasonIndex(state.day) === 1 && members.length >= 3) note(state, soc, `The ${soc.name} spent a summer night watching the skies above the stone; ${members.length} came.`, 1, members.slice(0, 4).map((c) => c.id));
  if (soc.kind === 'ancestral' && seasonIndex(state.day) === 3 && members.length >= 3) {
    for (const c of members) c.mood = Math.min(100, c.mood + 3);
    note(state, soc, `The ${soc.name} laid evergreen at the stone in memory of the ancestors; ${members.length} gathered.`, 1);
  }
  if (leader && state.government?.campaign) endorse(state, soc, leader);
}

/**
 * Before an election, a movement may say which candidate it favours. It is
 * advice members may ignore; the ballot stays each voter's own.
 */
function endorse(state, soc, leader) {
  const camp = state.government?.campaign;
  if (!camp?.candidates?.length) return;
  const pick = camp.candidates.map((x) => byId(state.citizens, x.id)).filter(Boolean)
    .find((cand) => (soc.kind === 'inquiry' ? ['reason', 'agnostic', 'atheist'].includes(primaryWorldview(state, cand)) : soc.kind === 'seekers' ? cand.worldview?.stone?.interp === 'cosmic' : isAdherent(cand, 'hearthkin')));
  if (!pick || soc.endorsed === camp.startDay) return;
  soc.endorsed = camp.startDay;
  soc.stats.endorsements++;
  note(state, soc, `The ${soc.name} spoke in favour of ${pick.firstName} ${pick.lastName} in the election; its members vote as they choose.`, 1, [pick.id]);
}

/**
 * Yearly: a large community of the Hidden Hand may divide over emphasis —
 * patience and contemplation, or a benevolent light. Members who lean
 * strongly one way and have a leader of their own may go their own way.
 */
export function considerSplit(state) {
  const d = ensureDivine(state);
  const f = activeCommunities(state).find((x) => x.tradition === 'hand');
  if (!f) return;
  const members = membersOf(state, f).filter((c) => ageOf(state, c) >= LIFE.adultAge);
  if (members.length < 12) return;
  for (const [tradition, lean] of [['silence', (c) => trait(c, 'shy') + trait(c, 'frugal') * 0.6 + trait(c, 'loyal') * 0.4 - trait(c, 'friendly') * 0.5], ['light', (c) => trait(c, 'friendly') + trait(c, 'creative') * 0.6 + trait(c, 'riskTaking') * 0.3 - trait(c, 'shy') * 0.5]]) {
    if (activeCommunities(state).some((x) => x.tradition === tradition) || state.citizens.some((c) => c.belief?.tradition === tradition)) continue;
    const leaners = members.filter((c) => c.id !== f.leaderId && lean(c) + (roll(state, c.id, 'lean-' + tradition) - 0.5) * 0.3 > 0.7);
    const leader = leaners.find((c) => c.reputation.standing >= 50 || trait(c, 'ambitious') > 0.4);
    if (leaners.length < 4 || !leader || roll(state, f.id, tradition, state.day) > 0.5) continue;
    for (const c of leaners) { c.belief.tradition = tradition; c.belief.since = state.day; remember(state, c, `Followed ${leader.firstName} out of the Keepers of the Stone to found ${TRADITIONS[tradition].name}.`, 3, 'life'); }
    d.stats.splits++;
    const text = `The faith of the Hidden Hand divided: ${leader.firstName} ${leader.lastName} and ${leaners.length - 1} others left the ${f.name} to follow ${TRADITIONS[tradition].name} (${TRADITIONS[tradition].theme}).`;
    record(state, 'culture', text, { citizens: [leader.id] }, 3);
    stoneEvent(state, 'split', text, { citizens: [leader.id], importance: 2 });
    return;
  }
}

/** The best builders' merchant to pay for works (or the wider world when none trades). */
function supplier(state) {
  return state.businesses.find((b) => isTrading(b) && (b.type === 'lumberyard' || b.type === 'blacksmith'))?.id ?? 'outside';
}

/**
 * Seasonal: those who care for the stone improve its surroundings — always
 * by paying for the work from a real purse. Offerings appear by themselves
 * when believers gather; nothing else does.
 */
export function siteWorks(state) {
  const s = state.divine?.stone;
  if (!s?.discovered) return;
  const age = state.civ?.age ?? 1;
  const site = s.site;
  const visitors = state.citizens.filter((c) => (c.worldview?.stone?.visits ?? 0) > 0 && c.worldview.stone.interp === 'divine').length;
  if (!site.offerings && visitors >= 3) { site.offerings = { day: state.day, by: 'believers' }; stoneEvent(state, 'offerings', `Believers have begun leaving flowers and small offerings at the stone ${placeName(state)}.`, { importance: 2, first: 'offerings' }); }
  const hand = activeCommunities(state).find((f) => f.tradition === 'hand') ?? activeCommunities(state).find((f) => f.tradition === 'light' || f.tradition === 'silence');
  const soc = (kind) => activeSocieties(state).find((x) => x.kind === kind);
  const plans = [
    ['lanterns', hand], ['fence', lawInForce(state, 'stone') ? 'treasury' : hand], ['plinth', lawInForce(state, 'stone') ? 'treasury' : soc('inquiry')],
    ['observatory', soc('seekers')], ['pavilion', lawInForce(state, 'stone') ? 'treasury' : hand], ['museum', lawInForce(state, 'stone') ? 'treasury' : soc('inquiry')],
    ['garden', activeCommunities(state).find((f) => f.tradition === 'silence') ?? hand],
  ];
  // Works come slowly: at most one a year, and each only after the stone has mattered for a while.
  const years = (state.day - s.discoveredDay) / DAYS_PER_YEAR;
  if (Object.values(site).some((w) => w.cost && state.day - w.day < DAYS_PER_YEAR)) return;
  for (const [work, owner] of plans) {
    const def = SITE_WORKS[work];
    if (site[work] || !owner || age < def.minAge || years < def.afterYears) continue;
    const payer = owner === 'treasury' ? 'treasury' : owner.id;
    const reserve = payer === 'treasury' ? 120 : 20;
    if (balance(state, payer) < def.cost + reserve) continue;
    if (!transfer(state, payer, supplier(state), def.cost, 'construction', `${def.label} at the stone`)) continue;
    const name = owner === 'treasury' ? 'the council' : owner.name.startsWith('The ') ? `t${owner.name.slice(1)}` : `the ${owner.name}`;
    site[work] = { day: state.day, by: name, cost: def.cost };
    if (owner !== 'treasury' && owner.stats) owner.stats.works = (owner.stats.works ?? 0) + 1;
    stoneEvent(state, 'works', `${name[0].toUpperCase()}${name.slice(1)} paid ${def.cost} coins for ${def.label.toLowerCase()} at the stone.`, { importance: work === 'museum' ? 3 : 2 });
    break; // one work a season
  }
}

// --- Laws -------------------------------------------------------------------------------
// Two bills that may come before the government, voted on by each member's
// own interests like every other law (see law/LegalCode.js).

LAWS.conscience = { name: 'Freedom of Belief Act', issue: 'trust', description: 'Every person may believe, doubt, worship or abstain as they choose.', requirement: 'No one is penalised, favoured or excluded from public life for their beliefs.', remedy: 'Discrimination by an official is set aside and the official fined.' };
LAWS.stone = { name: 'Protection of the Carved Stone Act', issue: 'works', description: 'The carved stone is protected as a landmark of the kingdom.', requirement: 'The stone may not be moved, defaced or built over; the council keeps its surroundings.', remedy: 'Damage is repaired at the offender\'s cost.' };

lawHooks.reason.conscience = (state) => {
  const counts = {};
  for (const c of state.citizens) { const k = primaryWorldview(state, c); counts[k] = (counts[k] ?? 0) + 1; }
  const kinds = Object.values(counts).filter((n) => n >= 3).length;
  const minority = state.citizens.length - Math.max(0, ...Object.values(counts));
  if (!state.divine?.stone?.discovered || kinds < 4 || minority < 8) return null;
  return `the kingdom now holds ${kinds} different faiths and philosophies, and ${minority} villagers belong to none of the largest`;
};
lawHooks.stance.conscience = (state, c) => {
  const wv = worldviewOf(state, c);
  const mine = primaryWorldview(state, c);
  const share = state.citizens.filter((o) => primaryWorldview(state, o) === mine).length / Math.max(1, state.citizens.length);
  return (wv.tol - 0.45) * 1.2 + (share < 0.35 ? 0.35 : -0.1);
};
lawHooks.reason.stone = (state) => {
  const s = state.divine?.stone;
  if (!s?.discovered || (s.known ?? 0) < 25 || s.visits < 80 || state.day - s.discoveredDay < DAYS_PER_YEAR * 4) return null;
  return `${s.known} villagers know of the carved stone and it has drawn ${s.visits} visits; some want it kept safe`;
};
lawHooks.stance.stone = (state, c) => {
  const k = c.worldview?.stone;
  if (!k) return -0.05;
  return k.interp === 'indifferent' ? -0.25 : k.interp === 'prank' ? -0.1 : 0.15 + k.interest * 0.5;
};

/** For the long-run statistics. */
export function movementStats(state) {
  return {
    societies: activeSocieties(state).map((s) => `${s.kind}:${societyMembers(state, s).length}`),
    everFounded: (state.divine?.societies ?? []).length,
    stoneFaiths: activeCommunities(state).filter((f) => ['hand', 'light', 'silence'].includes(f.tradition)).map((f) => `${f.tradition}:${membersOf(state, f).length}${f.tier ? `:${f.tier}` : ''}`),
  };
}

export { SOCIETIES, r2, DAYS_PER_YEAR };
