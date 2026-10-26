// Architecture shared by the simulation (values, beds, staff, navigation
// footprints) and the renderer (procedural models). Pure data and arithmetic:
// no imports, so any module can use it without creating import cycles.
//
// A building keeps the function it was built for (its `type`: cottage, bakery,
// lumberyard...) and records the era it was built or last rebuilt in, a
// deterministic seed and its number of floors. The era decides what it looks
// like, what it is worth and how many people it houses or employs.

export const ERA_NAMES = ['', 'Foundations', 'Industrial', 'Modern', 'Metropolitan', 'Tomorrow'];
export const ERA_MATERIAL = ['', 'Timber & stone', 'Brick & iron', 'Concrete', 'Steel & glass', 'Solar glass & living walls'];
/** The technology that opens each era's architecture. */
export const ARCH_TECH = [null, 'timber_framing', 'brickworks', 'reinforced_concrete', 'steel_glass', 'smart_materials'];
/** Storey height by era (world units; a villager is about two units tall). */
export const FLOOR_H = [0, 2.3, 2.6, 2.9, 3.1, 3.2];

const F = (labels, o = {}) => ({ labels: Array.isArray(labels) ? labels : [labels], floors: [1, 1], scale: 1, value: 1, beds: 0, staff: 0, needs: {}, work: 1, ...o });
const NA = null;

/**
 * Forms by building type and era (index 1..5). `labels` are variants picked by
 * seed; `floors` is a [min, max] range; `scale` widens the footprint; `value`
 * multiplies the building's base value; `beds`/`staff` are capacity; `needs`
 * are utility levels the district must provide; `work` scales construction.
 */
export const FORMS = {
  cottage: [NA,
    F(['Timber-frame cottage', 'Stone cottage', 'Thatched cottage'], { beds: 4 }),
    F(['Brick townhouse', 'Victorian house'], { floors: [2, 3], value: 1.6, beds: 5, work: 1.2 }),
    F(['Suburban house', 'Detached family house'], { floors: [1, 2], value: 2.2, beds: 5, work: 1.3, needs: { power: 2, water: 2 } }),
    F(['Contemporary family home', 'Glass-fronted house'], { floors: [2, 2], value: 3, beds: 6, work: 1.4, needs: { power: 2, water: 2 } }),
    F(['Solar villa', 'Garden house'], { floors: [1, 2], value: 3.8, beds: 6, work: 1.5, needs: { power: 3, water: 3 } })],
  farm: [NA,
    F(['Farmstead'], {}), F(['Brick farmhouse'], { value: 1.5, staff: 1 }), F(['Mechanised farm'], { value: 2.2, staff: 1, needs: { power: 2 } }),
    F(['Agricultural estate'], { value: 3, staff: 2, needs: { power: 2 } }), F(['Automated vertical farm'], { floors: [3, 5], value: 4, staff: 2, work: 1.6, needs: { power: 3 } })],
  lumberyard: [NA,
    F(['Lumber workshop'], {}), F(['Brick sawmill'], { floors: [2, 2], value: 1.7, staff: 1, work: 1.3 }),
    F(['Industrial warehouse'], { floors: [2, 3], scale: 1.1, value: 2.6, staff: 2, work: 1.6, needs: { power: 2 } }),
    F(['Corporate office tower'], { floors: [8, 16], scale: 0.9, value: 4.5, staff: 3, work: 3, needs: { power: 2, water: 3, transit: 2 }, tall: true }),
    F(['Automated construction campus'], { floors: [3, 5], scale: 1.15, value: 5.5, staff: 3, work: 2.6, needs: { power: 3, water: 3 } })],
  blacksmith: [NA,
    F(['Smithy'], {}), F(['Ironworks factory'], { floors: [2, 2], scale: 1.1, value: 1.8, staff: 1, work: 1.4 }),
    F(['Machine works'], { floors: [2, 3], scale: 1.15, value: 2.6, staff: 2, work: 1.7, needs: { power: 2 } }),
    F(['Manufacturing plant'], { floors: [2, 4], scale: 1.2, value: 3.6, staff: 3, work: 2, needs: { power: 2, water: 2 } }),
    F(['Automated production facility'], { floors: [2, 4], scale: 1.2, value: 5, staff: 3, work: 2.4, needs: { power: 3 } })],
  bakery: [NA,
    F(['Bakery'], {}), F(['Brick bakehouse'], { floors: [2, 2], value: 1.6, staff: 1 }), F(['Bakery and café'], { floors: [1, 2], value: 2.2, staff: 1, needs: { power: 2 } }),
    F(['Food hall'], { floors: [2, 3], scale: 1.1, value: 3, staff: 2, needs: { power: 2, water: 2 } }), F(['Automated kitchen'], { floors: [2, 3], value: 4, staff: 2, needs: { power: 3 } })],
  tavern: [NA,
    F(['Tavern'], {}), F(['Coaching inn'], { floors: [3, 3], value: 1.7, staff: 1, work: 1.3 }), F(['Hotel and restaurant'], { floors: [3, 5], value: 2.5, staff: 2, work: 1.6, needs: { power: 2, water: 2 } }),
    F(['Hotel tower'], { floors: [8, 14], scale: 0.95, value: 4, staff: 3, work: 2.8, needs: { power: 2, water: 3, transit: 2 }, tall: true }),
    F(['Sky hotel'], { floors: [10, 18], value: 5.2, staff: 3, work: 3, needs: { power: 3, water: 3, transit: 3 }, tall: true })],
  general_store: [NA,
    F(['Merchant shop'], {}), F(['Department store'], { floors: [2, 3], scale: 1.1, value: 1.8, staff: 1, work: 1.4 }),
    F(['Shopping centre'], { floors: [1, 2], scale: 1.2, value: 2.6, staff: 2, work: 1.6, needs: { power: 2 } }),
    F(['Shopping complex'], { floors: [2, 4], scale: 1.25, value: 3.6, staff: 3, work: 2, needs: { power: 2, transit: 2 } }),
    F(['Smart market hall'], { floors: [2, 3], scale: 1.25, value: 4.6, staff: 3, work: 2.2, needs: { power: 3 } })],
  stall: [NA,
    F(['Trading stall'], {}), F(['Market kiosk'], { value: 1.4 }), F(['Corner shop'], { value: 2, needs: { power: 2 } }), F(['Convenience store'], { value: 2.6, needs: { power: 2 } }), F(['Automated kiosk'], { value: 3.2, needs: { power: 3 } })],
  hall: [NA,
    F(['Hearth Hall'], { beds: 10 }), F(['Assembly rooms'], { floors: [2, 2], value: 1.5, beds: 12, work: 1.3 }), F(['Community centre'], { floors: [2, 2], value: 2.2, beds: 14, needs: { power: 2 } }),
    F(['Civic forum'], { floors: [2, 3], value: 3, beds: 16, needs: { power: 2 } }), F(['Civic commons'], { floors: [2, 3], value: 3.8, beds: 18, needs: { power: 3 } })],
  townhall: [NA,
    F(['Town Hall'], { beds: 10 }), F(['Municipal building'], { floors: [3, 3], value: 1.6, beds: 10, work: 1.4 }), F(['City hall'], { floors: [3, 4], value: 2.4, beds: 10, work: 1.6, needs: { power: 2 } }),
    F(['Government headquarters'], { floors: [6, 10], value: 3.6, beds: 10, work: 2.4, needs: { power: 2, transit: 2 }, tall: true }), F(['Civic spire'], { floors: [8, 12], value: 4.6, beds: 10, work: 2.8, needs: { power: 3 }, tall: true })],
  courthouse: [NA,
    F(['Courthouse'], {}), F(['Assize court'], { floors: [2, 2], value: 1.6, work: 1.3 }), F(['Courts of justice'], { floors: [2, 3], value: 2.3, needs: { power: 2 } }),
    F(['Justice centre'], { floors: [3, 5], value: 3.2, needs: { power: 2 } }), F(['Justice pavilion'], { floors: [2, 3], value: 4, needs: { power: 3 } })],
  school: [NA,
    F(['Schoolhouse'], {}), F(['Board school'], { floors: [2, 2], value: 1.6, staff: 1 }), F(['High school'], { floors: [2, 3], scale: 1.1, value: 2.3, staff: 1, needs: { power: 2 } }),
    F(['Academy'], { floors: [3, 4], value: 3.2, staff: 2, needs: { power: 2, comms: 3 } }), F(['Learning campus'], { floors: [2, 4], value: 4, staff: 2, needs: { power: 3 } })],
  granary: [NA,
    F(['Granary'], {}), F(['Grain warehouse'], { floors: [2, 2], value: 1.5 }), F(['Grain silos'], { floors: [3, 4], value: 2.2, needs: { power: 2 } }),
    F(['Logistics depot'], { floors: [2, 3], value: 3, needs: { power: 2 } }), F(['Automated food store'], { floors: [2, 3], value: 3.8, needs: { power: 3 } })],
  well: [NA, F(['Well'], {}), F(['Pump house'], { value: 1.4 }), F(['Water tower'], { floors: [3, 3], value: 2 }), F(['Water works'], { value: 2.6 }), F(['Water recycling plant'], { value: 3.2 })],
  bank: [NA,
    F(['Counting house'], {}), F(['Merchant bank'], { floors: [2, 3], value: 1.7, work: 1.4 }), F(['Art Deco bank'], { floors: [3, 5], value: 2.6, work: 1.7, needs: { power: 2 } }),
    F(['Financial tower'], { floors: [12, 24], scale: 0.95, value: 4.8, work: 3.2, needs: { power: 2, water: 3, transit: 2 }, tall: true }),
    F(['Glass finance spire'], { floors: [16, 30], value: 6, work: 3.6, needs: { power: 3, water: 3, transit: 3 }, tall: true })],
  guildhall: [NA,
    F(['Guild hall'], {}), F(['Guild exchange'], { floors: [2, 3], value: 1.7, work: 1.4 }), F(['Union headquarters'], { floors: [3, 5], value: 2.5, work: 1.7, needs: { power: 2 } }),
    F(['Corporate headquarters'], { floors: [10, 20], value: 4.6, work: 3, needs: { power: 2, water: 3, transit: 2 }, tall: true }),
    F(['Cooperative campus'], { floors: [4, 8], scale: 1.1, value: 5.4, work: 2.8, needs: { power: 3 } })],
  shrine: [NA, F(['Shrine'], {}), F(['Shrine'], {}), F(['Shrine'], {}), F(['Shrine'], {}), F(['Shrine'], {})],
  chapel: [NA, F(['Chapel'], {}), F(['Brick church'], { value: 1.5 }), F(['Modern church'], { value: 2 }), F(['Chapel of glass'], { value: 2.6 }), F(['Light chapel'], { value: 3 })],
  temple: [NA, F(['Temple'], {}), F(['Temple'], { value: 1.5 }), F(['Temple'], { value: 2 }), F(['Temple'], { value: 2.6 }), F(['Temple'], { value: 3 })],
  barracks: [NA, F(['Barracks'], {}), F(['Drill hall'], { floors: [2, 2], value: 1.5 }), F(['Armoury'], { floors: [2, 2], value: 2.2 }), F(['Defence centre'], { floors: [2, 3], value: 3 }), F(['Security centre'], { floors: [2, 3], value: 3.6 })],
  ruins: [NA, F('Ruins'), F('Ruins'), F('Ruins'), F('Ruins'), F('Ruins')],
  // --- Density and wealth (v0.5.2) ---------------------------------------------------
  apartment: [NA, NA,
    F(['Brick tenement', 'Mansion block'], { floors: [3, 4], scale: 1.2, value: 2, beds: 14, work: 2, needs: { water: 2 } }),
    F(['Concrete apartments', 'Art Deco flats'], { floors: [4, 7], scale: 1.25, value: 3, beds: 20, work: 2.6, needs: { power: 2, water: 2 } }),
    F(['Luxury condominiums', 'Apartment block'], { floors: [6, 12], scale: 1.25, value: 4.4, beds: 28, work: 3.2, needs: { power: 2, water: 3, transit: 2 } }),
    F(['Garden apartments', 'Terraced eco-flats'], { floors: [6, 12], scale: 1.25, value: 5.4, beds: 32, work: 3.4, needs: { power: 3, water: 3, transit: 2 } })],
  tower: [NA, NA, NA,
    F(['Early high-rise'], { floors: [7, 11], scale: 1.1, value: 4.4, beds: 34, work: 3.6, needs: { power: 2, water: 3, transit: 2 }, tall: true }),
    F(['Glass skyscraper', 'Residential tower', 'Twisting tower'], { floors: [14, 30], scale: 1.1, value: 7, beds: 48, work: 4.6, needs: { power: 2, water: 3, transit: 2 }, tall: true }),
    F(['Vertical garden tower', 'Solar spire'], { floors: [18, 36], scale: 1.1, value: 9, beds: 60, work: 5.2, needs: { power: 3, water: 3, transit: 3 }, tall: true })],
  mansion: [NA,
    F(['Manor house'], { floors: [2, 2], scale: 1.35, value: 3, beds: 6, work: 1.8 }),
    F(['Victorian mansion'], { floors: [2, 3], scale: 1.4, value: 4, beds: 8, work: 2.2 }),
    F(['Luxury estate'], { floors: [2, 2], scale: 1.5, value: 5, beds: 8, work: 2.4, needs: { power: 2, water: 2 } }),
    F(['Modern mansion'], { floors: [2, 3], scale: 1.5, value: 6.4, beds: 10, work: 2.8, needs: { power: 2, water: 3 } }),
    F(['Futuristic villa'], { floors: [2, 3], scale: 1.5, value: 7.6, beds: 10, work: 3, needs: { power: 3, water: 3 } })],
  grounds: [NA, F(['Estate grounds']), F(['Estate grounds']), F(['Gardens and plaza']), F(['Tower plaza']), F(['Garden plaza'])],
  station: [NA, NA,
    F(['Railway station'], { floors: [2, 2], scale: 1.2, value: 2.4, work: 2 }), F(['Bus and rail terminal'], { floors: [2, 2], scale: 1.25, value: 3, work: 2.2, needs: { power: 2 } }),
    F(['Transit hub'], { floors: [2, 3], scale: 1.25, value: 4, work: 2.6, needs: { power: 2 } }), F(['Maglev terminal'], { floors: [2, 3], scale: 1.25, value: 5, work: 3, needs: { power: 3 } })],
  hospital: [NA, NA, NA,
    F(['Hospital'], { floors: [3, 4], scale: 1.25, value: 3.4, work: 2.6, needs: { power: 2, water: 3 } }),
    F(['Medical centre'], { floors: [5, 8], scale: 1.25, value: 4.6, work: 3, needs: { power: 2, water: 3 } }),
    F(['Health campus'], { floors: [4, 6], scale: 1.3, value: 5.6, work: 3, needs: { power: 3, water: 3 } })],
};

/** Base footprints (era 1) for types the old Footprints table does not list. */
export const EXTRA_FOOTPRINT = {
  apartment: { w: 4.6, d: 4.2, h: 8 }, tower: { w: 5, d: 5, h: 30 }, mansion: { w: 4.4, d: 3.8, h: 5 }, grounds: { w: 0.1, d: 0.1, h: 0 },
  station: { w: 5.2, d: 3.6, h: 4.6 }, hospital: { w: 5.4, d: 4.4, h: 9 },
};

export const firstEraOf = (type) => (FORMS[type] ?? FORMS.cottage).findIndex((f) => f);
/** The form a type takes in an era (falls back to the nearest available era). */
export function formOf(type, era = 1) {
  const list = FORMS[type] ?? FORMS.cottage;
  for (let e = Math.max(1, Math.min(5, era)); e >= 1; e--) if (list[e]) return { ...list[e], era: e };
  const e = firstEraOf(type);
  return { ...list[e], era: e };
}

/** A small deterministic hash (FNV-1a) for seeds. */
export function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Distance-based zoning: the denser the centre, the taller it may build. */
export function zoneOf(plot) {
  if (plot.landType === 'farmland') return 'rural';
  const r = Math.hypot(plot.x, plot.z);
  return r <= 46 ? 'core' : r <= 60 ? 'urban' : 'suburban';
}
export const ZONE_MAX_FLOORS = { core: 40, urban: 9, suburban: 3, rural: 3 };
/** 0 at the valley edge, 1 at the crossroads. */
export const centrality = (plot) => Math.max(0, Math.min(1, 1 - Math.hypot(plot.x, plot.z) / 80));

/** Floors for a new building: the form's range, picked by seed, capped by zoning. */
export function floorsFor(type, era, seed, plot) {
  const f = formOf(type, era);
  const [lo, hi] = f.floors;
  const pickN = lo + (seed % (hi - lo + 1));
  return Math.max(1, Math.min(pickN, ZONE_MAX_FLOORS[zoneOf(plot)] ?? 3));
}

/** Variant label index for a building. */
export const variantOf = (b) => (b.seed ?? 0) % formOf(b.type, b.era ?? 1).labels.length;
export const formLabel = (b) => formOf(b.type, b.era ?? 1).labels[variantOf(b)];

/**
 * Footprint and height of a building in building-local space (width along x,
 * depth along z), clamped so it always fits inside its plot.
 */
export function dimsOf(b, plot, base) {
  const era = b.era ?? 1;
  const f = formOf(b.type, era);
  const fp = base ?? EXTRA_FOOTPRINT[b.type] ?? { w: 3.6, d: 3.2, h: 2.5 };
  const legacy = era <= 1 && !EXTRA_FOOTPRINT[b.type];
  const floors = b.floors ?? f.floors[0];
  // Plots may face east or west, which swaps their local axes.
  const sideways = plot && (plot.facing === 'east' || plot.facing === 'west');
  const maxW = plot ? (sideways ? plot.d : plot.w) - 1.2 : 99, maxD = plot ? (sideways ? plot.w : plot.d) - 1.6 : 99;
  if (legacy) return { w: fp.w, d: fp.d, h: fp.h, floors: 1 };
  const grow = f.scale * (1 + (era - 1) * 0.04);
  const w = Math.min(maxW, Math.max(fp.w, fp.w * grow));
  const d = Math.min(maxD, Math.max(fp.d, fp.d * grow));
  const h = b.type === 'grounds' ? 0 : floors * FLOOR_H[era] + 0.4;
  return { w: Math.max(1, w), d: Math.max(1, d), h, floors };
}
