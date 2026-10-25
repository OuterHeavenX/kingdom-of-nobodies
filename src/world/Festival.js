import * as THREE from 'three';
import { mat, G, part, PALETTE as P } from './Materials.js';
import { buildingModel } from './Models.js';

// Festival dressing for the square: bunting for every festival, then flowers
// for Renewal, market stalls for the Midsummer Fair, hay and pumpkins for the
// Harvest, lanterns for Hearthlight, and touches from the village's traditions.

const FLAGS = ['#d9534f', '#f0c24b', '#5b9bd5', '#7bbf6a', '#e88fb0'];
export const festivalLanterns = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffae42', emissiveIntensity: 1.4, flatShading: true });

export function festivalModel(f, traditions) {
  const g = new THREE.Group();
  const R = 6.2;
  // Bunting strung between eight poles around the square.
  const poles = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    part(g, G.cyl(6), mat(P.timberDark), [0.12, 3.2, 0.12], [x, 1.6, z]);
    poles.push([x, z]);
  }
  for (let i = 0; i < poles.length; i++) {
    const [ax, az] = poles[i], [bx, bz] = poles[(i + 1) % poles.length];
    for (let k = 1; k < 6; k++) {
      const t = k / 6, sag = Math.sin(t * Math.PI) * 0.5;
      part(g, G.cone(3), mat(FLAGS[(i + k) % FLAGS.length]), [0.28, 0.42, 0.06], [ax + (bx - ax) * t, 3 - sag, az + (bz - az) * t], [Math.PI, Math.atan2(bx - ax, bz - az), 0], false);
    }
  }
  if (f.season === 0) {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, r = 4.6 + (i % 3) * 0.3;
      part(g, G.sphere(5), mat(FLAGS[i % FLAGS.length]), [0.22, 0.22, 0.22], [Math.cos(a) * r, 0.18, Math.sin(a) * r], null, false);
    }
    part(g, G.cyl(8), mat('#f4efe2'), [0.18, 4.2, 0.18], [-3.2, 2.1, 3.2]); // the maypole
    for (let i = 0; i < 6; i++) part(g, G.box(), mat(FLAGS[i % FLAGS.length]), [0.05, 3.6, 0.05], [-3.2 + Math.cos(i) * 0.9, 2.1, 3.2 + Math.sin(i) * 0.9], [Math.sin(i) * 0.25, 0, Math.cos(i) * 0.25], false);
  }
  if (f.season === 1) {
    for (const [x, z, r] of [[5, -4.5, -0.6], [-5, -4.5, 0.6], [5.2, 4.2, Math.PI + 0.6]]) {
      const stall = buildingModel('stall', { id: 'fair' + x, open: true });
      stall.position.set(x, 0, z);
      stall.rotation.y = r;
      stall.scale.setScalar(0.6);
      g.add(stall);
    }
  }
  if (f.season === 2) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part(g, G.box(), mat(P.thatch), [1, 0.6, 0.7], [Math.cos(a) * 4.4, 0.3, Math.sin(a) * 4.4], [0, a, 0]);
      part(g, G.sphere(7), mat('#d9822b'), [0.45, 0.36, 0.45], [Math.cos(a + 0.3) * 3.8, 0.18, Math.sin(a + 0.3) * 3.8]);
    }
    part(g, G.box(), mat(P.plank), [3.6, 0.12, 0.9], [0, 0.8, -3.6]); // the feast table
    for (const x of [-1.4, 1.4]) part(g, G.box(), mat(P.timberDark), [0.12, 0.8, 0.8], [x, 0.4, -3.6]);
  }
  if (f.season === 3 || traditions.some((t) => t.id === 'fire-remembrance' && t.active)) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = 5.2;
      part(g, G.box(), festivalLanterns, [0.22, 0.3, 0.22], [Math.cos(a) * r, 2.4 + Math.sin(i * 1.7) * 0.2, Math.sin(a) * r], null, false);
    }
  }
  if (traditions.some((t) => t.id === 'founders-day' && t.active) && f.season === 0) {
    // Wreaths laid at the Founders' Memorial.
    for (let i = 0; i < 5; i++) part(g, G.ring(), mat('#4f8f53'), [0.6, 0.6, 0.6], [-4.6 + Math.cos(i) * 1.3, 0.1, -4.6 + Math.sin(i) * 1.3], null, false);
  }
  return g;
}
