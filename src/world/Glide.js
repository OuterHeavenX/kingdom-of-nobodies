// Drawn movers (villagers, vehicles) glide at a steady pace from where they
// are drawn to their latest simulated position, taking one tick's worth of
// real time to get there. At slow game speeds a tick lasts a second or more,
// so chasing the target exponentially would look like hurry, stop, hurry.

/**
 * Move `node` toward (x, z). `u` holds the glide state (usually node.userData),
 * `tickSeconds` is the real time one simulation tick takes at the current speed.
 * Far jumps (teleports, a long vehicle hop) snap. Returns the distance left.
 */
export function glide(node, u, x, z, dt, tickSeconds, snap) {
  if (u.gx !== x || u.gz !== z) {
    u.fx = node.position.x; u.fz = node.position.z;
    u.gx = x; u.gz = z;
    u.gt = 0;
  }
  if (Math.hypot(x - node.position.x, z - node.position.z) > snap) {
    node.position.set(x, 0, z);
    u.gt = 1;
    return 0;
  }
  u.gt = Math.min(1, u.gt + dt / Math.max(1e-3, tickSeconds));
  node.position.x = u.fx + (x - u.fx) * u.gt;
  node.position.z = u.fz + (z - u.fz) * u.gt;
  return Math.hypot(x - node.position.x, z - node.position.z);
}
