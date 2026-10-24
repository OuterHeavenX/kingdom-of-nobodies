// The per-state navigation grid cache, kept apart so that modules which change
// the world (roads, construction) can mark it stale without importing the grid.

export const grids = new WeakMap();

/** Something that changes movement happened mid-tick: re-check before the next route. */
export function markNavDirty(state) {
  const g = grids.get(state);
  if (g) g.dirty = true;
}
