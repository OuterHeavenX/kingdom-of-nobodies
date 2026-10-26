import * as THREE from 'three';

// Weather drawn from the simulation's weather of the day: rain streaks that
// splash where they land, mist and a darker, flatter sky. (Snow is drawn by
// effects/Snowfall, with snow lying on the ground from effects/SnowAccumulation.)
// Drops live in a box that follows the camera target, so the cost is fixed
// however large the town grows, and battery-saver mode cuts it to under half.

const SKY = { clear: 1, rain: 0.62, fog: 0.75, wind: 0.92, snow: 0.8 };
const BOX = 80, HEIGHT = 40;
// Splashes are only drawn near the view centre, where they can be seen.
const SPLASH_RADIUS = 32;
const SPLASH_LIFE = 0.32, SPRAY_LIFE = 0.28;

export class WeatherLayer {
  constructor(scene) {
    this.scene = scene;
    this.kind = null;
    this.rain = null;
    this.budget = 700;
    this.splashBudget = 140;
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
  }

  setQuality(q) {
    this.budget = q === 'high' ? 700 : 300;
    this.splashBudget = q === 'high' ? 140 : 48;
    this.kind = null;
  }

  build(kind) {
    if (this.rain) {
      for (const o of [this.rain.streaks, this.rain.rings, this.rain.spray]) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
      this.rain = null;
    }
    this.kind = kind;
    if (kind !== 'rain') return;
    const n = this.budget;
    // Each drop is a short streak: a line from its head up to its tail.
    const drops = new Float32Array(n * 3);
    const speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      drops[i * 3] = (Math.random() - 0.5) * BOX;
      drops[i * 3 + 1] = Math.random() * HEIGHT;
      drops[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      speed[i] = 28 + Math.random() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    const streaks = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#dbe8f4', transparent: true, opacity: 0.62, depthWrite: false }));
    streaks.frustumCulled = false;
    this.scene.add(streaks);

    // Splash rings spreading on the ground, faded by darkening (additive blending).
    const m = this.splashBudget;
    const ringGeo = new THREE.RingGeometry(0.07, 0.13, 16);
    ringGeo.rotateX(-Math.PI / 2);
    const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), m);
    rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rings.frustumCulled = false;
    for (let i = 0; i < m; i++) { this.dummy.scale.setScalar(0); this.dummy.updateMatrix(); rings.setMatrixAt(i, this.dummy.matrix); rings.setColorAt(i, this.color.setRGB(0, 0, 0)); }
    this.scene.add(rings);

    // A few droplets thrown up by each splash.
    const per = 3;
    const sprayGeo = new THREE.BufferGeometry();
    sprayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m * per * 3).fill(-999), 3));
    const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: '#d8e6f2', size: 0.16, transparent: true, opacity: 0.85, depthWrite: false }));
    spray.frustumCulled = false;
    this.scene.add(spray);

    this.rain = {
      n, drops, speed, streaks, rings, spray, per,
      splash: Array.from({ length: m }, () => ({ age: 9, x: 0, z: 0, size: 1 })),
      sprayV: new Float32Array(m * per * 3),
      next: 0,
    };
  }

  /** Start a splash where a drop landed (world coordinates). */
  splash(x, z, strength) {
    const r = this.rain;
    const i = r.next;
    r.next = (r.next + 1) % r.splash.length;
    const s = r.splash[i];
    s.age = 0; s.x = x; s.z = z; s.size = 0.7 + Math.random() * 0.6 * strength;
    const p = r.spray.geometry.attributes.position.array;
    for (let k = 0; k < r.per; k++) {
      const j = (i * r.per + k) * 3;
      const a = Math.random() * Math.PI * 2, out = 0.6 + Math.random() * 0.9;
      p[j] = x; p[j + 1] = 0.02; p[j + 2] = z;
      r.sprayV[j] = Math.cos(a) * out; r.sprayV[j + 1] = 1.4 + Math.random() * 1.2; r.sprayV[j + 2] = Math.sin(a) * out;
    }
  }

  /** Per frame: move the drops, and tell the caller how much to dim the sky and thicken the fog. */
  update(weather, dt, target, time) {
    const kind = weather?.kind ?? 'clear';
    if (kind !== this.kind) this.build(kind);
    const intensity = weather?.intensity ?? 0.5;
    if (this.rain) this.updateRain(dt, target, intensity);
    return {
      light: kind === 'clear' ? 1 : 1 - (1 - SKY[kind]) * (0.6 + intensity * 0.6),
      fogNear: kind === 'fog' ? 20 + (1 - intensity) * 30 : kind === 'rain' || kind === 'snow' ? 70 : 120,
      fogFar: kind === 'fog' ? 90 + (1 - intensity) * 60 : kind === 'rain' || kind === 'snow' ? 200 : 290,
      wind: kind === 'wind' ? 1 : kind === 'rain' ? 0.5 : 0.15,
    };
  }

  updateRain(dt, target, intensity) {
    const r = this.rain;
    const fall = 0.6 + intensity * 0.6;
    // Streak length follows the fall speed; a light wind slants the rain.
    const len = 0.9 + intensity * 0.8, slant = 0.18;
    const line = r.streaks.geometry.attributes.position.array;
    const near2 = SPLASH_RADIUS * SPLASH_RADIUS;
    for (let i = 0; i < r.n; i++) {
      const j = i * 3;
      r.drops[j + 1] -= r.speed[i] * dt * fall;
      r.drops[j] -= r.speed[i] * dt * fall * slant;
      if (r.drops[j + 1] < 0) {
        const lx = r.drops[j], lz = r.drops[j + 2];
        if (lx * lx + lz * lz < near2 && Math.random() < 0.55 + intensity * 0.4) this.splash(target.x + lx, target.z + lz, intensity);
        r.drops[j + 1] += HEIGHT;
        r.drops[j] = (Math.random() - 0.5) * BOX;
        r.drops[j + 2] = (Math.random() - 0.5) * BOX;
      }
      const x = target.x + r.drops[j], y = r.drops[j + 1], z = target.z + r.drops[j + 2];
      const k = i * 6;
      line[k] = x; line[k + 1] = y; line[k + 2] = z;
      line[k + 3] = x + len * slant; line[k + 4] = y + len; line[k + 5] = z;
    }
    r.streaks.geometry.attributes.position.needsUpdate = true;

    const d = this.dummy;
    for (let i = 0; i < r.splash.length; i++) {
      const s = r.splash[i];
      if (s.age > SPLASH_LIFE + 1) continue;
      s.age += dt;
      const t = Math.min(1, s.age / SPLASH_LIFE);
      d.position.set(s.x, 0.03, s.z);
      d.scale.setScalar(t >= 1 ? 0 : s.size * (1 + t * 4));
      d.updateMatrix();
      r.rings.setMatrixAt(i, d.matrix);
      const fade = t >= 1 ? 0 : (1 - t) * (1 - t);
      r.rings.setColorAt(i, this.color.setRGB(fade * 0.8, fade * 0.86, fade * 0.95));
      if (s.age > SPLASH_LIFE + 0.9) s.age = SPLASH_LIFE + 2;
    }
    r.rings.instanceMatrix.needsUpdate = true;
    if (r.rings.instanceColor) r.rings.instanceColor.needsUpdate = true;

    const p = r.spray.geometry.attributes.position.array;
    for (let i = 0; i < r.splash.length; i++) {
      const s = r.splash[i];
      for (let k = 0; k < r.per; k++) {
        const j = (i * r.per + k) * 3;
        if (s.age > SPRAY_LIFE || p[j + 1] < 0) { p[j + 1] = -999; continue; }
        r.sprayV[j + 1] -= 14 * dt;
        p[j] += r.sprayV[j] * dt; p[j + 1] += r.sprayV[j + 1] * dt; p[j + 2] += r.sprayV[j + 2] * dt;
      }
    }
    r.spray.geometry.attributes.position.needsUpdate = true;
  }

  dispose() { this.build(null); }
}
