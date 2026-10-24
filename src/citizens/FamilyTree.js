import { byId } from '../core/EntityRegistry.js';

// The family registry. Living citizens and archived (dead or departed) people
// share one id space, so family links survive death across many generations.

export function person(state, id) {
  if (!id) return null;
  return byId(state.citizens, id) ?? state.archive[id] ?? null;
}

export const isLiving = (state, id) => state.citizens.some((c) => c.id === id);
export const parentsOf = (state, id) => (person(state, id)?.family?.parentIds ?? []).map((p) => person(state, p)).filter(Boolean);
export const childrenOf = (state, id) => (person(state, id)?.family?.childIds ?? []).map((p) => person(state, p)).filter(Boolean);

export function siblingsOf(state, id) {
  const me = person(state, id);
  const out = new Map();
  for (const pid of me?.family?.parentIds ?? []) for (const c of childrenOf(state, pid)) if (c.id !== id) out.set(c.id, c);
  return [...out.values()];
}

export function ancestorIds(state, id, depth = 6) {
  const out = new Set();
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const f of frontier) for (const p of person(state, f)?.family?.parentIds ?? []) if (!out.has(p)) { out.add(p); next.push(p); }
    frontier = next;
  }
  return out;
}

export function descendantIds(state, id, depth = 8) {
  const out = new Set();
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const f of frontier) for (const c of person(state, f)?.family?.childIds ?? []) if (!out.has(c)) { out.add(c); next.push(c); }
    frontier = next;
  }
  return out;
}

/** Close kin may not court: shared ancestry within two generations, or direct lines. */
export function areCloseKin(state, a, b) {
  if (a === b) return true;
  const ancA = ancestorIds(state, a, 2), ancB = ancestorIds(state, b, 2);
  if (ancA.has(b) || ancB.has(a)) return true;
  for (const x of ancA) if (ancB.has(x)) return true;
  return false;
}

/** Link a child to a parent (biological or adoptive), refusing anything that would create a cycle. */
export function linkParent(state, childId, parentId) {
  const child = person(state, childId), parent = person(state, parentId);
  if (!child || !parent || childId === parentId) return false;
  if (ancestorIds(state, parentId, 12).has(childId)) return false;
  if (!child.family.parentIds.includes(parentId)) child.family.parentIds.push(parentId);
  if (!parent.family.childIds.includes(childId)) parent.family.childIds.push(childId);
  return true;
}

/** The house (family name) a person belongs to and its members past and present. */
export function houseMembers(state, name) {
  return [...state.citizens, ...Object.values(state.archive)].filter((p) => p.lastName === name);
}

/** Group a house's members into generations for the family tree view. */
export function generationsOf(state, name) {
  const byGen = new Map();
  for (const p of houseMembers(state, name)) {
    const g = p.generation ?? 1;
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g).push(p);
  }
  return [...byGen.entries()].sort((a, b) => a[0] - b[0]).map(([gen, members]) => ({ gen, members: members.sort((x, y) => x.birthDay - y.birthDay) }));
}
