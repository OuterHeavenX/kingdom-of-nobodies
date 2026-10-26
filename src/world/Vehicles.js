import * as THREE from 'three';
import { mat, G, part, PALETTE as P } from './Materials.js';

// Vehicles. A villager whose trip the simulation made by car, bus, rapid
// transit or autonomous pod is drawn in that vehicle, on the route the
// pathfinder gave them; caravans are drawn as the freight vehicle they
// actually travel in. Nothing here drives on its own.

const CAR_COLORS = ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#ecf0f1', '#2c3e50', '#8e44ad', '#d35400'];

function wheels(g, xs, zs, r = 0.42) {
  for (const x of xs) for (const z of zs) part(g, G.cyl(10), mat('#1f2224'), [r, 0.2, r], [x, r / 2 + 0.02, z], [0, 0, Math.PI / 2], false);
}

export function vehicleModel(kind, color = '#c0392b') {
  const g = new THREE.Group();
  if (kind === 'car') {
    part(g, G.box(), mat(color, { roughness: 0.4 }), [1.2, 0.5, 2.3], [0, 0.45, 0]);
    part(g, G.box(), mat('#2e3b45', { roughness: 0.2 }), [1.05, 0.42, 1.2], [0, 0.88, -0.1], null, false);
    part(g, G.box(), mat('#ffe9a8', { emissive: '#ffd27a', emissiveIntensity: 0.6 }), [0.9, 0.12, 0.05], [0, 0.5, 1.16], null, false);
    wheels(g, [-0.6, 0.6], [-0.75, 0.75]);
  } else if (kind === 'bus') {
    part(g, G.box(), mat('#e8a33c', { roughness: 0.5 }), [1.4, 1.4, 4.2], [0, 0.95, 0]);
    part(g, G.box(), mat('#2e3b45', { roughness: 0.2 }), [1.42, 0.5, 3.8], [0, 1.25, 0], null, false);
    wheels(g, [-0.7, 0.7], [-1.4, 1.4], 0.5);
  } else if (kind === 'metro') {
    part(g, G.box(), mat('#e8ecef', { roughness: 0.35 }), [1.3, 1.3, 5], [0, 0.95, 0]);
    part(g, G.box(), mat('#2b6cb0'), [1.32, 0.18, 5.02], [0, 0.5, 0], null, false);
    part(g, G.box(), mat('#22313d', { roughness: 0.15 }), [1.32, 0.45, 4.6], [0, 1.2, 0], null, false);
    wheels(g, [-0.6, 0.6], [-1.8, 1.8], 0.36);
  } else if (kind === 'pod') {
    part(g, G.sphere(12), mat('#f3f5f6', { roughness: 0.25 }), [1.2, 0.85, 1.9], [0, 0.55, 0]);
    part(g, G.sphere(12), mat('#66c2d9', { roughness: 0.1, metalness: 0.5 }), [1.0, 0.5, 1.2], [0, 0.78, 0.15], null, false);
    part(g, G.ring(), mat('#7fe8ff', { emissive: '#3fd0ff', emissiveIntensity: 0.8 }), [1.4, 1, 2.1], [0, 0.18, 0], null, false);
  }
  return g;
}

/** Freight: an ox cart (from Caravans.js) or the vehicle of its age. */
export function freightModel(mode, color) {
  const g = new THREE.Group();
  const legs = [], wheelList = [];
  if (mode === 'rail') {
    // A steam traction engine hauling a covered wagon along the road.
    part(g, G.cyl(12), mat('#2e3134', { metalness: 0.4 }), [0.9, 1.8, 0.9], [0, 1.15, 2.1], [Math.PI / 2, 0, 0]);
    part(g, G.cyl(8), mat('#1f1f1f'), [0.25, 1.1, 0.25], [0, 2.3, 2.8]);
    part(g, G.box(), mat('#5a3a24'), [1.2, 1.2, 1], [0, 1.3, 0.9]);
    for (const z of [0.9, 2.6]) for (const sx of [-1, 1]) wheelList.push(part(g, G.cyl(12), mat('#b8443a'), [z > 1 ? 0.9 : 1.3, 0.16, z > 1 ? 0.9 : 1.3], [sx * 0.7, z > 1 ? 0.45 : 0.65, z], [0, 0, Math.PI / 2], false));
    part(g, G.box(), mat(color), [1.4, 1.2, 2.4], [0, 1.2, -1.4]);
    for (const sx of [-1, 1]) for (const z of [-2.2, -0.6]) wheelList.push(part(g, G.cyl(10), mat(P.timberDark), [0.7, 0.14, 0.7], [sx * 0.75, 0.35, z], [0, 0, Math.PI / 2], false));
  } else if (mode === 'car' || mode === 'metro') {
    const electric = mode === 'metro';
    part(g, G.box(), mat(electric ? '#e8ecef' : color, { roughness: 0.45 }), [1.4, 1.3, 1.4], [0, 1.0, 1.5]);
    part(g, G.box(), mat('#2e3b45', { roughness: 0.2 }), [1.42, 0.5, 0.6], [0, 1.35, 2.0], null, false);
    part(g, G.box(), mat(electric ? '#2b6cb0' : '#f2efe6'), [1.5, 1.7, 3], [0, 1.2, -0.8]);
    wheels(g, [-0.7, 0.7], [-1.6, 1.4], 0.5);
  } else {
    part(g, G.box(), mat('#f3f5f6', { roughness: 0.3 }), [1.3, 1.1, 3.2], [0, 0.85, 0]);
    part(g, G.box(), mat('#66c2d9', { roughness: 0.1, metalness: 0.5 }), [1.32, 0.35, 0.8], [0, 1.15, 1.3], null, false);
    part(g, G.ring(), mat('#7fe8ff', { emissive: '#3fd0ff', emissiveIntensity: 0.8 }), [1.6, 1, 3.4], [0, 0.2, 0], null, false);
  }
  const cargo = new THREE.Group();
  g.add(cargo);
  g.userData = { wheels: wheelList, legs, cargo };
  return g;
}

export class VehicleLayer {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.nodes = new Map();
  }

  /** Citizens who are travelling by vehicle right now. */
  update(citizens, dt) {
    const seen = new Set();
    for (const c of citizens) {
      const a = c.activity;
      const kind = a?.phase === 'travel' ? a.vehicle : null;
      if (!kind) continue;
      seen.add(c.id);
      let n = this.nodes.get(c.id);
      if (n && n.userData.kind !== kind) { this.root.remove(n); n = null; }
      if (!n) {
        n = vehicleModel(kind, CAR_COLORS[Number(c.id.slice(1)) % CAR_COLORS.length]);
        n.userData.kind = kind;
        n.position.set(c.x, 0, c.z);
        n.traverse((o) => { o.userData.citizenId = c.id; });
        this.root.add(n);
        this.nodes.set(c.id, n);
      }
      const dx = c.x - n.position.x, dz = c.z - n.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 14) n.position.set(c.x, 0, c.z);
      else { n.position.x += dx * Math.min(1, dt * 6); n.position.z += dz * Math.min(1, dt * 6); }
      if (dist > 0.05) {
        const want = Math.atan2(dx, dz);
        let d = want - n.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        n.rotation.y += d * Math.min(1, dt * 8);
      }
    }
    for (const [id, n] of this.nodes) if (!seen.has(id)) { this.root.remove(n); this.nodes.delete(id); }
  }

  get count() { return this.nodes.size; }
}
