import * as THREE from 'three';
import { mat, G, part } from './Materials.js';

// Villager figures. Appearance comes from the citizen record (tunic colour,
// hair, skin) plus profession clothing and tools. Animation is chosen from the
// simulation's current activity, so what you see is what they are doing.

const PANTS = { Farmer: '#6b5a3e', Woodcutter: '#4b4f3a', Builder: '#5c4a36', Forager: '#4d5e3c', Baker: '#e8e2d6', Blacksmith: '#3d3a38', Merchant: '#4a3f5c', Innkeeper: '#5a3b2c', Laborer: '#5b5048' };

function addHair(head, style, color) {
  const m = mat(color);
  if (style === 'bald') return;
  if (style === 'short' || style === 'curly') part(head, style === 'curly' ? G.ico() : G.sphere(8), m, [0.56, 0.36, 0.56], [0, 0.17, -0.03], null, false);
  if (style === 'long') { part(head, G.sphere(8), m, [0.56, 0.4, 0.58], [0, 0.14, -0.04], null, false); part(head, G.box(), m, [0.5, 0.55, 0.16], [0, -0.15, -0.22], null, false); }
  if (style === 'bun') { part(head, G.sphere(8), m, [0.55, 0.34, 0.55], [0, 0.17, -0.03], null, false); part(head, G.sphere(6), m, [0.24, 0.24, 0.24], [0, 0.3, -0.24], null, false); }
  if (style === 'braid') { part(head, G.sphere(8), m, [0.55, 0.35, 0.56], [0, 0.16, -0.04], null, false); part(head, G.cyl(6), m, [0.12, 0.6, 0.12], [0, -0.25, -0.27], [0.25, 0, 0], false); }
}

function addHat(head, profession) {
  switch (profession) {
    case 'Farmer': part(head, G.cyl(10), mat('#d8b860'), [0.95, 0.05, 0.95], [0, 0.24, 0], null, false); part(head, G.cyl(10), mat('#d8b860'), [0.5, 0.22, 0.5], [0, 0.34, 0], null, false); break;
    case 'Woodcutter': part(head, G.cone(8), mat('#9c3b30'), [0.6, 0.45, 0.6], [0, 0.38, -0.03], null, false); break;
    case 'Builder': part(head, G.sphere(8), mat('#d39a3a'), [0.6, 0.36, 0.6], [0, 0.2, 0], null, false); break;
    case 'Baker': part(head, G.cyl(10), mat('#f7f4ee'), [0.48, 0.4, 0.48], [0, 0.42, 0], null, false); break;
    case 'Merchant': part(head, G.cyl(10), mat('#5d3f7a'), [0.56, 0.18, 0.56], [0, 0.3, 0], null, false); part(head, G.box(), mat('#e8c547'), [0.04, 0.3, 0.12], [0.22, 0.45, 0], [0, 0, -0.4], false); break;
    case 'Forager': part(head, G.cone(8), mat('#4d6b3a'), [0.62, 0.5, 0.62], [0, 0.32, -0.06], null, false); break;
    case 'Innkeeper': part(head, G.sphere(8), mat('#b8443a'), [0.56, 0.24, 0.56], [0, 0.2, 0], null, false); break;
    default: break;
  }
}

function addTool(hand, profession) {
  if (profession === 'Woodcutter') { part(hand, G.box(), mat('#7a5638'), [0.07, 0.7, 0.07], [0, -0.55, 0.12], [1.2, 0, 0], false); part(hand, G.box(), mat('#b9bec3'), [0.05, 0.22, 0.26], [0, -0.75, 0.42], [1.2, 0, 0], false); }
  if (profession === 'Builder') { part(hand, G.box(), mat('#7a5638'), [0.06, 0.5, 0.06], [0, -0.5, 0.1], [1.2, 0, 0], false); part(hand, G.box(), mat('#55595e'), [0.22, 0.12, 0.12], [0, -0.6, 0.3], [1.2, 0, 0], false); }
  if (profession === 'Blacksmith') { part(hand, G.box(), mat('#55595e'), [0.08, 0.4, 0.08], [0, -0.48, 0.08], [1.2, 0, 0], false); }
  if (profession === 'Forager') part(hand, G.cyl(8), mat('#b08850'), [0.36, 0.26, 0.36], [0, -0.5, 0.05], null, false);
}

export function makeVillager(c) {
  const root = new THREE.Group();
  const skin = mat(c.appearance?.skin ?? '#f2cfab');
  const tunic = mat(c.color);
  const pants = mat(PANTS[c.profession] ?? '#5b5048');
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.16, 0.72, 0);
    part(hip, G.box(), pants, [0.22, 0.7, 0.24], [0, -0.35, 0]);
    part(hip, G.box(), mat('#3b2a1e'), [0.24, 0.12, 0.32], [0, -0.68, 0.04], null, false);
    root.add(hip);
    return hip;
  });
  const torso = new THREE.Group();
  torso.position.y = 0.72;
  root.add(torso);
  part(torso, G.box(), tunic, [0.62, 0.78, 0.4], [0, 0.4, 0]);
  part(torso, G.box(), mat('#4a3626'), [0.64, 0.08, 0.42], [0, 0.06, 0], null, false);
  if (['Baker', 'Blacksmith', 'Innkeeper'].includes(c.profession)) part(torso, G.box(), mat(c.profession === 'Blacksmith' ? '#5a4030' : '#f2ede2'), [0.5, 0.62, 0.05], [0, 0.32, 0.22], null, false);
  const arms = [-1, 1].map((s) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.4, 0.72, 0);
    part(shoulder, G.box(), tunic, [0.17, 0.62, 0.2], [0, -0.28, 0]);
    part(shoulder, G.sphere(6), skin, [0.17, 0.17, 0.17], [0, -0.62, 0], null, false);
    torso.add(shoulder);
    return shoulder;
  });
  addTool(arms[1], c.profession);
  const head = new THREE.Group();
  head.position.y = 1.08;
  torso.add(head);
  part(head, G.sphere(10), skin, [0.5, 0.52, 0.5], [0, 0, 0]);
  part(head, G.box(), mat('#2b2420'), [0.06, 0.07, 0.03], [-0.1, 0.03, 0.24], null, false);
  part(head, G.box(), mat('#2b2420'), [0.06, 0.07, 0.03], [0.1, 0.03, 0.24], null, false);
  addHair(head, c.appearance?.hair ?? 'short', c.appearance?.hairColor ?? '#5a3b26');
  addHat(head, c.profession);
  root.userData = { citizenId: c.id, legs, arms, torso, head, signature: `${c.profession}|${c.appearance?.hair}|${c.color}` };
  root.traverse((o) => { o.userData.citizenId = c.id; });
  return root;
}

const WORKING = new Set(['work', 'build', 'forage']);
const SOCIAL = new Set(['socialize', 'tavern', 'festival', 'help']);

export class Villagers {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.nodes = new Map();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.9 }));
    this.ring.position.y = 0.05;
    this.ring.visible = false;
    scene.add(this.ring);
    this.tmp = new THREE.Vector3();
  }

  sync(citizens) {
    const ids = new Set(citizens.map((c) => c.id));
    for (const [id, node] of this.nodes) if (!ids.has(id)) { this.root.remove(node); this.nodes.delete(id); }
    for (const c of citizens) {
      let node = this.nodes.get(c.id);
      const sig = `${c.profession}|${c.appearance?.hair}|${c.color}`;
      if (node && node.userData.signature !== sig) { this.root.remove(node); node = null; }
      if (!node) {
        node = makeVillager(c);
        node.position.set(c.x, 0, c.z);
        this.root.add(node);
        this.nodes.set(c.id, node);
      }
    }
  }

  update(citizens, dt, time, selectedId) {
    for (const c of citizens) {
      const node = this.nodes.get(c.id);
      if (!node) continue;
      const u = node.userData;
      const a = c.activity;
      const asleep = a?.kind === 'sleep' && a.phase === 'perform';
      node.visible = !asleep;
      this.tmp.set(c.x, 0, c.z);
      const dx = c.x - node.position.x, dz = c.z - node.position.z;
      const dist = Math.hypot(dx, dz);
      const moving = dist > 0.05;
      if (dist > 12) node.position.copy(this.tmp);
      else node.position.lerp(this.tmp, Math.min(1, dt * 7));
      if (moving) node.rotation.y = lerpAngle(node.rotation.y, Math.atan2(dx, dz), Math.min(1, dt * 10));
      const phase = time * 9 + c.id.length * 1.7 + Number(c.id.slice(1));
      let legSwing = 0, armL = 0, armR = 0, bob = 0, headTilt = 0;
      if (moving) {
        legSwing = Math.sin(phase) * 0.6;
        armL = -legSwing * 0.8; armR = legSwing * 0.8;
        bob = Math.abs(Math.sin(phase)) * 0.06;
      } else if (a?.phase === 'perform' && WORKING.has(a.kind)) {
        const chop = Math.sin(time * 6 + phase * 0.1);
        armR = -1.2 - chop * 0.9;
        armL = a.kind === 'forage' ? -0.6 - chop * 0.3 : -0.4;
        bob = Math.max(0, chop) * 0.04;
        headTilt = 0.25;
      } else if (a?.phase === 'perform' && SOCIAL.has(a.kind)) {
        armR = -0.5 - Math.sin(time * 3 + phase) * 0.5;
        headTilt = Math.sin(time * 2 + phase) * 0.15;
        bob = Math.abs(Math.sin(time * 4 + phase)) * 0.03;
      } else if (a?.phase === 'perform' && (a.kind === 'eat_own' || a.kind === 'eat_stock' || a.kind === 'buy_food')) {
        armR = -2.1 + Math.sin(time * 5) * 0.2;
      } else {
        bob = Math.sin(time * 1.6 + phase) * 0.015;
      }
      u.legs[0].rotation.x = legSwing;
      u.legs[1].rotation.x = -legSwing;
      u.arms[0].rotation.x = armL;
      u.arms[1].rotation.x = armR;
      u.torso.position.y = 0.72 + bob;
      u.head.rotation.x = headTilt;
      const scale = c.id === selectedId ? 1.12 : 1;
      node.scale.setScalar(scale);
      if (c.id === selectedId) {
        this.ring.visible = node.visible;
        this.ring.position.set(node.position.x, 0.05, node.position.z);
        this.ring.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
      }
    }
    if (!citizens.some((c) => c.id === selectedId)) this.ring.visible = false;
  }

  pick(object) {
    while (object) { if (object.userData?.citizenId) return object.userData.citizenId; object = object.parent; }
    return null;
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
