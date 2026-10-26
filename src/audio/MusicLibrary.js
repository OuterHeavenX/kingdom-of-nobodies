import { VOICES, midiHz } from './Instruments.js';

// The soundtrack: original compositions generated from these descriptions
// (no recordings, no borrowed tunes). Each cue names its key, scale, tempo,
// chord progression and parts; melodies are composed once per cue from a
// fixed seed, so a cue always sounds the same. Two or more cues per age,
// plus themes for the title screen, festivals, winter, New Year, war,
// disasters and great achievements.

const SCALES = {
  dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], ionian: [0, 2, 4, 5, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], harmonic: [0, 2, 3, 5, 7, 8, 11], pentatonic: [0, 2, 4, 7, 9, 12, 14],
};

export const CUES = [
  // --- Age of Foundations: lute, harp, flute, strings, frame drum -------------------------------
  { id: 'hearthsong', title: 'Hearthsong', era: 1, mood: 'day', bpm: 88, beats: 4, root: 50, scale: 'dorian', prog: [0, 6, 0, 4, 2, 6, 3, 0], seed: 11,
    parts: [{ role: 'arp', voice: 'pluck', oct: 0, pattern: [0, 2, 1, 2, 0, 2, 1, 2], v: 0.45 }, { role: 'melody', voice: 'flute', oct: 1, v: 0.42, density: 0.6 }, { role: 'bass', voice: 'cello', oct: -1, v: 0.35 }, { role: 'drums', kit: { tabor: [0, 6, 8], shaker: [4, 12] }, v: 0.4 }] },
  { id: 'moonlit-commons', title: 'Moonlit Commons', era: 1, mood: 'night', bpm: 62, beats: 3, root: 45, scale: 'aeolian', prog: [0, 5, 3, 4, 0, 2, 5, 4], seed: 23,
    parts: [{ role: 'arp', voice: 'harp', oct: 1, pattern: [0, 1, 2, 1, 2, 1], v: 0.35 }, { role: 'pad', voice: 'strings', oct: 0, v: 0.5 }, { role: 'melody', voice: 'flute', oct: 1, v: 0.3, density: 0.35 }] },
  { id: 'market-morning', title: 'Market Morning', era: 1, mood: 'day', bpm: 104, beats: 4, root: 55, scale: 'mixolydian', prog: [0, 6, 3, 0, 0, 4, 6, 0], seed: 31,
    parts: [{ role: 'chord', voice: 'pluck', oct: 0, hits: [0, 4, 8, 12], v: 0.35 }, { role: 'melody', voice: 'flute', oct: 1, v: 0.38, density: 0.75 }, { role: 'bass', voice: 'bass', oct: -1, v: 0.35 }, { role: 'drums', kit: { tabor: [0, 8, 10], shaker: [2, 6, 10, 14] }, v: 0.4 }] },
  // --- Industrial Awakening: piano, strings, rhythmic percussion, machine textures ---------------
  { id: 'brass-and-steam', title: 'Brass and Steam', era: 2, mood: 'day', bpm: 100, beats: 4, root: 55, scale: 'ionian', prog: [0, 4, 5, 3, 0, 4, 1, 4], seed: 41,
    parts: [{ role: 'chord', voice: 'piano', oct: 0, hits: [0, 6, 8, 14], v: 0.4 }, { role: 'melody', voice: 'strings', oct: 1, v: 0.55, density: 0.45 }, { role: 'bass', voice: 'cello', oct: -1, v: 0.4 }, { role: 'drums', kit: { kick: [0, 8], snare: [4, 12], tick: [0, 2, 4, 6, 8, 10, 12, 14] }, v: 0.35 }] },
  { id: 'gaslight-waltz', title: 'Gaslight Waltz', era: 2, mood: 'night', bpm: 78, beats: 3, root: 52, scale: 'harmonic', prog: [0, 3, 4, 0, 5, 3, 4, 4], seed: 53,
    parts: [{ role: 'waltz', voice: 'piano', oct: 0, v: 0.38 }, { role: 'melody', voice: 'cello', oct: 0, v: 0.5, density: 0.5 }, { role: 'pad', voice: 'strings', oct: 1, v: 0.25 }] },
  // --- Modern Expansion: jazz, mid-century orchestral, soft rock ---------------------------------
  { id: 'main-street-swing', title: 'Main Street Swing', era: 3, mood: 'day', bpm: 116, beats: 4, swing: 0.62, root: 53, scale: 'ionian', prog: [1, 4, 0, 0, 1, 4, 0, 5], seventh: true, seed: 61,
    parts: [{ role: 'walk', voice: 'bass', oct: -1, v: 0.5 }, { role: 'chord', voice: 'epiano', oct: 0, hits: [2, 7, 10], v: 0.35 }, { role: 'melody', voice: 'piano', oct: 1, v: 0.4, density: 0.6 }, { role: 'drums', kit: { brush: [0, 4, 8, 12], hat: [4, 12], kick: [0] }, v: 0.4 }] },
  { id: 'evening-radio', title: 'Evening Radio', era: 3, mood: 'night', bpm: 84, beats: 4, root: 58, scale: 'ionian', prog: [0, 5, 3, 4, 0, 5, 1, 4], seventh: true, seed: 67,
    parts: [{ role: 'chord', voice: 'epiano', oct: 0, hits: [0, 8], v: 0.38 }, { role: 'bass', voice: 'bass', oct: -1, v: 0.42 }, { role: 'melody', voice: 'strings', oct: 1, v: 0.45, density: 0.35 }, { role: 'drums', kit: { kick: [0, 10], snare: [8], hat: [0, 4, 8, 12] }, v: 0.25 }] },
  // --- Metropolitan Age: ambient electronic, modern orchestral, atmospheric piano ---------------
  { id: 'glass-horizon', title: 'Glass Horizon', era: 4, mood: 'day', bpm: 96, beats: 4, root: 48, scale: 'lydian', prog: [0, 1, 5, 4, 0, 1, 3, 4], seed: 71,
    parts: [{ role: 'arp', voice: 'synth', oct: 1, pattern: [0, 1, 2, 3, 2, 1, 0, 2, 0, 1, 2, 3, 2, 1, 0, 2], step: 0.25, v: 0.3 }, { role: 'pad', voice: 'pad', oct: 0, v: 0.6 }, { role: 'bass', voice: 'bass', oct: -1, v: 0.4 }, { role: 'drums', kit: { kick: [0, 8], hat: [2, 6, 10, 14], shaker: [4, 12] }, v: 0.35 }] },
  { id: 'night-skyline', title: 'Night Skyline', era: 4, mood: 'night', bpm: 70, beats: 4, root: 57, scale: 'aeolian', prog: [0, 5, 2, 6, 0, 5, 3, 4], seed: 79,
    parts: [{ role: 'melody', voice: 'piano', oct: 0, v: 0.42, density: 0.4 }, { role: 'pad', voice: 'pad', oct: -1, v: 0.6 }, { role: 'arp', voice: 'bell', oct: 1, pattern: [0, 2, 1, 2], step: 1, v: 0.2 }] },
  // --- Age of Tomorrow: synthesisers, atmospheric pads, soft percussion, strings -------------------
  { id: 'solar-gardens', title: 'Solar Gardens', era: 5, mood: 'day', bpm: 102, beats: 4, root: 52, scale: 'ionian', prog: [0, 3, 5, 4, 0, 3, 1, 4], seed: 83,
    parts: [{ role: 'arp', voice: 'synth', oct: 1, pattern: [0, 2, 1, 3, 2, 1, 0, 1], step: 0.5, v: 0.28 }, { role: 'pad', voice: 'strings', oct: 0, v: 0.45 }, { role: 'melody', voice: 'bell', oct: 1, v: 0.3, density: 0.4 }, { role: 'bass', voice: 'bass', oct: -1, v: 0.38 }, { role: 'drums', kit: { kick: [0, 8], shaker: [2, 6, 10, 14], hat: [4, 12] }, v: 0.3 }] },
  { id: 'starlit-transit', title: 'Starlit Transit', era: 5, mood: 'night', bpm: 66, beats: 4, root: 50, scale: 'lydian', prog: [0, 1, 4, 5, 0, 1, 3, 4], seed: 89,
    parts: [{ role: 'pad', voice: 'pad', oct: 0, v: 0.65 }, { role: 'melody', voice: 'bell', oct: 1, v: 0.3, density: 0.3 }, { role: 'arp', voice: 'harp', oct: 1, pattern: [0, 1, 2, 3], step: 1, v: 0.22 }] },
  // --- Special themes ------------------------------------------------------------------------------
  { id: 'title', title: 'Kingdom of Nobodies', special: 'menu', bpm: 76, beats: 4, root: 50, scale: 'dorian', prog: [0, 5, 3, 4, 0, 5, 6, 4], seed: 97,
    parts: [{ role: 'arp', voice: 'harp', oct: 1, pattern: [0, 1, 2, 1, 0, 2, 1, 2], v: 0.32 }, { role: 'pad', voice: 'pad', oct: 0, v: 0.55 }, { role: 'melody', voice: 'flute', oct: 1, v: 0.35, density: 0.45 }] },
  { id: 'festival-jig', title: 'The Festival Jig', special: 'festival', bpm: 126, beats: 3, root: 50, scale: 'mixolydian', prog: [0, 0, 6, 6, 0, 3, 4, 0], seed: 101,
    parts: [{ role: 'chord', voice: 'pluck', oct: 0, hits: [0, 4, 8], v: 0.38 }, { role: 'melody', voice: 'flute', oct: 1, v: 0.45, density: 0.9 }, { role: 'bass', voice: 'bass', oct: -1, v: 0.35 }, { role: 'drums', kit: { tabor: [0, 4, 8, 10], shaker: [2, 6, 10] }, v: 0.45 }] },
  { id: 'winter-lights', title: 'Winter Lights', special: 'winter', bpm: 72, beats: 4, root: 55, scale: 'ionian', prog: [0, 3, 5, 4, 0, 3, 1, 4], seed: 103,
    parts: [{ role: 'arp', voice: 'bell', oct: 1, pattern: [0, 2, 1, 2], step: 1, v: 0.26 }, { role: 'pad', voice: 'strings', oct: 0, v: 0.45 }, { role: 'melody', voice: 'flute', oct: 1, v: 0.3, density: 0.35 }] },
  { id: 'new-year', title: 'Midnight Bells', special: 'newyear', bpm: 92, beats: 4, root: 48, scale: 'ionian', prog: [0, 4, 5, 3, 0, 4, 3, 4], seed: 107,
    parts: [{ role: 'chord', voice: 'brass', oct: 0, hits: [0, 6, 8], v: 0.32 }, { role: 'arp', voice: 'bell', oct: 1, pattern: [0, 1, 2, 3], step: 1, v: 0.25 }, { role: 'bass', voice: 'cello', oct: -1, v: 0.4 }, { role: 'drums', kit: { timpani: [0, 8] }, v: 0.4 }] },
  { id: 'banners-of-war', title: 'Banners of War', special: 'war', bpm: 84, beats: 4, root: 50, scale: 'harmonic', prog: [0, 0, 5, 4, 0, 3, 4, 4], seed: 109,
    parts: [{ role: 'pad', voice: 'cello', oct: -1, v: 0.5 }, { role: 'melody', voice: 'brass', oct: 0, v: 0.35, density: 0.4 }, { role: 'drums', kit: { timpani: [0, 6, 8, 12], snare: [4, 12, 14] }, v: 0.45 }] },
  { id: 'embers', title: 'Embers', special: 'disaster', bpm: 60, beats: 4, root: 45, scale: 'harmonic', prog: [0, 0, 5, 5, 3, 3, 4, 4], seed: 113,
    parts: [{ role: 'pad', voice: 'strings', oct: -1, v: 0.55 }, { role: 'drums', kit: { timpani: [0] }, v: 0.35 }, { role: 'melody', voice: 'cello', oct: 0, v: 0.3, density: 0.25 }] },
  { id: 'triumph', title: 'Triumph', special: 'achievement', stinger: true, bpm: 96, beats: 4, root: 53, scale: 'ionian', prog: [0, 4, 0], seed: 127,
    parts: [{ role: 'chord', voice: 'brass', oct: 0, hits: [0, 4, 8], v: 0.4 }, { role: 'arp', voice: 'bell', oct: 1, pattern: [0, 1, 2, 3], step: 0.5, v: 0.3 }, { role: 'drums', kit: { timpani: [0, 8] }, v: 0.45 }] },
];

export const CUE_BY_ID = Object.fromEntries(CUES.map((c) => [c.id, c]));
export const cuesForEra = (era) => CUES.filter((c) => c.era === era);
export const specialCue = (kind) => CUES.find((c) => c.special === kind) ?? null;

function rng(seed) {
  let s = seed * 7919 + 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/** Degree → MIDI note in a cue's key (degrees may exceed the scale; octaves wrap). */
export function noteOf(cue, degree, oct = 0) {
  const sc = SCALES[cue.scale];
  const n = sc.length === 7 ? 7 : sc.length;
  const o = Math.floor(degree / n);
  const d = ((degree % n) + n) % n;
  return cue.root + 12 * (o + oct) + sc[d];
}

const chordDegrees = (cue, bar) => { const r = cue.prog[bar % cue.prog.length]; return cue.seventh ? [r, r + 2, r + 4, r + 6] : [r, r + 2, r + 4]; };

/** Compose a cue's melody once: a list of { bar, beat, len, degree } over its whole progression. */
export function composeMelody(cue, part) {
  const r = rng(cue.seed + (part.oct ?? 0) * 3);
  const notes = [];
  let deg = cue.prog[0] + 2;
  const motif = [];
  // A two-bar motif, repeated with variation over the progression.
  for (let beat = 0; beat < cue.beats * 2; beat += 0.5) {
    if (r() > part.density && beat % 1 !== 0) continue;
    if (r() > part.density + 0.15) continue;
    motif.push({ beat, len: r() < 0.3 ? 1 : 0.5, step: Math.round((r() - 0.5) * 3) });
  }
  for (let bar = 0; bar < cue.prog.length; bar += 2) {
    const vary = (bar / 2) % 2 === 1;
    for (const m of motif) {
      const b = bar + Math.floor(m.beat / cue.beats);
      const chord = chordDegrees(cue, b);
      const strong = m.beat % cue.beats === 0 || m.beat % (cue.beats / 2) === 0;
      deg += vary ? -m.step : m.step;
      if (strong) deg = chord.reduce((best, c) => { const cand = c + 7 * Math.round((deg - c) / 7); return Math.abs(cand - deg) < Math.abs(best - deg) ? cand : best; }, chord[0]);
      deg = Math.max(-1, Math.min(9, deg));
      notes.push({ bar: b, beat: m.beat % cue.beats, len: m.len, degree: deg });
    }
  }
  return notes;
}

const melodies = new WeakMap();

/**
 * Schedule one bar of a cue starting at time t0. `spb` is seconds per beat.
 * Returns the number of notes scheduled.
 */
export function renderBar(ctx, out, cue, bar, t0, spb) {
  let count = 0;
  // Swing delays the off-beat eighth (the third sixteenth of each beat).
  const at16 = (s) => t0 + (s / 4) * spb + (cue.swing && s % 4 === 2 ? (cue.swing - 0.5) * spb : 0);
  const chord = chordDegrees(cue, bar);
  const play = (voice, t, deg, dur, v, oct = 0) => { VOICES[voice](ctx, out, t, midiHz(noteOf(cue, deg, oct)), dur, v); count++; };
  for (const part of cue.parts) {
    const oct = part.oct ?? 0;
    if (part.role === 'pad') for (const d of chord.slice(0, 3)) play(part.voice, t0, d, cue.beats * spb * 0.98, part.v, oct);
    else if (part.role === 'chord') for (const h of part.hits) { if (h / 4 >= cue.beats) continue; for (const d of chord) play(part.voice, at16(h), d, spb * 0.9, part.v * 0.6, oct); }
    else if (part.role === 'arp') {
      const step = part.step ?? 0.5;
      for (let i = 0; i * step < cue.beats; i++) {
        const k = part.pattern[i % part.pattern.length];
        const d = chord[k % chord.length] + (k >= chord.length ? 7 : 0);
        const t = t0 + i * step * spb + (step === 0.5 && i % 2 === 1 ? (cue.swing ? (cue.swing - 0.5) * spb : 0) : 0);
        play(part.voice, t, d, step * spb, part.v, oct);
      }
    } else if (part.role === 'bass') {
      play(part.voice, t0, chord[0], spb * 1.8, part.v, oct);
      if (cue.beats >= 4) play(part.voice, t0 + 2 * spb, chord[r5(chord)], spb * 1.6, part.v * 0.85, oct);
    } else if (part.role === 'walk') {
      const next = chordDegrees(cue, bar + 1)[0];
      const line = [chord[0], chord[1], chord[2], next + (next > chord[2] ? -1 : 1)];
      for (let i = 0; i < cue.beats; i++) play(part.voice, t0 + i * spb, line[i % 4], spb * 0.9, part.v, oct);
    } else if (part.role === 'waltz') {
      play(part.voice, t0, chord[0], spb, part.v, oct - 1);
      for (const i of [1, 2]) for (const d of chord.slice(1)) play(part.voice, t0 + i * spb, d, spb * 0.8, part.v * 0.55, oct);
    } else if (part.role === 'melody') {
      let m = melodies.get(cue)?.get(part);
      if (!m) { m = composeMelody(cue, part); if (!melodies.has(cue)) melodies.set(cue, new Map()); melodies.get(cue).set(part, m); }
      const loopBar = bar % cue.prog.length;
      for (const n of m) if (n.bar === loopBar) play(part.voice, t0 + n.beat * spb + (cue.swing && n.beat % 1 === 0.5 ? (cue.swing - 0.5) * spb : 0), n.degree, n.len * spb, part.v, oct);
    } else if (part.role === 'drums') {
      for (const [voice, steps] of Object.entries(part.kit)) for (const s of steps) { if (s / 4 >= cue.beats) continue; VOICES[voice](ctx, out, at16(s), voice === 'timpani' ? midiHz(cue.root - 12) : 0, spb, part.v); count++; }
    }
  }
  return count;
}

const r5 = (chord) => (chord.length > 2 ? 2 : 0);
