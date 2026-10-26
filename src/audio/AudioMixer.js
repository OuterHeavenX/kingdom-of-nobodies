import { busGain } from './AudioSettings.js';

// The mixer: one gain node per bus (music, ambience, effects, interface)
// feeding a master gain, a gentle compressor and the speakers. Volume changes
// ramp over a fraction of a second so sliders never click.

export const BUSES = ['music', 'ambience', 'sfx', 'ui'];

export class AudioMixer {
  constructor(ctx, settings) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -14;
    this.limiter.knee.value = 12;
    this.limiter.ratio.value = 4;
    this.limiter.attack.value = 0.01;
    this.limiter.release.value = 0.25;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.bus = {};
    for (const b of BUSES) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      this.bus[b] = g;
    }
    this.master.gain.value = 0;
    this.apply(settings, 0.01);
  }

  /** Apply settings with a short ramp. */
  apply(settings, ramp = 0.25) {
    const t = this.ctx.currentTime;
    const set = (param, v) => { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + ramp); };
    set(this.master.gain, settings.enabled ? settings.master : 0);
    for (const b of BUSES) set(this.bus[b].gain, busGain({ ...settings, master: 1 }, b));
    this.settings = settings;
  }

  /** Loudness of what is playing right now (RMS, 0..1): used by the audio test panel and the end-to-end test. */
  level() {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let s = 0;
    for (const v of data) s += v * v;
    return Math.sqrt(s / data.length);
  }

  dispose() {
    for (const b of BUSES) this.bus[b].disconnect();
    this.master.disconnect();
    this.limiter.disconnect();
    this.analyser.disconnect();
  }
}
