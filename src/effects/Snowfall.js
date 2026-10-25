import { ParticleField } from './AmbientParticles.js';

// Falling snow: two layers of GPU particles (large soft flakes and fine
// powder) so flakes vary in size and opacity and read against both white
// roofs and dark walls. They fall gently in calm weather and drift sideways
// in wind; heavier snowfall shows more flakes, faster. A budget caps the
// total, so a heavy storm costs the same on a phone as a light flurry.

export class Snowfall {
  constructor(budget, { reducedMotion = false } = {}) {
    const n = Math.max(40, Math.round(budget));
    this.reduced = reducedMotion;
    this.big = new ParticleField({ count: Math.round(n * 0.4), area: [80, 34, 80], shape: 'flake', motion: 'fall', colors: ['#ffffff', '#f4f8ff'], size: 0.3, speed: 2.4, opacity: 0.95, seed: 11 });
    this.fine = new ParticleField({ count: Math.round(n * 0.6), area: [110, 40, 110], shape: 'flake', motion: 'fall', colors: ['#ffffff', '#e8f0ff', '#dfe9f7'], size: 0.16, speed: 3.2, opacity: 0.75, seed: 23 });
    this.objects = [this.big.object, this.fine.object];
  }

  /** weather: the day's weather for this place; intensity 0..1. */
  update(dt, time, center, { weather, pixelScale } = {}) {
    const heavy = weather?.intensity ?? 0.5;
    const windy = weather?.kind === 'wind' || heavy > 0.8;
    const calm = this.reduced ? 0.45 : 1;
    const wind = windy ? [1.6 * calm, 0.6 * calm] : [0.25 * calm, 0.1 * calm];
    this.big.update(dt, time, center, { wind, pixelScale, speed: (1.6 + heavy * 1.4) * calm });
    this.fine.update(dt, time, center, { wind, pixelScale, speed: (2.2 + heavy * 2) * calm });
    // Light snow shows fewer flakes by fading the fine layer.
    this.fine.uniforms.uOpacity.value *= 0.35 + heavy * 0.65;
  }

  fadeOut() { this.big.fadeOut(); this.fine.fadeOut(); }
  get faded() { return this.big.faded && this.fine.faded; }
  dispose() { this.big.dispose(); this.fine.dispose(); }
}
