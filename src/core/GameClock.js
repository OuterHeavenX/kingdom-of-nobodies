import { TIME } from './Config.js';

// Fixed-step scheduler: rendering runs every animation frame, while the
// simulation advances in whole ticks at a rate set by the game speed.
export class GameClock {
  constructor(onTick) {
    this.onTick = onTick;
    this.paused = false;
    this.speed = 1;
    this.accumulator = 0;
  }
  advance(dtSeconds) {
    if (this.paused) return 0;
    this.accumulator += Math.min(0.25, dtSeconds) * this.speed;
    let ticks = 0;
    while (this.accumulator >= TIME.realSecondsPerTick && ticks < TIME.maxTicksPerFrame) {
      this.onTick();
      this.accumulator -= TIME.realSecondsPerTick;
      ticks++;
    }
    // Drop backlog rather than fast-forwarding silently after a stall.
    if (ticks === TIME.maxTicksPerFrame) this.accumulator = 0;
    return ticks;
  }
  togglePause() { this.paused = !this.paused; }
  cycleSpeed() {
    const i = TIME.speeds.indexOf(this.speed);
    this.speed = TIME.speeds[(i + 1) % TIME.speeds.length];
  }
}
