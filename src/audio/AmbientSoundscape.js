import { noiseBuffer } from './Instruments.js';
import { detailFor } from './SpatialAudio.js';

// Environmental sound. A few continuous beds (wind, crowds, traffic,
// machinery, electric hum, the soft shimmer of a future city, rain, snowy
// wind, summer crickets) are mixed from what is actually around the point
// the camera looks at, and one-off sounds (birds, horses, hammers, cars,
// trains) are drawn from the same picture. The surroundings' own age is
// heard: the preserved old town still sounds medieval in the Age of Tomorrow.

/**
 * What to hear, from the surroundings. `e` = { era (of the buildings
 * nearby), age, zoom, hour, season, weather, intensity, forest, farms,
 * workshops, industrial, shops, homes, towers, sites, station, faith,
 * vehicles, fires, crowd }. Returns { beds, events } with weights 0..1.
 */
export function ambienceMix(e) {
  const night = e.hour < 6 || e.hour >= 20;
  const day = night ? 0 : 1;
  const detail = detailFor(e.zoom ?? 60);
  const broad = 1 - detail;
  const era = e.era ?? 1;
  const n = (v, k) => Math.min(1, (v ?? 0) / k);
  const town = n(e.shops, 4) * 0.6 + n(e.homes, 10) * 0.4;
  const beds = {
    wind: 0.22 + n(e.forest, 1) * 0.25 + broad * 0.35 + (e.weather === 'wind' ? 0.35 : 0),
    crowd: (n(e.shops, 3) * 0.6 + n(e.crowd, 12) * 0.5) * (night ? 0.25 : 1) * (0.4 + detail * 0.6),
    traffic: era >= 3 ? (town * 0.7 + n(e.vehicles, 6) * 0.5 + n(e.towers, 3) * 0.3) * (night ? 0.45 : 1) * (era >= 5 ? 0.35 : 1) : 0,
    machine: (era >= 2 && era <= 4 ? n(e.industrial, 2) : 0) * day * (0.3 + detail * 0.7),
    hum: era >= 3 ? 0.08 + n(e.towers, 4) * 0.2 : 0,
    shimmer: era >= 5 ? 0.25 + n(e.towers, 4) * 0.25 : 0,
    rain: e.weather === 'rain' ? 0.35 + (e.intensity ?? 0.5) * 0.5 : 0,
    snowwind: e.weather === 'snow' ? 0.3 + (e.intensity ?? 0.5) * 0.4 : e.season === 3 ? 0.12 : 0,
    crickets: night && (e.season === 1 || e.season === 0) && era <= 3 ? 0.25 + n(e.farms, 2) * 0.3 : 0,
  };
  for (const k of Object.keys(beds)) beds[k] = Math.max(0, Math.min(1, beds[k]));
  const quiet = e.weather === 'rain' || e.weather === 'snow' ? 0.4 : 1;
  const events = {
    bird: day * (e.season === 3 ? 0.15 : 1) * quiet * (0.25 + n(e.forest, 1) * 0.6 + n(e.farms, 2) * 0.3) * (era >= 4 ? 0.5 : 1),
    owl: night * (0.15 + n(e.forest, 1) * 0.4) * (era <= 3 ? 1 : 0.3),
    horse: era <= 2 ? day * (0.2 + town * 0.4) : 0,
    cart: era <= 2 ? day * n(e.shops, 3) * 0.4 : 0,
    hammer: n(e.sites, 1) * (0.5 + day * 0.5) * detail,
    anvil: era <= 2 ? n(e.smithy, 1) * day * detail : 0,
    chop: era <= 2 ? n(e.lumber, 1) * day * detail * 0.8 + n(e.forest, 1) * day * 0.2 : 0,
    farm: n(e.farms, 2) * day * detail * 0.3,
    market: era <= 3 ? n(e.shops, 3) * day * detail * 0.6 : 0,
    steam: era === 2 ? n(e.industrial, 1) * day * 0.6 : 0,
    machine: era >= 2 && era <= 4 ? n(e.industrial, 1) * day * detail * 0.5 : 0,
    whistle: era >= 2 && era <= 3 && e.station ? 0.25 : 0,
    car: era >= 3 && era <= 4 ? (town * 0.6 + n(e.vehicles, 4) * 0.6) * (night ? 0.4 : 1) : 0,
    bus: era >= 3 && era <= 4 ? town * 0.2 * day : 0,
    tram: era >= 4 ? (town * 0.3 + n(e.towers, 2) * 0.2) * day : 0,
    pod: era >= 5 ? (town * 0.5 + n(e.vehicles, 4) * 0.5) : 0,
    interface: era >= 5 ? n(e.towers, 2) * 0.3 * detail : 0,
  };
  return { beds, events };
}

const BED_FILTERS = {
  wind: (ctx) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 480; return f; },
  crowd: (ctx) => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 1.1; return f; },
  traffic: (ctx) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 230; return f; },
  machine: (ctx) => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 160; f.Q.value = 2; return f; },
  // Rain is two layers: a soft, band-limited wash, and a patter of drops whose
  // density flickers. (A plain high-passed hiss read as far louder than its level
  // and held the master limiter down, pushing the music under it.)
  rain: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain();
    const lo = ctx.createBiquadFilter(); lo.type = 'highpass'; lo.frequency.value = 380;
    const hi = ctx.createBiquadFilter(); hi.type = 'lowpass'; hi.frequency.value = 3200; hi.Q.value = 0.5;
    input.connect(lo).connect(hi).connect(output);
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 2400; band.Q.value = 1.2;
    const patter = ctx.createGain(); patter.gain.value = 0.35;
    for (const [hz, depth] of [[5.3, 0.14], [8.9, 0.11], [13.7, 0.08]]) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = hz; lfo.start(ctx.currentTime);
      const g = ctx.createGain(); g.gain.value = depth;
      lfo.connect(g).connect(patter.gain);
    }
    input.connect(band).connect(patter).connect(output);
    return { input, output };
  },
  snowwind: (ctx) => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8; return f; },
  crickets: (ctx) => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4300; f.Q.value = 9; return f; },
};
const BED_LEVEL = { wind: 0.5, crowd: 0.35, traffic: 0.7, machine: 0.6, hum: 0.05, shimmer: 0.04, rain: 0.14, snowwind: 0.45, crickets: 0.25 };
// Slow swells that make a bed breathe (Hz, depth).
const BED_LFO = { rain: [0.07, 0.3], wind: [0.13, 0.5], crowd: [0.4, 0.3], traffic: [0.08, 0.35], machine: [2.2, 0.6], snowwind: [0.2, 0.6], crickets: [11, 0.9] };

export class AmbientSoundscape {
  constructor(ctx, bus) {
    this.ctx = ctx;
    this.bus = bus;
    this.beds = {};
    this.nextEvent = 0;
    this.mix = null;
    const t = ctx.currentTime;
    for (const name of Object.keys(BED_LEVEL)) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(bus);
      let src;
      if (name === 'hum' || name === 'shimmer') {
        src = ctx.createGain();
        for (const f of name === 'hum' ? [60, 120] : [1046, 1318, 1568]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(src); o.start(t); }
      } else {
        const n = ctx.createBufferSource();
        n.buffer = noiseBuffer(ctx);
        n.loop = true;
        n.start(t, Math.random());
        // A bed's filter is one node, or an { input, output } chain.
        const f = BED_FILTERS[name](ctx);
        n.connect(f.input ?? f);
        src = f.output ?? f;
      }
      const shape = ctx.createGain();
      shape.gain.value = 1;
      if (BED_LFO[name]) {
        const [hz, depth] = BED_LFO[name];
        const lfo = ctx.createOscillator(); lfo.frequency.value = hz; lfo.start(t);
        const d = ctx.createGain(); d.gain.value = depth * 0.5;
        lfo.connect(d).connect(shape.gain);
        shape.gain.value = 1 - depth * 0.5;
      }
      src.connect(shape).connect(g);
      this.beds[name] = g;
    }
  }

  /** Set the beds for the surroundings (smoothly). */
  update(mix) {
    this.mix = mix;
    const t = this.ctx.currentTime;
    for (const [name, g] of Object.entries(this.beds)) g.gain.setTargetAtTime((mix.beds[name] ?? 0) * BED_LEVEL[name], t, 1.2);
  }

  /** Called by the scheduler: maybe start a one-off sound. `play(kind)` plays it near the listener. */
  tick(play, reduced = false) {
    const t = this.ctx.currentTime;
    if (!this.mix || t < this.nextEvent) return null;
    const entries = Object.entries(this.mix.events).filter(([, w]) => w > 0.02);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    // Busier surroundings make sounds more often; reduced audio halves them.
    const gap = (total > 0 ? 2.6 / Math.min(2.5, total) : 4) * (reduced ? 2 : 1);
    this.nextEvent = t + gap * (0.6 + Math.random() * 0.8);
    if (!total) return null;
    let x = Math.random() * total;
    for (const [kind, w] of entries) { x -= w; if (x <= 0) { play(kind); return kind; } }
    return null;
  }

  stop() { for (const g of Object.values(this.beds)) g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); }
}
