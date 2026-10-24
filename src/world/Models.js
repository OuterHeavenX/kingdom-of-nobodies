import * as THREE from 'three';
import { mat, PALETTE as P, G, part } from './Materials.js';

// Procedural low-poly building models. Every model is built in local space
// with its front facing +z; World.js rotates it to face the street.

export const litWindow = new THREE.MeshStandardMaterial({ color: '#ffe2a8', emissive: '#ffb04a', emissiveIntensity: 0.05, roughness: 0.6, flatShading: true });
export const forgeGlow = new THREE.MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff5a1f', emissiveIntensity: 1.2, flatShading: true });
const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

function house(g, { w, d, h, wall = P.plaster, roof = P.roofRed, roofH = 1.8, stone = false, frame = true, windowsLit = true, door = true, chimney = 'side', y = 0 }) {
  const wallMat = mat(stone ? P.stone : wall);
  part(g, G.box(), mat(P.stoneDark), [w + 0.15, 0.35, d + 0.15], [0, y + 0.17, 0]);
  part(g, G.box(), wallMat, [w, h, d], [0, y + h / 2 + 0.3, 0]);
  if (frame && !stone) {
    const beam = mat(P.timber);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, G.box(), beam, [0.2, h, 0.2], [sx * (w / 2), y + h / 2 + 0.3, sz * (d / 2)]);
    part(g, G.box(), beam, [w + 0.1, 0.16, 0.12], [0, y + h * 0.55 + 0.3, d / 2 + 0.03]);
    part(g, G.box(), beam, [0.14, h, 0.1], [-w / 4, y + h / 2 + 0.3, d / 2 + 0.03]);
    part(g, G.box(), beam, [0.14, h, 0.1], [w / 4, y + h / 2 + 0.3, d / 2 + 0.03]);
  }
  part(g, G.prism(), mat(roof), [w + 0.7, roofH, d + 0.6], [0, y + h + 0.3, 0]);
  const win = windowsLit ? litWindow : mat(P.window);
  const wy = y + h * 0.62 + 0.3;
  if (door) part(g, G.box(), mat(P.door), [0.9, 1.5, 0.14], [0, y + 1.05, d / 2 + 0.05]);
  for (const sx of door ? [-1, 1] : [-1, 0, 1]) part(g, G.box(), win, [0.62, 0.6, 0.12], [sx * w * 0.33, wy, d / 2 + 0.06]);
  for (const sx of [-1, 1]) part(g, G.box(), win, [0.12, 0.6, 0.62], [sx * (w / 2 + 0.06), wy, 0]);
  if (chimney) part(g, G.box(), mat(P.stoneDark), [0.55, roofH + 0.8, 0.55], [chimney === 'side' ? w * 0.3 : 0, y + h + roofH * 0.55 + 0.3, -d * 0.2]);
}

function fence(g, w, d, gap = 1.6) {
  const wood = mat(P.plank);
  const posts = [];
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 1.25) posts.push([x, -d / 2], [x, d / 2]);
  for (let z = -d / 2 + 1.25; z < d / 2; z += 1.25) posts.push([-w / 2, z], [w / 2, z]);
  for (const [x, z] of posts) if (!(Math.abs(x) < gap && z > 0)) part(g, G.box(), wood, [0.12, 0.7, 0.12], [x, 0.35, z], null, false);
  part(g, G.box(), wood, [w / 2 - gap, 0.08, 0.06], [-(w / 4 + gap / 2), 0.5, d / 2], null, false);
  part(g, G.box(), wood, [w / 2 - gap, 0.08, 0.06], [w / 4 + gap / 2, 0.5, d / 2], null, false);
  part(g, G.box(), wood, [w, 0.08, 0.06], [0, 0.5, -d / 2], null, false);
  for (const sx of [-1, 1]) part(g, G.box(), wood, [0.06, 0.08, d], [sx * w / 2, 0.5, 0], null, false);
}

function sign(g, color, x, y, z) {
  part(g, G.box(), mat(P.timberDark), [0.08, 0.08, 0.9], [x, y + 0.5, z + 0.35], null, false);
  part(g, G.box(), mat(color), [0.7, 0.5, 0.08], [x, y, z + 0.75], null, false);
}

function logPile(g, x, z, n = 6) {
  const log = mat(P.trunk);
  let i = 0;
  for (let row = 0; row < 3 && i < n; row++) {
    for (let k = 0; k < 3 - row && i < n; k++, i++) part(g, G.cyl(7), log, [0.42, 2.2, 0.42], [x + (k - (2 - row) / 2) * 0.44, 0.22 + row * 0.38, z], [0, 0, Math.PI / 2]);
  }
}

function barrel(g, x, z) { part(g, G.cyl(9), mat(P.plank), [0.6, 0.8, 0.6], [x, 0.4, z]); }
function crate(g, x, z, s = 0.6) { part(g, G.box(), mat(P.plank), [s, s, s], [x, s / 2, z], [0, x * 0.7, 0]); }

const BUILDERS = {
  hall(g) {
    house(g, { w: 7, d: 5.4, h: 3.2, wall: P.plasterWarm, roof: P.roofBrown, roofH: 2.6, chimney: 'side' });
    part(g, G.box(), mat(P.door), [1.6, 1.9, 0.16], [0, 1.25, 2.76]);
    for (const sx of [-1, 1]) {
      part(g, G.box(), mat(P.timberDark), [0.1, 3.4, 0.1], [sx * 2.2, 1.7, 3.6], null, false);
      part(g, G.box(), mat(sx < 0 ? '#3f6fa3' : '#b8443a'), [0.7, 1.1, 0.05], [sx * 2.2 + 0.36 * sx, 2.8, 3.6], null, false);
    }
    part(g, G.box(), mat(P.plank), [2.4, 0.15, 0.5], [-2.2, 0.5, 3.9]);
  },
  cottage(g, o) {
    const v = hash(o.id) % 3;
    house(g, { w: 3.6, d: 3.2, h: 2.3, roof: [P.roofRed, P.thatch, P.roofSlate][v], wall: v === 1 ? P.plasterWarm : P.plaster, roofH: 1.7 });
    part(g, G.box(), mat('#d16a84'), [1.1, 0.25, 0.3], [-1.2, 1.0, 1.75], null, false);
    fence(g, 6, 5.6);
  },
  farm(g, o) {
    const fw = Math.min(o.w - 1, 10), fd = Math.min(o.d - 1.5, 7);
    part(g, G.plane(), mat(P.field), [fw, 1, fd * 0.75], [-0.5, 0.03, -fd * 0.12], null, false);
    const rows = 7, per = 9;
    const crops = new THREE.InstancedMesh(G.cone(5), mat(o.open === false ? '#a39566' : P.crop), rows * per);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let r = 0; r < rows; r++) for (let k = 0; k < per; k++) {
      m.compose(new THREE.Vector3(-fw / 2 + 0.6 + k * (fw - 1.2) / (per - 1) - 0.5, 0.32, -fd * 0.12 - fd * 0.33 + r * (fd * 0.66) / (rows - 1)),
        new THREE.Quaternion(), new THREE.Vector3(0.38, 0.55 + ((r + k) % 3) * 0.1, 0.38));
      crops.setMatrixAt(i++, m);
    }
    crops.castShadow = true;
    g.add(crops);
    const barn = new THREE.Group();
    house(barn, { w: 3.2, d: 2.6, h: 2.2, wall: '#a8513f', roof: P.roofBrown, roofH: 1.4, frame: false, chimney: null });
    barn.position.set(fw / 2 - 1.2, 0, fd / 2 - 0.4);
    g.add(barn);
    for (const [x, z] of [[-fw / 2 + 0.8, fd / 2 - 0.2], [-fw / 2 + 2, fd / 2 - 0.4]]) part(g, G.cyl(8), mat(P.thatch), [1.1, 0.9, 1.1], [x, 0.45, z]);
    fence(g, o.w - 0.2, o.d - 0.2, 2);
  },
  lumberyard(g, o) {
    const wood = mat(P.timber);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, G.box(), wood, [0.25, 2.6, 0.25], [sx * 2.4, 1.3, sz * 1.5 - 0.5]);
    part(g, G.box(), mat(P.roofBrown), [5.6, 0.18, 3.8], [0, 2.75, -0.5], [0.12, 0, 0]);
    part(g, G.box(), mat(P.plank), [3, 0.3, 0.8], [0, 0.9, -0.5]);
    part(g, G.cyl(10), mat('#cfd3d6', { metalness: 0.4 }), [1.1, 0.06, 1.1], [0.4, 1.15, -0.5], [Math.PI / 2, 0, 0]);
    logPile(g, -2.6, 2.4, 6);
    logPile(g, 1.4, 2.6, o.open === false ? 2 : 5);
    part(g, G.cyl(9), mat(P.trunk), [0.8, 0.6, 0.8], [3.3, 0.3, 1.8]);
    if (o.open !== false) sign(g, '#8a6a3a', 3.2, 2.1, -0.4);
  },
  blacksmith(g, o) {
    house(g, { w: 4.2, d: 3.6, h: 2.6, stone: true, roof: P.roofSlate, roofH: 1.6, chimney: 'side', windowsLit: o.open !== false });
    part(g, G.box(), mat(P.stoneDark), [0.9, 3.6, 0.9], [-1.4, 2.8, -0.6]);
    part(g, G.box(), mat(P.iron), [0.7, 0.35, 0.35], [1.6, 0.85, 2.6]);
    part(g, G.box(), mat(P.iron), [0.3, 0.6, 0.3], [1.6, 0.4, 2.6]);
    if (o.open !== false) part(g, G.box(), forgeGlow, [0.8, 0.5, 0.2], [-1.2, 0.8, 1.86], null, false);
    if (o.open !== false) sign(g, '#5d6670', 2.3, 2.3, 1.2);
  },
  bakery(g, o) {
    house(g, { w: 4, d: 3.4, h: 2.4, wall: P.plasterWarm, roof: P.thatch, roofH: 1.8, windowsLit: o.open !== false });
    part(g, G.sphere(10), mat('#b98a62'), [1.5, 1.3, 1.5], [2.6, 0.4, -0.4]);
    part(g, G.box(), mat(P.stoneDark), [0.3, 0.8, 0.3], [2.6, 1.2, -0.4]);
    if (o.open !== false) sign(g, '#d9a441', -2.3, 2.2, 1.0);
    crate(g, -1.6, 2.4, 0.5);
  },
  tavern(g, o) {
    house(g, { w: 4.8, d: 3.8, h: 2.2, wall: P.plaster, roof: P.roofRed, roofH: 0.01, chimney: null, windowsLit: o.open !== false });
    house(g, { w: 5.2, d: 4.2, h: 1.8, wall: P.plasterWarm, roof: P.roofRed, roofH: 2, y: 2.2, door: false, chimney: 'side', windowsLit: o.open !== false });
    for (const x of [-2.2, 2.4]) barrel(g, x, 2.6);
    part(g, G.box(), mat(P.plank), [1.6, 0.12, 0.8], [-1.6, 0.75, 3.3]);
    part(g, G.box(), mat(P.plank), [1.6, 0.12, 0.3], [-1.6, 0.45, 3.9]);
    if (o.open !== false) sign(g, '#b8443a', 2.8, 3.0, 1.4);
  },
  general_store(g, o) {
    house(g, { w: 4.2, d: 3.4, h: 2.5, roof: P.roofSlate, roofH: 1.6, windowsLit: o.open !== false });
    if (o.open !== false) {
      for (let i = 0; i < 5; i++) part(g, G.box(), mat(i % 2 ? P.awningB : P.awningA), [0.84, 0.08, 1.4], [-1.68 + i * 0.84, 2.3, 2.3], [0.35, 0, 0], false);
      crate(g, -1.5, 2.6); crate(g, 1.6, 2.7, 0.5);
      part(g, G.sphere(6), mat('#c8b07a'), [0.6, 0.7, 0.6], [1.0, 0.35, 2.9]);
    }
  },
  well(g) {
    part(g, G.cyl(12), mat(P.stone), [2.2, 0.9, 2.2], [0, 0.45, 0]);
    part(g, G.cyl(12), mat('#3a5a78'), [1.7, 0.1, 1.7], [0, 0.86, 0], null, false);
    for (const sx of [-1, 1]) part(g, G.box(), mat(P.timber), [0.16, 1.9, 0.16], [sx * 0.95, 1.3, 0]);
    part(g, G.prism(), mat(P.roofRed), [2.5, 0.8, 1.6], [0, 2.2, 0]);
    part(g, G.cyl(8), mat(P.plank), [0.3, 0.35, 0.3], [0.2, 1.3, 0], null, false);
  },
  granary(g) {
    part(g, G.box(), mat(P.stoneDark), [5.2, 0.6, 3.6], [0, 0.3, 0]);
    part(g, G.box(), mat(P.plank), [5, 2.4, 3.4], [0, 1.8, 0]);
    for (let i = -2; i <= 2; i++) part(g, G.box(), mat(P.timberDark), [0.12, 2.4, 3.45], [i * 1.2, 1.8, 0], null, false);
    part(g, G.prism(), mat(P.thatch), [5.8, 2, 4], [0, 3, 0]);
    part(g, G.box(), mat(P.door), [1.2, 1.6, 0.12], [0, 1.4, 1.75]);
    for (const x of [-3.3, 3.3]) part(g, G.cyl(8), mat(P.thatch), [1.2, 1.1, 1.2], [x, 0.55, 1.6]);
  },
  school(g, o) {
    house(g, { w: 5.6, d: 3.8, h: 2.6, wall: P.plasterWarm, roof: P.roofSlate, roofH: 2.1, chimney: null, windowsLit: o.open !== false });
    part(g, G.box(), mat(P.timber), [0.7, 1.6, 0.7], [0, 5.2, -0.4]);
    part(g, G.cone(4), mat(P.roofSlate), [1.1, 1, 1.1], [0, 6.5, -0.4], [0, Math.PI / 4, 0]);
    part(g, G.cyl(8), mat('#c9a442', { metalness: 0.5 }), [0.4, 0.4, 0.4], [0, 5.5, -0.02], [Math.PI / 2, 0, 0], false);
    part(g, G.box(), mat(P.plank), [1.6, 0.6, 0.6], [-1.8, 0.3, 2.6]);
  },
  townhall(g) {
    house(g, { w: 7.6, d: 5.6, h: 2.6, stone: true, roof: P.roofSlate, roofH: 0.01, chimney: null, frame: false });
    house(g, { w: 7.6, d: 5.6, h: 2.2, wall: P.plasterWarm, roof: P.roofSlate, roofH: 2.6, y: 2.6, door: false, chimney: 'side' });
    part(g, G.box(), mat(P.stone), [1.6, 4.5, 1.6], [0, 7.2, 0]);
    part(g, G.cone(4), mat(P.roofSlate), [2.4, 2.4, 2.4], [0, 10.6, 0], [0, Math.PI / 4, 0]);
    part(g, G.cyl(12), mat('#f4efe2'), [1, 1, 0.08], [0, 8.4, 0.82], [Math.PI / 2, 0, 0], false);
    part(g, G.box(), mat(P.door), [1.8, 2.1, 0.16], [0, 1.35, 2.86]);
    for (const sx of [-1, 1]) part(g, G.box(), mat(sx < 0 ? '#3f6fa3' : '#b8443a'), [0.8, 1.6, 0.05], [sx * 2.6, 3.8, 2.9], null, false);
  },
  ruins(g) {
    part(g, G.box(), mat('#3a3330'), [4.2, 0.3, 3.6], [0, 0.15, 0]);
    for (let i = 0; i < 6; i++) part(g, G.box(), mat(i % 2 ? '#2f2925' : '#5b4c40'), [0.4 + (i % 3) * 0.3, 0.6 + (i % 4) * 0.5, 0.3], [-1.6 + i * 0.65, 0.5, (i % 2 ? 1 : -1) * 1.2], [0, i * 0.7, (i % 3) * 0.2]);
    for (let i = 0; i < 5; i++) part(g, G.dodeca(), mat('#4a423b'), [0.7, 0.4, 0.7], [-1.8 + i, 0.2, 2.2 - (i % 2)], null, false);
  },
  stall(g, o) {
    const wood = mat(P.timber);
    part(g, G.box(), mat(P.plank), [3.6, 0.9, 1.6], [0, 0.45, 0]);
    for (const x of [-1.7, 1.7]) for (const z of [-0.8, 0.8]) part(g, G.box(), wood, [0.14, 2.6, 0.14], [x, 1.3, z]);
    for (let i = 0; i < 5; i++) part(g, G.box(), mat(o.open === false ? '#8a7f70' : i % 2 ? P.awningB : P.awningA), [0.86, 0.08, 2.4], [-1.72 + i * 0.86, 2.7, 0], [0.12, 0, 0]);
    crate(g, 1.2, 1.4, 0.5);
  },
};

/** Build a finished building. opts: { id, w, d, open (bool|undefined), level, condition } */
export function buildingModel(type, opts) {
  const g = new THREE.Group();
  (BUILDERS[type] ?? BUILDERS.cottage)(g, opts);
  const level = opts.level ?? 1;
  if (level >= 2 && !['farm', 'well', 'ruins', 'lumberyard'].includes(type)) {
    // An expanded building gains a side wing.
    const wing = new THREE.Group();
    house(wing, { w: 2.4, d: 2.6, h: 2 + (level - 2) * 0.8, roof: P.roofBrown, roofH: 1.2, chimney: null, door: false });
    wing.position.set(-(widthOf(type) / 2 + 1.1), 0, -0.2);
    g.add(wing);
  }
  if ((opts.condition ?? 100) < 60 && type !== 'ruins') {
    // Fire damage: soot and missing roof timbers until repaired.
    for (let i = 0; i < 4; i++) part(g, G.box(), mat('#1f1b19'), [0.9, 0.08, 0.9], [-1.2 + i * 0.8, heightOf(type) + 0.9 + (i % 2) * 0.3, 0.3], [0.5, i, 0.3], false);
  }
  if (opts.open === false && type !== 'farm' && type !== 'cottage') {
    // Boarded-up door shows the business has closed.
    for (const r of [0.6, -0.6]) part(g, G.box(), mat(P.timberDark), [1.2, 0.14, 0.08], [0, 1.05, (type === 'stall' ? 0.85 : depthOf(type) / 2) + 0.14], [0, 0, r], false);
  }
  return g;
}

const depthOf = (type) => ({ hall: 5.4, townhall: 5.6, cottage: 3.2, blacksmith: 3.6, bakery: 3.4, tavern: 3.8, general_store: 3.4, lumberyard: 3, school: 3.8, granary: 3.4, well: 2.2 }[type] ?? 3.2);
const heightOf = (type) => ({ hall: 3.2, townhall: 4.8, tavern: 4.0, lumberyard: 2.6, school: 2.6, granary: 2.6, well: 1.2 }[type] ?? 2.5);
const widthOf = (type) => ({ hall: 7, townhall: 7.6, tavern: 4.8, blacksmith: 4.2, bakery: 4, general_store: 4.2, lumberyard: 5, stall: 3.6, school: 5.6, granary: 5, well: 2.2 }[type] ?? 3.6);

function scaffold(g, w, d, h) {
  const pole = mat('#9c7a52');
  for (const x of [-w / 2 - 0.5, 0, w / 2 + 0.5]) part(g, G.box(), pole, [0.1, h + 0.8, 0.1], [x, (h + 0.8) / 2, d / 2 + 0.6], null, false);
  for (const y of [h * 0.45, h * 0.9]) part(g, G.box(), mat(P.plank), [w + 1.2, 0.08, 0.5], [0, y, d / 2 + 0.6], null, false);
  part(g, G.box(), pole, [0.08, h * 1.1, 0.08], [0, h * 0.5, d / 2 + 0.62], [0, 0, 0.9], false);
}

/**
 * A building site at a given stage. `progress` is 0..1 within the stage.
 * Stages: PLANNING, FOUNDATION, FRAME, ROOF, FINISHING, DEMOLISHING.
 */
export function constructionModel(type, stage, progress, opts) {
  const g = new THREE.Group();
  const w = widthOf(type), d = depthOf(type), h = heightOf(type);
  part(g, G.plane(), mat('#a68a64'), [w + 2.4, 1, d + 2.4], [0, 0.03, 0], null, false);
  logPile(g, w / 2 + 1.6, -d / 2, stage === 'FINISHING' ? 2 : 4);
  if (stage === 'DEMOLISHING') {
    const old = buildingModel(opts.oldType ?? type, { ...opts, open: false });
    old.scale.y = Math.max(0.15, 1 - progress * 0.85);
    g.add(old);
    for (let i = 0; i < 7; i++) part(g, G.dodeca(), mat(i % 2 ? P.stone : P.plank), [0.6, 0.4, 0.6], [((i * 37) % 7) - 3, 0.2, ((i * 53) % 5) - 2.5 + d / 2 + 1]);
    scaffold(g, w, d, h * old.scale.y);
    return g;
  }
  const stakes = mat('#e9d8b4');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, G.box(), stakes, [0.1, 0.6, 0.1], [sx * w / 2, 0.3, sz * d / 2], null, false);
  if (stage === 'PLANNING') {
    for (const sz of [-1, 1]) part(g, G.box(), mat('#f4efe2'), [w, 0.03, 0.03], [0, 0.5, sz * d / 2], null, false);
    for (const sx of [-1, 1]) part(g, G.box(), mat('#f4efe2'), [0.03, 0.03, d], [sx * w / 2, 0.5, 0], null, false);
    return g;
  }
  const slabH = stage === 'FOUNDATION' ? 0.1 + 0.25 * progress : 0.35;
  part(g, G.box(), mat(P.stoneDark), [w + 0.15, slabH, d + 0.15], [0, slabH / 2, 0]);
  if (stage === 'FOUNDATION') return g;
  if (stage === 'FINISHING') {
    g.add(buildingModel(type, { ...opts, open: true }));
    scaffold(g, w, d, h);
    return g;
  }
  const frameH = stage === 'FRAME' ? h * (0.3 + 0.7 * progress) : h;
  const beam = mat(P.timber);
  for (const x of [-w / 2, -w / 6, w / 6, w / 2]) for (const z of [-d / 2, d / 2]) part(g, G.box(), beam, [0.2, frameH, 0.2], [x, frameH / 2 + 0.3, z]);
  for (const x of [-w / 2, w / 2]) part(g, G.box(), beam, [0.2, frameH, 0.2], [x, frameH / 2 + 0.3, 0]);
  if (stage === 'FRAME' && progress > 0.6) {
    for (const z of [-d / 2, d / 2]) part(g, G.box(), beam, [w, 0.18, 0.18], [0, frameH + 0.3, z]);
  }
  if (stage === 'ROOF') {
    for (const z of [-d / 2, d / 2]) part(g, G.box(), beam, [w, 0.18, 0.18], [0, h + 0.3, z]);
    part(g, G.box(), mat(P.plaster), [w, h * 0.5, d], [0, h * 0.25 + 0.35, 0]);
    const rafters = Math.max(2, Math.round(2 + progress * 4));
    for (let i = 0; i < rafters; i++) {
      const z = -d / 2 + (i / (rafters - 1)) * d;
      for (const s of [-1, 1]) part(g, G.box(), beam, [0.14, 0.14, w * 0.62], [s * w * 0.25, h + 1.05, z], [0, Math.PI / 2, s * 0.6], false);
    }
    if (progress > 0.5) part(g, G.prism(), mat(P.roofBrown), [w + 0.7, 1.8 * (progress - 0.4), d * progress], [0, h + 0.3, -d * (1 - progress) / 2]);
  }
  scaffold(g, w, d, frameH);
  return g;
}

/** The Founders' Memorial: an obelisk with five plaques, later crowned when all founders have passed. */
export function memorialModel(allPassed) {
  const g = new THREE.Group();
  part(g, G.box(), mat(P.stoneDark), [2.4, 0.4, 2.4], [0, 0.2, 0]);
  part(g, G.box(), mat(P.stone), [1.6, 0.5, 1.6], [0, 0.65, 0]);
  part(g, G.cyl(4), mat('#c8c1b0'), [0.9, 3.2, 0.9], [0, 2.5, 0], [0, Math.PI / 4, 0]);
  part(g, G.cone(4), mat('#c8c1b0'), [0.9, 0.7, 0.9], [0, 4.45, 0], [0, Math.PI / 4, 0]);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    part(g, G.box(), mat('#a8874a', { metalness: 0.4 }), [0.36, 0.26, 0.05], [Math.sin(a) * 0.82, 0.68, Math.cos(a) * 0.82], [0, a, 0], false);
  }
  if (allPassed) part(g, G.sphere(10), mat('#e2c46a', { metalness: 0.6, roughness: 0.3 }), [0.6, 0.6, 0.6], [0, 5.05, 0]);
  return g;
}

/** Flickering flames for a burning building. */
export function fireModel() {
  const g = new THREE.Group();
  const flame = new THREE.MeshStandardMaterial({ color: '#ff9a3d', emissive: '#ff5a1f', emissiveIntensity: 2, transparent: true, opacity: 0.9, flatShading: true });
  for (let i = 0; i < 5; i++) part(g, G.cone(6), flame, [1.2, 2.2 + (i % 3) * 0.8, 1.2], [-1.6 + i * 0.8, 2.8 + (i % 2) * 0.6, (i % 2 ? 0.6 : -0.6)], null, false);
  const smoke = mat('#4b4744', { transparent: true, opacity: 0.55 });
  for (let i = 0; i < 4; i++) part(g, G.sphere(6), smoke, [1.4 + i * 0.3, 1.2, 1.4 + i * 0.3], [0.2 * i, 5 + i * 1.3, -0.2 * i], null, false);
  return g;
}

export function forSaleSign(color = '#e2b04a') {
  const g = new THREE.Group();
  part(g, G.box(), mat(P.timberDark), [0.12, 1.4, 0.12], [0, 0.7, 0], null, false);
  part(g, G.box(), mat(color), [0.9, 0.55, 0.08], [0, 1.25, 0.05], null, false);
  return g;
}
