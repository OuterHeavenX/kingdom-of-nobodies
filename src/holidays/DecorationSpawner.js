import * as THREE from 'three';
import { PROPS, DECOR_MATERIALS, FLAG_SETS, geometryFor, strand, skeleton, paradeFloat } from '../world/HolidayProps.js';
import { solidRects, buildingDims } from '../property/Footprints.js';
import { roadRect, RIVER } from '../navigation/RoadNetwork.js';
import { SWEETHEART_SPOTS } from './HolidayRegistry.js';
import { buildingModel } from '../world/Models.js';

// Seeded, navigation-safe decoration of a town for a season or holiday.
//
// Sites: from the simulation's plots and roads, the spawner works out where
// decorations may stand: beside front doors (never in front of them), in
// yard corners, along road verges (never on the road), around the square,
// in farm fields, and a few open "feature" spots big enough for a decorated
// tree, a bonfire or a rainbow. Every candidate is checked against
// buildings, roads, doorways, the river, the square's fire and market and
// any building site, so decorations never block a route or a door. Sites
// are recomputed when the town's layout changes, so new districts are
// decorated too.
//
// Placement is seeded by the holiday and the place, so the same pumpkins sit
// on the same steps after a reload. Every part of every prop is gathered
// into one InstancedMesh per geometry and material; the set owns its
// materials and instance buffers and disposes them when it is taken down.

export const LAMPS = [[-13, 2.4], [13, 2.4], [-13, -2.4], [13, -2.4], [2.4, 11], [-2.4, -13], [26, 2.4], [-26, -2.4]];
const FEATURE_CANDIDATES = [[-6.4, 6.6], [6.6, -6.4], [6.4, 6.4], [-6.6, -7.8], [0, 13.4], [-14, 5], [14, -5], [0, -14], [16, 5], [-16, -5]];

export function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  let t = h >>> 0;
  return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

const FACING = { south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0] };
/** A point given in a plot's own frame (x along the frontage, z towards the street) in world space. */
function plotPoint(plot, lx, lz) {
  const [fx, fz] = FACING[plot.facing ?? 'south'];
  // Local +z is the facing direction; local +x is the facing rotated a quarter turn.
  return [plot.x + lx * fz + lz * fx, plot.z - lx * fx + lz * fz];
}
const facingYaw = (plot) => ({ south: 0, north: Math.PI, west: -Math.PI / 2, east: Math.PI / 2 }[plot.facing ?? 'south']);

/** A signature of everything that moves decorations: when it changes, sites are recomputed. */
export function siteSignature(state) {
  let sig = `${state.roads?.length ?? 0}:${state.council?.marketplace ? 'm' : ''}:`;
  for (const p of state.plots) sig += `${p.building?.type ?? ''}${p.building?.era ?? ''}${p.projectId ? '*' : ''}${p.facing?.[0] ?? ''}|`;
  const st = state.divine?.stone;
  if (st) sig += `#stone:${st.x},${st.z}:${Object.keys(st.site ?? {}).length}`;
  return sig;
}

/** Where decorations may go in First Hearth. */
export function villageSites(state) {
  const solids = [], doors = [];
  for (const p of state.plots) {
    for (const r of solidRects(p)) solids.push(r);
    if (p.projectId) solids.push([p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2]);
    if (p.building && p.building.type !== 'farm' && p.building.type !== 'ruins') {
      // The doorway corridor: from the front wall out past the plot edge to the street.
      const d = buildingDims(p).d;
      const [ax, az] = plotPoint(p, -0.9, d / 2 - 0.2), [bx, bz] = plotPoint(p, 0.9, (FACING[p.facing ?? 'south'][1] ? p.d : p.w) / 2 + 1.6);
      doors.push([Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)]);
    }
  }
  const roads = (state.roads ?? []).map((r) => roadRect(r));
  const market = state.council?.marketplace ? [0, 1, 2, 3].map((i) => { const a = Math.PI / 4 + (i * Math.PI) / 2; return [Math.cos(a) * 7, Math.sin(a) * 7]; }) : [];
  const inside = (x, z, r, [a, b, c, d]) => x > a - r && x < c + r && z > b - r && z < d + r;
  const stone = state.divine?.stone ?? null;
  const stoneR = stone ? (stone.site?.museum || stone.site?.observatory ? 9.5 : stone.site?.garden ? 4.4 : 3.2) : 0;
  const free = (x, z, r = 0.5) => {
    if (Math.abs(x) > 86 || Math.abs(z) > 86) return false;
    if (z > RIVER.zMin - 1.5 - r && z < RIVER.zMax + 1.5 + r) return false;
    if (Math.hypot(x, z) < 4.9 + r) return false; // the square, its fire and benches
    if (Math.hypot(x + 4.6, z + 4.6) < 1.6 + r) return false; // the Founders' Memorial
    if (stone && Math.hypot(x - stone.x, z - stone.z) < stoneR + r) return false; // the carved stone and what stands around it
    for (const [lx, lz] of LAMPS) if (Math.hypot(x - lx, z - lz) < 0.6 + r) return false;
    for (const [mx, mz] of market) if (Math.hypot(x - mx, z - mz) < 1.9 + r) return false;
    for (const s of solids) if (inside(x, z, r + 0.3, s)) return false;
    for (const s of roads) if (inside(x, z, r + 0.25, s)) return false;
    for (const s of doors) if (inside(x, z, r + 0.1, s)) return false;
    return true;
  };
  const homes = [], doorsOut = [], yards = [], farms = [], corners = [];
  for (const p of state.plots) {
    const b = p.building;
    if (!b || p.projectId) continue;
    if (b.type === 'farm') {
      for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) {
        const [x, z] = plotPoint(p, i * (p.w / 6), j * (p.d / 4));
        if (free(x, z, 0.6)) farms.push([x, z, facingYaw(p), p.id]);
      }
      continue;
    }
    if (b.type === 'ruins' || b.type === 'grounds') continue;
    const { w, d } = buildingDims(p);
    const yaw = facingYaw(p);
    // Wreaths hang on the door itself.
    const [dx, dz] = plotPoint(p, 0, d / 2 + 0.02);
    doorsOut.push([dx, dz, yaw, p.id]);
    for (const s of [-1, 1]) {
      const [x, z] = plotPoint(p, s * (w / 2 + 0.95), d / 2 - 0.2);
      if (free(x, z, 0.45)) homes.push([x, z, yaw, p.id]);
      const [cx, cz] = plotPoint(p, s * (w / 2 - 0.05), d / 2 + 0.05);
      corners.push([cx, cz, yaw, p.id]);
      const [yx, yz] = plotPoint(p, s * (p.w / 2 - 0.8), -(FACING[p.facing ?? 'south'][1] ? p.d : p.w) / 2 + 0.8);
      if (free(yx, yz, 0.5)) yards.push([yx, yz, yaw, p.id]);
    }
  }
  const verges = [];
  for (const r of state.roads ?? []) {
    if (r.kind === 'bridge' || r.kind === 'ford') continue;
    const along = r.w >= r.d, len = along ? r.w : r.d, half = (along ? r.d : r.w) / 2 + 0.75;
    for (let t = -len / 2 + 1.5; t <= len / 2 - 1.5; t += 3.4) for (const s of [-1, 1]) {
      const x = along ? r.x + t : r.x + s * half, z = along ? r.z + s * half : r.z + t;
      if (free(x, z, 0.4)) verges.push([x, z, along ? (s > 0 ? Math.PI : 0) : (s > 0 ? -Math.PI / 2 : Math.PI / 2), r.id]);
    }
  }
  const square = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + 0.2; const x = Math.cos(a) * 5.9, z = Math.sin(a) * 5.9; if (free(x, z, 0.45)) square.push([x, z, -a - Math.PI / 2]); }
  const features = FEATURE_CANDIDATES.filter(([x, z]) => free(x, z, 1.7));
  const sweethearts = SWEETHEART_SPOTS.filter(([x, z]) => free(x, z, 0.4) || Math.hypot(x, z) < 6);
  const hall = state.plots.find((p) => p.name === 'Hearth Hall');
  const ghosts = [[0, 0], ...(hall ? [plotPoint(hall, 0, 5)] : []), ...homes.filter((_, i) => i % 7 === 0).slice(0, 4).map(([x, z]) => [x, z])];
  return { kind: 'village', free, homes, doors: doorsOut, corners, yards, farms, verges, square, features, sweethearts, lamps: LAMPS.map(([x, z]) => [x, z]), lampPairs: [[[-13, 2.4], [-26, -2.4]], [[13, 2.4], [26, 2.4]], [[-13, 2.4], [-13, -2.4]], [[13, 2.4], [13, -2.4]]], ghosts, mainRoad: [[-30, 0], [30, 0]], fireworks: [[0, 0], [-12, -6], [12, 6]], fireworksHeight: [16, 26] };
}

// --- The set: parts gathered into instanced meshes -------------------------------------

export class DecorationSet {
  constructor(name, { lanterns = null } = {}) {
    this.name = name;
    this.group = new THREE.Group();
    this.group.name = `decor:${name}`;
    this.uGrow = { value: 0.001 };
    this.target = 1;
    this.lanterns = lanterns;
    this.buckets = new Map();
    this.materials = new Map();
    this.live = [];
    this.meshes = [];
    this.count = 0; // props placed
    this.spots = []; // [x, z] of every placed prop (strands excluded), for checks
    this.propScale = 1; // holiday sets draw props a little larger so they read from the overview camera
  }

  material(name) {
    if (this.materials.has(name)) return this.materials.get(name);
    const [color, emissive, intensity, extra = {}] = DECOR_MATERIALS[name] ?? ['#ff00ff'];
    let c = color, e = emissive;
    // Lantern colours follow the holiday's palette.
    const lm = name.match(/^lantern(\d)$/);
    if (lm && this.lanterns) { c = this.lanterns[Number(lm[1]) % this.lanterns.length]; e = c; }
    const { flicker, twinkle, ...opts } = extra;
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true, ...(e ? { emissive: e, emissiveIntensity: intensity } : {}), ...opts });
    m.userData = { base: intensity ?? 0, flicker: !!flicker, twinkle: twinkle ?? null, glow: !!e };
    const grow = this.uGrow;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uGrow = grow;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uGrow;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed *= uGrow;');
    };
    m.customProgramCacheKey = () => 'decor-grow';
    this.materials.set(name, m);
    return m;
  }

  /** Place a prop's parts at (x, z), turned by `yaw`, scaled by `s`, raised by `y`. */
  add(parts, x, z, yaw = 0, s = 1, y = 0) {
    this.spots.push([x, z]);
    this.addParts(parts, x, z, yaw, s * this.propScale, y * this.propScale);
  }

  /** Flags or lights strung in the air (their parts are already in world positions). */
  addStrand(parts) { this.addParts(parts, 0, 0); }

  addParts(parts, x, z, yaw = 0, s = 1, y = 0) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const [g, m, sc, p, r] of parts) {
      const px = p[0] * s, pz = p[2] * s;
      const wx = x + px * cy + pz * sy, wz = z - px * sy + pz * cy;
      const key = g + '|' + m;
      if (!this.buckets.has(key)) this.buckets.set(key, { g, m, items: [] });
      this.buckets.get(key).items.push([[sc[0] * s, sc[1] * s, sc[2] * s], [wx, y + p[1] * s, wz], r ? [r[0], (r[1] ?? 0) + yaw, r[2]] : [0, yaw, 0]]);
    }
    this.count++;
  }

  /** Parts fixed to something that moves (a ship's rigging): real meshes under `parent`, removed again on dispose. */
  attach(parent, parts) {
    this.attached = this.attached ?? [];
    for (const [g, m, sc, p, r] of parts) {
      const mesh = new THREE.Mesh(geometryFor(g), this.material(m));
      mesh.scale.set(...sc); mesh.position.set(...p); if (r) mesh.rotation.set(r[0], r[1] ?? 0, r[2] ?? 0, 'YXZ');
      parent.add(mesh);
      this.attached.push(mesh);
    }
  }

  /** A moving prop: { group, update(time, calm, dt) }. */
  addLive(obj, x, z, yaw = 0, s = 1) {
    obj.group.position.set(x, 0, z);
    obj.group.rotation.y = yaw;
    obj.group.scale.setScalar(s);
    obj.baseScale = s;
    this.group.add(obj.group);
    this.live.push(obj);
    this.count++;
  }

  build() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const { g, m, items } of this.buckets.values()) {
      const mesh = new THREE.InstancedMesh(geometryFor(g), this.material(m), items.length);
      items.forEach(([s, p, r], i) => { e.set(r[0], r[1], r[2], 'YXZ'); q.setFromEuler(e); mesh.setMatrixAt(i, m4.compose(v.set(...p), q, sc.set(...s))); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = !this.materials.get(m).userData.glow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.buckets.clear();
    return this;
  }

  /** Per frame: grow in or out, flicker lanterns, twinkle lights, animate moving props. */
  update(dt, time, { night = 0, calm = 1 } = {}) {
    const g = this.uGrow;
    g.value += (this.target - g.value) * Math.min(1, dt * 2.2);
    if (this.target === 1 && g.value > 0.995) g.value = 1;
    this.group.visible = g.value > 0.01;
    const glow = 0.45 + night * 0.9;
    for (const m of this.materials.values()) {
      const u = m.userData;
      if (!u.glow) continue;
      let k = glow;
      if (u.flicker) k *= 0.82 + Math.sin(time * 9.1 + u.base) * 0.08 * calm + Math.sin(time * 15.7) * 0.06 * calm;
      if (u.twinkle != null) k *= 0.55 + 0.45 * Math.max(0, Math.sin(time * 1.8 * calm + u.twinkle * 1.26));
      m.emissiveIntensity = u.base * k;
    }
    for (const o of this.live) { o.update(time, calm, dt); o.group.scale.setScalar((o.baseScale ?? 1) * Math.max(0.001, g.value)); }
  }

  fadeOut() { this.target = 0; }
  get faded() { return this.target === 0 && this.uGrow.value < 0.02; }

  /** Free the GPU resources this set owns (shared geometries stay cached). */
  dispose() {
    for (const mesh of this.attached ?? []) mesh.parent?.remove(mesh);
    this.attached = [];
    for (const mesh of this.meshes) mesh.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const o of this.live) o.group.traverse((x) => { if (x.isMesh && x.userData.ownGeometry) x.geometry.dispose(); });
    this.group.clear();
    this.meshes = [];
    this.live = [];
    this.materials.clear();
  }
}

// --- What goes where, holiday by holiday -----------------------------------------------

/** Take up to `n` spots from a list, spread out (every k-th, starting at a seeded offset). */
function spread(list, n, rand) {
  if (!list.length || n <= 0) return [];
  if (n >= list.length) return list.slice();
  const step = list.length / n, start = rand() * step;
  return Array.from({ length: n }, (_, i) => list[Math.floor(start + i * step) % list.length]);
}
/** A scattered point near a spot, kept only if it is also clear of roads, doors and buildings. */
const around = (rand, sites, [x, z], r) => {
  const nx = x + (rand() - 0.5) * r, nz = z + (rand() - 0.5) * r;
  return sites.free(nx, nz, 0.35) ? [nx, nz] : [x, z];
};

function bunting(set, sites, items, rand, { sag = 0.45 } = {}) {
  // Strung between poles around the square and between lamps along the main road.
  const ring = sites.square.length >= 4 ? spread(sites.square, 8, rand) : [];
  for (const [x, z] of ring) set.add(PROPS.pole(rand, 3.2), x, z);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 9) set.addStrand(strand([a[0], 3.1, a[1]], [b[0], 3.1, b[1]], items, { sag }));
  }
  for (const [[ax, az], [bx, bz]] of sites.lampPairs) {
    set.addStrand(strand([ax, 2.75, az], [bx, 2.75, bz], items, { sag: sag * 1.4 }));
  }
}

function lights(set, sites, rand, bulbs = ['bulb0', 'bulb1', 'bulb2', 'bulb3', 'bulb4']) {
  const ring = spread(sites.square, 10, rand);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    set.add(PROPS.lightPost(rand), a[0], a[1]);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 8) set.addStrand(strand([a[0], 2.45, a[1]], [b[0], 2.45, b[1]], bulbs, { kind: 'light', spacing: 0.55, sag: 0.35 }));
  }
  for (let i = 0; i < sites.lamps.length - 1; i += 2) {
    const [ax, az] = sites.lamps[i], [bx, bz] = sites.lamps[i + 1];
    if (Math.hypot(ax - bx, az - bz) < 30) set.addStrand(strand([ax, 2.6, az], [bx, 2.6, bz], bulbs, { kind: 'light', spacing: 0.6, sag: 0.6 }));
  }
}

function lanternPoles(set, sites, n, rand, glow = ['lantern0', 'lantern1', 'lantern2']) {
  spread(sites.verges, n, rand).forEach(([x, z, yaw], i) => set.add(PROPS.lanternPole(rand, glow[i % glow.length]), x, z, yaw));
}

/** Blossom on the round trees' crowns: visible across the whole valley. */
function blossomTrees(set, trees, n, rand, colors = null) {
  for (const t of spread(trees, n, rand)) for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + rand();
    const parts = PROPS.blossom(rand).map((p) => (colors ? [p[0], colors[k % colors.length], p[2], p[3], p[4]] : p));
    set.addParts(parts, t.x + Math.cos(a) * 1.05 * t.s, t.z + Math.sin(a) * 1.05 * t.s, 0, t.s * 1.05, 2.4 * t.s + rand() * 0.9);
  }
}

const SETS = {
  newyear(set, sites, { n, rand }) {
    bunting(set, sites, FLAG_SETS.newyear, rand);
    lights(set, sites, rand, ['bulb2', 'bulb4', 'bulb3']);
    spread(sites.square, 4, rand).forEach(([x, z, yaw]) => set.add(PROPS.nyBanner(rand), x, z, yaw));
    lanternPoles(set, sites, n(16), rand);
    spread(sites.homes, n(18), rand).forEach(([x, z, yaw]) => set.add(PROPS.lanternPole(rand, 'lantern' + Math.floor(rand() * 3), 1.6), x, z, yaw));
  },
  valentine(set, sites, { n, rand, trees }) {
    blossomTrees(set, trees, n(90), rand, ['blush', 'pink', 'blossomPink', 'rose']);
    const ring = spread(sites.square, 8, rand);
    for (const [x, z] of ring) set.add(PROPS.pole(rand, 3.2), x, z);
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 9) set.addStrand(strand([a[0], 3.1, a[1]], [b[0], 3.1, b[1]], ['rose', 'pink', 'blush'], { kind: 'heart', spacing: 0.75 })); }
    for (const [[ax, az], [bx, bz]] of sites.lampPairs.slice(0, 2)) set.addStrand(strand([ax, 2.75, az], [bx, 2.75, bz], FLAG_SETS.pinkRed, { sag: 0.6 }));
    for (const [x, z] of sites.sweethearts) set.add(PROPS.romanticBench(rand), x, z, Math.atan2(-x, -z));
    spread(sites.homes, n(26), rand).forEach(([x, z, yaw]) => set.add(PROPS.flowerPot(rand, ['rose', 'pink', 'blush', 'flowerRed']), x, z, yaw));
    spread(sites.verges, n(18), rand).forEach(([x, z, yaw]) => set.add(PROPS.heartPost(rand), x, z, yaw));
    spread(sites.doors, n(20), rand).forEach(([x, z, yaw]) => set.add(PROPS.heart(rand, 0.5, rand() < 0.5 ? 'rose' : 'pink'), x, z, yaw, 1, 1.25));
    for (const f of sites.features.slice(0, 2)) set.add(PROPS.heart(rand, 3.2, 'rose'), f[0], f[1], Math.atan2(-f[0], -f[1]));
    lanternPoles(set, sites, n(10), rand);
  },
  stpatrick(set, sites, { n, rand }) {
    bunting(set, sites, FLAG_SETS.green, rand);
    for (const [x, z] of spread([...sites.homes, ...sites.yards, ...sites.verges], n(60), rand)) set.add(PROPS.shamrock(rand), ...around(rand, sites, [x, z], 0.8), rand() * 6);
    const f = sites.features[0];
    if (f) { set.add(PROPS.rainbow(rand, 1), f[0], f[1], 0.7); set.add(PROPS.potOfGold(), f[0] + Math.cos(0.7) * 3.6, f[1] - Math.sin(0.7) * 3.6); }
    lanternPoles(set, sites, n(14), rand);
  },
  spring(set, sites, { n, rand, trees }) {
    blossomTrees(set, trees, n(70), rand);
    bunting(set, sites, FLAG_SETS.pastel, rand);
    for (const [x, z] of spread([...sites.yards, ...sites.homes, ...sites.verges], n(70), rand)) set.add(PROPS.egg(rand), ...around(rand, sites, [x, z], 1.2), rand() * 6);
    spread(sites.homes, n(14), rand).forEach(([x, z, yaw]) => set.add(PROPS.eggBasket(rand), x, z, yaw));
    spread(sites.homes, n(20), rand).forEach(([x, z, yaw]) => set.add(PROPS.flowerBed(rand), x, z, yaw));
    spread(sites.square, 3, rand).forEach(([x, z, yaw]) => set.add(PROPS.flowerArch(rand), x, z, yaw));
    spread(sites.doors, n(18), rand).forEach(([x, z, yaw]) => set.add(PROPS.flowerWreath(rand), x, z, yaw));
  },
  solstice(set, sites, { n, rand }) {
    bunting(set, sites, FLAG_SETS.rainbow, rand);
    for (const f of sites.features.slice(0, 3)) set.add(PROPS.bonfire(rand, f === sites.features[0] ? 1.6 : 1), f[0], f[1]);
    lanternPoles(set, sites, n(18), rand);
    spread(sites.doors, n(24), rand).forEach(([x, z, yaw]) => set.add(PROPS.flowerWreath(rand), x, z, yaw));
    spread(sites.homes, n(12), rand).forEach(([x, z, yaw]) => set.add(PROPS.flowerPot(rand, ['flowerYellow', 'flowerRed', 'flowerViolet']), x, z, yaw));
  },
  founders(set, sites, { n, rand, kingdomColor }) {
    bunting(set, sites, FLAG_SETS.founders, rand);
    const colors = ['gold', 'red', 'blue', kingdomColor ?? 'gold'];
    spread(sites.verges, n(26), rand).forEach(([x, z, yaw], i) => set.add(PROPS.kingdomFlag(rand, colors[i % colors.length]), x, z, yaw));
    spread(sites.square, 6, rand).forEach(([x, z, yaw], i) => set.add(PROPS.kingdomFlag(rand, colors[i % colors.length], 5.2), x, z, yaw));
    if (sites.mainRoad) set.addLive(paradeFloat(materialTable(set, ['plank', 'gold', 'timberDark', 'red', 'blue']), sites.mainRoad), 0, 0);
  },
  harvest(set, sites, { n, rand }) {
    bunting(set, sites, FLAG_SETS.autumn, rand);
    spread(sites.farms, n(16), rand).forEach(([x, z, yaw], i) => set.add(i % 3 === 0 ? PROPS.scarecrow(rand) : i % 3 === 1 ? PROPS.hayBale(rand) : PROPS.cornStalks(), x, z, yaw));
    for (const [x, z] of spread(sites.farms, n(24), rand)) set.add(PROPS.pumpkin(rand), ...around(rand, sites, [x, z], 1.4));
    spread(sites.square, 4, rand).forEach(([x, z, yaw]) => set.add(PROPS.harvestDisplay(rand), x, z, yaw));
    spread(sites.verges, n(8), rand).forEach(([x, z, yaw]) => set.add(PROPS.harvestCart(rand), x, z, yaw + Math.PI / 2, 0.85));
    spread(sites.homes, n(18), rand).forEach(([x, z, yaw]) => set.add(rand() < 0.5 ? PROPS.hayBale(rand) : PROPS.cornStalks(), x, z, yaw, 0.7));
    lanternPoles(set, sites, n(10), rand);
  },
  halloween(set, sites, { n, rand }) {
    const mats = materialTable(set, ['bone', 'boneShade', 'hat']);
    for (const [x, z, yaw] of spread(sites.homes, n(sites.homes.length), rand)) set.add(rand() < 0.55 ? PROPS.jackolantern(rand) : PROPS.pumpkin(rand), x, z, yaw);
    for (const [x, z, yaw] of spread(sites.verges, n(28), rand)) set.add(rand() < 0.5 ? PROPS.jackolantern(rand, 0.8) : PROPS.pumpkin(rand, 0.8), x, z, yaw);
    for (const [x, z] of spread(sites.farms, n(30), rand)) set.add(PROPS.pumpkin(rand, 1.1), ...around(rand, sites, [x, z], 1.5));
    for (const [x, z, yaw] of sites.square) set.add(rand() < 0.6 ? PROPS.jackolantern(rand, 0.9) : PROPS.pumpkin(rand), x, z, yaw);
    spread(sites.farms, n(6), rand).forEach(([x, z, yaw]) => set.add(PROPS.scarecrow(rand), x, z, yaw));
    spread(sites.yards, n(6), rand).forEach(([x, z, yaw]) => set.add(PROPS.scarecrow(rand), x, z, yaw));
    spread(sites.corners, n(30), rand).forEach(([x, z, yaw]) => set.add(PROPS.cobweb(), x, z, yaw));
    spread(sites.yards, n(8), rand).forEach(([x, z, yaw]) => set.add(PROPS.spookyTree(rand), x, z, yaw));
    lanternPoles(set, sites, n(22), rand, ['orangeGlow', 'purpleGlow']);
    bunting(set, sites, FLAG_SETS.halloween, rand, { sag: 0.6 });
    const skel = [...spread(sites.square, 3, rand), ...spread(sites.homes, 3, rand)];
    for (const [x, z, yaw] of skel) set.addLive(skeleton(mats, rand), x, z, (yaw ?? 0) + Math.PI);
    // Haunted market stalls: draped in purple and cobwebbed.
    for (const f of sites.features.slice(0, 2)) {
      const stall = buildingModel('stall', { id: 'haunt' + f[0], open: true });
      stall.scale.setScalar(0.75);
      const drape = new THREE.Mesh(geometryFor('box'), materialTable(set, ['shirtA']).shirtA); drape.scale.set(3.2, 0.5, 2.6); drape.position.set(0, 2.5, 0); stall.add(drape);
      set.addLive({ group: stall, update() {} }, f[0], f[1], Math.atan2(-f[0], -f[1]));
      set.add(PROPS.cobweb(), f[0] + 1.2, f[1] + 1.2, 0.6);
      set.add(PROPS.jackolantern(rand, 0.8), f[0] - 1.6, f[1] + 0.6);
    }
  },
  gratitude(set, sites, { n, rand }) {
    bunting(set, sites, FLAG_SETS.autumn, rand);
    const f = sites.features.slice(0, 3);
    f.forEach(([x, z], i) => set.add(PROPS.foodTable(rand), x, z, i * 0.9));
    spread(sites.doors, n(28), rand).forEach(([x, z, yaw]) => set.add(PROPS.autumnWreath(rand), x, z, yaw));
    spread(sites.homes, n(16), rand).forEach(([x, z, yaw]) => set.add(PROPS.harvestDisplay(rand), x, z, yaw, 0.7));
    lanternPoles(set, sites, n(14), rand);
  },
  winter(set, sites, { n, rand }) {
    const f = sites.features;
    if (f[0]) { set.add(PROPS.decoratedTree(rand, 2.2), f[0][0], f[0][1]); for (let i = 0; i < 8; i++) set.add(PROPS.gift(rand), f[0][0] + Math.cos(i * 0.8) * 2.2, f[0][1] + Math.sin(i * 0.8) * 2.2, i); }
    for (const p of f.slice(1, 4)) set.add(PROPS.decoratedTree(rand, 1.1), p[0], p[1]);
    spread(sites.yards, n(14), rand).forEach(([x, z]) => set.add(PROPS.decoratedTree(rand, 0.7), x, z));
    spread(sites.doors, n(sites.doors.length), rand).forEach(([x, z, yaw]) => set.add(PROPS.wreath(rand, rand() < 0.7 ? 'red' : 'gold'), x, z, yaw));
    spread(sites.homes, n(22), rand).forEach(([x, z, yaw]) => set.add(rand() < 0.5 ? PROPS.gift(rand) : PROPS.lanternPole(rand, 'lantern' + Math.floor(rand() * 3), 1.4), x, z, yaw));
    spread(sites.verges, n(20), rand).forEach(([x, z, yaw], i) => set.add(PROPS.ribbonPost(rand, i % 2 ? 'red' : 'green', 'white'), x, z, yaw));
    lights(set, sites, rand);
    // Seasonal market stalls with red and white awnings.
    for (const p of f.slice(4, 6)) { const stall = buildingModel('stall', { id: 'xmas' + p[0], open: true }); stall.scale.setScalar(0.75); set.addLive({ group: stall, update() {} }, p[0], p[1], Math.atan2(-p[0], -p[1])); }
  },
};

/** Materials from the set's own table, by name (for moving props). */
function materialTable(set, names) { return Object.fromEntries(names.map((k) => [k, set.material(k)])); }

// Seasonal dressing that is there whatever the holiday: flowers, blossom, hay, fallen leaves.
const SEASON_SETS = {
  0(set, sites, { n, rand, trees }) {
    spread(sites.homes, n(Math.ceil(sites.homes.length * 0.6)), rand).forEach(([x, z, yaw]) => set.add(PROPS.flowerBed(rand), x, z, yaw));
    for (const t of spread(trees, n(70), rand)) for (let k = 0; k < 5; k++) { const a = k * 1.26 + rand(); set.add(PROPS.blossom(rand), t.x + Math.cos(a) * 1.1 * t.s, t.z + Math.sin(a) * 1.1 * t.s, 0, t.s * 0.9, 2.6 * t.s + rand() * 0.6); }
  },
  1(set, sites, { n, rand }) {
    spread(sites.homes, n(Math.ceil(sites.homes.length * 0.4)), rand).forEach(([x, z, yaw]) => set.add(PROPS.flowerPot(rand, ['flowerRed', 'flowerYellow', 'flowerViolet', 'pink']), x, z, yaw));
    spread(sites.verges, n(10), rand).forEach(([x, z, yaw]) => set.add(PROPS.pennant(rand), x, z, yaw));
  },
  2(set, sites, { n, rand, trees }) {
    for (const [x, z] of spread(sites.verges, n(90), rand)) set.add(PROPS.fallenLeaf(rand), ...around(rand, sites, [x, z], 1.4));
    for (const t of spread(trees, n(60), rand)) for (let k = 0; k < 4; k++) set.add(PROPS.fallenLeaf(rand), t.x + (rand() - 0.5) * 3, t.z + (rand() - 0.5) * 3);
    spread(sites.farms, n(10), rand).forEach(([x, z, yaw], i) => set.add(i % 2 ? PROPS.hayBale(rand) : PROPS.pumpkin(rand, 1.2), x, z, yaw));
    if (sites.farms.length) set.add(PROPS.harvestCart(rand), sites.farms[0][0], sites.farms[0][1], sites.farms[0][2]);
  },
  3() {},
};

/**
 * Build a decoration set for a theme. `which` is a holiday id or 'season-N'.
 * opts: { sites, density (0..1), seedKey, lanterns, trees, kingdom, extra(set, sites, ctx) }
 */
export function buildDecorations(which, opts) {
  const set = new DecorationSet(which, { lanterns: opts.lanterns });
  if (!which.startsWith('season-')) set.propScale = 1.3;
  const rand = seeded(`${which}:${opts.seedKey ?? 'hearth'}`);
  const n = (base) => Math.max(0, Math.round(base * (opts.density ?? 1)));
  const ctx = { n, rand, trees: opts.trees ?? [], kingdom: opts.kingdom ?? 'hearth', kingdomColor: opts.kingdomColor };
  const season = which.startsWith('season-') ? Number(which.slice(7)) : null;
  if (season != null) SEASON_SETS[season](set, opts.sites, ctx);
  else SETS[which]?.(set, opts.sites, ctx);
  opts.extra?.(set, opts.sites, ctx);
  return set.build();
}

export const DECORATED_HOLIDAYS = Object.keys(SETS);

/**
 * Each kingdom celebrates in its own way on top of the shared set:
 * Saltmere hangs lanterns along its docks and dresses its ships, Greenvale
 * ties ribbons to its windmills and fills its fields for the harvest,
 * Ironhold lines its walls with lanterns and lights bonfires on the hills.
 */
export function kingdomExtras(kingdom, holidayId) {
  if (kingdom === 'saltmere') return (set, sites, { rand }) => {
    if (!holidayId) return;
    for (const x of sites.docks ?? []) for (const z of [30, 38, 46]) for (const s of [-1, 1]) set.add(PROPS.lanternPole(rand, 'lantern' + Math.floor(rand() * 3), 2), x + s * 1.7, z, s > 0 ? 0 : Math.PI, 1, 0.9);
    const flags = FLAG_SETS[{ halloween: 'halloween', valentine: 'pinkRed', stpatrick: 'green', winter: 'festive', newyear: 'newyear', founders: 'founders' }[holidayId] ?? 'rainbow'];
    for (const boat of sites.boats ?? []) set.attach(boat, [...strand([0, 3.8, 0], [0, 1, 2.3], flags, { sag: 0.1, spacing: 0.45 }), ...strand([0, 3.8, 0], [0, 1, -2], flags, { sag: 0.1, spacing: 0.45 })]);
  };
  if (kingdom === 'greenvale') return (set, sites, { rand }) => {
    if (!holidayId || !['spring', 'solstice', 'harvest', 'founders', 'valentine', 'stpatrick'].includes(holidayId)) return;
    const flags = FLAG_SETS[{ valentine: 'pinkRed', stpatrick: 'green', spring: 'pastel', harvest: 'autumn', founders: 'founders' }[holidayId] ?? 'rainbow'];
    for (const [x, z] of sites.windmills ?? []) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; set.addStrand(strand([x, 7.6, z], [x + Math.cos(a) * 7, 0.6, z + Math.sin(a) * 7], flags, { sag: 0.5, spacing: 0.7 })); set.add(PROPS.pole(rand, 0.7), x + Math.cos(a) * 7, z + Math.sin(a) * 7); }
  };
  if (kingdom === 'ironhold') return (set, sites, { rand }) => {
    if (!holidayId) return;
    const w = sites.wall;
    if (w && ['winter', 'newyear', 'halloween', 'solstice', 'founders'].includes(holidayId)) {
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        if (Math.abs(((a - w.gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.25) continue;
        set.add([['box', holidayId === 'halloween' ? (i % 2 ? 'orangeGlow' : 'purpleGlow') : 'lantern' + (i % 3), [0.36, 0.44, 0.36], [0, 3.5, 0]]], w.x + Math.cos(a) * w.r, w.z + Math.sin(a) * w.r, -a);
      }
    }
    if (holidayId === 'solstice') for (const [x, z] of [[-40, -44], [-12, -48], [22, -46]]) set.add(PROPS.bonfire(rand, 1.4), x, z);
  };
  return null;
}
