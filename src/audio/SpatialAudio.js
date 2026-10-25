// Distance and direction for sounds in the world, without one audio node per
// thing that might make a noise. The listener is the point the camera looks
// at; how far the camera stands back (its zoom) decides whether you hear the
// blacksmith's hammer or only the town's general murmur.

/** 1 when the camera is close (detail audible), 0 when it is far above the town. */
export const detailFor = (zoom) => Math.max(0, Math.min(1, (120 - zoom) / 90));

/**
 * Gain and stereo pan for a sound at (x, z). `listener` = { x, z, zoom, yaw }.
 * Sounds fade with distance from the view centre and with zoom.
 */
export function placeSound(listener, x, z, range = 45) {
  const dx = x - listener.x, dz = z - listener.z;
  const d = Math.hypot(dx, dz);
  const near = Math.max(0, 1 - d / range);
  const zoom = 0.25 + 0.75 * detailFor(listener.zoom ?? 60);
  const gain = near * near * zoom;
  // The camera looks along -z rotated by yaw; pan by the sound's side relative to the view.
  const yaw = listener.yaw ?? 0;
  const side = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const pan = d < 0.01 ? 0 : Math.max(-0.85, Math.min(0.85, side / Math.max(8, d)));
  return { gain, pan, distance: d };
}

/**
 * A small pool of effect voices: limits how many one-shots sound at once and
 * how often the same kind may repeat, so a crowd of builders is a rhythm
 * rather than a din.
 */
export class VoicePool {
  constructor({ max = 8, cooldowns = {} } = {}) {
    this.max = max;
    this.cooldowns = cooldowns;
    this.active = []; // end times
    this.last = {};
    this.played = 0;
    this.skipped = 0;
    this.skippedBy = {};
  }

  /** May a sound of `kind` start at time `now` and last `dur` seconds? Records it if so. */
  claim(kind, now, dur = 1) {
    this.active = this.active.filter((t) => t > now);
    const cd = this.cooldowns[kind] ?? 0.08;
    if (this.active.length >= this.max || (this.last[kind] !== undefined && now - this.last[kind] < cd)) { this.skipped++; this.skippedBy[kind] = (this.skippedBy[kind] ?? 0) + 1; return false; }
    this.active.push(now + dur);
    this.last[kind] = now;
    this.played++;
    return true;
  }
}

export const COOLDOWNS = {
  tap: 0.04, panel: 0.15, select: 0.1, notify: 1.5, coins: 0.6,
  hammer: 0.35, anvil: 1.2, chop: 0.8, crash: 3, farm: 2, road: 1.5,
  horse: 3, cart: 4, car: 1.8, pod: 1.6, bus: 6, tram: 8, whistle: 25, steam: 5, machine: 4, interface: 4,
  bird: 0.9, owl: 12, market: 2.5, townbell: 60, cheer: 4, launch: 0.15, boom: 0.12,
};
