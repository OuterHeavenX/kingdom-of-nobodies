import { SAVE_VERSION, WIDER_WORLD } from './Config.js';
import { createKingdom, createWorks, addMilestone4State, addMilestone5State } from '../sim/Setup.js';
import { adjustBoth } from '../citizens/Relationships.js';
import { addGoods } from '../economy/Inventory.js';
import { transfer } from '../economy/Transactions.js';
import { plotByName } from '../property/LandRegistry.js';
import { POPULATION, DAYS_PER_YEAR } from './Config.js';
import { NAMES } from '../citizens/Families.js';
import { familyWish } from '../citizens/Genetics.js';
import { attractionFor } from '../citizens/Citizen.js';

const FOUNDER_SEX = { Ada: 'F', Bram: 'M', Cora: 'F', Dain: 'M', Elin: 'F' };

/**
 * Milestone 2 (v3) → Milestone 3 (v4). Ages become birth dates on the new
 * calendar, everyone gains family, education and health records, and the
 * world gains an archive, statistics and an (unformed) government. Partners
 * stay partners; marriage is something they may now choose.
 */
export function migrateV3(s) {
  for (const c of s.citizens) {
    const age = Number.isFinite(c.age) ? c.age : 30;
    c.birthDay = s.day - age * DAYS_PER_YEAR - (Number(c.id.slice(1)) % DAYS_PER_YEAR);
    delete c.age;
    c.sex = FOUNDER_SEX[c.firstName] && Number(c.id.slice(1)) <= 5 ? FOUNDER_SEX[c.firstName] : NAMES.F.includes(c.firstName) ? 'F' : 'M';
    c.founder = Number(c.id.slice(1)) <= 5 && !!FOUNDER_SEX[c.firstName];
    c.generation = 1;
    c.attraction = c.attraction ?? attractionFor(Number(c.id.slice(1)));
    c.retired = false;
    c.romance = { engagedTo: null, ...c.romance };
    c.family = { spouseId: null, formerSpouseIds: [], guardianId: null, adoptive: false, ...c.family, parentIds: c.family?.parentIds ?? [], childIds: c.family?.childIds ?? [] };
    c.education = c.education ?? { level: 0.3, trade: null, masterId: null, apprenticeSince: null };
    c.pregnancy = null;
    c.health = c.health ?? { sickUntil: 0, immuneUntil: 0, starvingDays: 0 };
    c.achievements = c.achievements ?? [];
    c.appearance = { height: 1, ...c.appearance };
    c.stats.maxStaff = c.stats.maxStaff ?? 0;
    c.familyWish = c.familyWish ?? familyWish(s, c);
  }
  Object.assign(s, {
    archive: s.archive ?? {}, estates: s.estates ?? [],
    stats: s.stats ?? { births: 0, deaths: 0, immigrants: Math.max(0, s.citizens.length - 5), emigrants: 0, marriages: 0, elections: 0, fires: 0 },
    season: s.season ?? {}, discoveries: s.discoveries ?? {}, government: s.government ?? null,
    eras: s.eras ?? [{ name: 'The Founding Years', startDay: 1, reason: 'Five strangers lit the first hearth.' }],
    populationCap: POPULATION.max, yearly: s.yearly ?? [], eventLog: s.eventLog ?? [], fires: s.fires ?? [], research: s.research ?? {},
    monuments: s.monuments ?? [{ id: 'founders', name: "Founders' Memorial", day: 1 }],
  });
  s.accounts.outside += 46000; // the wider world becomes realistically large
  if (!s.businesses.some((b) => b.type === 'works')) createWorks(s);
  s.version = 4;
  s.migratedFrom = s.migratedFrom ?? 'milestone-2';
  return s;
}

/**
 * Milestone 3 (v4) → Milestone 4 (v5). Nothing is reset: the village keeps its
 * people, families and history, and gains its roads (including any districts
 * already opened), navigation records, the region beyond the valley, trade,
 * law and festival calendars.
 */
export function migrateV4(s) {
  // Milestone 4 opens the valley to trade with the wider world, which is far
  // larger than the purse a Milestone 3 village knew about. This one-time top-up
  // is recorded so the money supply stays explainable.
  const topUp = Math.max(0, WIDER_WORLD - (s.accounts.outside ?? 0));
  s.accounts.outside = (s.accounts.outside ?? 0) + topUp;
  s.migrationNotes = [...(s.migrationNotes ?? []), { version: 5, outsideTopUp: topUp }];
  addMilestone4State(s);
  s.version = 5;
  s.migratedFrom = s.migratedFrom ?? 'milestone-3';
  return s;
}

/**
 * Milestone 4 (v5) → Milestone 5 (v6). The village, its people and its region
 * are kept as they are; it gains a town plan (districts already opened keep
 * their identity), banking, guilds, faith communities, named foreign
 * citizens, alliances and armies, weather and cloud-sync metadata. Nothing is
 * funded out of thin air: new institutions start empty and grow from real
 * deposits, dues and donations.
 */
export function migrateV5(s) {
  addMilestone5State(s);
  s.version = 6;
  s.migratedFrom = s.migratedFrom ?? 'milestone-4';
  s.migrationNotes = [...(s.migrationNotes ?? []), { version: 6, day: s.day }];
  return s;
}

// Pure save-format helpers (no browser APIs) so they can be unit tested.
// A save file is an envelope { format, version, savedAt, checksum, data }.

export const FORMAT = 'kingdom-of-nobodies';

export function checksum(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

export function serialize(state, build = 'dev') {
  const data = JSON.stringify({ ...state, events: [] });
  return JSON.stringify({ format: FORMAT, version: SAVE_VERSION, build, savedAt: new Date().toISOString(), checksum: checksum(data), data });
}

/** Parse and verify an envelope. Returns the game state or throws with a readable reason. */
export function deserialize(text) {
  let env;
  try { env = JSON.parse(text); } catch { throw new Error('The save file is not valid JSON.'); }
  if (env && env.format === FORMAT) {
    if (checksum(env.data) !== env.checksum) throw new Error('The save file is damaged (checksum mismatch).');
    return migrate(JSON.parse(env.data));
  }
  // A bare Milestone 1 state (as stored in localStorage by the first prototype).
  if (env && env.version === 2 && Array.isArray(env.people)) return migrateMilestone1(env);
  throw new Error('This is not a Kingdom of Nobodies save.');
}

/**
 * Choose the most recently written valid save from labelled candidates
 * ([label, text] pairs). Write time decides, not simulation progress, so an
 * imported or newly started kingdom is never displaced by an older, longer one.
 */
export function newestSave(candidates) {
  let best = null;
  for (const [label, text] of candidates) {
    if (!text) continue;
    try {
      const state = deserialize(text);
      let savedAt = '';
      try { savedAt = JSON.parse(text).savedAt ?? ''; } catch { /* bare legacy state */ }
      if (!best || savedAt > best.savedAt) best = { label, state, savedAt };
    } catch (e) {
      console.warn(`Skipping ${label}:`, e.message);
    }
  }
  return best;
}

export function validateState(s) {
  const problems = [];
  if (!s || typeof s !== 'object') return ['missing state'];
  for (const key of ['citizens', 'businesses', 'plots', 'projects', 'chronicle', 'ledger']) if (!Array.isArray(s[key])) problems.push(`${key} missing`);
  if (!s.accounts || typeof s.accounts !== 'object') problems.push('accounts missing');
  if (!Number.isInteger(s.day) || s.day < 1) problems.push('bad day');
  for (const [k, v] of Object.entries(s.accounts ?? {})) if (!Number.isInteger(v) || v < 0) problems.push(`account ${k} invalid`);
  return problems;
}

export function migrate(s) {
  if (s.version === SAVE_VERSION) {
    const problems = validateState(s);
    if (problems.length) throw new Error(`The save is incomplete: ${problems.join(', ')}.`);
    s.events = [];
    return s;
  }
  if (s.version === 5) return migrate(migrateV5(s));
  if (s.version === 4) return migrate(migrateV4(s));
  if (s.version === 3) return migrate(migrateV3(s));
  if (s.version === 2 && Array.isArray(s.people)) return migrateMilestone1(s);
  throw new Error(`Unsupported save version ${s.version}.`);
}

/**
 * Bring a Milestone 1 village forward: the same five residents keep their
 * needs, moods, positions and friendships; the old treasury, food and wood
 * carry over; cottages they built stand as council cottages; and the old
 * chronicle is preserved.
 */
export function migrateMilestone1(old) {
  const s = createKingdom(1000 + (old.day ?? 1));
  s.day = Math.max(1, old.day ?? 1);
  s.minute = Math.round(((old.hour ?? 8) % 24) * 6) * 10;
  const byOldId = {};
  for (const p of old.people ?? []) {
    const c = s.citizens.find((x) => x.firstName === p.name);
    if (!c) continue;
    byOldId[p.id] = c;
    c.needs = { hunger: num(p.hunger, 70), energy: num(p.energy, 80), social: num(p.social, 60) };
    c.mood = num(p.mood, 70);
    c.x = num(p.x, 0); c.z = num(p.z, 0);
  }
  for (const p of old.people ?? []) {
    for (const [otherId, n] of Object.entries(p.friendships ?? {})) {
      const a = byOldId[p.id], b = byOldId[otherId];
      if (a && b) adjustBoth(s, a.id, b.id, { friendship: Math.min(50, n * 8), trust: Math.min(25, n * 4) });
    }
  }
  const gold = Math.max(0, Math.floor(num(old.gold, 0)));
  if (gold) transfer(s, 'outside', 'treasury', Math.min(gold, s.accounts.outside), 'immigration', 'Treasury carried over from the first hearth');
  const food = Math.max(0, Math.floor(num(old.food, 0)));
  if (food) addGoods(s.council.pantry, 'grain', Math.min(60, food));
  const wood = Math.max(0, Math.floor(num(old.wood, 0)));
  const woodlot = s.businesses.find((b) => b.name === 'Village Woodlot');
  if (wood && woodlot) addGoods(woodlot.inventory, 'timber', Math.min(40, wood));
  const cottages = (old.buildings ?? []).filter((b) => b.type === 'cottage').length;
  const sites = ['Willow Cottage', 'Hill Cottage', 'Elm Cottage', 'Brook Cottage'];
  for (let i = 0; i < Math.min(cottages, sites.length); i++) {
    const plot = plotByName(s, sites[i]);
    plot.building = { type: 'cottage', name: `Cottage ${i + 1}`, builtDay: 1 };
    plot.constructionStatus = 'COMPLETE';
    plot.marketStatus = 'NOT_FOR_SALE';
    plot.history.push({ day: 1, text: 'Built by the founders during the first hearth.' });
  }
  const legacy = (old.chronicle ?? []).slice(0, 25).reverse();
  s.chronicle = [
    ...legacy.map((e, i) => ({ id: i + 1, day: e.day ?? 1, minute: 0, category: 'citizen', text: String(e.message ?? ''), refs: { citizens: [], business: null, plot: null }, importance: 2, legacy: true })),
    ...s.chronicle.map((e, i) => ({ ...e, id: legacy.length + i + 1, day: s.day, text: 'The village entered a new age: the Living Society.' })),
  ];
  s.nextId.chronicle = s.chronicle.length;
  s.migratedFrom = 'milestone-1';
  return s;
}

const num = (v, d) => (Number.isFinite(v) ? v : d);
