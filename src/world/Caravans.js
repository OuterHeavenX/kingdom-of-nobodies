import * as THREE from 'three';
import { mat, G, part, PALETTE as P } from './Materials.js';
import { routeById } from '../region/RegionManager.js';
import { GATES } from '../navigation/RoadNetwork.js';
import { findPath } from '../navigation/Pathfinding.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';
import { freightModel } from './Vehicles.js';

// Caravans in the village. While a caravan's current leg starts or ends at
// First Hearth and it is within the last (or first) few kilometres, its cart
// is drawn on the real road from the gate to the market square, at the point
// matching its simulated progress. Loading and unloading happen in the square.

const LOCAL_KM = 3;
const MARKET = { x: 7, z: 3.4 };

/** A low-poly cart with an ox, a driver and cargo. */
export function cartModel(color) {
  const g = new THREE.Group();
  const wood = mat(P.timber), dark = mat(P.timberDark);
  part(g, G.box(), wood, [1.5, 0.18, 2.4], [0, 0.75, 0]);
  for (const sx of [-1, 1]) part(g, G.box(), dark, [0.08, 0.36, 2.4], [sx * 0.74, 0.98, 0], null, false);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-0.7, 0.7]) {
    const w = part(g, G.cyl(10), dark, [0.62, 0.12, 0.62], [sx * 0.86, 0.36, sz], [0, 0, Math.PI / 2]);
    wheels.push(w);
  }
  const cargo = new THREE.Group();
  part(cargo, G.box(), mat('#c9a66b'), [0.6, 0.45, 0.6], [-0.3, 1.1, -0.5]);
  part(cargo, G.cyl(8), mat('#a27a4f'), [0.5, 0.6, 0.5], [0.32, 1.15, -0.4]);
  part(cargo, G.box(), mat(color), [1.3, 0.12, 1.3], [0, 1.45, -0.4], null, false);
  g.add(cargo);
  // The ox, the shaft and the driver.
  part(g, G.box(), dark, [0.08, 0.08, 1.2], [0, 0.65, 1.7], null, false);
  const ox = new THREE.Group();
  part(ox, G.box(), mat('#8b6a4a'), [0.6, 0.6, 1.2], [0, 0.85, 0]);
  part(ox, G.box(), mat('#7a5a3c'), [0.42, 0.42, 0.45], [0, 1.0, 0.75]);
  for (const sx of [-1, 1]) part(ox, G.cone(5), mat('#efe6d0'), [0.08, 0.3, 0.08], [sx * 0.22, 1.28, 0.8], [0, 0, sx * -0.6], false);
  const legs = [];
  for (const sx of [-1, 1]) for (const sz of [-0.4, 0.4]) legs.push(part(ox, G.box(), mat('#6a4c34'), [0.14, 0.55, 0.14], [sx * 0.2, 0.28, sz], null, false));
  ox.position.z = 2.5;
  g.add(ox);
  const driver = new THREE.Group();
  part(driver, G.box(), mat(color), [0.42, 0.55, 0.32], [0, 1.2, 0.8], null, false);
  part(driver, G.sphere(8), mat('#f2cfab'), [0.32, 0.32, 0.32], [0, 1.65, 0.8], null, false);
  g.add(driver);
  g.userData = { wheels, legs, cargo };
  return g;
}

export class CaravanLayer {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.nodes = new Map();
    this.paths = new Map();
  }

  /** The local road from a gate to the market, planned once per gate and town layout. */
  localPath(state, gate, version) {
    const key = `${gate}:${version}`;
    if (!this.paths.has(key)) {
      const from = GATES[gate];
      const route = findPath(state, from, MARKET);
      const pts = [[from.x, from.z], ...(route.failed ? [] : route.points)];
      const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
      this.paths.set(key, { pts, lens, total: lens.reduce((a, b) => a + b, 0) });
    }
    return this.paths.get(key);
  }

  /** Where a caravan should be drawn in the village, or null if it is out in the region. */
  localPlacement(state, cv, version) {
    if (!cv.leg) {
      if (cv.at !== HEARTH || cv.status === 'COMPLETED' || cv.status === 'CANCELLED' || cv.status === 'PLANNING') return null;
      return { x: MARKET.x + 2, z: MARKET.z + 1.5, heading: Math.PI / 2, moving: false };
    }
    const route = routeById(cv.leg.route);
    if (cv.leg.from !== HEARTH && cv.leg.to !== HEARTH) return null;
    const fromHearth = cv.leg.from === HEARTH;
    const kmFromHearth = fromHearth ? cv.leg.progress : cv.leg.km - cv.leg.progress;
    if (kmFromHearth > LOCAL_KM) return null;
    const path = this.localPath(state, route.gate, version);
    // 0 = at the gate, 1 = at the market.
    const f = 1 - kmFromHearth / LOCAL_KM;
    let d = f * path.total;
    for (let i = 0; i < path.lens.length; i++) {
      if (d <= path.lens[i] || i === path.lens.length - 1) {
        const t = path.lens[i] ? Math.min(1, d / path.lens[i]) : 0;
        const [ax, az] = path.pts[i], [bx, bz] = path.pts[i + 1];
        const heading = Math.atan2(bx - ax, bz - az) + (fromHearth ? Math.PI : 0);
        return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, heading, moving: cv.status !== 'DELAYED' };
      }
      d -= path.lens[i];
    }
    return null;
  }

  sync(state, version) {
    const seen = new Set();
    for (const cv of state.trade?.caravans ?? []) {
      const place = this.localPlacement(state, cv, version);
      if (!place) continue;
      seen.add(cv.id);
      let node = this.nodes.get(cv.id);
      const mode = cv.mode ?? 'cart';
      if (node && node.userData.mode !== mode) { this.root.remove(node); node = null; }
      if (!node) {
        const color = cv.home === HEARTH ? '#d4a64a' : KINGDOMS[cv.home]?.color ?? '#c9b48e';
        // Each caravan is drawn as what it travels in: an ox cart, a steam wagon, a lorry or a cargo pod.
        node = mode === 'cart' ? cartModel(color) : freightModel(mode, color);
        node.userData.mode = mode;
        node.position.set(place.x, 0, place.z);
        node.traverse((o) => { o.userData.caravanId = cv.id; });
        this.root.add(node);
        this.nodes.set(cv.id, node);
      }
      node.userData.target = place;
      node.userData.cargo.visible = Object.keys(cv.cargo).length > 0;
    }
    for (const [id, node] of this.nodes) if (!seen.has(id)) { this.root.remove(node); this.nodes.delete(id); }
    // Old path plans are dropped when the town layout changes.
    if (this.paths.size > 12) this.paths.clear();
  }

  update(dt, time) {
    for (const node of this.nodes.values()) {
      const t = node.userData.target;
      if (!t) continue;
      const dx = t.x - node.position.x, dz = t.z - node.position.z;
      if (Math.hypot(dx, dz) > 15) node.position.set(t.x, 0, t.z);
      else { node.position.x += dx * Math.min(1, dt * 3); node.position.z += dz * Math.min(1, dt * 3); }
      node.rotation.y += (((t.heading - node.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 4);
      const swing = t.moving ? Math.sin(time * 6) * 0.35 : 0;
      node.userData.legs?.forEach((l, i) => { l.rotation.x = i % 2 ? swing : -swing; });
      if (t.moving) for (const w of node.userData.wheels) w.rotation.x += dt * 2.5;
    }
  }

  /** Position of a caravan's cart in the village, if it is drawn. */
  positionOf(id) {
    const n = this.nodes.get(id);
    return n ? { x: n.position.x, z: n.position.z } : null;
  }
}
