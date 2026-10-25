// A minimal stand-in for the Web Audio API, enough to run the audio engine's
// logic in Node and to count what it schedules. It makes no sound.

class Param {
  constructor(v = 0) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); this.value = v; return this; }
  setTargetAtTime(v, t, c) { this.events.push(['target', v, t, c]); this.value = v; return this; }
  cancelScheduledValues() { return this; }
}

class Node {
  constructor(ctx) { this.ctx = ctx; this.outputs = []; ctx.nodes++; }
  connect(n) { this.outputs.push(n); return n; }
  disconnect() { this.outputs = []; }
}

class Source extends Node {
  start(t = 0) { this.startedAt = t; this.ctx.started++; }
  stop(t) { this.stoppedAt = t; }
}

export class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.nodes = 0;
    this.started = 0;
    this.destination = new Node(this);
    FakeAudioContext.instances.push(this);
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; this.onstatechange?.(); return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createGain() { const n = new Node(this); n.gain = new Param(1); return n; }
  createOscillator() { const n = new Source(this); n.frequency = new Param(440); n.detune = new Param(0); n.type = 'sine'; return n; }
  createBufferSource() { const n = new Source(this); n.loop = false; return n; }
  createBuffer(ch, len, rate) { const data = new Float32Array(len); return { length: len, sampleRate: rate, getChannelData: () => data }; }
  createBiquadFilter() { const n = new Node(this); n.frequency = new Param(1000); n.Q = new Param(1); n.type = 'lowpass'; return n; }
  createDynamicsCompressor() { const n = new Node(this); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; }
  createAnalyser() { const n = new Node(this); n.fftSize = 32; n.getFloatTimeDomainData = (a) => a.fill(0.1); return n; }
  createStereoPanner() { const n = new Node(this); n.pan = new Param(0); return n; }
}
FakeAudioContext.instances = [];

export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}
