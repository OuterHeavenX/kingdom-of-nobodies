import * as THREE from 'three';
import { G, mat, part, PALETTE as P } from './Materials.js';
import { GLYPHS, glyphsFor } from '../divine/Config.js';

// v0.5.3 — what the Hidden Hand looks like. The Mysterious Stone (weathered,
// mossy, carved with an original script that glows faintly at night), what
// villagers build around it, the placement preview, omen effects and the
// small golden motes that tell the player a blessing was given. Everything
// here is drawn from simulation state or a player action; it never changes
// the simulation, and constant spectacle is avoided so the mystery holds.

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const OMEN_SECONDS = 16;

/** A soft round dot (for motes, glows and stars), drawn once on a canvas. */
let dotTexture = null;
function dot() {
  if (dotTexture) return dotTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,248,220,1)');
  grad.addColorStop(0.35, 'rgba(241,217,145,0.7)');
  grad.addColorStop(1, 'rgba(241,217,145,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTexture = new THREE.CanvasTexture(c);
  dotTexture.colorSpace = THREE.SRGBColorSpace;
  return dotTexture;
}

/** A small deterministic random sequence (the same stone looks the same on every device). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0; return (s >>> 8) / 16777216; };
}

/** The monument: an irregular standing stone, weathered and cracked, mossy at the foot. */
function stoneBody(seed) {
  const rand = seeded(seed);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 0.86 + rand() * 0.22;
    v.multiplyScalar(k);
    // Tall, slightly tapering, with a flattened carving face towards +z.
    const taper = 1 - (v.y + 1) * 0.12;
    v.set(v.x * 0.82 * taper, v.y * 1.75 + 1.75, Math.min(v.z, 0.82) * 0.52 * taper);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  // Weathered grey with moss creeping up from the ground and lichen flecks.
  const p = flat.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color(), moss = new THREE.Color('#5d7a43'), grey = new THREE.Color('#aaa699'), dark = new THREE.Color('#77736a');
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const r = rand();
    c.copy(grey).lerp(dark, r * 0.55);
    if (y < 0.45 + r * 0.5) c.lerp(moss, 0.45 + r * 0.25);
    else if (r > 0.86) c.lerp(new THREE.Color('#b9b48f'), 0.5);
    for (let k = 0; k < 3; k++) { colors[(i + k) * 3] = c.r; colors[(i + k) * 3 + 1] = c.g; colors[(i + k) * 3 + 2] = c.b; }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.dispose();
  return flat;
}

/** Where the dressed, carved panel sits on each face of the stone. */
const PANEL = { w: 1.12, h: 1.62, d: 0.18, y: 2.42, z: 0.3 };

/** The carved script as thin quads on both dressed faces (one geometry, one material). */
function carving(inscription) {
  const seq = glyphsFor(inscription);
  const verts = [];
  const cols = 4, cell = 0.25, w = 0.028, x0 = -cols * cell / 2 + 0.02, y0 = PANEL.y + PANEL.h / 2 - 0.08;
  for (const side of [1, -1]) {
    const z = side * (PANEL.z + PANEL.d / 2 + 0.012);
    seq.forEach((g, i) => {
      const ox = x0 + (i % cols) * cell, oy = y0 - Math.floor(i / cols) * cell * 1.2;
      for (const [ax, ay, bx, by] of GLYPHS[g]) {
        const x1 = side * (ox + ax * cell * 0.8), y1 = oy - ay * cell * 0.8, x2 = side * (ox + bx * cell * 0.8), y2 = oy - by * cell * 0.8;
        const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * w, ny = (dx / len) * w;
        verts.push(x1 + nx, y1 + ny, z, x1 - nx, y1 - ny, z, x2 + nx, y2 + ny, z, x2 + nx, y2 + ny, z, x1 - nx, y1 - ny, z, x2 - nx, y2 - ny, z);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return g;
}

/** A few cracks: dark hairlines across the face. */
function cracks(seed) {
  const rand = seeded(seed + 99);
  const verts = [];
  for (let k = 0; k < 4; k++) {
    let x = (rand() - 0.5) * 0.9, y = 0.7 + rand() * 2.6;
    for (let s = 0; s < 4; s++) {
      const nx = x + (rand() - 0.5) * 0.18, ny = y - 0.08 - rand() * 0.14;
      const w = 0.012;
      verts.push(x - w, y, 0.44, x + w, y, 0.44, nx + w, ny, 0.44, nx + w, ny, 0.44, x - w, y, 0.44, nx - w, ny, 0.44);
      x = nx; y = ny;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return g;
}

export class HiddenHandLayer {
  constructor(world) {
    this.world = world;
    this.root = new THREE.Group();
    this.root.userData.noBake = true;
    world.village.add(this.root);
    this.key = '';
    this.stone = null;
    this.effects = [];
    this.seen = new Set();
    this.placing = null;
    this.preview = null;
    this.glyphMat = new THREE.MeshBasicMaterial({ color: '#ffe7a3', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    this.crackMat = new THREE.MeshBasicMaterial({ color: '#2e2b27', side: THREE.DoubleSide });
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 });
    this.lanternMat = new THREE.MeshStandardMaterial({ color: '#fff0c0', emissive: '#ffd27a', emissiveIntensity: 0.2, roughness: 0.4 });
    this.glow = null;
    this.motes = null;
    this.pulse = 0;
  }

  // --- The stone and its surroundings ------------------------------------------------------

  /** Rebuild the monument when the stone or its surroundings change. */
  sync(force = false) {
    const st = this.world.sim.state.divine?.stone;
    const key = st ? `${st.id}:${st.inscription}:${st.x}:${st.z}:${Object.keys(st.site).sort().join(',')}` : '';
    if (!force && key === this.key) return;
    this.key = key;
    if (this.stone) { this.root.remove(this.stone); this.stone.traverse((o) => { if (o.userData.own) o.geometry.dispose(); }); this.stone = null; }
    if (!st) return;
    const g = new THREE.Group();
    g.position.set(st.x, 0, st.z);
    g.rotation.y = st.rotation ?? 0;
    const seed = (st.inscription.length * 7919 + Math.round(st.x * 13) + Math.round(st.z * 31)) >>> 0;
    const raise = st.site.plinth ? 0.45 : 0;
    const body = new THREE.Mesh(stoneBody(seed), this.bodyMat);
    body.position.y = raise; body.castShadow = true; body.receiveShadow = true; body.userData.own = true;
    const carved = new THREE.Mesh(carving(st.inscription), this.glyphMat);
    carved.position.y = raise; carved.userData.own = true;
    const crack = new THREE.Mesh(cracks(seed), this.crackMat);
    crack.position.y = raise; crack.userData.own = true;
    // A dressed face on each side carries the inscription.
    for (const side of [1, -1]) part(g, G.box(), mat('#b9b5a8'), [PANEL.w, PANEL.h, PANEL.d], [0, PANEL.y + raise, side * PANEL.z], null, true);
    g.add(body, carved, crack);
    // Rubble and moss at the foot.
    const rand = seeded(seed + 7);
    for (let i = 0; i < 7; i++) { const a = rand() * Math.PI * 2, r = 0.75 + rand() * 0.5; part(g, G.dodeca(), mat(i % 3 ? P.stoneDark : '#6d7a52'), [0.22 + rand() * 0.2, 0.12 + rand() * 0.1, 0.2 + rand() * 0.2], [Math.cos(a) * r, 0.06 + raise, Math.sin(a) * r], [rand(), rand(), rand()], false); }
    part(g, G.disc(), mat('#5f7d45'), [2.2, 1, 1.8], [0, 0.02, 0], null, false);
    this.site(g, st.site, raise);
    // A soft glow around the carving at night, and a few rising motes.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color: '#ffe08a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(4.2, 5.6, 1); glow.position.set(0, 2.4 + raise, 0.3);
    g.add(glow);
    this.glow = glow;
    this.motes = this.moteCloud(REDUCED ? 6 : 18, 1.1, 3.9 + raise);
    g.add(this.motes.points);
    g.traverse((o) => { o.userData.stone = true; });
    this.root.add(g);
    this.stone = g;
  }

  /** What villagers paid to build around the stone, as recorded in its `site`. */
  site(g, site, raise) {
    if (site.plinth) { part(g, G.box(), mat('#b8b1a2'), [1.9, 0.45, 1.3], [0, 0.22, 0]); part(g, G.box(), mat('#a8874a', { metalness: 0.4 }), [0.6, 0.3, 0.04], [0, 0.25, 0.67], null, false); }
    if (site.offerings) {
      const rand = seeded(17);
      for (let i = 0; i < 9; i++) { const a = -0.9 + rand() * 1.8, r = 0.75 + rand() * 0.3; part(g, G.sphere(6), mat(['#f2d36b', '#e88aa0', '#f4f1e6', '#b48bff'][i % 4]), [0.09, 0.09, 0.09], [Math.sin(a) * r, 0.08 + raise, Math.cos(a) * r], null, false); }
      part(g, G.cyl(8), mat('#efe6d0'), [0.08, 0.18, 0.08], [0.35, 0.1 + raise, 0.62], null, false);
    }
    if (site.fence) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; part(g, G.box(), mat(P.timberDark), [0.08, 0.7, 0.08], [Math.cos(a) * 2.3, 0.35, Math.sin(a) * 2.3], null, false); part(g, G.box(), mat(P.timber), [1.2, 0.06, 0.06], [Math.cos(a + 0.26) * 2.25, 0.55, Math.sin(a + 0.26) * 2.25], [0, -a - 0.26 + Math.PI / 2, 0], false); }
    if (site.lanterns) for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i / 4) * Math.PI * 2; part(g, G.cyl(6), mat(P.iron), [0.07, 1.4, 0.07], [Math.cos(a) * 1.8, 0.7, Math.sin(a) * 1.8], null, false); part(g, G.box(), this.lanternMat, [0.2, 0.26, 0.2], [Math.cos(a) * 1.8, 1.5, Math.sin(a) * 1.8], null, false); }
    if (site.pavilion) {
      for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) part(g, G.cyl(8), mat('#e9e6df'), [0.16, 4.6, 0.16], [x, 2.3, z]);
      part(g, G.box(), mat('#cfe6ee', { transparent: true, opacity: 0.35, metalness: 0.2, roughness: 0.15 }), [3.8, 0.12, 3.8], [0, 4.65, 0], null, false);
    }
    if (site.observatory) { part(g, G.cyl(12), mat('#d9d6cf'), [2.2, 1.8, 2.2], [-5.5, 0.9, -1.5]); part(g, G.sphere(12), mat('#9fb0bd', { metalness: 0.5, roughness: 0.3 }), [2.1, 2.1, 2.1], [-5.5, 1.8, -1.5]); part(g, G.box(), mat('#1d2630'), [0.4, 0.9, 0.12], [-5.5, 2.4, -0.5], null, false); }
    if (site.museum) { part(g, G.box(), mat('#efece6'), [5.5, 2.6, 3.4], [5.8, 1.3, -1]); part(g, G.box(), mat('#9ec8d8', { transparent: true, opacity: 0.55, metalness: 0.3, roughness: 0.1 }), [5.2, 1.9, 0.08], [5.8, 1.15, 0.72], null, false); part(g, G.box(), mat('#cfc8b8'), [5.9, 0.2, 3.8], [5.8, 2.7, -1]); }
    if (site.garden) for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; part(g, G.sphere(7), mat(i % 2 ? P.leaf : '#7fae6a'), [0.6, 0.45, 0.6], [Math.cos(a) * 3.4, 0.22, Math.sin(a) * 3.4], null, false); }
  }

  /** A tiny cloud of golden motes that rise and fade, recycled. */
  moteCloud(count, radius, height) {
    const pos = new Float32Array(count * 3);
    const life = new Float32Array(count);
    for (let i = 0; i < count; i++) { life[i] = i / count; pos[i * 3] = (Math.random() - 0.5) * radius; pos[i * 3 + 1] = life[i] * height; pos[i * 3 + 2] = (Math.random() - 0.5) * radius; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot(), color: '#f1d991', size: 0.22, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    points.userData.own = true;
    points.frustumCulled = false;
    return { points, life, radius, height, count };
  }

  stepMotes(m, dt, speed = 0.12) {
    if (!m || REDUCED) return;
    const pos = m.points.geometry.attributes.position;
    for (let i = 0; i < m.count; i++) {
      m.life[i] += dt * speed;
      if (m.life[i] > 1) { m.life[i] = 0; pos.setX(i, (Math.random() - 0.5) * m.radius); pos.setZ(i, (Math.random() - 0.5) * m.radius); }
      pos.setY(i, m.life[i] * m.height);
    }
    pos.needsUpdate = true;
  }

  // --- Per frame ----------------------------------------------------------------------------------

  update(dt, time, night = 0) {
    if (time - (this.lastSync ?? -9) > 0.6) { this.sync(); this.catchUpOmens(); this.lastSync = time; }
    if (this.stone) {
      this.pulse = Math.max(0, this.pulse - dt * 0.08);
      const glow = Math.min(1, 0.08 + night * 0.5 + this.pulse);
      this.glyphMat.opacity = Math.min(1, 0.3 + glow * 0.75 + (REDUCED ? 0 : Math.sin(time * 0.9) * 0.04));
      this.glow.material.opacity = glow * 0.42;
      this.lanternMat.emissiveIntensity = 0.15 + night * 1.6;
      this.stepMotes(this.motes, dt);
      this.motes.points.material.opacity = 0.25 + night * 0.6 + this.pulse * 0.5;
    }
    if (this.preview) this.preview.rotation.y += dt * 0.6;
    for (const e of [...this.effects]) {
      const t = (performance.now() / 1000 - e.start) / e.dur;
      if (t >= 1) { this.root.remove(e.group); e.group.traverse((o) => { if (o.userData.own) { o.geometry?.dispose(); o.material?.dispose?.(); } }); this.effects.splice(this.effects.indexOf(e), 1); continue; }
      e.update(t, dt, time);
    }
  }

  // --- Placement -----------------------------------------------------------------------------------

  startPlacing(onPick) { this.placing = { onPick }; }
  stopPlacing() { this.placing = null; if (this.preview) { this.root.remove(this.preview); this.preview = null; } }

  setPreview(x, z, ok) {
    if (!this.preview) {
      const g = new THREE.Group();
      const ghost = new THREE.Mesh(stoneBody(42), new THREE.MeshStandardMaterial({ color: '#f1d991', transparent: true, opacity: 0.45, flatShading: true, depthWrite: false }));
      ghost.userData.own = true;
      const ring = new THREE.Mesh(G.ring(), new THREE.MeshBasicMaterial({ color: '#5ee6a0', transparent: true, opacity: 0.85, depthWrite: false }));
      ring.scale.set(3.4, 1, 3.4); ring.position.y = 0.05; ring.name = 'ring';
      g.add(ghost, ring);
      this.root.add(g);
      this.preview = g;
    }
    this.preview.position.set(x, 0, z);
    this.preview.getObjectByName('ring').material.color.set(ok ? '#5ee6a0' : '#ff8a8a');
    this.preview.children[0].material.color.set(ok ? '#f1d991' : '#ff8a8a');
  }

  /** While placing, a tap on the land chooses the spot (returns true when it handled the tap). */
  pickPlacement(raycaster) {
    if (!this.placing) return false;
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) this.placing.onPick(Math.round(hit.x * 10) / 10, Math.round(hit.z * 10) / 10);
    return true;
  }

  /** Was the stone tapped? */
  pick(raycaster) { return !!this.stone && raycaster.intersectObject(this.stone, true).some((h) => h.object.userData.stone); }

  // --- Blessing feedback and omens --------------------------------------------------------------

  /** Golden motes rising at (x, z): the player's own sign that a blessing was given. Nobody in the world sees it. */
  blessingMotes(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const m = this.moteCloud(REDUCED ? 8 : 26, 1.4, 3);
    g.add(m.points);
    this.effects.push({ group: g, start: performance.now() / 1000, dur: 4, update: (t, dt) => { this.stepMotes(m, dt, 0.6); m.points.material.opacity = Math.sin(t * Math.PI) * 0.9; } });
    this.root.add(g);
  }

  /** Omens created elsewhere (or before a reload) are still drawn if they are recent. */
  catchUpOmens() {
    const s = this.world.sim.state;
    for (const o of s.divine?.omens ?? []) if (!this.seen.has(o.id) && s.tick - o.tick <= 18) this.playOmen(o);
  }

  playOmen(o) {
    if (this.seen.has(o.id)) return;
    this.seen.add(o.id);
    const make = OMEN_FX[o.kind];
    if (!make) return;
    const fx = make(this, o);
    fx.start = performance.now() / 1000;
    fx.dur = fx.dur ?? OMEN_SECONDS;
    this.effects.push(fx);
    this.root.add(fx.group);
    if (o.kind === 'stoneglow' || o.kind === 'tone') this.pulse = 1;
  }
}

const fade = (t) => Math.min(1, t * 5) * Math.min(1, (1 - t) * 3);
const own = (o) => { o.userData.own = true; return o; };
const glowMat = (color, opacity = 0.5) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

/** One small factory per omen. Each returns { group, update(t), dur? } with t in 0..1. */
const OMEN_FX = {
  skylights(layer, o) {
    const g = new THREE.Group();
    const target = layer.world.controls.target;
    // Ribbons of light hung over the view, low enough to be seen from the usual high camera.
    g.position.set(target.x, 0, target.z);
    const ribbons = [];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.PlaneGeometry(90, 9, 40, 1);
      const m = own(new THREE.Mesh(geo, glowMat(['#5ee6a0', '#8fb6ff', '#b48bff'][i], 0)));
      m.position.set((i - 1) * 6, 18 + i * 4, -10 - i * 7);
      m.rotation.set(-1.1, 0.25 * (i - 1), 0);
      g.add(m);
      ribbons.push({ m, base: geo.attributes.position.array.slice() });
    }
    return { group: g, update: (t, dt, time) => { for (const [i, r] of ribbons.entries()) { r.m.material.opacity = fade(t) * 0.32; if (REDUCED) continue; const p = r.m.geometry.attributes.position; for (let k = 0; k < p.count; k++) p.setZ(k, r.base[k * 3 + 2] + Math.sin(r.base[k * 3] * 0.08 + time * 0.7 + i) * 3); p.needsUpdate = true; } } };
  },
  stoneglow(layer, o) {
    const g = new THREE.Group();
    g.position.set(o.x, 0, o.z);
    const pillar = own(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.4, 22, 16, 1, true), glowMat('#f1d991', 0)));
    pillar.position.y = 11;
    g.add(pillar);
    return { group: g, update: (t) => { pillar.material.opacity = fade(t) * 0.22; } };
  },
  rainbow(layer, o) {
    const g = new THREE.Group();
    const target = layer.world.controls.target;
    g.position.set(target.x, 0, target.z - 70);
    const colors = ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#7950f2'];
    const arcs = [];
    for (const [r, strength] of [[48, 0.32], [56, 0.16]]) colors.forEach((c, i) => {
      const m = own(new THREE.Mesh(new THREE.TorusGeometry(r - i * 0.9, 0.45, 4, 64, Math.PI), glowMat(strength === 0.16 ? colors[colors.length - 1 - i] : c, 0)));
      g.add(m);
      arcs.push({ m, strength });
    });
    return { group: g, update: (t) => { for (const a of arcs) a.m.material.opacity = fade(t) * a.strength; } };
  },
  bloom(layer, o) {
    const g = new THREE.Group();
    g.position.set(o.x, 0, o.z);
    const n = 70;
    const flowers = own(new THREE.InstancedMesh(G.sphere(6).clone(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), n));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const spots = [];
    const rand = seeded(o.tick ?? 1);
    for (let i = 0; i < n; i++) { const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 6; spots.push([Math.cos(a) * r, Math.sin(a) * r, rand()]); flowers.setColorAt(i, c.set(['#f2d36b', '#e88aa0', '#f4f1e6', '#b48bff', '#ff9f6b'][i % 5])); }
    g.add(flowers);
    return { group: g, dur: 26, update: (t) => { for (let i = 0; i < n; i++) { const [x, z, d] = spots[i]; const s = Math.max(0, Math.min(1, (t * 6 - d))) * Math.min(1, (1 - t) * 4) * 0.22; m4.compose(new THREE.Vector3(x, s * 0.6, z), q, new THREE.Vector3(s, s, s)); flowers.setMatrixAt(i, m4); } flowers.instanceMatrix.needsUpdate = true; } };
  },
  tone(layer, o) {
    const g = new THREE.Group();
    g.position.set(o.x, 0.1, o.z);
    const rings = [0, 1, 2].map(() => { const m = own(new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), glowMat('#f1d991', 0))); g.add(m); return m; });
    return { group: g, dur: 8, update: (t) => rings.forEach((m, i) => { const k = (t * 1.5 - i * 0.25); const s = 1 + Math.max(0, k) * 14; m.scale.set(s, 1, s); m.material.opacity = k > 0 && k < 1 ? (1 - k) * 0.5 : 0; }) };
  },
  stars(layer, o) {
    const g = new THREE.Group();
    const target = layer.world.controls.target;
    g.position.set(target.x, 0, target.z);
    const streaks = [];
    const rand = seeded(o.tick ?? 3);
    for (let i = 0; i < 9; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-3.5, -1.4, 0)]);
      const line = own(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#fff6d8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending })));
      const from = new THREE.Vector3((rand() - 0.3) * 60, 22 + rand() * 12, -10 - rand() * 25);
      line.position.copy(from);
      g.add(line);
      streaks.push({ line, from, delay: rand() * 0.7 });
    }
    return { group: g, dur: 10, update: (t) => { for (const s of streaks) { const k = (t - s.delay) * 4; const on = k > 0 && k < 1; s.line.material.opacity = on ? (1 - k) * 0.9 : 0; if (on && !REDUCED) s.line.position.set(s.from.x - k * 30, s.from.y - k * 12, s.from.z); } } };
  },
  clouds(layer, o) {
    const g = new THREE.Group();
    const target = layer.world.controls.target;
    g.position.set(target.x + 6, 22, target.z - 14);
    const puffs = [];
    for (let i = 0; i < 16; i++) { const a = i * 0.7, r = 1.5 + i * 0.75; const m = own(new THREE.Mesh(G.sphere(8).clone(), new THREE.MeshStandardMaterial({ color: '#f4f4f0', transparent: true, opacity: 0, roughness: 1 }))); m.scale.setScalar(2.4 + (i % 3)); m.position.set(Math.cos(a) * r, Math.sin(i) * 0.6, Math.sin(a) * r); g.add(m); puffs.push(m); }
    return { group: g, dur: 22, update: (t, dt) => { for (const m of puffs) m.material.opacity = fade(t) * 0.75; if (!REDUCED) g.rotation.y += dt * 0.05; } };
  },
  calm(layer, o) {
    const g = new THREE.Group();
    const target = layer.world.controls.target;
    g.position.set(target.x, 0, target.z);
    const cone = own(new THREE.Mesh(new THREE.CylinderGeometry(3, 14, 60, 24, 1, true), glowMat('#fff1c4', 0)));
    cone.position.y = 30;
    g.add(cone);
    return { group: g, dur: 20, update: (t) => { cone.material.opacity = fade(t) * 0.12; } };
  },
};
