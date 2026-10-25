import * as THREE from 'three';

// A bounded field of particles animated entirely on the GPU: the CPU sets a
// clock and a centre each frame and never touches the particles themselves.
// Particles live in a box that follows the camera target and wraps in world
// space, so they stay put as the view moves and the cost is fixed however
// big the town grows. One shader draws every shape the seasons need: soft
// flakes and glows, hearts, leaves, petals, confetti and butterflies.

export const SHAPES = { flake: 0, heart: 1, leaf: 2, confetti: 3, petal: 4, butterfly: 5, glow: 6 };
export const MOTIONS = { fall: 0, rise: 1, hover: 2, flutter: 3 };

const vertex = /* glsl */`
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uArea;
uniform vec2 uWind;
uniform float uSpeed;
uniform float uSize;
uniform float uScale;
uniform float uMotion;
uniform float uFloor;
attribute vec4 aSeed;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
varying float vFlap;
void main() {
  vec3 p = position;
  float t = uTime * uSpeed;
  float s = 0.6 + aSeed.x * 0.8;
  if (uMotion < 0.5) {            // fall: snow
    p.y = mod(p.y - t * s, uArea.y);
    p.x += sin(uTime * 0.7 + aSeed.y * 6.283) * 0.6 + uWind.x * t * 0.6;
    p.z += cos(uTime * 0.5 + aSeed.z * 6.283) * 0.6 + uWind.y * t * 0.6;
  } else if (uMotion < 1.5) {     // rise: hearts, sparks
    p.y = mod(p.y + t * s, uArea.y);
    p.x += sin(uTime * 1.3 + aSeed.y * 6.283) * 0.5;
  } else if (uMotion < 2.5) {     // hover: fireflies, butterflies
    p.x += sin(uTime * (0.4 + aSeed.y) + aSeed.z * 6.283) * 1.8;
    p.z += cos(uTime * (0.35 + aSeed.z) + aSeed.y * 6.283) * 1.8;
    p.y += sin(uTime * (0.9 + aSeed.x) + aSeed.w * 6.283) * 0.35;
  } else {                        // flutter: leaves, petals, confetti
    p.y = mod(p.y - t * s * 0.45, uArea.y);
    p.x += sin(uTime * (1.1 + aSeed.y) + aSeed.z * 6.283) * 1.4 + uWind.x * t * 0.4;
    p.z += cos(uTime * (0.9 + aSeed.z) + aSeed.y * 6.283) * 1.4 + uWind.y * t * 0.4;
  }
  // Wrap into the box around the view centre (world-space, so particles don't swim with the camera).
  vec3 rel = p + vec3(0.0, uFloor, 0.0) - uCenter;
  rel.xz = mod(rel.xz + uArea.xz * 0.5, uArea.xz) - uArea.xz * 0.5;
  vec3 world = uCenter + rel;
  world.y = p.y + uFloor;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * (0.55 + aSeed.w * 0.9);
  gl_PointSize = size * uScale / max(1.0, -mv.z);
  vColor = aColor;
  float h = p.y / uArea.y;
  vAlpha = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.85, 1.0, h)) * (0.55 + aSeed.x * 0.45);
  if (uMotion > 1.5 && uMotion < 2.5) vAlpha = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed.y * 3.0) + aSeed.z * 20.0);
  vSpin = uTime * (1.0 + aSeed.y * 2.0) + aSeed.z * 6.283;
  vFlap = abs(sin(uTime * (9.0 + aSeed.x * 5.0) + aSeed.w * 6.283));
}`;

const fragment = /* glsl */`
uniform float uShape;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
varying float vFlap;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float a = 0.0;
  if (uShape < 0.5) {               // flake: soft disc
    a = 1.0 - smoothstep(0.35, 1.0, length(q));
  } else if (uShape < 1.5) {        // heart
    vec2 h = q * 1.25; h.y += 0.25;
    float v = pow(h.x * h.x + h.y * h.y - 0.45, 3.0) - h.x * h.x * h.y * h.y * h.y;
    a = 1.0 - smoothstep(-0.02, 0.02, v);
  } else if (uShape < 2.5) {        // leaf: a spinning ellipse with a midrib
    float c = cos(vSpin), s = sin(vSpin);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    float e = (r.x * r.x) / 0.18 + (r.y * r.y) / 0.85;
    a = (1.0 - smoothstep(0.8, 1.0, e)) * (abs(r.x) < 0.04 ? 0.7 : 1.0);
  } else if (uShape < 3.5) {        // confetti: a tumbling rectangle
    float w = 0.15 + 0.55 * abs(cos(vSpin));
    float c = cos(vSpin * 0.7), s = sin(vSpin * 0.7);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    a = step(abs(r.x), w) * step(abs(r.y), 0.32);
  } else if (uShape < 4.5) {        // petal
    float c = cos(vSpin), s = sin(vSpin);
    vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    a = 1.0 - smoothstep(0.75, 1.0, (r.x * r.x) / 0.35 + (r.y * r.y) / 0.6);
  } else if (uShape < 5.5) {        // butterfly: two wing pairs that flap
    float span = 0.25 + 0.75 * vFlap;
    vec2 w = vec2(abs(q.x) / max(0.1, span), q.y);
    float upper = 1.0 - smoothstep(0.5, 0.62, length(w - vec2(0.55, 0.22)));
    float lower = 1.0 - smoothstep(0.32, 0.42, length(w - vec2(0.45, -0.3)));
    float body = step(abs(q.x), 0.06) * step(abs(q.y), 0.5);
    a = max(max(upper, lower), body);
  } else {                          // glow
    float d = length(q);
    a = exp(-d * d * 5.0);
  }
  float alpha = a * vAlpha * uOpacity;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(vColor, alpha);
}`;

function seeded(seed) {
  let t = seed >>> 0;
  return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

/**
 * opts: { count, area: [w, h, d], floor, shape, motion, colors: ['#hex'...],
 *         size, speed, opacity, additive, seed }
 */
export class ParticleField {
  constructor(opts) {
    // size is in world units; pixelScale (from the camera) turns it into pixels at each distance.
    this.opts = { area: [90, 40, 90], floor: 0, size: 0.3, speed: 1, opacity: 1, additive: false, seed: 1, ...opts };
    const { count, area, colors } = this.opts;
    const rand = seeded(this.opts.seed);
    const pos = new Float32Array(count * 3), seed = new Float32Array(count * 4), col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * area[0];
      pos[i * 3 + 1] = rand() * area[1];
      pos[i * 3 + 2] = (rand() - 0.5) * area[2];
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = rand();
      c.set(colors[i % colors.length]);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    this.uniforms = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uArea: { value: new THREE.Vector3(...area) },
      uWind: { value: new THREE.Vector2() }, uSpeed: { value: this.opts.speed }, uSize: { value: this.opts.size },
      uScale: { value: 1 }, uMotion: { value: MOTIONS[this.opts.motion] ?? 0 }, uShape: { value: SHAPES[this.opts.shape] ?? 0 },
      uOpacity: { value: 0 }, uFloor: { value: this.opts.floor },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false,
      blending: this.opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.count = count;
    this.fade = 0; // 0..1, eased towards target
    this.target = 1;
  }

  get object() { return this.points; }

  /** Per frame: move the clock and the centre, ease the fade. Cheap: a handful of uniforms. */
  update(dt, time, center, { wind = null, pixelScale = 600, speed = null } = {}) {
    this.fade += (this.target - this.fade) * Math.min(1, dt * 1.6);
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCenter.value.set(center.x, 0, center.z);
    if (wind) u.uWind.value.set(wind[0], wind[1]);
    if (speed != null) u.uSpeed.value = speed;
    u.uScale.value = pixelScale;
    u.uOpacity.value = this.opts.opacity * this.fade;
    this.points.visible = this.fade > 0.01;
  }

  /** Fade out; `done` once invisible so the owner can dispose. */
  fadeOut() { this.target = 0; }
  get faded() { return this.target === 0 && this.fade < 0.02; }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// --- Ground fog ------------------------------------------------------------------------

const fogVertex = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const fogFragment = /* glsl */`
uniform float uOpacity;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float d = dot(q, q);
  float wobble = 0.85 + 0.15 * sin(uTime * 0.4 + q.x * 3.0 + q.y * 2.0);
  float a = exp(-d * 2.6) * uOpacity * wobble;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/**
 * Low drifting banks of mist: a few large soft discs lying just above the
 * ground around the view (Halloween's eerie fog, winter's cold mist, a foggy
 * morning). A handful of instances, moved on the CPU.
 */
export class GroundFog {
  constructor(count, { color = '#d8dce8', opacity = 0.45, seed = 5 } = {}) {
    const rand = seeded(seed);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.uniforms = { uOpacity: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } };
    const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: fogVertex, fragmentShader: fogFragment, transparent: true, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, material, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.banks = Array.from({ length: count }, () => ({ x: (rand() - 0.5) * 70, z: (rand() - 0.5) * 70, s: 14 + rand() * 16, y: 0.35 + rand() * 0.9, v: 0.3 + rand() * 0.5, a: rand() * 6.28 }));
    this.opacity = opacity;
    this.fade = 0;
    this.target = 1;
    this.m4 = new THREE.Matrix4();
  }
  get object() { return this.mesh; }
  setColor(c) { this.uniforms.uColor.value.set(c); }
  update(dt, time, center, { strength = 1 } = {}) {
    this.fade += (this.target * strength - this.fade) * Math.min(1, dt * 0.8);
    this.uniforms.uOpacity.value = this.opacity * this.fade;
    this.uniforms.uTime.value = time;
    this.mesh.visible = this.fade > 0.01;
    if (!this.mesh.visible) return;
    this.banks.forEach((b, i) => {
      const x = center.x + ((((b.x + Math.cos(b.a) * time * b.v * 0.3) % 80) + 120) % 80) - 40;
      const z = center.z + ((((b.z + Math.sin(b.a) * time * b.v * 0.3) % 80) + 120) % 80) - 40;
      this.m4.makeScale(b.s, 1, b.s * 0.8).setPosition(x, b.y, z);
      this.mesh.setMatrixAt(i, this.m4);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  fadeOut() { this.target = 0; }
  get faded() { return this.target === 0 && this.fade < 0.02; }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
}
