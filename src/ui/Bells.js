// New Year's bells, synthesised with Web Audio (no sound files). Off unless
// the player turns "Bells at New Year" on; the audio context is only created
// from that tap, as browsers require. When the game's own sound is on, the
// bells play through the main mixer instead (AudioManager.bells) and this
// context stays idle.
//
// This second context is suspended whenever it is not ringing: while the game
// is hidden, and a moment after the bells (or the unlocking tap) have died
// away, so an idle context never keeps the phone's audio hardware awake.

let ctx = null;
let idle = null;
let listening = false;

const hidden = () => globalThis.document?.hidden === true;

function rest(ms) {
  clearTimeout(idle);
  idle = setTimeout(() => { idle = null; if (ctx && ctx.state === 'running') ctx.suspend?.().catch?.(() => {}); }, ms);
  idle?.unref?.(); // (Node, in tests)
}

function listen() {
  if (listening || !globalThis.addEventListener) return;
  listening = true;
  const sleep = () => { clearTimeout(idle); idle = null; if (ctx && ctx.state === 'running') ctx.suspend?.().catch?.(() => {}); };
  globalThis.document?.addEventListener?.('visibilitychange', () => { if (hidden()) sleep(); });
  globalThis.addEventListener('pagehide', sleep);
}

/** Call from a user gesture (the settings toggle) so the browser allows sound. */
export function unlockAudio() {
  try {
    ctx = ctx ?? new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
    listen();
    if (ctx.state === 'suspended') ctx.resume();
    rest(2000);
  } catch { ctx = null; }
}

/** A few strokes of a church-like bell: a fundamental with inharmonic partials, decaying. */
export function ringBells(strokes = 4) {
  if (!ctx || hidden()) return false;
  const play = () => {
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
      setTimeout(() => { try { master.disconnect(); } catch { /* ignore */ } }, ((t - ctx.currentTime) + 3.5) * 1000)?.unref?.();
    }
    rest(((strokes - 1) * 1.3 + 3.6) * 1000);
  };
  clearTimeout(idle);
  if (ctx.state === 'running') play();
  else Promise.resolve(ctx.resume()).then(play, () => {});
  return true;
}

/** For tests: forget the context. */
export function resetBells() { clearTimeout(idle); idle = null; ctx = null; }

/** For tests and the audio panel: the bells context's state. */
export const bellsState = () => ctx?.state ?? 'not started';
