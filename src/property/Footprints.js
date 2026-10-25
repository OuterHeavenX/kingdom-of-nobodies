// Building footprints shared by the simulation (navigation) and the renderer,
// so what blocks a villager's path is exactly what is drawn. Sizes are in
// building-local space: width along x, depth along z, the door on +z.

export const FOOTPRINT = {
  hall: { w: 7, d: 5.4, h: 3.2 },
  townhall: { w: 7.6, d: 5.6, h: 4.8 },
  cottage: { w: 3.6, d: 3.2, h: 2.5 },
  blacksmith: { w: 4.2, d: 3.6, h: 2.5 },
  bakery: { w: 4, d: 3.4, h: 2.5 },
  tavern: { w: 4.8, d: 3.8, h: 4.0 },
  general_store: { w: 4.2, d: 3.4, h: 2.5 },
  lumberyard: { w: 5, d: 3, h: 2.6 },
  stall: { w: 3.6, d: 1.6, h: 2.5 },
  school: { w: 5.6, d: 3.8, h: 2.6 },
  granary: { w: 5, d: 3.4, h: 2.6 },
  well: { w: 2.2, d: 2.2, h: 1.2 },
  courthouse: { w: 6, d: 4.4, h: 3.4 },
  ruins: { w: 4.2, d: 3.6, h: 0.6 },
  bank: { w: 4.6, d: 3.8, h: 3.4 },
  guildhall: { w: 6, d: 4.4, h: 3.6 },
  shrine: { w: 2.2, d: 2, h: 2.2 },
  chapel: { w: 4, d: 5.2, h: 3.4 },
  temple: { w: 6, d: 6, h: 4.6 },
  barracks: { w: 6.4, d: 4, h: 2.8 },
};

export const widthOf = (type) => FOOTPRINT[type]?.w ?? 3.6;
export const depthOf = (type) => FOOTPRINT[type]?.d ?? 3.2;
export const heightOf = (type) => FOOTPRINT[type]?.h ?? 2.5;

const ROTATE = {
  south: (x, z) => [x, z],
  north: (x, z) => [-x, -z],
  west: (x, z) => [-z, x],
  east: (x, z) => [z, -x],
};

/** Convert a building-local rectangle to a world-space axis-aligned one [minX, minZ, maxX, maxZ]. */
function worldRect(plot, cx, cz, w, d) {
  const rot = ROTATE[plot.facing ?? 'south'];
  const corners = [[cx - w / 2, cz - d / 2], [cx + w / 2, cz + d / 2]].map(([x, z]) => rot(x, z));
  const xs = corners.map((p) => p[0] + plot.x), zs = corners.map((p) => p[1] + plot.z);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

/**
 * The solid parts of whatever stands on a plot, as world rectangles. Farms
 * block only the barn (the field is walkable rough ground); an expanded
 * building also blocks its side wing.
 */
export function solidRects(plot) {
  const b = plot.building;
  if (!b) return [];
  if (b.type === 'farm') {
    const fw = Math.min(plot.w - 1, 10), fd = Math.min(plot.d - 1.5, 7);
    return [worldRect(plot, fw / 2 - 1.2, fd / 2 - 0.4, 3.2, 2.6)];
  }
  if (b.type === 'ruins') return [];
  const rects = [worldRect(plot, 0, 0, widthOf(b.type), depthOf(b.type))];
  if ((b.level ?? 1) >= 2 && !['well', 'lumberyard'].includes(b.type)) rects.push(worldRect(plot, -(widthOf(b.type) / 2 + 1.1), -0.2, 2.4, 2.6));
  return rects;
}
