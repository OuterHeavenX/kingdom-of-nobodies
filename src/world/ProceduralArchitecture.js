import * as THREE from 'three';
import { mat, G, part, PALETTE as P } from './Materials.js';
import { facadeMaterial, facadeGeometry } from './Facades.js';
import { FLOOR_H, formOf, variantOf } from '../civilization/ArchitectureData.js';

// Procedural architecture for every era after the Age of Foundations, and
// for the density and wealth types (apartments, towers, mansions, grounds,
// stations, hospitals). Models are built in building-local space with the
// front on +z, from a building's type, era, seed and floors, so the same
// record always produces the same building, and a Then & Now reconstruction
// from the archive looks exactly as it did.

const SIGN = { bakery: '#d9a441', general_store: '#3f6fa3', tavern: '#b8443a', blacksmith: '#5d6670', lumberyard: '#8a6a3a', bank: '#c9a442', guildhall: '#7a3b2c', stall: '#c45c49' };
const BRICKS = ['#c96e52', '#a9573f', '#d8b08a', '#b9654b'];
const PASTELS = ['#f2e4c8', '#dce8ef', '#f1d3c9', '#e3edd6', '#efe7f3'];
const GLASS_TINTS = ['#9fd0e8', '#8fb8d8', '#b3c9a9', '#d9c39b', '#a5c4d4'];

export function rng(seed) {
  let s = (seed % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

// --- Components ---------------------------------------------------------------------

/** Walls with a repeating window facade; returns the top height. */
export function walls(g, { w, d, h, floors, kind, tint = '#ffffff', x = 0, y = 0, z = 0, bay = 2.4 }) {
  const m = new THREE.Mesh(facadeGeometry(w, h, d, floors, bay), facadeMaterial(kind, tint));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true; m.receiveShadow = true;
  m.userData.ownGeometry = true;
  g.add(m);
  return y + h;
}

function cylinderWalls(g, { r, h, floors, kind, tint, x = 0, y = 0, z = 0, seg = 16 }) {
  const geo = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  const uv = geo.attributes.uv;
  const cols = Math.max(2, Math.round((Math.PI * 2 * r) / 2.4)) / 4, rows = floors / 4;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * cols, uv.getY(i) * rows);
  const m = new THREE.Mesh(geo, facadeMaterial(kind, tint));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true; m.receiveShadow = true; m.userData.ownGeometry = true;
  g.add(m);
  part(g, G.cyl(seg), mat('#7d8286'), [r * 2 + 0.1, 0.25, r * 2 + 0.1], [x, y + h + 0.12, z]);
  return y + h;
}

export function flatRoof(g, w, d, y, { color = '#77797b', parapet = '#9a9c9e', x = 0, z = 0 } = {}) {
  part(g, G.box(), mat(color), [w, 0.2, d], [x, y + 0.1, z]);
  if (parapet) for (const [sx, sz, pw, pd] of [[0, 1, w, 0.18], [0, -1, w, 0.18], [1, 0, 0.18, d], [-1, 0, 0.18, d]]) part(g, G.box(), mat(parapet), [pw, 0.4, pd], [x + sx * (w / 2 - 0.09), y + 0.35, z + sz * (d / 2 - 0.09)], null, false);
  return y + 0.2;
}

function gable(g, w, d, y, h, color, { x = 0, z = 0, along = false } = {}) {
  part(g, G.prism(), mat(color), along ? [d + 0.5, h, w + 0.4] : [w + 0.5, h, d + 0.4], [x, y, z], along ? [0, Math.PI / 2, 0] : null);
  return y + h;
}

function hip(g, w, d, y, h, color, { x = 0, z = 0 } = {}) {
  part(g, G.cone(4), mat(color), [(w + 0.6) * 1.414, h, (d + 0.6) * 1.414], [x, y + h / 2, z], [0, Math.PI / 4, 0]);
  return y + h;
}

function mansard(g, w, d, y, h, color) {
  part(g, G.cone(4), mat(color), [(w + 0.3) * 1.414, h * 1.8, (d + 0.3) * 1.414], [0, y + h * 0.9 - h * 0.45, 0], [0, Math.PI / 4, 0]);
  part(g, G.box(), mat(color), [w * 0.62, 0.15, d * 0.62], [0, y + h * 0.95, 0]);
  for (const sx of [-1, 0, 1]) {
    part(g, G.box(), mat('#efe9e0'), [0.6, 0.7, 0.4], [sx * w * 0.3, y + h * 0.42, d / 2 - 0.05], null, false);
    part(g, G.box(), mat(P.window), [0.42, 0.5, 0.06], [sx * w * 0.3, y + h * 0.42, d / 2 + 0.16], null, false);
  }
  return y + h;
}

function sawtooth(g, w, d, y, color, n = 3) {
  for (let i = 0; i < n; i++) {
    const zz = -d / 2 + (i + 0.5) * (d / n);
    part(g, G.prism(), mat(color), [w, 1.1, d / n], [0, y, zz], [0, 0, 0]);
    part(g, G.box(), mat('#9fb8c4', { roughness: 0.3 }), [w * 0.96, 0.9, 0.06], [0, y + 0.45, zz + d / n / 2 - 0.1], [-0.35, 0, 0], false);
  }
  return y + 1.1;
}

function chimney(g, x, z, y, h = 1.4, color = P.stoneDark) {
  part(g, G.box(), mat(color), [0.5, h, 0.5], [x, y + h / 2, z]);
  part(g, G.box(), mat(P.stone), [0.64, 0.14, 0.64], [x, y + h, z], null, false);
}

function smokestack(g, x, z, h) {
  part(g, G.cyl(10), mat('#9a5a44'), [0.9, h, 0.9], [x, h / 2, z]);
  for (const t of [0.35, 0.7]) part(g, G.cyl(10), mat('#efe6d6'), [0.96, 0.22, 0.96], [x, h * t, z], null, false);
  part(g, G.cyl(10), mat('#3b3634'), [1.0, 0.3, 1.0], [x, h, z], null, false);
}

function rooftopUnits(g, w, d, y, r, n = 3) {
  for (let i = 0; i < n; i++) part(g, G.box(), mat(pick(r, ['#b9bcbe', '#9fa3a6', '#cfd2d3'])), [0.8 + r() * 0.8, 0.5 + r() * 0.5, 0.8 + r() * 0.6], [(r() - 0.5) * (w - 1.6), y + 0.35, (r() - 0.5) * (d - 1.6)]);
  if (r() < 0.5) { part(g, G.cyl(10), mat('#8a6a4a'), [1.1, 1.3, 1.1], [w * 0.25, y + 1.2, -d * 0.2]); for (const sx of [-1, 1]) part(g, G.box(), mat('#55595e'), [0.08, 0.6, 0.08], [w * 0.25 + sx * 0.4, y + 0.3, -d * 0.2], null, false); }
}

function solarPanels(g, w, d, y, r) {
  const panel = mat('#23395b', { roughness: 0.3, metalness: 0.4 });
  const rows = Math.max(1, Math.floor(d / 1.6)), cols = Math.max(1, Math.floor(w / 1.4));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) part(g, G.box(), panel, [1.1, 0.06, 1.1], [-w / 2 + 0.75 + i * 1.4, y + 0.45, -d / 2 + 0.85 + j * 1.6], [-0.45, 0, 0], false);
}

function greenRoof(g, w, d, y, r) {
  part(g, G.box(), mat('#6f9e4f'), [w - 0.3, 0.16, d - 0.3], [0, y + 0.08, 0], null, false);
  for (let i = 0; i < Math.round(w * d / 6) + 1; i++) part(g, G.ico(), mat(pick(r, ['#5d8f45', '#7fb05a', '#4c7c3b'])), [0.7, 0.55, 0.7], [(r() - 0.5) * (w - 1), y + 0.4, (r() - 0.5) * (d - 1)], null, false);
}

function balconies(g, w, d, floors, fh, y0, kind = 'concrete', r = Math.random, every = 1) {
  const slab = mat(kind === 'glass' ? '#dfe6ea' : kind === 'eco' ? '#f2f2ee' : '#c8c8c4');
  const rail = mat(kind === 'glass' ? '#9fd0e8' : '#7d8286', kind === 'glass' ? { transparent: true, opacity: 0.55 } : {});
  const plant = kind === 'eco';
  const n = Math.max(1, Math.floor(w / 2.6));
  for (let f = 1; f < floors; f += every) {
    const yy = y0 + f * fh;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n);
      part(g, G.box(), slab, [w / n - 0.4, 0.12, 0.8], [x, yy, d / 2 + 0.4], null, false);
      part(g, G.box(), rail, [w / n - 0.4, 0.45, 0.05], [x, yy + 0.28, d / 2 + 0.8], null, false);
      if (plant && (i + f) % 2 === 0) part(g, G.ico(), mat('#5f9a48'), [0.6, 0.5, 0.5], [x, yy + 0.35, d / 2 + 0.55], null, false);
    }
  }
}

function entrance(g, w, d, { color = P.door, glass = false, width = 1.2, height = 1.9 } = {}) {
  part(g, G.box(), glass ? mat('#9fd0e8', { roughness: 0.2, metalness: 0.5 }) : mat(color), [width, height, 0.14], [0, height / 2 + 0.05, d / 2 + 0.05], null, false);
  part(g, G.box(), mat(P.stone), [width + 0.6, 0.12, 0.6], [0, 0.06, d / 2 + 0.35], null, false);
}

function shopfront(g, w, d, color, era) {
  part(g, G.box(), mat(era >= 3 ? '#9fd0e8' : '#3d4f5c', era >= 3 ? { roughness: 0.2, metalness: 0.5 } : {}), [w * 0.86, 1.5, 0.1], [0, 1.05, d / 2 + 0.06], null, false);
  part(g, G.box(), mat(color), [w * 0.9, 0.5, 0.16], [0, 2.1, d / 2 + 0.12], null, false);
  if (era <= 3) for (let i = 0; i < 5; i++) part(g, G.box(), mat(i % 2 ? P.awningB : color), [w * 0.9 / 5, 0.08, 1.1], [-w * 0.36 + i * (w * 0.9 / 5), 2.4, d / 2 + 0.6], [0.35, 0, 0], false);
}

function signBoard(g, color, w, y, d) {
  part(g, G.box(), mat(color, { emissive: color, emissiveIntensity: 0.25 }), [Math.min(3.2, w * 0.6), 0.6, 0.12], [0, y, d / 2 + 0.1], null, false);
}

export function tree(g, x, z, s = 1, leaf = P.leaf) {
  part(g, G.cyl(6), mat(P.trunk), [0.25 * s, 1.2 * s, 0.25 * s], [x, 0.6 * s, z]);
  part(g, G.ico(), mat(leaf), [1.5 * s, 1.4 * s, 1.5 * s], [x, 1.7 * s, z]);
}

function lawn(g, w, d, x = 0, z = 0, color = '#7fb069') { part(g, G.plane(), mat(color), [w, 1, d], [x, 0.035, z], null, false); }
function paving(g, w, d, x = 0, z = 0, color = '#c9c4b8') { part(g, G.plane(), mat(color, { roughness: 0.95 }), [w, 1, d], [x, 0.04, z], null, false); }

function car(g, x, z, rot = 0, color = '#c0392b', era = 3) {
  const c = new THREE.Group();
  if (era >= 5) {
    part(c, G.sphere(10), mat('#f3f5f6', { roughness: 0.3 }), [1.2, 0.8, 2], [0, 0.5, 0]);
    part(c, G.sphere(10), mat('#66c2d9', { roughness: 0.15, metalness: 0.5 }), [1.0, 0.5, 1.2], [0, 0.75, 0.1], null, false);
  } else {
    part(c, G.box(), mat(color, { roughness: 0.4 }), [1.2, 0.5, 2.3], [0, 0.45, 0]);
    part(c, G.box(), mat(era >= 4 ? '#2e3b45' : '#3d4f5c'), [1.05, 0.42, 1.2], [0, 0.88, -0.1], null, false);
    for (const sx of [-1, 1]) for (const sz of [-0.75, 0.75]) part(c, G.cyl(8), mat('#222'), [0.42, 0.18, 0.42], [sx * 0.6, 0.22, sz], [0, 0, Math.PI / 2], false);
  }
  c.position.set(x, 0, z);
  c.rotation.y = rot;
  g.add(c);
}

function pool(g, x, z, w, d) {
  part(g, G.box(), mat('#e8e4da'), [w + 0.5, 0.18, d + 0.5], [x, 0.09, z]);
  part(g, G.box(), mat('#59b7d8', { roughness: 0.15, metalness: 0.2, emissive: '#1b6f8a', emissiveIntensity: 0.25 }), [w, 0.08, d], [x, 0.19, z], null, false);
}

function picketFence(g, w, d, color = '#f4f1ea', gap = 1.6) {
  const m = mat(color);
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.6) if (Math.abs(x) > gap / 2) part(g, G.box(), m, [0.08, 0.55, 0.06], [x, 0.28, d / 2], null, false);
  for (const sx of [-1, 1]) part(g, G.box(), m, [w / 2 - gap / 2, 0.06, 0.05], [sx * (w / 4 + gap / 4), 0.42, d / 2], null, false);
}

function gate(g, w, d, color = '#2e2e30') {
  const m = mat(color, { metalness: 0.5, roughness: 0.4 });
  for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.5) if (Math.abs(x) > 1.1) part(g, G.box(), m, [0.06, 1.1, 0.06], [x, 0.55, d / 2], null, false);
  for (const sx of [-1, 1]) {
    part(g, G.box(), mat(P.stone), [0.4, 1.4, 0.4], [sx * 1.2, 0.7, d / 2]);
    part(g, G.box(), m, [w / 2 - 1.2, 0.06, 0.05], [sx * (w / 4 + 0.6), 1.05, d / 2], null, false);
  }
}

function crown(g, w, d, y, r, era, { spire = false, helipad = false } = {}) {
  if (spire) {
    part(g, G.cone(era >= 5 ? 6 : 4), mat(era >= 5 ? '#e2c46a' : '#b9c3c8', { metalness: 0.6, roughness: 0.3 }), [Math.min(w, d) * 0.45, Math.min(w, d) * 1.4, Math.min(w, d) * 0.45], [0, y + Math.min(w, d) * 0.7, 0]);
  } else if (helipad) {
    part(g, G.cyl(16), mat('#5d6266'), [Math.min(w, d) * 0.85, 0.2, Math.min(w, d) * 0.85], [0, y + 0.6, 0]);
    part(g, G.ring(), mat('#f2c84b'), [Math.min(w, d) * 0.6, 1, Math.min(w, d) * 0.6], [0, y + 0.72, 0], null, false);
  } else rooftopUnits(g, w, d, y, r, 3);
  part(g, G.cyl(6), mat('#c8ccd0', { metalness: 0.5 }), [0.12, 3.2, 0.12], [w * 0.2, y + 1.6 + (spire ? Math.min(w, d) * 1.2 : 0), -d * 0.15], null, false);
  part(g, G.sphere(6), mat('#ff4a3a', { emissive: '#ff2a1a', emissiveIntensity: 1.2 }), [0.25, 0.25, 0.25], [w * 0.2, y + 3.25 + (spire ? Math.min(w, d) * 1.2 : 0), -d * 0.15], null, false);
}

// --- Facade choices by era ------------------------------------------------------------

function facadeFor(era, r, purpose = 'general') {
  if (era === 2) return purpose === 'industrial' ? { kind: 'factory', tint: pick(r, BRICKS) } : { kind: 'brick', tint: pick(r, BRICKS) };
  if (era === 3) return r() < 0.5 && purpose !== 'industrial' ? { kind: 'deco', tint: pick(r, ['#fff8ea', '#f3efe6', '#f6ebe0']) } : { kind: 'concrete', tint: pick(r, ['#ffffff', '#f1efe8', '#e9eef0']) };
  if (era === 4) return purpose === 'industrial' ? { kind: 'concrete', tint: pick(r, ['#d8e2e8', '#e4e7ea']) } : { kind: 'glass', tint: pick(r, GLASS_TINTS) };
  return r() < 0.5 ? { kind: 'eco', tint: '#ffffff' } : { kind: 'solar', tint: pick(r, ['#ffffff', '#e8fff8', '#fff6e6']) };
}

// --- Archetypes ----------------------------------------------------------------------------

function house(g, b, dm, r) {
  const era = b.era, fh = FLOOR_H[era];
  const v = variantOf(b);
  const { w, d } = dm;
  const floors = dm.floors;
  if (era === 2) {
    const f = facadeFor(2, r);
    const top = walls(g, { w, d, h: floors * fh, floors, ...f, bay: w / 2 });
    if (v === 1) mansard(g, w, d, top, 1.6, P.roofSlate); else gable(g, w, d, top, 1.5, pick(r, [P.roofSlate, '#6b4a3c', '#55606b']));
    chimney(g, -w * 0.32, -d * 0.1, top, 1.6, '#9a5a44'); chimney(g, w * 0.32, -d * 0.1, top, 1.6, '#9a5a44');
    entrance(g, w, d, { color: pick(r, ['#2f4a3a', '#5a2a2a', '#25324a']) });
    if (v === 1) { walls(g, { w: 1.6, d: 0.8, h: fh * 0.9, floors: 1, ...f, x: w * 0.26, z: d / 2 + 0.4, bay: 1.6 }); part(g, G.prism(), mat(P.roofSlate), [1.9, 0.6, 1], [w * 0.26, fh * 0.9, d / 2 + 0.4]); }
    picketFence(g, w + 1, d + 1.4, '#3a3a3a');
  } else if (era === 3) {
    const tint = pick(r, PASTELS);
    const top = walls(g, { w: w * 0.72, d, h: floors * fh, floors, kind: 'concrete', tint, x: -w * 0.14, bay: 2 });
    hip(g, w * 0.72, d, top, 1.3, pick(r, ['#7a5a4c', '#5d6670', '#8a4a3c']), { x: -w * 0.14 });
    walls(g, { w: w * 0.3, d: d * 0.8, h: fh * 0.9, floors: 1, kind: 'concrete', tint, x: w * 0.36, z: -d * 0.1, bay: 3 });
    part(g, G.box(), mat('#e8e2d6'), [w * 0.26, fh * 0.7, 0.1], [w * 0.36, fh * 0.35, d * 0.31], null, false);
    flatRoof(g, w * 0.3, d * 0.8, fh * 0.9, { x: w * 0.36, z: -d * 0.1, parapet: null, color: '#6b6f72' });
    entrance(g, w * 0.72, d, { color: pick(r, ['#c0392b', '#2c3e50', '#16a085']) });
    paving(g, w * 0.28, 2.2, w * 0.36, d / 2 + 1.1, '#8f8f8a');
    if (r() < 0.6) car(g, w * 0.36, d / 2 + 1.1, 0, pick(r, ['#c0392b', '#2980b9', '#f1c40f', '#27ae60']), 3);
    picketFence(g, w + 0.8, d + 2.6);
  } else if (era === 4) {
    const a = walls(g, { w: w * 0.62, d, h: fh * 2, floors: 2, kind: 'concrete', tint: '#ffffff', x: -w * 0.18, bay: 2 });
    flatRoof(g, w * 0.62, d, a, { parapet: null, color: '#5d6266' });
    const b2 = walls(g, { w: w * 0.5, d: d * 0.8, h: fh, floors: 1, kind: 'glass', tint: pick(r, GLASS_TINTS), x: w * 0.24, z: d * 0.08, bay: 1.6 });
    flatRoof(g, w * 0.56, d * 0.86, b2, { parapet: null, color: '#3b3f43', x: w * 0.24, z: d * 0.08 });
    part(g, G.box(), mat('#a0714e'), [0.8, fh * 2, d + 0.05], [-w * 0.49 + 0.4, fh, 0], null, false);
    paving(g, 2.2, 2.2, w * 0.24, d / 2 + 1.1, '#5a5d60');
    if (r() < 0.7) car(g, w * 0.24, d / 2 + 1.1, 0, pick(r, ['#1c1c1c', '#ecf0f1', '#2c3e50', '#8e2b2b']), 4);
    tree(g, -w / 2 - 0.3, d / 2 + 0.6, 0.6, '#5f9a48');
  } else {
    cylinderWalls(g, { r: Math.min(w, d) * 0.42, h: fh * floors, floors, kind: 'solar', tint: '#ffffff', x: -w * 0.1 });
    const top = fh * floors;
    greenRoof(g, Math.min(w, d) * 0.8, Math.min(w, d) * 0.8, top, r);
    walls(g, { w: w * 0.36, d: d * 0.6, h: fh, floors: 1, kind: 'eco', tint: '#ffffff', x: w * 0.3, z: d * 0.1, bay: 2 });
    solarPanels(g, w * 0.36, d * 0.6, fh, r);
    lawn(g, w + 0.6, d + 1.6, 0, 0.6, '#86c06c');
    if (r() < 0.6) car(g, w * 0.3, d / 2 + 1.2, 0, '#fff', 5);
    tree(g, w / 2, -d / 2, 0.7, '#6fae54');
  }
}

function mansion(g, b, dm, r) {
  const era = b.era, fh = FLOOR_H[era], { w, d } = dm, floors = dm.floors;
  if (era === 1) {
    const f = { kind: 'brick', tint: '#c9c1b2' };
    const top = walls(g, { w: w * 0.6, d, h: fh * 2, floors: 2, ...f, bay: 1.8 });
    gable(g, w * 0.6, d, top, 2, P.roofSlate);
    for (const sx of [-1, 1]) { const t = walls(g, { w: w * 0.22, d: d * 0.8, h: fh * 1.6, floors: 1, ...f, x: sx * w * 0.39, z: -d * 0.05, bay: 1.6 }); gable(g, w * 0.22, d * 0.8, t, 1.4, P.roofSlate, { x: sx * w * 0.39, z: -d * 0.05, along: true }); }
    chimney(g, -w * 0.2, 0, top, 1.6); chimney(g, w * 0.2, 0, top, 1.6);
    entrance(g, w * 0.6, d, { width: 1.4, height: 2.2 });
  } else if (era === 2) {
    const f = facadeFor(2, r);
    const top = walls(g, { w: w * 0.8, d, h: fh * floors, floors, ...f, x: -w * 0.08, bay: 1.8 });
    mansard(g, w * 0.8, d, top, 1.8, P.roofSlate);
    const tw = walls(g, { w: 1.8, d: 1.8, h: fh * floors + 2, floors: floors + 1, ...f, x: w * 0.36, z: d * 0.2, bay: 1.8 });
    part(g, G.cone(8), mat(P.roofSlate), [2.4, 2.6, 2.4], [w * 0.36, tw + 1.3, d * 0.2]);
    for (const x of [-1.2, 1.2]) part(g, G.cyl(8), mat('#f2ece0'), [0.25, fh, 0.25], [x - w * 0.08, fh / 2, d / 2 + 0.7]);
    part(g, G.box(), mat('#f2ece0'), [3.2, 0.2, 1.2], [-w * 0.08, fh, d / 2 + 0.6]);
    entrance(g, w, d, { color: '#2f4a3a', width: 1.4, height: 2.2 });
  } else if (era === 3) {
    const top = walls(g, { w, d: d * 0.85, h: fh * floors, floors, kind: 'deco', tint: '#fffaf0', bay: 1.8 });
    hip(g, w, d * 0.85, top, 1.6, '#5d6670');
    for (const x of [-1.6, -0.55, 0.55, 1.6]) part(g, G.cyl(10), mat('#fbf8f0'), [0.35, fh * floors, 0.35], [x, (fh * floors) / 2, d * 0.425 + 0.6]);
    part(g, G.prism(), mat('#fbf8f0'), [4.2, 0.9, 1.3], [0, fh * floors, d * 0.425 + 0.6]);
    entrance(g, w, d * 0.85, { color: '#3b2a1e', width: 1.4, height: 2.3 });
    car(g, w * 0.36, d / 2 + 0.9, Math.PI / 2, '#1c1c1c', 3);
  } else if (era === 4) {
    const a = walls(g, { w: w * 0.9, d: d * 0.7, h: fh, floors: 1, kind: 'glass', tint: pick(r, GLASS_TINTS), z: d * 0.1, bay: 1.8 });
    flatRoof(g, w * 0.95, d * 0.75, a, { parapet: null, color: '#f2f2f0', z: d * 0.1 });
    const b2 = walls(g, { w: w * 0.7, d: d * 0.8, h: fh * (floors - 1), floors: floors - 1, kind: 'concrete', tint: '#ffffff', x: -w * 0.1, y: a + 0.2, z: -d * 0.05, bay: 2.2 });
    flatRoof(g, w * 0.72, d * 0.82, b2, { parapet: null, color: '#3b3f43', x: -w * 0.1, z: -d * 0.05 });
    car(g, w * 0.35, d / 2 + 1, 0, pick(r, ['#1c1c1c', '#ecf0f1', '#7f1d1d']), 4);
  } else {
    cylinderWalls(g, { r: Math.min(w, d) * 0.45, h: fh, floors: 1, kind: 'solar', tint: '#ffffff' });
    cylinderWalls(g, { r: Math.min(w, d) * 0.32, h: fh * (floors - 1), floors: floors - 1, kind: 'eco', tint: '#ffffff', x: w * 0.08, y: fh + 0.25 });
    greenRoof(g, Math.min(w, d) * 0.6, Math.min(w, d) * 0.6, fh * floors + 0.25, r);
    car(g, w * 0.36, d / 2 + 1, 0, '#fff', 5);
  }
  lawn(g, w + 0.8, d + 2, 0, 0.5, '#7fb069');
  if (era >= 2) gate(g, w + 0.8, d + 2.4);
}

function apartment(g, b, dm, r) {
  const era = b.era, fh = FLOOR_H[era], { w, d, floors } = dm;
  const f = facadeFor(era, r);
  const top = walls(g, { w, d, h: floors * fh, floors, ...f });
  if (era === 2) {
    part(g, G.box(), mat('#efe6d6'), [w + 0.3, 0.35, d + 0.3], [0, top - 0.1, 0]);
    flatRoof(g, w, d, top, { color: '#5d6266', parapet: '#9a5a44' });
    for (let i = 0; i < Math.max(2, Math.round(w / 2.5)); i++) chimney(g, -w / 2 + 1 + i * 2.4, -d * 0.3, top, 1.3, '#9a5a44');
    entrance(g, w, d, { color: '#2a2a2a' });
  } else {
    const roofTop = flatRoof(g, w, d, top, { color: era >= 4 ? '#4a4e52' : '#77797b' });
    balconies(g, w, d, floors, fh, 0, f.kind, r, era === 3 ? 1 : 1);
    entrance(g, w, d, { glass: true, width: 1.8, height: 2.2 });
    if (era >= 5) { greenRoof(g, w, d, roofTop, r); solarPanels(g, w * 0.5, d * 0.5, roofTop + 0.3, r); } else rooftopUnits(g, w, d, roofTop, r, 2);
  }
}

/** Skyscrapers and other tall forms: several silhouettes chosen by seed. */
function tower(g, b, dm, r, { signColor = null } = {}) {
  const era = Math.max(3, b.era), fh = FLOOR_H[era], { w, d, floors } = dm;
  const f = facadeFor(era, r);
  const shape = pick(r, era === 3 ? ['setback', 'slab'] : era === 4 ? ['setback', 'slab', 'twist', 'taper', 'round'] : ['garden', 'twist', 'round', 'taper']);
  // A podium of shops at street level.
  const podium = walls(g, { w: w + 0.4, d: d + 0.4, h: fh * 1.3, floors: 1, kind: era >= 4 ? 'glass' : 'concrete', tint: era >= 4 ? '#cfe5ef' : '#f1efe8', bay: 3 });
  flatRoof(g, w + 0.4, d + 0.4, podium, { parapet: null, color: '#5d6266' });
  entrance(g, w + 0.4, d + 0.4, { glass: true, width: 2.4, height: 2.4 });
  if (signColor) signBoard(g, signColor, w, fh * 1.3 + 0.5, d + 0.4);
  const shaftFloors = Math.max(2, floors - 1);
  let y = podium + 0.2, top = y, tw = w, td = d;
  if (shape === 'slab' || shape === 'setback' || shape === 'taper' || shape === 'garden') {
    const tiers = shape === 'slab' ? 1 : shape === 'setback' ? 3 : shape === 'garden' ? 4 : 5;
    let left = shaftFloors;
    for (let t = 0; t < tiers; t++) {
      const fl = t === tiers - 1 ? left : Math.max(1, Math.round(shaftFloors * (shape === 'setback' ? [0.55, 0.3, 0.15][t] : 1 / tiers)));
      left -= fl;
      if (fl <= 0) continue;
      const shrink = shape === 'setback' ? 1 - t * 0.2 : shape === 'taper' ? 1 - t * 0.1 : shape === 'garden' ? 1 - t * 0.08 : 1;
      tw = w * shrink; td = d * shrink;
      top = walls(g, { w: tw, d: td, h: fl * fh, floors: fl, ...f, y });
      if (shape === 'garden') {
        part(g, G.box(), mat('#6f9e4f'), [tw + 0.5, 0.35, td + 0.5], [0, top + 0.05, 0], null, false);
        for (let k = 0; k < 4; k++) part(g, G.ico(), mat('#5d8f45'), [0.9, 0.8, 0.9], [(k % 2 ? 1 : -1) * tw * 0.42, top + 0.55, (k < 2 ? 1 : -1) * td * 0.42], null, false);
      } else if (shape === 'setback' && era === 3) part(g, G.box(), mat('#e8e1d0'), [tw + 0.25, 0.3, td + 0.25], [0, top, 0], null, false);
      y = top + (shape === 'garden' ? 0.35 : 0);
    }
  } else if (shape === 'twist') {
    const seg = Math.max(4, Math.round(shaftFloors / 3));
    const per = shaftFloors / seg;
    for (let i = 0; i < seg; i++) {
      const s = new THREE.Group();
      walls(s, { w: w * 0.9, d: d * 0.9, h: per * fh, floors: Math.max(1, Math.round(per)), ...f });
      s.position.y = y;
      s.rotation.y = i * 0.09;
      g.add(s);
      y += per * fh;
    }
    top = y; tw = w * 0.9; td = d * 0.9;
  } else {
    top = cylinderWalls(g, { r: Math.min(w, d) * 0.5, h: shaftFloors * fh, floors: shaftFloors, ...f, y, seg: 18 });
    tw = td = Math.min(w, d) * 0.9;
  }
  const roof = flatRoof(g, tw, td, top, { color: '#4a4e52', parapet: era >= 4 ? null : '#9a9c9e' });
  if (era >= 5) { greenRoof(g, tw * 0.9, td * 0.9, roof, r); solarPanels(g, tw * 0.6, td * 0.6, roof + 0.2, r); }
  crown(g, tw, td, roof + (era >= 5 ? 0.4 : 0), r, era, { spire: shape === 'setback' || (shape === 'taper' && r() < 0.6), helipad: shape === 'slab' && era >= 4 });
}

function industrial(g, b, dm, r) {
  const era = b.era, fh = FLOOR_H[era], { w, d, floors } = dm;
  if (era === 2) {
    const f = facadeFor(2, r, 'industrial');
    const top = walls(g, { w, d, h: floors * fh, floors, ...f, bay: 2.8 });
    sawtooth(g, w, d, top, P.roofSlate, Math.max(2, Math.round(d / 1.6)));
    smokestack(g, -w / 2 - 0.6, -d / 2 + 0.6, top + 4.5);
    part(g, G.box(), mat('#5a3a24'), [1.8, 2, 0.14], [w * 0.2, 1.05, d / 2 + 0.06], null, false);
  } else if (era === 3) {
    const top = walls(g, { w, d, h: floors * fh, floors, kind: 'concrete', tint: '#eceae4', bay: 3 });
    part(g, G.prism(), mat('#8a9096', { metalness: 0.4, roughness: 0.5 }), [w + 0.3, 1.0, d + 0.3], [0, top, 0]);
    for (const x of [-w * 0.25, w * 0.2]) part(g, G.box(), mat('#b0563c'), [1.8, 2.2, 0.12], [x, 1.15, d / 2 + 0.06], null, false);
    chimney(g, w * 0.35, -d * 0.3, top + 0.5, 2.6, '#7d8286');
    if (b.type === 'lumberyard') for (let i = 0; i < 3; i++) part(g, G.cyl(7), mat(P.trunk), [0.4, 2.2, 0.4], [w / 2 + 0.9, 0.22 + i * 0.4, d * 0.2 - i * 0.45], [Math.PI / 2, 0, 0]);
  } else if (era === 4) {
    const top = walls(g, { w, d, h: floors * fh, floors, kind: 'concrete', tint: pick(r, ['#d8e2e8', '#dfe5e8', '#e8e4dc']), bay: 3.2 });
    flatRoof(g, w, d, top, { color: '#5d6266', parapet: '#8f969b' });
    for (let i = 0; i < 3; i++) part(g, G.cyl(10), mat('#c9ced1', { metalness: 0.5 }), [0.9, 1.2, 0.9], [-w * 0.3 + i * w * 0.3, top + 0.8, -d * 0.2]);
    for (const x of [-w * 0.3, w * 0.25]) part(g, G.box(), mat('#e0b23a'), [2, 2.4, 0.12], [x, 1.2, d / 2 + 0.06], null, false);
  } else {
    const top = walls(g, { w, d, h: floors * fh, floors, kind: 'eco', tint: '#ffffff', bay: 3 });
    const roof = flatRoof(g, w, d, top, { color: '#e8ebec', parapet: null });
    solarPanels(g, w, d, roof, r);
    for (const x of [-w * 0.3, w * 0.3]) {
      part(g, G.cyl(8), mat('#f39c12', { metalness: 0.3 }), [0.5, 1.4, 0.5], [x, 0.7, d / 2 + 1.1]);
      part(g, G.box(), mat('#f39c12'), [0.25, 0.25, 1.6], [x, 1.5, d / 2 + 0.5], [0.4, 0, 0], false);
    }
    part(g, G.cyl(16), mat('#5d6266'), [2.2, 0.15, 2.2], [w * 0.25, roof + 0.4, d * 0.2], null, false);
  }
}

function commercial(g, b, dm, r) {
  const era = b.era, fh = FLOOR_H[era], { w, d, floors } = dm;
  const sc = SIGN[b.type] ?? '#3f6fa3';
  const f = facadeFor(era, r);
  const top = walls(g, { w, d, h: floors * fh, floors, ...f, bay: era >= 4 ? 2.2 : 2.6 });
  shopfront(g, w, d, sc, era);
  if (era === 2) {
    part(g, G.box(), mat('#efe6d6'), [w + 0.3, 0.4, d + 0.3], [0, top, 0]);
    flatRoof(g, w, d, top + 0.2, { color: '#5d6266', parapet: '#9a5a44' });
    if (w > 4.5) { part(g, G.cyl(12), mat('#f4efe2'), [0.9, 0.9, 0.08], [0, top - 0.6, d / 2 + 0.1], [Math.PI / 2, 0, 0], false); }
    chimney(g, w * 0.3, -d * 0.2, top, 1.2, '#9a5a44');
  } else {
    const roof = flatRoof(g, w, d, top, { color: era >= 4 ? '#4a4e52' : '#77797b' });
    signBoard(g, sc, w, top - 0.6, d);
    if (era >= 5) { greenRoof(g, w, d, roof, r); part(g, G.box(), mat('#23395b', { metalness: 0.4, roughness: 0.3 }), [w * 0.9, 0.08, 2.2], [0, 2.9, d / 2 + 1.1], [0.15, 0, 0], false); }
    else rooftopUnits(g, w, d, roof, r, 2);
    if (b.type === 'general_store' && era >= 3) paving(g, w + 1, 2.4, 0, d / 2 + 1.4, '#6b6e70');
  }
}

function civic(g, b, dm, r) {
  const era = b.era, fh = FLOOR_H[era], { w, d, floors } = dm;
  const t = b.type;
  if (t === 'hospital') {
    const top = walls(g, { w, d, h: floors * fh, floors, kind: era >= 5 ? 'eco' : 'concrete', tint: '#ffffff', bay: 2.2 });
    flatRoof(g, w, d, top, { color: '#9aa0a4' });
    for (const [sw, sh] of [[1.6, 0.45], [0.45, 1.6]]) part(g, G.box(), mat('#e53935', { emissive: '#e53935', emissiveIntensity: 0.4 }), [sw, sh, 0.1], [0, top - 1.2, d / 2 + 0.08], null, false);
    entrance(g, w, d, { glass: true, width: 2.4, height: 2.2 });
    part(g, G.cyl(16), mat('#5d6266'), [2.4, 0.15, 2.4], [w * 0.2, top + 0.3, 0], null, false);
    return;
  }
  if (t === 'station') {
    const f = era === 2 ? facadeFor(2, r) : facadeFor(era, r);
    const top = walls(g, { w: w * 0.7, d: d * 0.6, h: floors * fh, floors, ...f, z: -d * 0.2, bay: 2 });
    if (era === 2) { gable(g, w * 0.7, d * 0.6, top, 1.6, P.roofSlate, { z: -d * 0.2 }); part(g, G.box(), mat('#efe6d6'), [1.2, 2.4, 1.2], [0, top + 1.2, -d * 0.2]); part(g, G.cyl(12), mat('#f4efe2'), [0.8, 0.8, 0.08], [0, top + 1.6, -d * 0.2 + 0.62], [Math.PI / 2, 0, 0], false); }
    else flatRoof(g, w * 0.7, d * 0.6, top, { z: -d * 0.2 });
    // Platform canopy and rails along the front.
    part(g, G.box(), mat('#c9c4b8'), [w, 0.3, d * 0.3], [0, 0.15, d * 0.25]);
    part(g, G.box(), mat(era >= 4 ? '#dfe6ea' : '#6e4a31'), [w, 0.12, d * 0.34], [0, fh * 1.1, d * 0.25]);
    for (const x of [-w * 0.4, 0, w * 0.4]) part(g, G.cyl(6), mat('#5d6266'), [0.12, fh * 1.1, 0.12], [x, fh * 0.55, d * 0.36], null, false);
    for (const z of [d * 0.43, d * 0.5]) part(g, G.box(), mat('#7d8286', { metalness: 0.6 }), [w + 0.6, 0.08, 0.08], [0, 0.08, z], null, false);
    return;
  }
  if (t === 'well') {
    if (era === 3) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, G.box(), mat('#7d8286'), [0.18, 4, 0.18], [sx * 0.7, 2, sz * 0.7]); part(g, G.cyl(12), mat('#b9c3c8', { metalness: 0.4 }), [2.2, 1.6, 2.2], [0, 4.6, 0]); part(g, G.cone(12), mat('#8f969b'), [2.3, 0.6, 2.3], [0, 5.7, 0]); }
    else { const top = walls(g, { w: 2, d: 2, h: fh, floors: 1, ...facadeFor(era, r), bay: 2 }); era === 2 ? gable(g, 2, 2, top, 0.9, P.roofSlate) : flatRoof(g, 2, 2, top); }
    return;
  }
  if ((t === 'temple' || t === 'shrine') || (t === 'chapel' && era >= 3)) return faithBuilding(g, b, dm, r);
  if (t === 'chapel') {
    const f = era === 2 ? facadeFor(2, r) : { kind: era >= 4 ? 'glass' : 'concrete', tint: '#ffffff' };
    const top = walls(g, { w: w * 0.7, d, h: fh * 1.4, floors: 1, ...f, bay: 1.6 });
    gable(g, w * 0.7, d, top, 2.4, era === 2 ? P.roofSlate : '#e8e8e4', { along: true });
    const tt = walls(g, { w: 1.6, d: 1.6, h: fh * 2.8, floors: 2, ...f, z: -d / 2 + 0.8, bay: 1.6 });
    part(g, G.cone(4), mat(era === 2 ? P.roofSlate : '#d8d8d4'), [2, 3.4, 2], [0, tt + 1.7, -d / 2 + 0.8], [0, Math.PI / 4, 0]);
    entrance(g, w * 0.7, d, { color: '#5a3a24', width: 1.2, height: 2.4 });
    return;
  }
  // Halls, courthouses, schools, banks, guild halls, barracks, granaries.
  const f = facadeFor(era, r, t === 'granary' || t === 'barracks' ? 'industrial' : 'general');
  const civicStone = era === 2 ? { kind: 'deco', tint: '#efe6d6' } : f;
  const top = walls(g, { w, d, h: floors * fh, floors, ...(t === 'courthouse' || t === 'bank' ? civicStone : f), bay: 2.2 });
  if (era === 2) {
    if (['courthouse', 'bank', 'townhall'].includes(t)) {
      for (const x of [-w * 0.3, -w * 0.1, w * 0.1, w * 0.3]) part(g, G.cyl(8), mat('#f2ece0'), [0.38, fh * Math.min(2, floors), 0.38], [x, (fh * Math.min(2, floors)) / 2, d / 2 + 0.6]);
      part(g, G.prism(), mat('#f2ece0'), [w * 0.75, 1, 1.4], [0, fh * Math.min(2, floors), d / 2 + 0.6]);
    }
    gable(g, w, d, top, 1.6, P.roofSlate);
    if (['townhall', 'hall', 'school'].includes(t)) { const ct = walls(g, { w: 1.6, d: 1.6, h: 3, floors: 1, kind: 'brick', tint: '#c96e52', y: top, bay: 1.6 }); part(g, G.cone(4), mat(P.roofSlate), [2.2, 2, 2.2], [0, ct + 1, 0], [0, Math.PI / 4, 0]); part(g, G.cyl(12), mat('#f4efe2'), [0.9, 0.9, 0.08], [0, top + 1.8, 0.82], [Math.PI / 2, 0, 0], false); }
  } else {
    const roof = flatRoof(g, w, d, top, { color: era >= 4 ? '#4a4e52' : '#77797b' });
    if (era >= 5) greenRoof(g, w, d, roof, r); else rooftopUnits(g, w, d, roof, r, 2);
    if (['courthouse', 'townhall', 'bank'].includes(t)) for (const x of [-w * 0.3, 0, w * 0.3]) part(g, G.box(), mat('#f4f4f2'), [0.4, fh * Math.min(2, floors), 0.4], [x, (fh * Math.min(2, floors)) / 2, d / 2 + 0.4]);
    if (SIGN[t]) signBoard(g, SIGN[t], w, Math.min(top - 0.5, fh * 1.6), d);
  }
  entrance(g, w, d, { glass: era >= 3, width: 1.6, height: 2.3, color: '#4a3020' });
  for (const sx of [-1, 1]) {
    part(g, G.box(), mat(P.timberDark), [0.08, 3.2, 0.08], [sx * (w / 2 + 0.4), 1.6, d / 2 + 0.6], null, false);
    part(g, G.box(), mat(sx < 0 ? '#3f6fa3' : '#b8443a'), [0.7, 0.9, 0.04], [sx * (w / 2 + 0.4) + 0.36 * sx, 2.7, d / 2 + 0.6], null, false);
  }
}

/**
 * v0.5.3: places of worship that change with the ages — brick temples and
 * domes, modern spiritual centres, great sanctuaries, luminous glass temples
 * in gardens. Buildings of the stone's own faiths carry a small replica of
 * the standing stone and a gold eye at the door.
 */
function faithBuilding(g, b, dm, r) {
  const era = b.era, fh = FLOOR_H[era], { w, d } = dm, t = b.type;
  const stoneFaith = /Hidden Hand|Children of the Light|Keepers of the Silence/.test(b.name ?? '');
  const gold = mat('#e2c46a', { metalness: 0.55, roughness: 0.3 });
  const glowGlass = mat('#fff4cf', { emissive: '#ffd27a', emissiveIntensity: 0.35, transparent: true, opacity: 0.8, roughness: 0.2 });
  if (t === 'shrine') {
    part(g, G.box(), mat(era >= 3 ? '#cfcac0' : P.stoneDark), [2.2, 0.3, 2], [0, 0.15, 0]);
    if (era === 2) { const top = walls(g, { w: 1.6, d: 1.2, h: 1.9, floors: 1, kind: 'brick', tint: '#b8604a', z: -0.3, bay: 1.6 }); gable(g, 1.8, 1.4, top, 0.8, P.roofSlate, { z: -0.3 }); }
    else if (era === 3) { part(g, G.box(), mat('#d8d4cb'), [0.25, 2.2, 0.25], [-0.8, 1.25, -0.4]); part(g, G.box(), mat('#d8d4cb'), [0.25, 2.2, 0.25], [0.8, 1.25, -0.4]); part(g, G.box(), mat('#bfbab0'), [2.2, 0.18, 1.4], [0, 2.4, -0.3]); }
    else { part(g, G.cyl(16), glowGlass, [2, 2.6, 0.25], [0, 1.4, -0.3], null, false); if (era >= 5) greenRoof(g, 2.2, 2, 0.3, r); }
    part(g, G.sphere(8), glowGlass, [0.28, 0.28, 0.28], [0, 1.1, 0.2], null, false);
  } else if (t === 'chapel') {
    // Modern church (age 3), chapel of glass (age 4), light chapel under a living roof (age 5).
    const top = walls(g, { w: w * 0.72, d: d * 0.85, h: fh * 1.5, floors: 1, kind: era >= 4 ? 'glass' : 'concrete', tint: '#ffffff', bay: 1.4 });
    part(g, G.prism(), mat(era >= 4 ? '#dfe6ea' : '#e8e8e4'), [w * 0.8, 3.4, d * 0.9], [0, top, 0], [0, Math.PI / 2, 0]);
    part(g, G.box(), mat('#d4d4d0'), [0.5, top + 5, 0.5], [w * 0.38, (top + 5) / 2, -d * 0.35]);
    part(g, G.box(), gold, [1.1, 0.12, 0.12], [w * 0.38, top + 4, -d * 0.35 + 0.3], null, false);
    if (era >= 5) greenRoof(g, w * 0.5, d * 0.5, top + 0.2, r);
    entrance(g, w * 0.72, d * 0.85, { glass: true, width: 1.6, height: 2.6 });
  } else if (era === 2) {
    // A brick temple: portico of columns, a drum and a dome.
    const top = walls(g, { w: w * 0.8, d: d * 0.75, h: fh * 1.6, floors: 1, ...facadeFor(2, r), bay: 1.8 });
    for (const x of [-0.3, -0.1, 0.1, 0.3]) part(g, G.cyl(10), mat('#f2ece0'), [0.42, fh * 1.6, 0.42], [x * w, (fh * 1.6) / 2, d * 0.42]);
    part(g, G.prism(), mat('#f2ece0'), [w * 0.7, 1.1, 1.6], [0, fh * 1.6, d * 0.42]);
    part(g, G.cyl(16), mat('#c96e52'), [w * 0.42, 1.4, w * 0.42], [0, top + 0.7, -d * 0.05]);
    part(g, G.sphere(16), mat('#6f8f8a', { metalness: 0.3, roughness: 0.5 }), [w * 0.42, w * 0.34, w * 0.42], [0, top + 1.4, -d * 0.05]);
    part(g, G.cyl(8), gold, [0.3, 1, 0.3], [0, top + 1.4 + w * 0.17 + 0.4, -d * 0.05], null, false);
  } else if (era === 3) {
    // A community spiritual centre: a wide low hall round a courtyard, with a slender bell tower.
    const top = walls(g, { w, d: d * 0.45, h: fh * 1.2, floors: 1, kind: 'concrete', tint: '#f4efe6', z: -d * 0.27, bay: 2 });
    flatRoof(g, w, d * 0.45, top, { color: '#8f9294', z: -d * 0.27 });
    for (const sx of [-1, 1]) { const tt = walls(g, { w: w * 0.18, d: d * 0.5, h: fh * 1.1, floors: 1, kind: 'concrete', tint: '#efe9de', x: sx * w * 0.41, z: d * 0.2, bay: 2 }); flatRoof(g, w * 0.18, d * 0.5, tt, { x: sx * w * 0.41, z: d * 0.2 }); }
    lawn(g, w * 0.6, d * 0.4, 0, d * 0.2);
    part(g, G.box(), mat('#e6e2da'), [0.9, fh * 4, 0.9], [w * 0.38, fh * 2, -d * 0.4]);
    part(g, G.box(), gold, [0.7, 0.7, 0.08], [w * 0.38, fh * 3.6, -d * 0.4 + 0.47], null, false);
  } else if (era === 4) {
    // A great sanctuary: a tall faceted hall of glass and steel beside a campanile.
    const top = walls(g, { w: w * 0.7, d: d * 0.8, h: fh * 2.6, floors: 2, kind: 'glass', tint: '#ffffff', bay: 1.6 });
    part(g, G.cone(4), mat('#dfe6ea', { metalness: 0.4, roughness: 0.25 }), [w * 0.82, fh * 2.2, d * 0.9], [0, top + fh * 1.1, 0], [0, Math.PI / 4, 0]);
    part(g, G.box(), mat('#cfd6da'), [0.8, top + fh * 3, 0.8], [w * 0.42, (top + fh * 3) / 2, -d * 0.36]);
    entrance(g, w * 0.7, d * 0.8, { glass: true, width: 2.2, height: 3 });
  } else {
    // A luminous temple: a glass dome that glows at night, in a ring of gardens.
    part(g, G.cyl(20), mat('#e9efe8'), [w * 0.7, 0.6, w * 0.7], [0, 0.3, 0]);
    part(g, G.sphere(20), glowGlass, [w * 0.62, w * 0.5, w * 0.62], [0, 0.6, 0], null, false);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; tree(g, Math.cos(a) * w * 0.46, Math.sin(a) * d * 0.46, 0.7); }
    part(g, G.cyl(8), gold, [0.25, 1.2, 0.25], [0, w * 0.5 + 0.9, 0], null, false);
  }
  if (stoneFaith) {
    // The faith's emblem: a small standing stone before the door and a gold eye above it.
    part(g, G.dodeca(), mat('#8d8a80'), [0.5, 1.4, 0.3], [w * 0.28, 0.7, d / 2 + 0.6]);
    part(g, G.cyl(16), gold, [0.7, 0.7, 0.06], [0, Math.min(fh * 1.3, 3.2), d / 2 + 0.06], [Math.PI / 2, 0, 0], false);
  }
}

function farmExtras(g, b, dm, o, r) {
  const era = b.era;
  const fw = Math.min(o.w - 1, 10), fd = Math.min(o.d - 1.5, 7);
  const bx = fw / 2 - 1.2, bz = fd / 2 - 0.4;
  if (era === 2) { const t = walls(g, { w: 3.2, d: 2.6, h: 4.4, floors: 2, kind: 'brick', tint: '#b9654b', x: bx, z: bz, bay: 1.6 }); gable(g, 3.2, 2.6, t, 1.4, P.roofSlate, { x: bx, z: bz }); }
  else if (era === 3) {
    const t = walls(g, { w: 3.2, d: 2.6, h: 3, floors: 1, kind: 'concrete', tint: '#c0392b', x: bx, z: bz, bay: 3 });
    part(g, G.prism(), mat('#8a9096'), [3.5, 1, 2.9], [bx, t, bz]);
    part(g, G.cyl(12), mat('#c9ced1', { metalness: 0.4 }), [1.4, 5, 1.4], [bx - 2.6, 2.5, bz]); part(g, G.sphere(10), mat('#c9ced1', { metalness: 0.4 }), [1.4, 0.9, 1.4], [bx - 2.6, 5, bz]);
  } else if (era === 4) {
    for (let i = 0; i < 2; i++) { part(g, G.box(), mat('#cfe8f0', { transparent: true, opacity: 0.55, roughness: 0.1 }), [fw * 0.4, 1.6, 1.6], [-fw * 0.2, 0.8, -fd * 0.3 + i * 2], null, false); }
    const t = walls(g, { w: 3.2, d: 2.6, h: 3, floors: 1, kind: 'concrete', tint: '#ffffff', x: bx, z: bz, bay: 3 }); flatRoof(g, 3.2, 2.6, t, { x: bx, z: bz });
  } else {
    const t = walls(g, { w: 3, d: 2.6, h: (b.floors ?? 3) * FLOOR_H[5], floors: b.floors ?? 3, kind: 'eco', tint: '#ffffff', x: bx, z: bz, bay: 1.5 });
    greenRoof(g, 3, 2.6, t, r); solarPanels(g, 3, 2.6, t + 0.2, r);
  }
}

function grounds(g, b, dm, o, r) {
  const W = o.w - 0.6, D = o.d - 0.6;
  const sideways = o.facing === 'east' || o.facing === 'west';
  const w = sideways ? D : W, d = sideways ? W : D;
  const plaza = b.name?.includes('plaza') || b.name?.includes('Plaza');
  if (plaza) {
    paving(g, w, d, 0, 0, b.era >= 5 ? '#d9e4d2' : '#c9c4b8');
    part(g, G.cyl(16), mat(P.stone), [2.6, 0.5, 2.6], [0, 0.25, 0]);
    part(g, G.cyl(16), mat('#59b7d8', { emissive: '#1b6f8a', emissiveIntensity: 0.3 }), [2.2, 0.1, 2.2], [0, 0.5, 0], null, false);
    part(g, G.cyl(8), mat(P.stone), [0.4, 1.2, 0.4], [0, 0.8, 0]);
    for (const [x, z] of [[-w / 2 + 1, -d / 2 + 1], [w / 2 - 1, -d / 2 + 1], [-w / 2 + 1, d / 2 - 1], [w / 2 - 1, d / 2 - 1]]) { part(g, G.box(), mat('#9a9c9e'), [1.2, 0.5, 1.2], [x, 0.25, z]); tree(g, x, z, 0.7, b.era >= 5 ? '#6fae54' : P.leaf); }
    for (const sx of [-1, 1]) part(g, G.box(), mat(P.plank), [1.6, 0.12, 0.5], [sx * 2.4, 0.45, d * 0.25]);
    return;
  }
  lawn(g, w, d, 0, 0, '#7fb069');
  for (let i = 0; i < 6; i++) tree(g, (r() - 0.5) * (w - 2), (r() - 0.5) * (d - 2), 0.6 + r() * 0.5, pick(r, [P.leaf, P.leafDark, '#6fae54']));
  if (b.era >= 3) pool(g, w * 0.15, d * 0.1, Math.min(4, w * 0.4), Math.min(2.4, d * 0.3));
  else { part(g, G.cyl(8), mat('#f2ece0'), [2, 0.15, 2], [0, 0.08, 0]); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; part(g, G.cyl(6), mat('#f2ece0'), [0.12, 1.8, 0.12], [Math.cos(a) * 0.9, 0.9, Math.sin(a) * 0.9], null, false); } part(g, G.cone(6), mat(P.roofSlate), [2.4, 0.9, 2.4], [0, 2.2, 0]); }
  part(g, G.ico(), mat('#d16a84'), [1.2, 0.5, 0.8], [-w / 2 + 1.2, 0.3, d / 2 - 1], null, false);
}

// --- Dispatch ------------------------------------------------------------------------------

const INDUSTRIAL = new Set(['lumberyard', 'blacksmith']);
const COMMERCIAL = new Set(['bakery', 'general_store', 'stall', 'tavern']);

/**
 * Build a building of a later era (or a v0.5.2 type). `b` is the building
 * record {type, era, seed, floors, name}, `dm` its dimensions, `o` the plot.
 */
export function eraModel(b, dm, o) {
  const g = new THREE.Group();
  const r = rng((b.seed ?? 1) + b.era * 101);
  const f = formOf(b.type, b.era);
  if (b.type === 'grounds') grounds(g, b, dm, o, r);
  else if (b.type === 'mansion') mansion(g, b, dm, r);
  else if (b.type === 'cottage') house(g, b, dm, r);
  else if (b.type === 'apartment') apartment(g, b, dm, r);
  else if (b.type === 'tower' || f.tall) tower(g, b, dm, r, { signColor: SIGN[b.type] ?? null });
  else if (INDUSTRIAL.has(b.type)) industrial(g, b, dm, r);
  else if (COMMERCIAL.has(b.type)) commercial(g, b, dm, r);
  else if (b.type === 'farm') farmExtras(g, b, dm, o, r);
  else civic(g, b, dm, r);
  return g;
}

/** A cheap stand-in for distant tall buildings: the massing only, with the same facade. */
export function massingModel(b, dm) {
  const g = new THREE.Group();
  const r = rng((b.seed ?? 1) + b.era * 101);
  const f = facadeFor(Math.max(2, b.era), r);
  walls(g, { w: dm.w, d: dm.d, h: dm.h, floors: dm.floors, ...f });
  part(g, G.box(), mat('#4a4e52'), [dm.w, 0.3, dm.d], [0, dm.h + 0.15, 0], null, false);
  return g;
}

/** A modern building site: concrete frame or steel skeleton rising floor by floor, with a crane for tall work. */
export function modernSite(type, era, stage, progress, dm) {
  const g = new THREE.Group();
  const { w, d } = dm;
  const floors = dm.floors, fh = FLOOR_H[era];
  part(g, G.plane(), mat('#9b9286'), [w + 2.6, 1, d + 2.6], [0, 0.03, 0], null, false);
  for (const [sx, sz] of [[-1, 0], [1, 0]]) part(g, G.box(), mat('#e0b23a'), [0.1, 1.1, d + 2.4], [sx * (w / 2 + 1.25), 0.55, sz], null, false);
  const slab = mat('#b9b6ae'), steel = mat(era >= 4 ? '#7e8b95' : '#a39f96', { metalness: era >= 4 ? 0.5 : 0.05 });
  const built = stage === 'FOUNDATION' ? 0 : stage === 'FRAME' ? Math.max(1, Math.round(floors * progress)) : floors;
  part(g, G.box(), slab, [w + 0.2, stage === 'FOUNDATION' ? 0.15 + 0.3 * progress : 0.45, d + 0.2], [0, 0.2, 0]);
  for (let f = 0; f < built; f++) {
    const y = 0.45 + f * fh;
    for (const x of [-w / 2 + 0.15, 0, w / 2 - 0.15]) for (const z of [-d / 2 + 0.15, d / 2 - 0.15]) part(g, G.box(), steel, [0.22, fh, 0.22], [x, y + fh / 2, z]);
    part(g, G.box(), slab, [w, 0.18, d], [0, y + fh, 0]);
  }
  if (stage === 'ROOF' || stage === 'FINISHING') {
    const clad = Math.max(1, Math.round(floors * (stage === 'ROOF' ? progress : 1)));
    walls(g, { w: w - 0.05, d: d - 0.05, h: clad * fh, floors: clad, ...facadeFor(era, rng(7)), y: 0.45 });
  }
  if (floors >= 4 && stage !== 'FOUNDATION') {
    // A tower crane: the mast beside the site and a jib that slews (animated by the world).
    const top = 0.45 + floors * fh + 6;
    const mastX = w / 2 + 1.6;
    for (let y = 0; y < top; y += 2) part(g, G.box(), mat('#e0b23a'), [0.5, 2, 0.5], [mastX, y + 1, -d / 2], null, false);
    const jib = new THREE.Group();
    jib.position.set(mastX, top, -d / 2);
    part(jib, G.box(), mat('#e0b23a'), [0.4, 0.4, 14], [0, 0.2, 3], null, false);
    part(jib, G.box(), mat('#5d6266'), [1.4, 1, 1.4], [0, 0.6, -3.6], null, false);
    part(jib, G.box(), mat('#2e2e30'), [0.05, 4, 0.05], [0, -2, 8], null, false);
    part(jib, G.box(), mat('#c9ced1'), [1.2, 0.6, 1.2], [0, -4.2, 8], null, false);
    jib.userData.crane = true;
    g.add(jib);
  }
  return g;
}

export { FLOOR_H };
