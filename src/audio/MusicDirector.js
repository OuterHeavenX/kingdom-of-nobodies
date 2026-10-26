import { CUE_BY_ID, cuesForEra, specialCue, renderBar } from './MusicLibrary.js';

// The music director chooses what plays from the state of the world — the
// age, the hour, war, festivals, disasters, winter, New Year, the kingdom on
// screen — and crossfades between cues. It owns no timer of its own: the
// audio manager's single scheduler calls tick(), which writes the next bars
// a little ahead of time so playback never stutters.

const LOOKAHEAD = 1.2; // seconds of music scheduled ahead
const FADE = 3.5; // crossfade length
const MIN_HOLD = 25; // seconds a calm cue plays before another calm cue may replace it

/** Regional colour: each kingdom hears the age's music in its own key. */
export const KINGDOM_TRANSPOSE = { hearth: 0, greenvale: 2, ironhold: -3, saltmere: 5 };

/**
 * Which cue fits a moment. `c` = { menu, era, hour, war, festival, disaster,
 * holiday, winter, kingdom, rotation, shuffle, random }. Returns { id, transpose, urgent }.
 */
export function chooseCue(c) {
  const transpose = KINGDOM_TRANSPOSE[c.kingdom ?? 'hearth'] ?? 0;
  if (c.menu) return { id: 'title', transpose: 0, urgent: true };
  if (c.disaster) return { id: 'embers', transpose, urgent: true };
  if (c.war) return { id: 'banners-of-war', transpose, urgent: true };
  if (c.holiday === 'newyear') return { id: 'new-year', transpose, urgent: true };
  if (c.festival || (c.holiday && c.holiday !== 'winter')) return { id: 'festival-jig', transpose, urgent: true };
  const night = c.hour < 6 || c.hour >= 20;
  if (c.holiday === 'winter' || (c.winter && night)) return { id: 'winter-lights', transpose, urgent: false };
  const list = cuesForEra(c.era ?? 1);
  const mood = list.filter((x) => x.mood === (night ? 'night' : 'day'));
  const pool = c.shuffle ? list : mood.length ? mood : list;
  const i = c.shuffle ? Math.floor((c.random ?? 0) * pool.length) : (c.rotation ?? 0) % pool.length;
  return { id: pool[i].id, transpose, urgent: false };
}

export class MusicDirector {
  constructor(ctx, bus) {
    this.ctx = ctx;
    this.bus = bus;
    this.current = null; // { id, transpose, cue, gain, bar, next, startedAt, loops }
    this.fading = [];
    this.rotation = 0;
    this.notes = 0;
    this.switches = 0;
    this.stingerGain = null;
  }

  /** Point the director at a new moment; it crossfades if the right cue has changed. */
  update(context) {
    const want = chooseCue({ ...context, rotation: this.rotation, random: ((this.rotation * 9301 + 49297) % 233280) / 233280 });
    const cur = this.current;
    if (cur && cur.id === want.id && cur.transpose === want.transpose) return cur.id;
    const now = this.ctx.currentTime;
    if (cur && !want.urgent && !cur.urgent && now - cur.startedAt < MIN_HOLD) return cur.id;
    this.play(want.id, want.transpose, want.urgent);
    return want.id;
  }

  play(id, transpose = 0, urgent = false) {
    const base = CUE_BY_ID[id];
    if (!base) return;
    const now = this.ctx.currentTime;
    if (this.current) this.fadeOut(this.current, now);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + (this.current ? FADE : 1.5));
    gain.connect(this.bus);
    const cue = transpose ? { ...base, root: base.root + transpose } : base;
    this.current = { id, transpose, cue, gain, bar: 0, next: now + 0.15, startedAt: now, loops: 0, urgent };
    this.switches++;
  }

  fadeOut(entry, now) {
    entry.gain.gain.cancelScheduledValues(now);
    entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
    entry.gain.gain.linearRampToValueAtTime(0.0001, now + FADE);
    entry.stopAt = now + FADE + 2.5; // notes already scheduled ring out under the fade
    this.fading.push(entry);
  }

  /** Schedule ahead. Called by the audio manager's scheduler. */
  tick() {
    const now = this.ctx.currentTime;
    const cur = this.current;
    if (cur) {
      const spb = 60 / cur.cue.bpm;
      // After a while away (a suspended tab), restart cleanly rather than catching up.
      if (cur.next < now - 0.5) cur.next = now + 0.1;
      while (cur.next < now + LOOKAHEAD) {
        this.notes += renderBar(this.ctx, cur.gain, cur.cue, cur.bar, cur.next, spb);
        cur.next += cur.cue.beats * spb;
        cur.bar++;
        if (cur.bar % cur.cue.prog.length === 0) {
          cur.loops++;
          // Calm cues rotate after a few passes so the soundtrack keeps moving.
          if (!cur.urgent && cur.loops >= 3) { this.rotation++; cur.loops = 0; cur.rotate = true; }
        }
      }
    }
    for (const f of [...this.fading]) if (now > f.stopAt) { f.gain.disconnect(); this.fading = this.fading.filter((x) => x !== f); }
  }

  /** True when the playing cue asked to rotate (the manager then calls update with the same context). */
  wantsRotation() { const r = this.current?.rotate; if (r) this.current.rotate = false; return !!r; }

  /** A short fanfare over the soundtrack, which dips while it plays. */
  stinger(id = 'triumph') {
    const cue = CUE_BY_ID[id];
    if (!cue) return;
    const now = this.ctx.currentTime;
    const spb = 60 / cue.bpm;
    const len = cue.prog.length * cue.beats * spb;
    if (this.current) {
      const g = this.current.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.35, now + 0.4);
      g.setValueAtTime(0.35, now + len);
      g.linearRampToValueAtTime(1, now + len + 2);
    }
    const out = this.ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.bus);
    for (let b = 0; b < cue.prog.length; b++) this.notes += renderBar(this.ctx, out, cue, b, now + 0.2 + b * cue.beats * spb, spb);
    setTimeout(() => out.disconnect(), (len + 4) * 1000);
  }

  stop() {
    const now = this.ctx.currentTime;
    if (this.current) this.fadeOut(this.current, now);
    this.current = null;
  }

  get playing() { return this.current?.id ?? null; }
}

export { specialCue };
