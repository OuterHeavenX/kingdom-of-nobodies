// Synthesised instruments (Web Audio, no sound files). Every voice is a short
// graph of oscillators, noise and filters scheduled at an exact time and then
// left to stop by itself; the music director decides what to play.

const noiseCache = new WeakMap();
/** Two seconds of white noise, shared by every noisy voice in a context. */
export function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  noiseCache.set(ctx, b);
  return b;
}

export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

function env(ctx, t, { a = 0.01, peak = 1, decay = 0.4, sustain = 0, dur = 0.5, release = 0.2 } = {}) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (sustain > 0) {
    g.gain.setTargetAtTime(peak * sustain, t + a, decay / 3);
    g.gain.setValueAtTime(peak * sustain, t + Math.max(a, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, dur) + release);
  } else g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  return g;
}

function osc(ctx, type, f, t, stop, detune = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  o.stop(stop);
  return o;
}

function noise(ctx, t, stop) {
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.loop = true;
  n.start(t, Math.random() * 1.5);
  n.stop(stop);
  return n;
}

function filter(ctx, type, f, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

export const VOICES = {
  /** Lute or guitar: a plucked string, bright at first and darkening. */
  pluck(ctx, out, t, f, dur, v = 0.5) {
    const len = Math.min(1.8, 0.5 + dur);
    const e = env(ctx, t, { a: 0.004, peak: v * 0.5, decay: len });
    const lp = filter(ctx, 'lowpass', 3800, 1.2);
    lp.frequency.setValueAtTime(3800, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.35);
    osc(ctx, 'triangle', f, t, t + len + 0.1).connect(lp);
    const h = ctx.createGain(); h.gain.value = 0.25;
    osc(ctx, 'sawtooth', f, t, t + len + 0.1, 4).connect(h).connect(lp);
    lp.connect(e).connect(out);
  },
  harp(ctx, out, t, f, dur, v = 0.5) {
    const len = 2.4;
    const e = env(ctx, t, { a: 0.006, peak: v * 0.45, decay: len });
    osc(ctx, 'sine', f, t, t + len + 0.1).connect(e);
    const h = ctx.createGain(); h.gain.value = 0.3;
    osc(ctx, 'triangle', f * 2, t, t + len + 0.1).connect(h).connect(e);
    e.connect(out);
  },
  flute(ctx, out, t, f, dur, v = 0.5) {
    const stop = t + dur + 0.3;
    const e = env(ctx, t, { a: 0.07, peak: v * 0.32, decay: 0.2, sustain: 0.85, dur, release: 0.18 });
    const o = osc(ctx, 'sine', f, t, stop);
    const lfo = osc(ctx, 'sine', 5.2, t, stop);
    const depth = ctx.createGain(); depth.gain.value = f * 0.004;
    lfo.connect(depth).connect(o.frequency);
    o.connect(e);
    const breath = ctx.createGain(); breath.gain.value = 0.06;
    noise(ctx, t, stop).connect(filter(ctx, 'bandpass', f * 1.5, 3)).connect(breath).connect(e);
    e.connect(out);
  },
  strings(ctx, out, t, f, dur, v = 0.5) {
    const stop = t + dur + 0.8;
    const e = env(ctx, t, { a: 0.35, peak: v * 0.16, decay: 0.3, sustain: 0.9, dur, release: 0.6 });
    const lp = filter(ctx, 'lowpass', 1700, 0.5);
    for (const d of [-7, 6]) osc(ctx, 'sawtooth', f, t, stop, d).connect(lp);
    lp.connect(e).connect(out);
  },
  cello(ctx, out, t, f, dur, v = 0.5) {
    const stop = t + dur + 0.6;
    const e = env(ctx, t, { a: 0.12, peak: v * 0.22, decay: 0.3, sustain: 0.8, dur, release: 0.4 });
    const lp = filter(ctx, 'lowpass', 900, 0.8);
    osc(ctx, 'sawtooth', f, t, stop).connect(lp);
    lp.connect(e).connect(out);
  },
  piano(ctx, out, t, f, dur, v = 0.5) {
    const len = Math.min(2.6, 1 + dur);
    const e = env(ctx, t, { a: 0.004, peak: v * 0.36, decay: len });
    for (const [m, g] of [[1, 1], [2, 0.38], [3, 0.12], [4.01, 0.05]]) { const k = ctx.createGain(); k.gain.value = g; osc(ctx, m === 1 ? 'triangle' : 'sine', f * m, t, t + len + 0.1).connect(k).connect(e); }
    e.connect(out);
  },
  epiano(ctx, out, t, f, dur, v = 0.5) {
    const len = Math.min(2.2, 0.8 + dur);
    const e = env(ctx, t, { a: 0.005, peak: v * 0.32, decay: len });
    const car = osc(ctx, 'sine', f, t, t + len + 0.1);
    const mod = osc(ctx, 'sine', f * 2, t, t + len + 0.1);
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.2, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.6);
    mod.connect(idx).connect(car.frequency);
    car.connect(e).connect(out);
  },
  bell(ctx, out, t, f, dur, v = 0.5) {
    const len = 2.8;
    const e = env(ctx, t, { a: 0.003, peak: v * 0.22, decay: len });
    for (const [m, g] of [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]]) { const k = ctx.createGain(); k.gain.value = g; osc(ctx, 'sine', f * m, t, t + len + 0.1).connect(k).connect(e); }
    e.connect(out);
  },
  brass(ctx, out, t, f, dur, v = 0.5) {
    const stop = t + dur + 0.4;
    const e = env(ctx, t, { a: 0.05, peak: v * 0.2, decay: 0.2, sustain: 0.8, dur, release: 0.25 });
    const lp = filter(ctx, 'lowpass', 600, 2);
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(2600, t + 0.12);
    lp.frequency.linearRampToValueAtTime(1500, t + dur);
    for (const d of [-5, 5]) osc(ctx, 'sawtooth', f, t, stop, d).connect(lp);
    lp.connect(e).connect(out);
  },
  synth(ctx, out, t, f, dur, v = 0.5) {
    const len = Math.min(1.2, 0.25 + dur);
    const e = env(ctx, t, { a: 0.005, peak: v * 0.22, decay: len });
    const lp = filter(ctx, 'lowpass', 3000, 4);
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + len);
    osc(ctx, 'square', f, t, t + len + 0.1).connect(lp);
    osc(ctx, 'sawtooth', f * 2, t, t + len + 0.1, 7).connect(lp);
    lp.connect(e).connect(out);
  },
  pad(ctx, out, t, f, dur, v = 0.5) {
    const stop = t + dur + 1.6;
    const e = env(ctx, t, { a: 1.1, peak: v * 0.11, decay: 0.5, sustain: 0.9, dur, release: 1.4 });
    const lp = filter(ctx, 'lowpass', 1300, 0.6);
    const lfo = osc(ctx, 'sine', 0.18, t, stop);
    const depth = ctx.createGain(); depth.gain.value = 500;
    lfo.connect(depth).connect(lp.frequency);
    for (const d of [-9, 0, 8]) osc(ctx, 'sawtooth', f, t, stop, d).connect(lp);
    lp.connect(e).connect(out);
  },
  bass(ctx, out, t, f, dur, v = 0.5) {
    const len = Math.min(1.4, 0.3 + dur);
    const e = env(ctx, t, { a: 0.006, peak: v * 0.5, decay: len });
    const lp = filter(ctx, 'lowpass', 520, 1);
    osc(ctx, 'triangle', f, t, t + len + 0.1).connect(lp);
    osc(ctx, 'sine', f / 2, t, t + len + 0.1).connect(lp);
    lp.connect(e).connect(out);
  },
  // --- Percussion ---------------------------------------------------------------------
  kick(ctx, out, t, f, dur, v = 0.5) {
    const e = env(ctx, t, { a: 0.002, peak: v * 0.8, decay: 0.35 });
    const o = osc(ctx, 'sine', 120, t, t + 0.4);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    o.connect(e).connect(out);
  },
  snare(ctx, out, t, f, dur, v = 0.5) {
    const e = env(ctx, t, { a: 0.002, peak: v * 0.4, decay: 0.18 });
    noise(ctx, t, t + 0.25).connect(filter(ctx, 'bandpass', 2000, 0.8)).connect(e).connect(out);
  },
  brush(ctx, out, t, f, dur, v = 0.5) {
    const e = env(ctx, t, { a: 0.03, peak: v * 0.16, decay: 0.22 });
    noise(ctx, t, t + 0.3).connect(filter(ctx, 'bandpass', 3400, 0.6)).connect(e).connect(out);
  },
  hat(ctx, out, t, f, dur, v = 0.5) {
    const e = env(ctx, t, { a: 0.001, peak: v * 0.16, decay: 0.05 });
    noise(ctx, t, t + 0.08).connect(filter(ctx, 'highpass', 7000)).connect(e).connect(out);
  },
  tabor(ctx, out, t, f, dur, v = 0.5) {
    const e = env(ctx, t, { a: 0.002, peak: v * 0.45, decay: 0.28 });
    const o = osc(ctx, 'sine', 170, t, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.2);
    o.connect(e);
    const s = ctx.createGain(); s.gain.value = 0.25;
    noise(ctx, t, t + 0.1).connect(filter(ctx, 'lowpass', 1200)).connect(s).connect(e);
    e.connect(out);
  },
  shaker(ctx, out, t, f, dur, v = 0.5) {
    const e = env(ctx, t, { a: 0.012, peak: v * 0.1, decay: 0.06 });
    noise(ctx, t, t + 0.1).connect(filter(ctx, 'highpass', 5000)).connect(e).connect(out);
  },
  tick(ctx, out, t, f, dur, v = 0.5) {
    const e = env(ctx, t, { a: 0.001, peak: v * 0.12, decay: 0.03 });
    osc(ctx, 'square', 1900, t, t + 0.05).connect(filter(ctx, 'bandpass', 2400, 4)).connect(e).connect(out);
  },
  timpani(ctx, out, t, f, dur, v = 0.5) {
    const e = env(ctx, t, { a: 0.004, peak: v * 0.6, decay: 1.2 });
    const o = osc(ctx, 'sine', f * 1.02, t, t + 1.3);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.15);
    o.connect(e);
    const s = ctx.createGain(); s.gain.value = 0.15;
    noise(ctx, t, t + 0.12).connect(filter(ctx, 'lowpass', 400)).connect(s).connect(e);
    e.connect(out);
  },
};

export { env, osc, noise, filter };
