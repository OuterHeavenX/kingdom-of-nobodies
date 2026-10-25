import * as THREE from 'three';

// Halloween's friendly low-poly ghosts, drifting and bobbing near chosen
// buildings, and the occasional bats wheeling overhead. Playful, not
// frightening: round bodies, big dark eyes, a soft glow. Their numbers come
// from the graphics budget and their motion calms with reduced motion.

function seeded(seed) {
  let t = seed >>> 0;
  return () => { t = (t * 1664525 + 1013904223) >>> 0; return t / 4294967296; };
}

export class Ghosts {
  /** anchors: [x, z] points (beside the hall, the square and a few houses) the ghosts drift around. */
  constructor(anchors, { ghosts = 6, bats = 8, reducedMotion = false, seed = 31 } = {}) {
    const rand = seeded(seed);
    this.group = new THREE.Group();
    this.reduced = reducedMotion;
    this.body = new THREE.MeshStandardMaterial({ color: '#f4f6ff', emissive: '#c9d4ff', emissiveIntensity: 0.35, transparent: true, opacity: 0.86, roughness: 0.6, flatShading: true });
    this.eye = new THREE.MeshBasicMaterial({ color: '#1b1630' });
    this.batMat = new THREE.MeshStandardMaterial({ color: '#241a33', roughness: 0.9, flatShading: true });
    this.geos = [new THREE.SphereGeometry(0.6, 10, 8), new THREE.ConeGeometry(0.62, 1.1, 10, 1, true), new THREE.SphereGeometry(0.11, 6, 4), new THREE.BoxGeometry(0.28, 0.2, 0.42), new THREE.ConeGeometry(0.5, 0.06, 3)];
    const [head, skirt, eyeG, batBody, wing] = this.geos;
    this.ghosts = [];
    for (let i = 0; i < Math.min(ghosts, anchors.length * 2); i++) {
      const g = new THREE.Group();
      const top = new THREE.Mesh(head, this.body); top.position.y = 0.75; g.add(top);
      const tail = new THREE.Mesh(skirt, this.body); tail.position.y = 0.2; tail.rotation.x = Math.PI; g.add(tail);
      for (const s of [-1, 1]) { const e = new THREE.Mesh(eyeG, this.eye); e.position.set(s * 0.2, 0.85, 0.52); e.scale.set(1, 1.4, 0.6); g.add(e); }
      const [ax, az] = anchors[i % anchors.length];
      g.userData = { ax, az, r: 1.5 + rand() * 2.5, phase: rand() * 6.28, speed: 0.25 + rand() * 0.3, h: 1.4 + rand() * 1.2 };
      this.group.add(g);
      this.ghosts.push(g);
    }
    this.bats = [];
    for (let i = 0; i < bats; i++) {
      const b = new THREE.Group();
      b.add(new THREE.Mesh(batBody, this.batMat));
      const wings = [-1, 1].map((s) => { const w = new THREE.Mesh(wing, this.batMat); w.position.x = s * 0.36; w.rotation.z = s * Math.PI / 2; w.scale.set(1, 1, 1.6); b.add(w); return w; });
      b.userData = { wings, r: 14 + rand() * 18, h: 9 + rand() * 7, phase: rand() * 6.28, speed: 0.22 + rand() * 0.25, cx: (rand() - 0.5) * 30, cz: (rand() - 0.5) * 30 };
      this.group.add(b);
      this.bats.push(b);
    }
    this.fade = 0;
    this.target = 1;
  }

  get object() { return this.group; }

  update(dt, time) {
    this.fade += (this.target - this.fade) * Math.min(1, dt * 1.5);
    this.body.opacity = 0.86 * this.fade;
    this.group.visible = this.fade > 0.02;
    const calm = this.reduced ? 0.35 : 1;
    for (const g of this.ghosts) {
      const u = g.userData;
      const a = u.phase + time * u.speed * calm;
      g.position.set(u.ax + Math.cos(a) * u.r, u.h + Math.sin(time * 1.3 * calm + u.phase) * 0.3, u.az + Math.sin(a) * u.r);
      g.rotation.y = -a + Math.PI;
      g.scale.setScalar(this.fade);
    }
    for (const b of this.bats) {
      const u = b.userData;
      const a = u.phase + time * u.speed * calm;
      b.position.set(u.cx + Math.cos(a) * u.r, u.h + Math.sin(a * 3) * 1.2, u.cz + Math.sin(a) * u.r);
      b.rotation.y = -a;
      const flap = this.reduced ? 0.3 : Math.sin(time * 14 + u.phase) * 0.7;
      u.wings[0].rotation.y = flap; u.wings[1].rotation.y = -flap;
      b.scale.setScalar(this.fade);
    }
  }

  fadeOut() { this.target = 0; }
  get faded() { return this.target === 0 && this.fade < 0.03; }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.body.dispose(); this.eye.dispose(); this.batMat.dispose();
  }
}
