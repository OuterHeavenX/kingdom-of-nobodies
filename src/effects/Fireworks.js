import * as THREE from 'three';

// Fireworks: a fixed pool of GPU particles. A launch writes one shell's
// particles (a rising rocket and its burst) into the pool; from then on the
// shader moves and fades them with the clock alone, so a whole show costs a
// few small buffer uploads. There are no lights and no screen flashes; with
// reduced motion the shells are fewer, slower and softer.

const SHELL = 40; // particles per shell (one is the rocket)
const PALETTES = [['#ffd36b', '#fff2b3'], ['#ff5c8a', '#ffc2d6'], ['#5bc0ff', '#d6f0ff'], ['#7cf08a', '#e2ffd9'], ['#c48bff', '#f0e0ff'], ['#ff8c3a', '#ffe0b3']];

const vertex = /* glsl */`
uniform float uTime;
uniform float uScale;
uniform float uLife;
uniform float uRise;
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec3 aColor;
attribute vec2 aInfo; // x: start time, y: 1 for the rocket
varying vec3 vColor;
varying float vAlpha;
void main() {
  float age = uTime - aInfo.x;
  vec3 p = aOrigin;
  float alpha = 0.0;
  float size = 0.0;
  if (aInfo.y > 0.5) {
    float k = (age + uRise) / uRise;
    if (k > 0.0 && k < 1.0) { p = mix(vec3(aOrigin.x, 0.5, aOrigin.z), aOrigin, k); alpha = 0.9; size = 0.45; }
  } else if (age > 0.0 && age < uLife) {
    float drag = (1.0 - exp(-2.0 * age)) / 2.0;
    p = aOrigin + aVel * drag + vec3(0.0, -1.6 * age * age, 0.0);
    alpha = pow(1.0 - age / uLife, 1.4);
    size = 0.9 * (1.0 - age / uLife * 0.6);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = alpha > 0.0 ? size * uScale / max(1.0, -mv.z) : 0.0;
  vColor = aColor;
  vAlpha = alpha;
}`;

const fragment = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 4.0) * vAlpha;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor, a);
}`;

export class Fireworks {
  constructor(budget, { reducedMotion = false, seed = 7 } = {}) {
    this.shells = Math.max(3, Math.floor(budget / SHELL));
    const n = this.shells * SHELL;
    this.reduced = reducedMotion;
    this.geo = new THREE.BufferGeometry();
    const attr = (size) => new THREE.BufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr(3)); // unused by the shader but required
    for (const [k, s] of [['aOrigin', 3], ['aVel', 3], ['aColor', 3], ['aInfo', 2]]) this.geo.setAttribute(k, attr(s));
    const info = this.geo.attributes.aInfo.array;
    for (let i = 0; i < n; i++) info[i * 2] = -1e6;
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 600 }, uLife: { value: reducedMotion ? 3.4 : 2.4 }, uRise: { value: reducedMotion ? 1.8 : 1.15 } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.next = 0;
    this.queue = [];
    this.time = 0;
    this.endsAt = 0;
    let s = seed >>> 0;
    this.rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    this.shows = 0;
  }

  get object() { return this.points; }
  /** True while a show is running or its last sparks are still falling. */
  get active() { return this.queue.length > 0 || this.time < this.endsAt; }

  /**
   * Schedule a show: `origins` are [x, z] points to burst over, `duration`
   * in real seconds. Shell count follows the pool size and motion setting.
   */
  launchShow({ origins, duration = 24, height = [16, 26] }) {
    const count = Math.round((this.reduced ? 0.35 : 1) * Math.min(this.shells * 3, duration * 1.6));
    for (let i = 0; i < count; i++) {
      const o = origins[i % origins.length];
      const at = this.time + 0.3 + (i / count) * duration + this.rand() * 0.4;
      this.queue.push({ at, x: o[0] + (this.rand() - 0.5) * 10, z: o[1] + (this.rand() - 0.5) * 10, y: height[0] + this.rand() * (height[1] - height[0]) });
    }
    this.queue.sort((a, b) => a.at - b.at);
    // A finale: three together at the end (not in reduced motion).
    if (!this.reduced) for (let k = 0; k < 3; k++) { const o = origins[k % origins.length]; this.queue.push({ at: this.time + duration + 0.8, x: o[0] + (k - 1) * 8, z: o[1], y: height[1] }); }
    this.endsAt = this.time + duration + 6;
    this.shows++;
  }

  burst(b) {
    const start = this.next * SHELL;
    this.next = (this.next + 1) % this.shells;
    const [main, light] = PALETTES[Math.floor(this.rand() * PALETTES.length)];
    const c1 = new THREE.Color(main), c2 = new THREE.Color(light);
    const A = this.geo.attributes;
    const speed = this.reduced ? 5 : 8.5;
    for (let i = 0; i < SHELL; i++) {
      const k = start + i;
      A.aOrigin.array.set([b.x, b.y, b.z], k * 3);
      // Even directions over a sphere (golden spiral), with a little scatter.
      const t = (i + 0.5) / SHELL, inc = Math.acos(1 - 2 * t), az = i * 2.39996;
      const v = speed * (0.85 + this.rand() * 0.3);
      A.aVel.array.set([Math.sin(inc) * Math.cos(az) * v, Math.cos(inc) * v, Math.sin(inc) * Math.sin(az) * v], k * 3);
      const c = i % 3 ? c1 : c2;
      A.aColor.array.set([c.r, c.g, c.b], k * 3);
      A.aInfo.array.set([b.at + this.uniforms.uRise.value, i === 0 ? 1 : 0], k * 2);
    }
    for (const key of ['aOrigin', 'aVel', 'aColor', 'aInfo']) {
      A[key].addUpdateRange?.(start * A[key].itemSize, SHELL * A[key].itemSize);
      A[key].needsUpdate = true;
    }
  }

  update(dt, time, pixelScale = 600) {
    this.time = time;
    this.uniforms.uTime.value = time;
    this.uniforms.uScale.value = pixelScale;
    while (this.queue.length && this.queue[0].at <= time) this.burst(this.queue.shift());
    this.points.visible = this.active;
  }

  stop() { this.queue = []; this.endsAt = this.time; }

  dispose() { this.geo.dispose(); this.material.dispose(); }
}
