import * as THREE from 'three';

// Weather drawn from the simulation's weather of the day: rain streaks, snow
// flakes, mist and a darker, flatter sky. Particles live in a box that
// follows the camera target, so the cost is fixed (a few hundred points)
// however large the town grows, and battery-saver mode halves it.

const SKY = { clear: 1, rain: 0.62, fog: 0.75, wind: 0.92, snow: 0.8 };

export class WeatherLayer {
  constructor(scene) {
    this.scene = scene;
    this.kind = null;
    this.points = null;
    this.speed = null;
    this.budget = 700;
  }

  setQuality(q) { this.budget = q === 'high' ? 700 : 300; this.kind = null; }

  build(kind) {
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); this.points = null; }
    this.kind = kind;
    if (kind !== 'rain' && kind !== 'snow') return;
    const n = kind === 'rain' ? this.budget : Math.round(this.budget * 0.7);
    const pos = new Float32Array(n * 3);
    this.speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 50;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      this.speed[i] = kind === 'rain' ? 28 + Math.random() * 10 : 2.5 + Math.random() * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: kind === 'rain' ? '#bcd3e6' : '#ffffff', size: kind === 'rain' ? 0.18 : 0.42, transparent: true, opacity: kind === 'rain' ? 0.55 : 0.9, depthWrite: false });
    this.points = new THREE.Points(geo, m);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /** Per frame: move the particles, and tell the caller how much to dim the sky and thicken the fog. */
  update(weather, dt, target, time) {
    const kind = weather?.kind ?? 'clear';
    if (kind !== this.kind) this.build(kind);
    if (this.points) {
      this.points.position.set(target.x, 0, target.z);
      const p = this.points.geometry.attributes.position.array;
      const drift = kind === 'snow' ? Math.sin(time * 0.7) * 0.8 : 0;
      for (let i = 0; i < this.speed.length; i++) {
        p[i * 3 + 1] -= this.speed[i] * dt * (0.6 + (weather.intensity ?? 0.5) * 0.6);
        p[i * 3] += drift * dt;
        if (p[i * 3 + 1] < 0) p[i * 3 + 1] += 50;
      }
      this.points.geometry.attributes.position.needsUpdate = true;
    }
    const intensity = weather?.intensity ?? 0.5;
    return {
      light: kind === 'clear' ? 1 : 1 - (1 - SKY[kind]) * (0.6 + intensity * 0.6),
      fogNear: kind === 'fog' ? 20 + (1 - intensity) * 30 : kind === 'rain' || kind === 'snow' ? 70 : 120,
      fogFar: kind === 'fog' ? 90 + (1 - intensity) * 60 : kind === 'rain' || kind === 'snow' ? 200 : 290,
      wind: kind === 'wind' ? 1 : kind === 'rain' ? 0.5 : 0.15,
    };
  }

  dispose() { this.build(null); }
}
