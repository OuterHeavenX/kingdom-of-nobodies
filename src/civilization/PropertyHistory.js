import { CIV } from '../core/Config.js';
import { byId } from '../core/EntityRegistry.js';
import { yearOf } from '../core/Calendar.js';
import { formLabel } from './ArchitectureData.js';
import { BUILDING_INFO } from '../property/LandRegistry.js';

// Then & Now: a compact, permanent record of how each property changed over
// the centuries. Nothing graphical is stored, only what is needed to rebuild
// the picture deterministically: the building's type, era, seed, floors and
// level, plus who owned it and what business it housed. Records are taken by
// comparing each plot with its last record once a day, so every path that
// changes a property (construction, rebuilding, fire, sale, inheritance, a
// court order) is captured without each system having to report it.

const STRUCTURAL = new Set(['built', 'rebuilt', 'demolished', 'ruined', 'expanded', 'restored']);

export function ensureArchive(state) {
  state.civ.archive = state.civ.archive ?? {};
  return state.civ.archive;
}

const personName = (state, id) => {
  if (!id || id === 'council') return 'the council';
  const c = byId(state.citizens, id) ?? state.archive?.[id];
  if (c) return `${c.firstName} ${c.lastName}`;
  return state.finance?.banks?.find((b) => b.id === id)?.name ?? state.guilds?.list?.find((g) => g.id === id)?.name ?? id;
};

/** The current, comparable state of a plot. */
function current(state, plot) {
  const b = plot.building;
  const biz = plot.businessId ? byId(state.businesses, plot.businessId) : null;
  return {
    t: b?.type ?? null, e: b?.era ?? 1, s: b?.seed ?? 0, f: b?.floors ?? 1, l: b?.level ?? 1,
    o: plot.ownerId, bz: biz?.name ?? null, n: b ? (biz?.name ?? b.name) : null,
  };
}

/**
 * The last known state of a plot reconstructed from its records (or null if
 * never recorded). The replay is cached per list and reused until a record is
 * added (every change pushes a new last record, so the cache can never be stale).
 */
const replayed = new WeakMap();
function lastKnown(list) {
  if (!list?.length) return null;
  const last = list[list.length - 1];
  const hit = replayed.get(list);
  if (hit && hit.last === last && hit.length === list.length) return hit.st;
  const st = { t: null, e: 1, s: 0, f: 1, l: 1, o: null, bz: null, n: null };
  for (const r of list) applyRecord(st, r);
  replayed.set(list, { last, length: list.length, st });
  return st;
}

function applyRecord(st, r) {
  if (r.k === 'built' || r.k === 'rebuilt' || r.k === 'ruined' || r.k === 'restored') Object.assign(st, { t: r.t, e: r.e, s: r.s, f: r.f, l: r.l ?? 1, n: r.n ?? st.n });
  if (r.k === 'expanded') st.l = r.l;
  if (r.k === 'demolished') Object.assign(st, { t: null, n: null, bz: null });
  if (r.o !== undefined) st.o = r.o;
  if (r.bz !== undefined) st.bz = r.bz;
  if (r.k === 'renamed') st.n = r.n;
}

function push(state, plot, rec) {
  const archive = ensureArchive(state);
  const list = (archive[plot.id] = archive[plot.id] ?? []);
  list.push({ d: state.day, ...rec });
  if (list.length > CIV.archivePerPlot) {
    // Keep every structural change; thin out ownership and business notes, oldest first.
    const i = list.findIndex((r, idx) => idx > 0 && !STRUCTURAL.has(r.k));
    if (i > 0) list.splice(i, 1); else list.splice(1, 1);
  }
}

/** Daily: record whatever changed on each plot since its last record. */
export function recordPropertyChanges(state) {
  const archive = ensureArchive(state);
  for (const plot of state.plots) {
    if (plot.projectId && plot.constructionStatus !== 'COMPLETE') {
      // Mid-construction the old building may already be gone; wait for the outcome, except a finished demolition.
      if (plot.building) continue;
    }
    const now = current(state, plot);
    const was = lastKnown(archive[plot.id]);
    if (!was) {
      if (now.t) push(state, plot, { k: 'built', t: now.t, e: now.e, s: now.s, f: now.f, l: now.l, n: now.n, o: now.o, on: personName(state, now.o), bz: now.bz });
      else push(state, plot, { k: 'surveyed', o: now.o, on: personName(state, now.o) });
      continue;
    }
    const rec = {};
    if (now.t !== was.t || (now.t && (now.s !== was.s || now.e !== was.e))) {
      if (!now.t) rec.k = 'demolished';
      else if (now.t === 'ruins') rec.k = 'ruined';
      else if (!was.t) rec.k = 'built';
      else if (was.t === 'ruins') rec.k = 'restored';
      else rec.k = 'rebuilt';
      if (now.t) Object.assign(rec, { t: now.t, e: now.e, s: now.s, f: now.f, l: now.l, n: now.n, from: was.t ? `${BUILDING_INFO[was.t]?.label ?? was.t}` : null });
    } else if (now.t && now.l !== was.l) Object.assign(rec, { k: 'expanded', l: now.l });
    if (now.o !== was.o) { rec.k = rec.k ?? 'owner'; rec.o = now.o; rec.on = personName(state, now.o); rec.prev = was.o; }
    if (now.bz !== was.bz) { rec.k = rec.k ?? (now.bz ? 'business' : 'closed'); rec.bz = now.bz; }
    else if (now.n && now.n !== was.n && !rec.k) { rec.k = 'renamed'; rec.n = now.n; }
    if (rec.k) push(state, plot, rec);
  }
}

/** The property's timeline for the Then & Now viewer, oldest first. */
export function propertyTimeline(state, plotId) {
  const list = ensureArchive(state)[plotId] ?? [];
  const st = { t: null, e: 1, s: 0, f: 1, l: 1, o: null, bz: null, n: null };
  return list.map((r) => {
    applyRecord(st, r);
    return { ...r, year: yearOf(r.d), state: { ...st }, label: st.t ? describe(st) : 'Vacant land' };
  });
}

/** What stood on a plot on a given day (deterministic reconstruction data), or null if it was empty. */
export function propertyOn(state, plotId, day) {
  const list = ensureArchive(state)[plotId] ?? [];
  const st = { t: null, e: 1, s: 0, f: 1, l: 1, o: null, bz: null, n: null };
  let seen = false;
  for (const r of list) { if (r.d > day) break; applyRecord(st, r); seen = true; }
  return seen ? st : null;
}

export function describe(st) {
  if (!st.t) return 'Vacant land';
  if (st.t === 'ruins') return 'Ruins';
  return formLabel({ type: st.t, era: st.e, seed: st.s });
}

/** Distinct appearances a property has had (for the timeline's stops). */
export function appearances(state, plotId) {
  return propertyTimeline(state, plotId).filter((r) => STRUCTURAL.has(r.k) || r.k === 'surveyed');
}

/** Ownership chain with family links between successive owners. */
export function ownerChain(state, plotId) {
  const chain = [];
  for (const r of propertyTimeline(state, plotId)) {
    if (!r.o || chain.at(-1)?.id === r.o) continue;
    const person = byId(state.citizens, r.o) ?? state.archive?.[r.o];
    const prev = chain.at(-1);
    let link = null;
    if (prev && person?.family) {
      const prevPerson = byId(state.citizens, prev.id) ?? state.archive?.[prev.id];
      if (person.family.parentIds?.includes(prev.id)) link = 'child of the previous owner';
      else if (prev.id && (person.family.spouseId === prev.id || prevPerson?.family?.spouseId === person.id || person.family.formerSpouseIds?.includes(prev.id))) link = 'spouse of the previous owner';
      else if (prevPerson?.family?.parentIds?.some((pid) => person.family.parentIds?.includes(pid))) link = 'sibling of the previous owner';
      else if (person.family.parentIds?.some((pid) => (byId(state.citizens, pid) ?? state.archive?.[pid])?.family?.parentIds?.includes(prev.id))) link = 'grandchild of the previous owner';
    }
    chain.push({ id: r.o, name: r.on ?? personName(state, r.o), from: r.d, year: r.year, link, living: !!byId(state.citizens, r.o) });
  }
  return chain;
}
