import * as THREE from 'three';
import { G } from './Materials.js';

// Low-poly props for the seasons and holidays. Each prop is a list of parts
// (a shared geometry, a material name, scale, position, rotation) relative to
// the prop's own origin; DecorationSpawner gathers every part of every prop
// into one InstancedMesh per geometry and material, so a town full of
// pumpkins and lanterns costs a few dozen draw calls. Props that move
// (skeletons, the parade float) are built as small groups instead.

// Extra shared geometries (cached here; never disposed, like Materials.G).
const extra = new Map();
const geo = (key, make) => { if (!extra.has(key)) extra.set(key, make()); return extra.get(key); };
export const PG = {
  torus: () => geo('torus', () => new THREE.TorusGeometry(0.5, 0.16, 6, 16)),
  arch: () => geo('arch', () => new THREE.TorusGeometry(0.5, 0.06, 5, 20, Math.PI)),
  heart: () => geo('heart', () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.5); s.bezierCurveTo(0.6, -0.05, 0.55, 0.45, 0, 0.2); s.bezierCurveTo(-0.55, 0.45, -0.6, -0.05, 0, -0.5);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0.1, -0.09);
    return g;
  }),
  star: () => geo('star', () => new THREE.OctahedronGeometry(0.5, 0)),
  flatleaf: () => geo('flatleaf', () => new THREE.CircleGeometry(0.5, 5).rotateX(-Math.PI / 2)),
};

/** Geometry by key, from Materials.G or the extras above. */
export function geometryFor(key) {
  if (PG[key]) return PG[key]();
  const m = key.match(/^([a-z]+)(\d*)$/);
  const fn = G[m[1]];
  return m[2] ? fn(Number(m[2])) : fn();
}

/**
 * Decoration materials by name: [colour, emissive colour or null, emissive
 * intensity, extra]. `flicker` lanterns waver; `twinkle` bulbs shimmer in turn.
 */
export const DECOR_MATERIALS = {
  pumpkin: ['#e8761c'], pumpkinDark: ['#c95d12'], pumpkinLit: ['#ff8a1c', '#ff6a00', 0.9, { flicker: true }], stem: ['#5a7a2a'], glowFace: ['#ffd36b', '#ffb347', 2.2, { flicker: true }],
  bone: ['#f2ead8'], boneShade: ['#cfc4ac'], straw: ['#e2c35a'], strawDark: ['#c9a43e'], sack: ['#c9b48e'], shirtA: ['#7a4a8a'], shirtB: ['#4a6a8a'],
  hat: ['#2a2230'], web: ['#ffffff', null, 0, { transparent: true, opacity: 0.55 }], deadWood: ['#3a2a2a'], purpleGlow: ['#b06dff', '#9b4dff', 2, { flicker: true }],
  orangeGlow: ['#ffa040', '#ff8c1a', 2.2, { flicker: true }], timber: ['#6e4a31'], timberDark: ['#4f3524'], plank: ['#a77b52'], iron: ['#3a3d42'],
  pine: ['#2f7a4f'], pineDark: ['#245f3d'], gold: ['#ffd36b', '#ffb347', 1.4], silver: ['#e8eef7', '#c9d6ea', 0.6],
  red: ['#d8343c'], green: ['#2e9a52'], white: ['#f7f4ee'], cream: ['#f4e6c8'], blue: ['#3f7fd8'], pink: ['#ff7aa8'], rose: ['#ff3d6e'], blush: ['#ffc2da'],
  shamrock: ['#2fbf55'], shamrockDark: ['#1f9a43'], lime: ['#a8e05a'], potGold: ['#e8b32c', '#c98a12', 0.5],
  pastelPink: ['#ffc8e2'], pastelBlue: ['#bfe3ff'], pastelYellow: ['#fff2a8'], pastelGreen: ['#c9f5c0'], pastelLilac: ['#e2ccff'],
  flowerRed: ['#ff4d5e'], flowerYellow: ['#ffd23c'], flowerViolet: ['#9a6bff'], flowerWhite: ['#ffffff'], leafGreen: ['#3fa548'], terracotta: ['#c4663a'],
  hay: ['#e2c35a'], hayDark: ['#c9a43e'], corn: ['#d9c45a'], cornHusk: ['#a8b052'], apple: ['#d23a2a'], squash: ['#f2a93b'], grape: ['#7a3fa0'], bread: ['#d9a35a'],
  flame: ['#ffb347', '#ff7a1f', 2.4, { flicker: true }], flameCore: ['#fff0a8', '#ffd36b', 2.6, { flicker: true }], stone: ['#8c877d'],
  leafOrange: ['#f08a2a'], leafRed: ['#d4452c'], leafYellow: ['#e8c13a'], leafBrown: ['#b8562a'],
  blossomPink: ['#ffb3d1'], blossomWhite: ['#fff4f8'], cloud: ['#ffffff', null, 0, { roughness: 1 }],
  bulb0: ['#ff4d4d', '#ff4d4d', 2.2, { twinkle: 0 }], bulb1: ['#3fd46b', '#3fd46b', 2.2, { twinkle: 1 }], bulb2: ['#ffd36b', '#ffd36b', 2.2, { twinkle: 2 }],
  bulb3: ['#6fb7ff', '#6fb7ff', 2.2, { twinkle: 3 }], bulb4: ['#ffffff', '#ffffff', 2, { twinkle: 4 }],
  lantern0: ['#ffd27a', '#ffae42', 1.6, { flicker: true }], lantern1: ['#ffd27a', '#ffae42', 1.6, { flicker: true }], lantern2: ['#ffd27a', '#ffae42', 1.6, { flicker: true }],
  flagA: ['#d9534f'], flagB: ['#f0c24b'], flagC: ['#5b9bd5'], flagD: ['#7bbf6a'], flagE: ['#e88fb0'], flagF: ['#9a6bff'],
};
export const FLAG_SETS = {
  rainbow: ['flagA', 'flagB', 'flagC', 'flagD', 'flagE', 'flagF'],
  pinkRed: ['pink', 'rose', 'blush', 'white'], green: ['shamrock', 'lime', 'white', 'potGold'],
  pastel: ['pastelPink', 'pastelBlue', 'pastelYellow', 'pastelGreen', 'pastelLilac'], halloween: ['pumpkin', 'shirtA', 'hat', 'orangeGlow'],
  autumn: ['leafOrange', 'leafRed', 'leafYellow', 'hay'], festive: ['red', 'green', 'gold', 'white'], newyear: ['gold', 'silver', 'blue', 'white'],
  founders: ['gold', 'red', 'blue', 'white'],
};

// --- Props: each returns parts [geometry, material, [sx, sy, sz], [x, y, z], [rx, ry, rz]?] ---------

const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];

export const PROPS = {
  pumpkin(rand, s = 1) {
    const w = (0.55 + rand() * 0.35) * s;
    return [['sphere8', rand() < 0.5 ? 'pumpkin' : 'pumpkinDark', [w, w * 0.72, w], [0, w * 0.34, 0]], ['cyl6', 'stem', [0.06 * s, 0.16 * s, 0.06 * s], [0, w * 0.74, 0]]];
  },
  jackolantern(rand, s = 1) {
    const w = (0.7 + rand() * 0.3) * s;
    return [
      ['sphere8', 'pumpkinLit', [w, w * 0.74, w], [0, w * 0.36, 0]], ['cyl6', 'stem', [0.07 * s, 0.17 * s, 0.07 * s], [0, w * 0.76, 0]],
      ['cone3', 'glowFace', [0.13 * w, 0.12 * w, 0.05], [-0.16 * w, 0.44 * w, 0.47 * w], [0, 0, Math.PI]], ['cone3', 'glowFace', [0.13 * w, 0.12 * w, 0.05], [0.16 * w, 0.44 * w, 0.47 * w], [0, 0, Math.PI]],
      ['box', 'glowFace', [0.36 * w, 0.07 * w, 0.05], [0, 0.24 * w, 0.48 * w]],
    ];
  },
  scarecrow(rand) {
    return [
      ['box', 'timberDark', [0.1, 2.1, 0.1], [0, 1.05, 0]], ['box', 'timberDark', [1.5, 0.08, 0.08], [0, 1.55, 0]],
      ['box', rand() < 0.5 ? 'shirtA' : 'shirtB', [0.6, 0.75, 0.34], [0, 1.35, 0]], ['sphere6', 'sack', [0.42, 0.44, 0.4], [0, 2.0, 0]],
      ['cone8', 'hat', [0.5, 0.42, 0.5], [0, 2.38, 0]], ['cyl8', 'hat', [0.7, 0.04, 0.7], [0, 2.2, 0]],
      ['cone4', 'straw', [0.16, 0.34, 0.16], [-0.78, 1.5, 0], [0, 0, Math.PI / 2]], ['cone4', 'straw', [0.16, 0.34, 0.16], [0.78, 1.5, 0], [0, 0, -Math.PI / 2]],
    ];
  },
  cobweb() { return [['ring', 'web', [0.9, 0.9, 0.9], [0, 1.9, 0], [Math.PI / 2, 0, 0]], ['box', 'web', [0.02, 0.85, 0.02], [0, 1.9, 0.01]], ['box', 'web', [0.85, 0.02, 0.02], [0, 1.9, 0.01]]]; },
  lanternPole(rand, glow = 'lantern0', h = 2.4) {
    return [['box', 'timberDark', [0.1, h, 0.1], [0, h / 2, 0]], ['box', 'timberDark', [0.5, 0.06, 0.06], [0.2, h - 0.1, 0]], ['box', glow, [0.26, 0.34, 0.26], [0.42, h - 0.35, 0]]];
  },
  spookyTree(rand) {
    const parts = [['cyl6', 'deadWood', [0.32, 3.2, 0.32], [0, 1.6, 0]]];
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + rand(), y = 1.6 + i * 0.32;
      parts.push(['box', 'deadWood', [1.2 - i * 0.12, 0.08, 0.08], [Math.cos(a) * 0.45, y, Math.sin(a) * 0.45], [0, -a, 0.5]]);
    }
    return parts;
  },
  hayBale(rand) { const r = rand() * 0.6; return [['cyl8', 'hay', [1.1, 1.3, 1.1], [0, 0.55, 0], [0, r, Math.PI / 2]], ['cyl8', 'hayDark', [1.12, 0.06, 1.12], [0, 0.55, 0], [0, r, Math.PI / 2]]]; },
  cornStalks() {
    const parts = [];
    for (let i = 0; i < 6; i++) { const a = i * 1.05; parts.push(['cone4', i % 2 ? 'corn' : 'cornHusk', [0.22, 2.1, 0.22], [Math.cos(a) * 0.18, 1.05, Math.sin(a) * 0.18], [Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08]]); }
    parts.push(['cyl6', 'hayDark', [0.5, 0.12, 0.5], [0, 0.8, 0]]);
    return parts;
  },
  harvestCart(rand) {
    const parts = [['box', 'plank', [1.6, 0.5, 1.1], [0, 0.65, 0]], ['cyl8', 'timberDark', [0.8, 0.12, 0.8], [-0.55, 0.4, 0.6], [Math.PI / 2, 0, 0]], ['cyl8', 'timberDark', [0.8, 0.12, 0.8], [0.55, 0.4, 0.6], [Math.PI / 2, 0, 0]],
      ['cyl8', 'timberDark', [0.8, 0.12, 0.8], [-0.55, 0.4, -0.6], [Math.PI / 2, 0, 0]], ['cyl8', 'timberDark', [0.8, 0.12, 0.8], [0.55, 0.4, -0.6], [Math.PI / 2, 0, 0]], ['box', 'timber', [0.08, 0.08, 1.4], [0, 0.55, 1.2]]];
    for (let i = 0; i < 8; i++) parts.push(['sphere6', pick(rand, ['pumpkin', 'apple', 'squash', 'corn']), [0.38, 0.32, 0.38], [-0.55 + (i % 4) * 0.36, 1.02 + Math.floor(i / 4) * 0.2, -0.25 + Math.floor(i / 4) * 0.4]]);
    return parts;
  },
  foodTable(rand) {
    const parts = [['box', 'plank', [3.4, 0.1, 1], [0, 0.8, 0]], ['box', 'timberDark', [0.1, 0.8, 0.9], [-1.5, 0.4, 0]], ['box', 'timberDark', [0.1, 0.8, 0.9], [1.5, 0.4, 0]], ['box', 'cream', [3.5, 0.02, 1.1], [0, 0.86, 0]]];
    for (let i = 0; i < 6; i++) {
      const x = -1.35 + i * 0.54;
      parts.push(['cyl8', 'white', [0.36, 0.04, 0.36], [x, 0.88, 0.1]], ['sphere6', pick(rand, ['bread', 'apple', 'squash', 'grape', 'pumpkin']), [0.24, 0.2, 0.24], [x, 0.98, 0.1]]);
    }
    for (const x of [-1.2, 1.2]) parts.push(['box', 'timberDark', [1.4, 0.08, 0.36], [x, 0.45, 0.85]], ['box', 'timberDark', [1.4, 0.08, 0.36], [x, 0.45, -0.85]]);
    return parts;
  },
  harvestDisplay(rand) {
    return [...PROPS.hayBale(rand), ...PROPS.pumpkin(rand, 0.8).map((p) => offset(p, [0.9, 0, 0.5])), ...PROPS.pumpkin(rand, 0.6).map((p) => offset(p, [-0.9, 0, 0.6])), ...PROPS.cornStalks().map((p) => offset(p, [0, 0, -0.9]))];
  },
  wreath(rand, ribbon = 'red') { return [['torus', 'pine', [0.55, 0.55, 0.55], [0, 1.55, 0.06]], ['cone4', ribbon, [0.14, 0.2, 0.06], [-0.08, 1.3, 0.14], [0, 0, 0.6]], ['cone4', ribbon, [0.14, 0.2, 0.06], [0.08, 1.3, 0.14], [0, 0, -0.6]]]; },
  autumnWreath(rand) { return [['torus', 'leafOrange', [0.55, 0.55, 0.55], [0, 1.55, 0.06]], ['sphere5', 'leafRed', [0.14, 0.14, 0.14], [0.2, 1.38, 0.12]], ['sphere5', 'leafYellow', [0.14, 0.14, 0.14], [-0.2, 1.38, 0.12]]]; },
  flowerWreath(rand) {
    const parts = [['torus', 'leafGreen', [0.5, 0.5, 0.5], [0, 1.55, 0.06]]];
    for (let i = 0; i < 6; i++) { const a = i * 1.05; parts.push(['sphere5', pick(rand, ['flowerRed', 'flowerYellow', 'flowerViolet', 'flowerWhite']), [0.12, 0.12, 0.12], [Math.cos(a) * 0.25, 1.55 + Math.sin(a) * 0.25, 0.12]]); }
    return parts;
  },
  decoratedTree(rand, s = 1) {
    const parts = [['cyl6', 'timber', [0.3 * s, 0.7 * s, 0.3 * s], [0, 0.35 * s, 0]]];
    const tiers = [[1.9, 1.6, 1.1], [1.5, 1.4, 1.9], [1.05, 1.2, 2.6]];
    for (const [w, h, y] of tiers) parts.push(['cone7', 'pine', [w * s, h * s, w * s], [0, y * s, 0]]);
    for (let i = 0; i < 14; i++) {
      const t = i / 14, y = (0.8 + t * 2.1) * s, r = (0.95 - t * 0.7) * s, a = i * 2.4;
      parts.push(['sphere5', `bulb${i % 5}`, [0.16 * s, 0.16 * s, 0.16 * s], [Math.cos(a) * r, y, Math.sin(a) * r]]);
    }
    parts.push(['star', 'gold', [0.36 * s, 0.42 * s, 0.14 * s], [0, 3.35 * s, 0]]);
    return parts;
  },
  gift(rand) {
    const w = 0.35 + rand() * 0.3, c = pick(rand, ['red', 'green', 'blue', 'gold', 'pink', 'white']), rib = c === 'gold' ? 'red' : 'gold';
    return [['box', c, [w, w * 0.8, w], [0, w * 0.4, 0]], ['box', rib, [w * 1.02, w * 0.82, 0.06], [0, w * 0.4, 0]], ['box', rib, [0.06, w * 0.82, w * 1.02], [0, w * 0.4, 0]]];
  },
  heart(rand, s = 1, m = 'rose') { return [['heart', m, [0.9 * s, 0.9 * s, 0.9 * s], [0, 0.55 * s, 0]]]; },
  heartPost(rand) { return [['box', 'white', [0.08, 1.6, 0.08], [0, 0.8, 0]], ['heart', pick(rand, ['rose', 'pink']), [0.75, 0.75, 0.75], [0, 1.75, 0]]]; },
  bench(rand) {
    return [['box', 'plank', [1.6, 0.08, 0.45], [0, 0.45, 0]], ['box', 'plank', [1.6, 0.36, 0.06], [0, 0.72, -0.2]], ['box', 'timberDark', [0.08, 0.45, 0.4], [-0.7, 0.22, 0]], ['box', 'timberDark', [0.08, 0.45, 0.4], [0.7, 0.22, 0]]];
  },
  romanticBench(rand) {
    return [...PROPS.bench(rand), ['box', 'white', [0.08, 2.2, 0.08], [-0.95, 1.1, -0.25]], ['box', 'white', [0.08, 2.2, 0.08], [0.95, 1.1, -0.25]],
      ['arch', 'pink', [1.9, 1.9, 1.9], [0, 2.2, -0.25]], ['heart', 'rose', [0.6, 0.6, 0.6], [0, 2.95, -0.25]], ...PROPS.flowerPot(rand).map((p) => offset(p, [1.25, 0, 0.1])), ...PROPS.flowerPot(rand).map((p) => offset(p, [-1.25, 0, 0.1]))];
  },
  flowerPot(rand, colors = ['flowerRed', 'pink', 'rose', 'flowerWhite']) {
    const parts = [['cyl8', 'terracotta', [0.42, 0.36, 0.42], [0, 0.18, 0]], ['sphere6', 'leafGreen', [0.44, 0.24, 0.44], [0, 0.42, 0]]];
    for (let i = 0; i < 4; i++) parts.push(['sphere5', pick(rand, colors), [0.14, 0.14, 0.14], [Math.cos(i * 1.6) * 0.14, 0.55, Math.sin(i * 1.6) * 0.14]]);
    return parts;
  },
  flowerBed(rand, colors = ['flowerRed', 'flowerYellow', 'flowerViolet', 'flowerWhite', 'pink']) {
    const parts = [['box', 'timberDark', [1.3, 0.12, 0.5], [0, 0.06, 0]], ['box', 'leafGreen', [1.2, 0.14, 0.42], [0, 0.14, 0]]];
    for (let i = 0; i < 6; i++) parts.push(['sphere5', pick(rand, colors), [0.15, 0.15, 0.15], [-0.5 + i * 0.2, 0.28, (i % 2 ? 0.08 : -0.08)]]);
    return parts;
  },
  shamrock(rand) {
    const s = 0.6 + rand() * 0.5;
    return [0, 2.1, 4.2].map((a) => ['sphere6', rand() < 0.5 ? 'shamrock' : 'shamrockDark', [0.22 * s, 0.05 * s, 0.22 * s], [Math.cos(a) * 0.12 * s, 0.12 * s, Math.sin(a) * 0.12 * s]]).concat([['box', 'shamrockDark', [0.03, 0.12 * s, 0.03], [0, 0.06 * s, 0]]]);
  },
  potOfGold() { return [['cyl8', 'iron', [0.6, 0.45, 0.6], [0, 0.22, 0]], ['sphere6', 'potGold', [0.55, 0.22, 0.55], [0, 0.46, 0]]]; },
  rainbow(rand, s = 1) {
    return ['flagA', 'flagB', 'flagE', 'flagD', 'flagC', 'flagF'].map((m, i) => ['arch', m, [(8 - i * 0.55) * s, (8 - i * 0.55) * s, 2 * s], [0, 0, 0]]);
  },
  egg(rand) {
    const c = pick(rand, ['pastelPink', 'pastelBlue', 'pastelYellow', 'pastelGreen', 'pastelLilac']), band = pick(rand, ['flowerRed', 'flowerViolet', 'blue', 'white', 'gold']);
    const s = 0.8 + rand() * 0.5;
    return [['sphere8', c, [0.24 * s, 0.32 * s, 0.24 * s], [0, 0.16 * s, 0], [0.2, 0, 0.3]], ['cyl8', band, [0.245 * s, 0.05 * s, 0.245 * s], [0, 0.17 * s, 0], [0.2, 0, 0.3]]];
  },
  eggBasket(rand) { const parts = [['cyl8', 'plank', [0.7, 0.32, 0.7], [0, 0.16, 0]]]; for (let i = 0; i < 4; i++) parts.push(...PROPS.egg(rand).map((p) => offset(p, [Math.cos(i * 1.6) * 0.16, 0.22, Math.sin(i * 1.6) * 0.16]))); return parts; },
  flowerArch(rand) {
    const parts = [['box', 'leafGreen', [0.12, 2.2, 0.12], [-0.9, 1.1, 0]], ['box', 'leafGreen', [0.12, 2.2, 0.12], [0.9, 1.1, 0]], ['arch', 'leafGreen', [1.8, 1.8, 3], [0, 2.2, 0]]];
    for (let i = 0; i < 9; i++) { const a = (i / 8) * Math.PI; parts.push(['sphere5', pick(rand, ['pastelPink', 'flowerYellow', 'flowerWhite', 'pastelLilac']), [0.2, 0.2, 0.2], [Math.cos(a) * 0.9, 2.2 + Math.sin(a) * 0.9, 0]]); }
    return parts;
  },
  bonfire(rand, s = 1) {
    const parts = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.push(['dodeca', 'stone', [0.4 * s, 0.3 * s, 0.4 * s], [Math.cos(a) * 1.05 * s, 0.12 * s, Math.sin(a) * 1.05 * s]]); }
    for (let i = 0; i < 4; i++) parts.push(['cyl6', 'timber', [0.18 * s, 1.5 * s, 0.18 * s], [0, 0.45 * s, 0], [Math.PI / 2.6, i * 0.8, 0]]);
    parts.push(['cone7', 'flame', [1.2 * s, 1.9 * s, 1.2 * s], [0, 1.0 * s, 0]], ['cone7', 'flameCore', [0.6 * s, 1.2 * s, 0.6 * s], [0, 0.75 * s, 0]]);
    return parts;
  },
  kingdomFlag(rand, color = 'gold', h = 4.2) { return [['cyl6', 'timberDark', [0.1, h, 0.1], [0, h / 2, 0]], ['box', color, [0.04, 0.8, 1.3], [0, h - 0.5, 0.66]], ['sphere5', 'gold', [0.16, 0.16, 0.16], [0, h + 0.05, 0]]]; },
  pole(rand, h = 3.2) { return [['cyl6', 'timberDark', [0.1, h, 0.1], [0, h / 2, 0]]]; },
  ribbonPost(rand, a = 'red', b = 'white') {
    const parts = [['cyl6', a, [0.14, 2.4, 0.14], [0, 1.2, 0]]];
    for (let i = 0; i < 5; i++) parts.push(['cyl6', b, [0.15, 0.12, 0.15], [0, 0.3 + i * 0.45, 0], [0.25, 0, 0]]);
    return parts.concat([['sphere5', 'gold', [0.2, 0.2, 0.2], [0, 2.45, 0]]]);
  },
  fallenLeaf(rand) { return [['flatleaf', pick(rand, ['leafOrange', 'leafRed', 'leafYellow', 'leafBrown']), [0.28 + rand() * 0.15, 1, 0.2 + rand() * 0.1], [0, 0.035 + rand() * 0.01, 0], [0, rand() * 6.28, 0]]]; },
  blossom(rand) { return [['sphere5', rand() < 0.6 ? 'blossomPink' : 'blossomWhite', [0.5, 0.42, 0.5], [0, 0, 0]]]; },
  cloud(rand) { const parts = []; for (let i = 0; i < 5; i++) parts.push(['ico', 'cloud', [5 + rand() * 4, 2.2 + rand() * 1.2, 4 + rand() * 3], [(i - 2) * 3.4, rand() * 1.2, (rand() - 0.5) * 3]]); return parts; },
  pennant(rand, set = FLAG_SETS.rainbow) { return [['cyl6', 'timberDark', [0.08, 3, 0.08], [0, 1.5, 0]], ['cone3', pick(rand, set), [0.06, 0.9, 0.6], [0, 2.6, 0.32], [0, 0, Math.PI / 2]]]; },
  lightPost(rand) { return [['box', 'timberDark', [0.1, 2.4, 0.1], [0, 1.2, 0]], ['sphere5', `bulb${Math.floor(rand() * 5)}`, [0.24, 0.24, 0.24], [0, 2.5, 0]]]; },
  nyBanner(rand) {
    return [['box', 'timberDark', [0.1, 3.2, 0.1], [-1.1, 1.6, 0]], ['box', 'timberDark', [0.1, 3.2, 0.1], [1.1, 1.6, 0]], ['box', 'blue', [2.2, 0.7, 0.05], [0, 2.7, 0]], ['box', 'gold', [2.0, 0.08, 0.06], [0, 2.52, 0.02]], ['star', 'gold', [0.3, 0.36, 0.1], [0, 2.85, 0.05]]];
  },
};

/** Shift a part by [dx, dy, dz]. */
export function offset(p, [dx, dy, dz]) { return [p[0], p[1], p[2], [p[3][0] + dx, p[3][1] + dy, p[3][2] + dz], p[4]]; }

/**
 * Parts for a string of flags or lights hung between two points, sagging in
 * the middle. `items` is the list of material names to cycle through.
 */
export function strand([ax, ay, az], [bx, by, bz], items, { spacing = 0.7, sag = 0.5, kind = 'flag' } = {}) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.floor(len / spacing));
  const yaw = Math.atan2(bx - ax, bz - az);
  const parts = [];
  for (let k = 1; k < n; k++) {
    const t = k / n, y = ay + (by - ay) * t - Math.sin(t * Math.PI) * sag;
    const p = [ax + (bx - ax) * t, y, az + (bz - az) * t];
    const m = items[k % items.length];
    // Flags and hearts hang square to the line, so they face people walking beneath.
    if (kind === 'flag') parts.push(['cone3', m, [0.26, 0.4, 0.05], [p[0], p[1] - 0.18, p[2]], [Math.PI, yaw + Math.PI / 2, 0]]);
    else if (kind === 'heart') parts.push(['heart', m, [0.32, 0.32, 0.32], [p[0], p[1] - 0.2, p[2]], [0, yaw + Math.PI / 2, 0]]);
    else parts.push(['sphere5', m, [0.15, 0.15, 0.15], p]);
  }
  return parts;
}

// --- Moving props (built as small groups) ---------------------------------------------------

/** A friendly skeleton: arms wave and the jaw chatters on a loop. Returns { group, update(time) }. */
export function skeleton(materials, rand) {
  const g = new THREE.Group();
  const bone = materials.bone, shade = materials.boneShade;
  const add = (geoKey, m, s, p, parent = g) => { const mesh = new THREE.Mesh(geometryFor(geoKey), m); mesh.scale.set(...s); mesh.position.set(...p); parent.add(mesh); return mesh; };
  add('sphere8', bone, [0.5, 0.5, 0.48], [0, 1.75, 0]);
  const jaw = add('box', shade, [0.32, 0.1, 0.3], [0, 1.5, 0.04]);
  for (const s of [-1, 1]) add('sphere5', materials.hat, [0.12, 0.14, 0.06], [s * 0.11, 1.8, 0.22]);
  add('cyl6', bone, [0.08, 0.5, 0.08], [0, 1.2, 0]);
  for (let i = 0; i < 4; i++) add('box', i % 2 ? shade : bone, [0.5 - i * 0.05, 0.05, 0.22], [0, 1.32 - i * 0.12, 0]);
  add('box', bone, [0.36, 0.1, 0.18], [0, 0.82, 0]);
  const arms = [-1, 1].map((s) => { const arm = new THREE.Group(); arm.position.set(s * 0.32, 1.38, 0); add('box', bone, [0.07, 0.62, 0.07], [0, -0.3, 0], arm); add('sphere5', bone, [0.1, 0.1, 0.1], [0, -0.64, 0], arm); g.add(arm); return arm; });
  for (const s of [-1, 1]) add('box', bone, [0.08, 0.8, 0.08], [s * 0.12, 0.4, 0]);
  const phase = rand() * 6.28;
  return {
    group: g,
    update(time, calm = 1) {
      arms[0].rotation.z = -0.3 - Math.max(0, Math.sin(time * 2.2 * calm + phase)) * 1.6;
      arms[1].rotation.z = 0.3 + Math.sin(time * 1.1 * calm + phase) * 0.15;
      jaw.position.y = 1.5 - Math.abs(Math.sin(time * 6 * calm + phase)) * 0.05;
    },
  };
}

/** The Founders' Day parade float: a decorated wagon with flags that rolls along a route and back. */
export function paradeFloat(materials, route) {
  const g = new THREE.Group();
  const add = (geoKey, m, s, p, r) => { const mesh = new THREE.Mesh(geometryFor(geoKey), m); mesh.scale.set(...s); mesh.position.set(...p); if (r) mesh.rotation.set(...r); g.add(mesh); return mesh; };
  add('box', materials.plank, [2.2, 0.5, 1.4], [0, 0.7, 0]);
  add('box', materials.gold, [2.3, 0.12, 1.5], [0, 0.98, 0]);
  for (const [x, z] of [[-0.8, 0.75], [0.8, 0.75], [-0.8, -0.75], [0.8, -0.75]]) add('cyl8', materials.timberDark, [0.8, 0.12, 0.8], [x, 0.4, z], [Math.PI / 2, 0, 0]);
  for (const [x, c] of [[-0.7, 'red'], [0, 'blue'], [0.7, 'gold']]) { add('cyl6', materials.timberDark, [0.06, 2, 0.06], [x, 1.9, 0]); add('box', materials[c], [0.04, 0.5, 0.8], [x, 2.6, 0.4]); }
  add('star', materials.gold, [0.5, 0.6, 0.2], [0, 1.5, 0.76]);
  let t = 0;
  return {
    group: g,
    update(time, calm = 1, dt = 0.016) {
      t += dt * 0.035 * calm;
      const k = (Math.sin(t * Math.PI * 2 - Math.PI / 2) + 1) / 2;
      const [ax, az] = route[0], [bx, bz] = route[1];
      g.position.set(ax + (bx - ax) * k, Math.abs(Math.sin(time * 6)) * 0.03, az + (bz - az) * k);
      g.rotation.y = Math.atan2(bx - ax, bz - az) + (Math.cos(t * Math.PI * 2 - Math.PI / 2) < 0 ? Math.PI : 0);
    },
  };
}
