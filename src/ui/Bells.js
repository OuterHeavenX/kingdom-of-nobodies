// New Year's bells, synthesised with Web Audio (no sound files). Off unless
// the player turns "Bells at New Year" on; the audio context is only created
// from that tap, as browsers require.

let ctx = null;

/** Call from a user gesture (the settings toggle) so the browser allows sound. */
export function unlockAudio() {
  try {
    ctx = ctx ?? new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}

/** A few strokes of a church-like bell: a fundamental with inharmonic partials, decaying. */
export function ringBells(strokes = 4) {
  if (!ctx) return false;
  const now = ctx.currentTime + 0.05;
  for (let i = 0; i < strokes; i++) {
    const t = now + i * 1.3;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    master.connect(ctx.destination);
    for (const [ratio, level] of [[1, 1], [2.0, 0.5], [2.76, 0.35], [5.4, 0.18]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 392 * ratio * (i % 2 ? 0.75 : 1);
      g.gain.value = level;
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 3.3);
    }
  }
  return true;
}
