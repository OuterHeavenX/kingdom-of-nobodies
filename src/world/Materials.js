import * as THREE from 'three';
import { addSnow } from '../effects/SnowAccumulation.js';

// Shared materials and geometries. Everything in the scene draws from these
// caches so the GPU sees a small, stable set of programs and buffers.

const materials = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!materials.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...opts });
    // Opaque surfaces can carry snow in winter (see effects/SnowAccumulation).
    if (!opts.transparent) addSnow(m);
    materials.set(key, m);
  }
  return materials.get(key);
}

export const PALETTE = {
  plaster: '#ecdcc0', plasterWarm: '#e7cfa6', timber: '#6e4a31', timberDark: '#4f3524', plank: '#a77b52',
  roofRed: '#a4553e', roofBrown: '#7c5440', roofSlate: '#5d6670', thatch: '#c9a35e', stone: '#a9a497',
  stoneDark: '#7f7b72', window: '#3d4f5c', windowLit: '#ffd27a', door: '#5a3a24', grass: '#79a764',
  path: '#c9b48e', field: '#8a6a45', crop: '#9cbf5a', cropRipe: '#d7b955', leaf: '#4f8f53', leafDark: '#3c7347',
  pine: '#2f6b4a', trunk: '#7a5638', awningA: '#c45c49', awningB: '#f0e2c6', fire: '#ffa33d', iron: '#4a4d52',
};

const geometries = new Map();
function geo(key, make) {
  if (!geometries.has(key)) geometries.set(key, make());
  return geometries.get(key);
}

export const G = {
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (seg = 8) => geo('cyl' + seg, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg)),
  cone: (seg = 4) => geo('cone' + seg, () => new THREE.ConeGeometry(0.5, 1, seg)),
  sphere: (seg = 8) => geo('sph' + seg, () => new THREE.SphereGeometry(0.5, seg, Math.max(4, seg - 2))),
  ico: () => geo('ico', () => new THREE.IcosahedronGeometry(0.5, 0)),
  dodeca: () => geo('dod', () => new THREE.DodecahedronGeometry(0.5, 0)),
  // Triangular prism used for gable roofs: 1 wide (x), 1 tall (y), 1 deep (z).
  prism: () => geo('prism', () => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.5, 0); shape.lineTo(0.5, 0); shape.lineTo(0, 1); shape.lineTo(-0.5, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    return g;
  }),
  plane: () => geo('plane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
  disc: () => geo('disc', () => new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2)),
  ring: () => geo('ring', () => new THREE.RingGeometry(0.42, 0.5, 24).rotateX(-Math.PI / 2)),
};

/** Add a scaled, positioned mesh of a shared geometry to a group. */
export function part(group, geometry, material, [sx, sy, sz], [x, y, z], rot = null, shadow = true) {
  const m = new THREE.Mesh(geometry, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = shadow;
  m.receiveShadow = true;
  group.add(m);
  return m;
}
