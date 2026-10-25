import { ParticleField } from './AmbientParticles.js';

// Valentine's Day hearts rising gently through the town (and, sharing the same
// rising motion, the solstice bonfires' sparks), kept low so they float past
// windows and between the houses rather than filling the sky.

const SETS = {
  hearts: { shape: 'heart', colors: ['#ff4d7d', '#ff8fb1', '#ff2e63', '#ffc2d6'], size: 1.1, area: [60, 14, 60], opacity: 0.9, additive: false },
  sparks: { shape: 'glow', colors: ['#ffb347', '#ff7a2a', '#ffe08a'], size: 0.22, area: [3.2, 8, 3.2], opacity: 1, additive: true },
};

export class FloatingHearts {
  constructor(budget, { kind = 'hearts', reducedMotion = false, center = null } = {}) {
    const set = SETS[kind] ?? SETS.hearts;
    this.reduced = reducedMotion;
    this.anchor = center; // sparks stay over their bonfire; hearts follow the view
    this.field = new ParticleField({ count: Math.max(16, Math.round(budget)), motion: 'rise', speed: 0.9, seed: kind === 'hearts' ? 41 : 43, ...set });
    this.objects = [this.field.object];
  }

  update(dt, time, center, { pixelScale } = {}) {
    this.field.update(dt, time, this.anchor ?? center, { pixelScale, speed: this.reduced ? 0.35 : 0.9 });
  }

  fadeOut() { this.field.fadeOut(); }
  get faded() { return this.field.faded; }
  dispose() { this.field.dispose(); }
}
