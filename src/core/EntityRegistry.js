// Fast id lookups over the state's entity arrays. The index is cached per
// array and rebuilt automatically whenever the array is replaced or its length
// changes, so callers never see stale entries. Nothing here is saved.

const caches = new WeakMap();

export function byId(list, id) {
  if (!id || !list) return null;
  let entry = caches.get(list);
  if (!entry || entry.length !== list.length) {
    entry = { length: list.length, map: new Map(list.map((x) => [x.id, x])) };
    caches.set(list, entry);
  }
  const hit = entry.map.get(id);
  return hit && hit.id === id ? hit : null;
}

/** Drop the cached index for a list (after an entity's id was changed in place). */
export function invalidateIds(list) {
  caches.delete(list);
}
