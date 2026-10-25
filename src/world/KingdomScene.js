import * as THREE from 'three';
import { mat, G, part, PALETTE as P } from './Materials.js';
import { house, fence, crate, barrel, logPile, buildingModel, forgeGlow, litWindow } from './Models.js';
import { makeVillager } from './Villagers.js';
import { cartModel } from './Caravans.js';
import { KINGDOMS, HEARTH } from '../region/RegionData.js';
import { peopleOf, foreignAge } from '../region/ForeignCitizenManager.js';
import { stageForAge } from '../core/Calendar.js';

// A neighbouring kingdom drawn in 3D when the player visits it. Each has its
// own landscape and architecture: Greenvale's rolling farmland and windmills,
// Ironhold's walled stone town under the mountains with its mines and
// smelters, Saltmere's harbour of docks, warehouses and boats. The scene is
// a view of the simulation, never a separate world: its named people are the
// kingdom's real citizens (those at home today), carts in its market are the
// caravans actually loading or unloading there, and an army camped outside
// is an army the war system put there. It is built on entry and disposed on
// exit; only one major settlement is ever fully rendered.

function rng(seed) {
  let t = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 2166136261);
  return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

const PROF = { merchant: 'Merchant', guild: 'Blacksmith', faith: 'Innkeeper', ruler: 'Merchant', notable: 'Merchant', craft: 'Builder', resident: 'Farmer', child: 'Child' };
const KPROF = { greenvale: { craft: 'Builder', resident: 'Farmer', guild: 'Farmer' }, ironhold: { craft: 'Blacksmith', resident: 'Laborer', guild: 'Blacksmith' }, saltmere: { craft: 'Builder', resident: 'Forager', guild: 'Merchant' } };
const ROLE_COLOR = { ruler: '#c9a442', notable: '#7c4a8a', merchant: '#4a5f8a', guild: '#8a5a3a', faith: '#e8e2d6', craft: '#6b7a4a', resident: '#8a7a5a', child: '#c49bd6' };

/** The figure for a named foreign citizen (same rig as villagers, dressed for their role and kingdom). */
function figureFor(p, kid, day) {
  const stage = stageForAge(foreignAge({ day }, p)).id;
  const prof = KPROF[kid][p.role] ?? PROF[p.role] ?? 'Laborer';
  const fig = makeVillager({ id: p.id, color: ROLE_COLOR[p.role] ?? '#888', profession: prof, appearance: p.appearance }, stage);
  if (p.role === 'ruler') {
    const crown = new THREE.Group();
    part(crown, G.cyl(8), mat('#d8b23a', { metalness: 0.6, roughness: 0.3 }), [0.5, 0.16, 0.5], [0, 0.32, 0], null, false);
    for (let i = 0; i < 5; i++) part(crown, G.cone(4), mat('#d8b23a', { metalness: 0.6 }), [0.08, 0.16, 0.08], [Math.cos(i * 1.26) * 0.22, 0.46, Math.sin(i * 1.26) * 0.22], null, false);
    fig.userData.head.add(crown);
  }
  fig.traverse((o) => { o.userData.foreignId = p.id; });
  fig.userData.stage = stage;
  return fig;
}

/** Common ground: a large disc of land, coloured for the kingdom and season. */
function ground(g, color, radius = 120) {
  const geo = new THREE.CircleGeometry(radius, 48).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function road(g, points, width = 3, color = P.path) {
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const len = Math.hypot(bx - ax, bz - az);
    part(g, G.plane(), mat(color), [width, 1, len + width * 0.5], [(ax + bx) / 2, 0.04, (az + bz) / 2], [0, Math.atan2(bx - ax, bz - az), 0], false);
  }
}

function tree(g, x, z, s = 1, pine = false) {
  part(g, G.cyl(6), mat(P.trunk), [0.3 * s, 1.4 * s, 0.3 * s], [x, 0.7 * s, z]);
  if (pine) { part(g, G.cone(7), mat(P.pine), [1.8 * s, 2.6 * s, 1.8 * s], [x, 2.4 * s, z]); part(g, G.cone(7), mat(P.pine), [1.3 * s, 1.8 * s, 1.3 * s], [x, 3.5 * s, z]); }
  else part(g, G.ico(), mat(P.leaf), [2 * s, 1.8 * s, 2 * s], [x, 2.2 * s, z]);
}

function windmill(g, x, z, r) {
  const m = new THREE.Group();
  m.position.set(x, 0, z);
  m.rotation.y = r;
  part(m, G.cyl(8), mat(P.plaster), [2.6, 6, 2.6], [0, 3, 0]);
  part(m, G.cone(8), mat(P.thatch), [3.2, 2, 3.2], [0, 7, 0]);
  part(m, G.box(), mat(P.door), [0.8, 1.4, 0.12], [0, 0.7, 1.3]);
  const hub = new THREE.Group();
  hub.position.set(0, 5.6, 1.5);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    part(arm, G.box(), mat(P.timberDark), [0.16, 4.2, 0.12], [0, 2.1, 0], null, false);
    part(arm, G.box(), mat('#efe6d0'), [0.9, 3.2, 0.04], [0.5, 2.4, 0.06], null, false);
    hub.add(arm);
  }
  m.add(hub);
  g.add(m);
  return hub;
}

function field(g, x, z, w, d, ripe, r = 0) {
  const f = new THREE.Group();
  f.position.set(x, 0, z);
  f.rotation.y = r;
  part(f, G.plane(), mat(P.field), [w, 1, d], [0, 0.03, 0], null, false);
  for (let i = 0; i < Math.floor(d / 1.2); i++) part(f, G.box(), mat(ripe ? P.cropRipe : P.crop), [w - 0.6, 0.35, 0.5], [0, 0.2, -d / 2 + 0.6 + i * 1.2], null, false);
  g.add(f);
}

function boat(g, x, z, r, color) {
  const b = new THREE.Group();
  b.position.set(x, 0.1, z);
  b.rotation.y = r;
  part(b, G.box(), mat(P.timber), [1.4, 0.6, 4], [0, 0.2, 0]);
  part(b, G.prism(), mat(P.timber), [1.4, 0.9, 0.6], [0, 0.2, 2.2], [Math.PI / 2, 0, 0]);
  part(b, G.cyl(6), mat(P.timberDark), [0.12, 3.6, 0.12], [0, 2.2, 0], null, false);
  part(b, G.box(), mat(color), [0.05, 2.2, 1.6], [0, 2.5, 0.1], null, false);
  g.add(b);
  return b;
}

function wallRing(g, cx, cz, radius, gaps = [0]) {
  const segments = 22;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    if (gaps.some((gap) => Math.abs(((a - gap + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.18)) continue;
    const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
    part(g, G.box(), mat(P.stoneDark), [radius * 0.3, 3.2, 1.2], [x, 1.6, z], [0, -a + Math.PI / 2, 0]);
    if (i % 4 === 0) { part(g, G.cyl(8), mat(P.stone), [2.2, 4.6, 2.2], [x, 2.3, z]); part(g, G.cone(8), mat(P.roofSlate), [2.8, 1.6, 2.8], [x, 5.4, z]); }
  }
}

function tents(g, x, z, n, color) {
  for (let i = 0; i < n; i++) {
    const a = i * 2.4, r = 3 + (i % 3) * 2.2;
    part(g, G.cone(4), mat(i % 2 ? '#e8dcc0' : '#d4c4a0'), [1.8, 1.6, 1.8], [x + Math.cos(a) * r, 0.8, z + Math.sin(a) * r], [0, Math.PI / 4, 0]);
  }
  part(g, G.box(), mat(P.timberDark), [0.1, 4, 0.1], [x, 2, z], null, false);
  part(g, G.box(), mat(color), [1.4, 0.9, 0.04], [x + 0.72, 3.5, z], null, false);
}

// --- Kingdom layouts -------------------------------------------------------------------

const LAYOUTS = {
  greenvale(g, r, anim) {
    const geos = [ground(g, '#7fb069')];
    // Rolling hills.
    for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, d = 45 + r() * 50; part(g, G.sphere(10), mat(i % 2 ? '#86b56c' : '#78a85f'), [22 + r() * 18, 6 + r() * 6, 22 + r() * 18], [Math.cos(a) * d, -1.5, Math.sin(a) * d], null, false); }
    road(g, [[-60, 0], [-10, 0], [0, 0], [10, 6], [60, 20]], 3.2);
    road(g, [[0, 0], [0, -40]], 2.4);
    // The steward's hall, farmhouses, barns and a grain store round the green.
    const hall = new THREE.Group(); house(hall, { w: 7, d: 5, h: 3, wall: P.plasterWarm, roof: P.thatch, roofH: 2.6, shutters: '#4f7a5a' }); hall.position.set(0, 0, -10); g.add(hall);
    for (let i = 0; i < 9; i++) {
      const h = new THREE.Group();
      house(h, { w: 3.6 + r() * 0.8, d: 3.2, h: 2.2, wall: r() < 0.5 ? P.plaster : P.plasterWarm, roof: P.thatch, roofH: 1.8, shutters: ['#4f7a5a', '#a4553e', '#6a4a8a'][i % 3] });
      fence(h, 6, 5.6);
      const a = (i / 9) * Math.PI * 2 + 0.3, d = 18 + (i % 3) * 7;
      h.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); h.rotation.y = -a - Math.PI / 2; g.add(h);
    }
    const store = buildingModel('granary', { id: 'gv-granary', open: true }); store.position.set(14, 0, -6); g.add(store);
    for (const [x, z, w, d, rot] of [[-38, -22, 18, 12, 0.2], [-30, 26, 16, 10, -0.3], [34, -28, 20, 12, 0.5], [30, 34, 14, 12, 0.1], [-52, 4, 12, 16, 0]]) field(g, x, z, w, d, true, rot);
    anim.push(...[[-24, -40, 0.3], [40, -10, -1.2], [-12, 44, 2.4]].map(([x, z, rr]) => ({ kind: 'spin', obj: windmill(g, x, z, rr), speed: 0.9 })));
    for (let i = 0; i < 6; i++) { const s = buildingModel('stall', { id: 'gvs' + i, open: true }); const a = i * 1.05; s.position.set(Math.cos(a) * 7, 0, 4 + Math.sin(a) * 5); s.rotation.y = -a; s.scale.setScalar(0.75); g.add(s); }
    for (let i = 0; i < 30; i++) { const a = r() * Math.PI * 2, d = 40 + r() * 60; tree(g, Math.cos(a) * d, Math.sin(a) * d, 0.8 + r() * 0.6); }
    for (let i = 0; i < 6; i++) crate(g, 10 + r() * 6, 2 + r() * 6, 0.6);
    return { geos, market: { x: 0, z: 4 }, gate: { x: -60, z: 0 }, camp: { x: -70, z: 18 }, sky: '#b9dcef' };
  },
  ironhold(g, r, anim) {
    const geos = [ground(g, '#8a8a80')];
    // The mountains behind the town and a scree of rocks.
    for (let i = 0; i < 9; i++) { const x = -70 + i * 18 + r() * 6, h = 26 + r() * 22; part(g, G.cone(6), mat(i % 2 ? '#6f7178' : '#7d8088'), [26 + r() * 10, h, 22], [x, h / 2 - 1, -62 - r() * 12], [0, r(), 0]); part(g, G.cone(6), mat('#eef2f4'), [9, h * 0.3, 8], [x, h * 0.9, -62 - 4], null, false); }
    for (let i = 0; i < 40; i++) { const a = r() * Math.PI * 2, d = 30 + r() * 60; part(g, G.dodeca(), mat(i % 3 ? '#77777a' : '#8c8b86'), [1 + r() * 3, 0.8 + r() * 2, 1 + r() * 3], [Math.cos(a) * d, 0.4, Math.sin(a) * d + 10], [r(), r(), r()]); }
    road(g, [[0, 70], [0, 20], [0, 0], [-6, -30], [-14, -50]], 3, '#9a948a');
    wallRing(g, 0, -2, 30, [Math.PI / 2]);
    // Stone houses, the guildmaster's keep, smithies and the smelter.
    const keep = new THREE.Group();
    part(keep, G.box(), mat(P.stoneDark), [8, 8, 7], [0, 4, 0]); part(keep, G.cone(4), mat(P.roofSlate), [10, 4, 9], [0, 10, 0], [0, Math.PI / 4, 0]);
    part(keep, G.box(), mat(P.door), [1.6, 2.4, 0.2], [0, 1.2, 3.55]); part(keep, G.box(), litWindow, [0.6, 1, 0.1], [-2, 5, 3.56], null, false); part(keep, G.box(), litWindow, [0.6, 1, 0.1], [2, 5, 3.56], null, false);
    keep.position.set(0, 0, -20); g.add(keep);
    for (let i = 0; i < 10; i++) {
      const h = new THREE.Group();
      house(h, { w: 3.8, d: 3.4, h: 2.4, stone: true, roof: P.roofSlate, roofH: 1.6 });
      const a = (i / 10) * Math.PI * 2, d = 14 + (i % 2) * 6;
      h.position.set(Math.cos(a) * d, 0, -2 + Math.sin(a) * d); h.rotation.y = -a - Math.PI / 2; g.add(h);
    }
    for (const [x, z] of [[-10, 8], [10, 8]]) { const b = buildingModel('blacksmith', { id: 'ih' + x, open: true }); b.position.set(x, 0, z); b.rotation.y = Math.PI; g.add(b); }
    // The smelter with its glowing furnace, and the mine mouth in the mountain.
    part(g, G.cyl(8), mat(P.stoneDark), [3, 9, 3], [20, 4.5, -18]); part(g, G.cyl(8), forgeGlow, [1.6, 1.2, 1.6], [20, 1, -16.6], null, false);
    part(g, G.box(), mat('#3a3330'), [6, 5, 2], [-14, 2.5, -50]); part(g, G.box(), mat('#140f0d'), [3.2, 3.6, 0.4], [-14, 1.8, -48.9], null, false);
    for (let i = 0; i < 3; i++) { const cart = new THREE.Group(); part(cart, G.box(), mat(P.iron), [1.2, 0.8, 1.6], [0, 0.6, 0]); part(cart, G.dodeca(), mat('#6a5f58'), [1, 0.6, 1.2], [0, 1.1, 0]); cart.position.set(-12 + i * 2.2, 0, -44 + i * 1.5); g.add(cart); }
    for (let i = 0; i < 18; i++) { const a = r() * Math.PI * 2, d = 50 + r() * 40; tree(g, Math.cos(a) * d, Math.sin(a) * d + 20, 0.9 + r() * 0.5, true); }
    logPile(g, 16, 10, 6);
    return { geos, market: { x: 0, z: 2 }, gate: { x: 0, z: 34 }, camp: { x: 6, z: 52 }, sky: '#a9b8c8' };
  },
  saltmere(g, r, anim) {
    const geos = [ground(g, '#c9c08e')];
    // The sea, with a gentle swell.
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 140, 20, 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4f8fb0', roughness: 0.35, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.94 }));
    sea.position.set(0, 0.15, 78);
    g.add(sea);
    geos.push(sea);
    anim.push({ kind: 'swell', obj: sea });
    road(g, [[-60, 6], [60, 6]], 3.2, '#d4c49c');
    road(g, [[0, 6], [0, -50]], 2.6, '#d4c49c');
    // Whitewashed houses with blue roofs, warehouses on the quay, the Doge's palace.
    const palace = new THREE.Group();
    house(palace, { w: 9, d: 6, h: 3.2, wall: '#f4f1ea', roof: '#3f6fa3', roofH: 2.4, shutters: '#3f6fa3' });
    part(palace, G.box(), mat('#f4f1ea'), [2, 6, 2], [3.5, 3, -2]); part(palace, G.cone(4), mat('#3f6fa3'), [2.8, 2, 2.8], [3.5, 7, -2], [0, Math.PI / 4, 0]);
    palace.position.set(0, 0, -16); g.add(palace);
    for (let i = 0; i < 12; i++) {
      const h = new THREE.Group();
      house(h, { w: 3.4, d: 3.2, h: 2.4 + (i % 3) * 0.5, wall: '#f4f1ea', roof: i % 2 ? '#3f6fa3' : '#5fa8c4', roofH: 1.4, frame: false, shutters: '#3f6fa3' });
      const x = -40 + (i % 6) * 14 + r() * 3, z = i < 6 ? -6 : -26;
      h.position.set(x, 0, z); h.rotation.y = i < 6 ? 0 : Math.PI; g.add(h);
    }
    for (let i = 0; i < 4; i++) { const w = new THREE.Group(); house(w, { w: 7, d: 5, h: 3, wall: P.plank, roof: P.roofBrown, roofH: 1.6, frame: true, chimney: null }); w.position.set(-36 + i * 22, 0, 18); w.rotation.y = Math.PI; g.add(w); for (let k = 0; k < 3; k++) barrel(g, -32 + i * 22 + k, 22); }
    // Docks on posts, and the fishing and merchant fleet.
    for (const x of [-30, -6, 18, 40]) {
      part(g, G.box(), mat(P.plank), [3, 0.3, 26], [x, 0.9, 40]);
      for (let z = 28; z <= 52; z += 4) for (const s of [-1, 1]) part(g, G.cyl(6), mat(P.timberDark), [0.3, 2.6, 0.3], [x + s * 1.4, 0, z], null, false);
    }
    const sails = ['#f0e2c6', '#c45c49', '#f4f1ea', '#5fa8c4', '#d39a3a'];
    for (let i = 0; i < 7; i++) anim.push({ kind: 'bob', obj: boat(g, -36 + i * 12 + r() * 3, 46 + (i % 2) * 10, r() * 0.4 - 0.2, sails[i % sails.length]), phase: i * 1.3 });
    // A lighthouse on the point.
    part(g, G.cyl(8), mat('#f4f1ea'), [3, 12, 3], [62, 6, 40]); part(g, G.cyl(8), litWindow, [2, 1.6, 2], [62, 12.8, 40], null, false); part(g, G.cone(8), mat('#b8443a'), [2.8, 2, 2.8], [62, 14.6, 40]);
    for (let i = 0; i < 6; i++) { const s = buildingModel('stall', { id: 'sms' + i, open: true }); s.position.set(-10 + i * 4, 0, 10); s.rotation.y = Math.PI; s.scale.setScalar(0.75); g.add(s); }
    for (let i = 0; i < 14; i++) { const a = r() * Math.PI, d = 50 + r() * 40; tree(g, Math.cos(a) * d, -Math.sin(a) * d - 10, 0.8 + r() * 0.5); }
    return { geos, market: { x: 0, z: 10 }, gate: { x: -60, z: 6 }, camp: { x: -72, z: -10 }, sky: '#bfe0ee' };
  },
};

export class KingdomScene {
  constructor(state, kid) {
    this.kid = kid;
    this.group = new THREE.Group();
    this.anim = [];
    const r = rng(kid);
    this.layout = LAYOUTS[kid](this.group, r, this.anim);
    this.people = new Map();
    this.peopleRoot = new THREE.Group();
    this.group.add(this.peopleRoot);
    this.extras = new THREE.Group();
    this.group.add(this.extras);
    this.extrasKey = '';
    this.sync(state);
  }

  /** Waypoints a named person walks between, chosen stably from their id. */
  route(p) {
    const r = rng(p.id);
    const m = this.layout.market;
    const pts = [];
    for (let i = 0; i < 4; i++) { const a = r() * Math.PI * 2, d = 4 + r() * 18; pts.push([m.x + Math.cos(a) * d, m.z + Math.sin(a) * d * 0.7]); }
    // The ruler keeps near their hall; everyone else moves about the market and the streets.
    if (p.role === 'ruler') return [[0, -6], [3, -5], [-3, -5]];
    return pts;
  }

  /** Rebuild the people and the visiting caravans and armies from the simulation. */
  sync(state) {
    const here = peopleOf(state, this.kid, { includeAway: false });
    const ids = new Set(here.map((p) => p.id));
    for (const [id, node] of this.people) if (!ids.has(id)) { this.peopleRoot.remove(node); this.people.delete(id); }
    for (const p of here) {
      if (this.people.has(p.id)) continue;
      const fig = figureFor(p, this.kid, state.day);
      const route = this.route(p);
      fig.userData.route = route;
      fig.userData.seg = 0;
      fig.userData.t = rng(p.id + 't')();
      fig.position.set(route[0][0], 0, route[0][1]);
      this.peopleRoot.add(fig);
      this.people.set(p.id, fig);
    }
    // Carts in the market for caravans actually stopped here; tents for armies camped here.
    const carts = (state.trade?.caravans ?? []).filter((c) => c.at === this.kid && ['LOADING', 'UNLOADING', 'ARRIVED', 'PLANNING'].includes(c.status));
    const armies = (state.military?.armies ?? []).filter((a) => a.status !== 'DISBANDED' && a.at === this.kid);
    const key = carts.map((c) => c.id).join(',') + '|' + armies.map((a) => a.id + a.status).join(',');
    if (key === this.extrasKey) return;
    this.extrasKey = key;
    this.group.remove(this.extras);
    this.extras = new THREE.Group();
    this.group.add(this.extras);
    carts.forEach((c, i) => {
      const cart = cartModel(c.home === HEARTH ? '#e8c06a' : KINGDOMS[c.home]?.color ?? '#aaa');
      cart.position.set(this.layout.market.x - 6 + i * 3.4, 0, this.layout.market.z + 6);
      cart.traverse((o) => { o.userData.caravanId = c.id; });
      this.extras.add(cart);
    });
    armies.forEach((a, i) => {
      const color = a.owner === HEARTH ? '#e8c06a' : KINGDOMS[a.owner]?.color ?? '#aaa';
      const camp = { x: this.layout.camp.x + i * 10, z: this.layout.camp.z };
      tents(this.extras, camp.x, camp.z, Math.min(10, 3 + Math.round(a.soldiers / 60)), color);
      const block = soldierBlock(Math.min(24, Math.max(6, Math.round(a.soldiers / 20))), color, a.owner !== this.kid);
      block.position.set(camp.x + 8, 0, camp.z + 4);
      block.traverse((o) => { o.userData.armyId = a.id; });
      this.extras.add(block);
    });
  }

  update(dt, time) {
    for (const a of this.anim) {
      if (a.kind === 'spin') a.obj.rotation.z += dt * a.speed;
      if (a.kind === 'bob') { a.obj.position.y = 0.1 + Math.sin(time * 1.4 + a.phase) * 0.12; a.obj.rotation.z = Math.sin(time * 1.1 + a.phase) * 0.04; }
      if (a.kind === 'swell') a.obj.position.y = 0.15 + Math.sin(time * 0.6) * 0.06;
    }
    for (const fig of this.people.values()) {
      const u = fig.userData;
      const route = u.route;
      const [ax, az] = route[u.seg % route.length], [bx, bz] = route[(u.seg + 1) % route.length];
      const len = Math.max(0.1, Math.hypot(bx - ax, bz - az));
      u.t += (dt * 1.3) / len;
      const pause = u.t > 1 && u.t < 1.6;
      if (u.t >= 1.6) { u.t = 0; u.seg++; }
      const t = Math.min(1, u.t);
      fig.position.set(ax + (bx - ax) * t, 0, az + (bz - az) * t);
      fig.rotation.y = Math.atan2(bx - ax, bz - az);
      const walk = !pause;
      const sw = walk ? Math.sin(time * 9 + len) * 0.55 : 0;
      u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
      u.arms[0].rotation.x = -sw * 0.8; u.arms[1].rotation.x = pause ? -0.6 - Math.sin(time * 3) * 0.4 : sw * 0.8;
      const sc = u.stage === 'child' ? 0.62 : u.stage === 'infant' ? 0.4 : u.stage === 'teen' ? 0.86 : 1;
      fig.scale.setScalar(sc);
    }
  }

  pick(raycaster) {
    const hits = raycaster.intersectObjects([this.peopleRoot, this.extras], true);
    for (const h of hits) {
      const u = h.object.userData;
      if (u.foreignId) return { kind: 'foreign', id: u.foreignId };
      if (u.caravanId) return { kind: 'caravan', id: u.caravanId };
      if (u.armyId) return { kind: 'army', id: u.armyId };
    }
    return null;
  }

  /** Free what this scene owns: its own ground and sea meshes. Shared geometries and materials stay cached. */
  dispose() {
    for (const mesh of this.layout.geos) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.group.clear();
    this.people.clear();
  }
}

/** A small, readable formation of soldiers with shields, spears and a banner. */
export function soldierBlock(n, color, hostile = false) {
  const g = new THREE.Group();
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const shield = mat(color), tunic = mat(hostile ? '#5a4a40' : '#6a5a48'), metal = mat(P.iron, { metalness: 0.4 }), skin = mat('#e0b48c');
  for (let i = 0; i < n; i++) {
    const s = new THREE.Group();
    s.position.set((i % cols) * 1.1 - cols * 0.55, 0, Math.floor(i / cols) * 1.2);
    part(s, G.box(), tunic, [0.5, 0.9, 0.35], [0, 0.95, 0], null, false);
    part(s, G.box(), mat('#3b2a1e'), [0.45, 0.6, 0.3], [0, 0.3, 0], null, false);
    part(s, G.sphere(6), skin, [0.36, 0.36, 0.36], [0, 1.6, 0], null, false);
    part(s, G.sphere(6), metal, [0.4, 0.24, 0.4], [0, 1.74, 0], null, false);
    part(s, G.box(), shield, [0.5, 0.65, 0.06], [-0.32, 1, 0.22], null, false);
    part(s, G.box(), mat(P.timberDark), [0.05, 2.2, 0.05], [0.32, 1.3, 0.1], null, false);
    part(s, G.cone(4), metal, [0.1, 0.25, 0.1], [0.32, 2.5, 0.1], null, false);
    g.add(s);
  }
  part(g, G.box(), mat(P.timberDark), [0.08, 3.4, 0.08], [0, 1.7, -1], null, false);
  part(g, G.box(), mat(color), [1.2, 0.8, 0.04], [0.62, 2.9, -1], null, false);
  g.userData.soldiers = g.children.slice(0, n);
  return g;
}
