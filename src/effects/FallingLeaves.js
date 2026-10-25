import { ParticleField } from './AmbientParticles.js';

// Autumn leaves (and spring petals, Valentine's blossoms and New Year's
// confetti, which move the same way): tumbling, spinning shapes that drift
// down through the air on the breeze.

const SETS = {
  leaves: { shape: 'leaf', colors: ['#f08a2a', '#e8c13a', '#d4452c', '#f2a93b', '#b8562a'], size: 0.5 },
  petals: { shape: 'petal', colors: ['#ffd1e8', '#ffffff', '#ffc2d6', '#fff0f6'], size: 0.3 },
  blossom: { shape: 'petal', colors: ['#ff8fc0', '#ff5c93', '#ffc2da', '#ffffff'], size: 0.34 },
  confetti: { shape: 'confetti', colors: ['#ffd36b', '#ff5c8a', '#5bc0ff', '#7cf08a', '#c48bff', '#ffffff'], size: 0.32 },
};

export class FallingLeaves {
  constructor(kind, budget, { reducedMotion = false } = {}) {
    const set = SETS[kind] ?? SETS.leaves;
    this.reduced = reducedMotion;
    this.field = new ParticleField({ count: Math.max(20, Math.round(budget)), area: [70, 22, 70], motion: 'flutter', size: set.size, speed: 1.6, opacity: 0.95, seed: kind.length * 17, ...set });
    this.objects = [this.field.object];
  }

  update(dt, time, center, { weather, pixelScale } = {}) {
    const gust = weather?.kind === 'wind' ? 1.8 : 0.5;
    const calm = this.reduced ? 0.4 : 1;
    this.field.update(dt, time, center, { wind: [gust * calm, 0.4 * gust * calm], pixelScale, speed: 1.6 * calm });
  }

  fadeOut() { this.field.fadeOut(); }
  get faded() { return this.field.faded; }
  dispose() { this.field.dispose(); }
}
