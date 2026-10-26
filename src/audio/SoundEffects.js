import { env, osc, noise, filter, VOICES, midiHz } from './Instruments.js';

// One-shot sound effects, all synthesised. Each takes (ctx, out, t, p) where
// `out` is already panned and attenuated for its place in the world and `p`
// varies the sound a little (so a crowd of hammers is not one hammer).

const r = () => Math.random();

export const SFX = {
  // --- Interface -----------------------------------------------------------------
  tap(ctx, out, t) { const e = env(ctx, t, { a: 0.002, peak: 0.25, decay: 0.06 }); osc(ctx, 'sine', 880 + r() * 60, t, t + 0.1).connect(e).connect(out); },
  panel(ctx, out, t) { const e = env(ctx, t, { a: 0.01, peak: 0.18, decay: 0.22 }); const o = osc(ctx, 'triangle', 520, t, t + 0.3); o.frequency.exponentialRampToValueAtTime(780, t + 0.16); o.connect(e).connect(out); },
  select(ctx, out, t) { const e = env(ctx, t, { a: 0.002, peak: 0.35, decay: 0.12 }); osc(ctx, 'sine', 310, t, t + 0.15).connect(e); noise(ctx, t, t + 0.05).connect(filter(ctx, 'bandpass', 1800, 2)).connect(e); e.connect(out); },
  notify(ctx, out, t) { VOICES.bell(ctx, out, t, midiHz(79), 0.4, 0.5); VOICES.bell(ctx, out, t + 0.16, midiHz(84), 0.4, 0.4); },
  coins(ctx, out, t) { for (let i = 0; i < 4; i++) { const tt = t + i * 0.05 + r() * 0.03; const e = env(ctx, tt, { a: 0.001, peak: 0.16, decay: 0.18 }); osc(ctx, 'sine', 2200 + r() * 1200, tt, tt + 0.22).connect(e).connect(out); } },
  // --- Work -------------------------------------------------------------------------------
  hammer(ctx, out, t) { const e = env(ctx, t, { a: 0.001, peak: 0.5, decay: 0.12 }); const o = osc(ctx, 'sine', 190 + r() * 40, t, t + 0.15); o.frequency.exponentialRampToValueAtTime(90, t + 0.1); o.connect(e); noise(ctx, t, t + 0.04).connect(filter(ctx, 'bandpass', 2600, 1.5)).connect(e); e.connect(out); },
  anvil(ctx, out, t) { const e = env(ctx, t, { a: 0.001, peak: 0.28, decay: 0.7 }); for (const f of [910, 1432, 2210]) osc(ctx, 'sine', f * (0.98 + r() * 0.04), t, t + 0.8).connect(e); e.connect(out); },
  chop(ctx, out, t) { const e = env(ctx, t, { a: 0.001, peak: 0.45, decay: 0.16 }); noise(ctx, t, t + 0.12).connect(filter(ctx, 'bandpass', 1100, 1.2)).connect(e); osc(ctx, 'sine', 140, t, t + 0.12).connect(e); e.connect(out); },
  crash(ctx, out, t) {
    const e = env(ctx, t, { a: 0.005, peak: 0.6, decay: 1.4 });
    const lp = filter(ctx, 'lowpass', 2400, 0.7);
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(160, t + 1.2);
    noise(ctx, t, t + 1.6).connect(lp).connect(e);
    osc(ctx, 'sine', 55, t, t + 1.2).connect(e);
    e.connect(out);
    for (let i = 0; i < 5; i++) SFX.hammer(ctx, out, t + 0.2 + r() * 0.8);
  },
  farm(ctx, out, t) { const e = env(ctx, t, { a: 0.05, peak: 0.12, decay: 0.4 }); noise(ctx, t, t + 0.5).connect(filter(ctx, 'bandpass', 3800, 0.8)).connect(e).connect(out); },
  road(ctx, out, t) { for (let i = 0; i < 6; i++) { const tt = t + i * 0.07; const e = env(ctx, tt, { a: 0.003, peak: 0.12, decay: 0.06 }); noise(ctx, tt, tt + 0.08).connect(filter(ctx, 'bandpass', 1400 + r() * 600, 1)).connect(e).connect(out); } },
  // --- Movement -----------------------------------------------------------------------------
  horse(ctx, out, t) { for (let i = 0; i < 8; i++) { const tt = t + i * 0.19 + (i % 2) * 0.05; const e = env(ctx, tt, { a: 0.001, peak: 0.18, decay: 0.05 }); osc(ctx, 'sine', i % 2 ? 470 : 610, tt, tt + 0.07).connect(e).connect(out); } },
  cart(ctx, out, t) { for (let i = 0; i < 14; i++) { const tt = t + i * 0.09 + r() * 0.03; const e = env(ctx, tt, { a: 0.001, peak: 0.07, decay: 0.03 }); noise(ctx, tt, tt + 0.04).connect(filter(ctx, 'bandpass', 900, 3)).connect(e).connect(out); } },
  car(ctx, out, t) {
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.22, t + 0.9); e.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const o = osc(ctx, 'sawtooth', 92, t, t + 2.3); o.frequency.linearRampToValueAtTime(70, t + 2.2);
    o.connect(filter(ctx, 'lowpass', 320)).connect(e);
    noise(ctx, t, t + 2.3).connect(filter(ctx, 'bandpass', 700, 0.6)).connect(e);
    e.connect(out);
  },
  pod(ctx, out, t) {
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.12, t + 0.7); e.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const o = osc(ctx, 'sine', 340, t, t + 1.9); o.frequency.linearRampToValueAtTime(260, t + 1.8);
    o.connect(e); noise(ctx, t, t + 1.9).connect(filter(ctx, 'highpass', 2500)).connect(e);
    e.connect(out);
  },
  bus(ctx, out, t) { SFX.car(ctx, out, t); const e = env(ctx, t + 1.1, { a: 0.02, peak: 0.1, decay: 0.5 }); noise(ctx, t + 1.1, t + 1.7).connect(filter(ctx, 'highpass', 3000)).connect(e).connect(out); },
  tram(ctx, out, t) { VOICES.bell(ctx, out, t, midiHz(76), 0.3, 0.35); VOICES.bell(ctx, out, t + 0.22, midiHz(72), 0.3, 0.3); SFX.pod(ctx, out, t + 0.3); },
  whistle(ctx, out, t) {
    const e = env(ctx, t, { a: 0.05, peak: 0.16, decay: 0.3, sustain: 0.8, dur: 1.1, release: 0.3 });
    for (const f of [660, 880]) { const o = osc(ctx, 'sine', f, t, t + 1.6); const lfo = osc(ctx, 'sine', 6, t, t + 1.6); const d = ctx.createGain(); d.gain.value = 6; lfo.connect(d).connect(o.frequency); o.connect(e); }
    noise(ctx, t, t + 1.5).connect(filter(ctx, 'bandpass', 2200, 2)).connect(e);
    e.connect(out);
  },
  steam(ctx, out, t) { for (let i = 0; i < 4; i++) { const tt = t + i * 0.28; const e = env(ctx, tt, { a: 0.01, peak: 0.16, decay: 0.22 }); noise(ctx, tt, tt + 0.3).connect(filter(ctx, 'highpass', 2600)).connect(e).connect(out); } },
  machine(ctx, out, t) { for (let i = 0; i < 6; i++) { const tt = t + i * 0.32; SFX.anvil(ctx, out, tt); const e = env(ctx, tt + 0.16, { a: 0.002, peak: 0.25, decay: 0.12 }); osc(ctx, 'square', 70, tt + 0.16, tt + 0.3).connect(filter(ctx, 'lowpass', 300)).connect(e).connect(out); } },
  interface(ctx, out, t) { for (const [i, f] of [[0, 1180], [1, 1570], [2, 1980]]) { const tt = t + i * 0.09; const e = env(ctx, tt, { a: 0.003, peak: 0.08, decay: 0.12 }); osc(ctx, 'sine', f, tt, tt + 0.14).connect(e).connect(out); } },
  // --- Nature ---------------------------------------------------------------------------------
  bird(ctx, out, t) {
    const n = 2 + Math.floor(r() * 4), base = 2600 + r() * 1800;
    for (let i = 0; i < n; i++) { const tt = t + i * (0.09 + r() * 0.06); const e = env(ctx, tt, { a: 0.004, peak: 0.08, decay: 0.07 }); const o = osc(ctx, 'sine', base, tt, tt + 0.1); o.frequency.exponentialRampToValueAtTime(base * (1.2 + r() * 0.4), tt + 0.05); o.connect(e).connect(out); }
  },
  owl(ctx, out, t) { for (const [i, d] of [[0, 0.32], [1, 0.5]]) { const tt = t + i * 0.55; const e = env(ctx, tt, { a: 0.06, peak: 0.12, decay: d }); osc(ctx, 'sine', 380 - i * 30, tt, tt + d + 0.1).connect(e).connect(out); } },
  market(ctx, out, t) {
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.14, t + 0.3); e.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const am = osc(ctx, 'sine', 5.5, t, t + 1.9); const d = ctx.createGain(); d.gain.value = 0.07; am.connect(d).connect(e.gain);
    noise(ctx, t, t + 1.9).connect(filter(ctx, 'bandpass', 650, 1.4)).connect(e).connect(out);
  },
  townbell(ctx, out, t) { for (let i = 0; i < 3; i++) VOICES.bell(ctx, out, t + i * 1.4, midiHz(55), 1, 0.55); },
  // --- Celebration ------------------------------------------------------------------------------
  cheer(ctx, out, t) {
    const e = ctx.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(0.25, t + 0.4); e.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    noise(ctx, t, t + 2.5).connect(filter(ctx, 'bandpass', 1300, 0.7)).connect(e);
    for (let i = 0; i < 8; i++) { const tt = t + r() * 0.8; const o = osc(ctx, 'triangle', 300 + r() * 400, tt, tt + 0.6); o.frequency.linearRampToValueAtTime(500 + r() * 500, tt + 0.4); const g = env(ctx, tt, { a: 0.05, peak: 0.04, decay: 0.5 }); o.connect(g).connect(e); }
    e.connect(out);
  },
  launch(ctx, out, t) { const e = env(ctx, t, { a: 0.02, peak: 0.05, decay: 0.9 }); const o = osc(ctx, 'sine', 600, t, t + 1); o.frequency.exponentialRampToValueAtTime(2400, t + 0.9); o.connect(e).connect(out); },
  boom(ctx, out, t) {
    const e = env(ctx, t, { a: 0.002, peak: 0.55, decay: 1.3 });
    noise(ctx, t, t + 1.4).connect(filter(ctx, 'lowpass', 900)).connect(e);
    const o = osc(ctx, 'sine', 75, t, t + 1); o.frequency.exponentialRampToValueAtTime(35, t + 0.8); o.connect(e);
    e.connect(out);
    for (let i = 0; i < 12; i++) { const tt = t + 0.25 + r() * 1.2; const c = env(ctx, tt, { a: 0.001, peak: 0.07, decay: 0.02 }); noise(ctx, tt, tt + 0.03).connect(filter(ctx, 'highpass', 4000)).connect(c).connect(out); }
  },
};

export const SFX_KINDS = Object.keys(SFX);
