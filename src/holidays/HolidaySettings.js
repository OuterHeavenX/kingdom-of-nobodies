// Device settings for seasons and celebrations. These are display choices
// kept with the other graphics settings in this browser: they change what is
// drawn, never what happens. (Which holidays the kingdom keeps at all is part
// of the save: see culture/Holidays.js.)

export const DURATIONS = { short: 0.6, normal: 1, long: 1.6 };

export const DEFAULTS = {
  effects: true, // holiday decorations and effects
  snow: true, // falling snow and other weather particles
  fireworks: true,
  atmosphere: true, // seasonal colour, light and sky
  density: 'medium', // decoration density: low / medium / high
  reducedMotion: 'auto', // auto follows the system setting; on / off override it
  realCalendar: false, // show the real-world season and holiday instead of the kingdom's (visual only)
  duration: 'normal', // how long holiday visuals last on the kingdom calendar
  linger: 40, // real seconds a holiday's look stays at least, however fast time runs
  sound: false, // bells at midnight on New Year's Eve
};

/** Particle and decoration budgets per graphics quality. Every effect is bounded by these. */
export const BUDGETS = {
  low: { particles: 260, fireworks: 160, decorations: 0.45, clouds: 3, flyers: 6, fog: 4 },
  medium: { particles: 650, fireworks: 380, decorations: 0.75, clouds: 6, flyers: 12, fog: 7 },
  high: { particles: 1300, fireworks: 760, decorations: 1, clouds: 9, flyers: 20, fog: 10 },
};
export const DENSITY = { low: 0.5, medium: 0.8, high: 1 };

export function normalizeSettings(raw = {}) {
  const s = { ...DEFAULTS, ...(raw ?? {}) };
  for (const k of ['effects', 'snow', 'fireworks', 'atmosphere', 'realCalendar', 'sound']) s[k] = !!s[k];
  if (!DENSITY[s.density]) s.density = DEFAULTS.density;
  if (!['auto', 'on', 'off'].includes(s.reducedMotion)) s.reducedMotion = 'auto';
  if (!DURATIONS[s.duration]) s.duration = 'normal';
  s.linger = Math.max(0, Math.min(180, Number(s.linger) || 0));
  return s;
}

/** Whether to calm motion: the player's choice, or the system's "reduce motion" preference. */
export function prefersReducedMotion(settings, media = globalThis.matchMedia) {
  if (settings.reducedMotion === 'on') return true;
  if (settings.reducedMotion === 'off') return false;
  try { return !!media?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** The effective budget for a quality level and these settings. */
export function budgetFor(quality, settings) {
  const b = { ...(BUDGETS[quality] ?? BUDGETS.medium) };
  b.decorations *= DENSITY[settings.density] ?? 0.8;
  if (prefersReducedMotion(settings)) { b.particles = Math.round(b.particles * 0.4); b.fireworks = Math.round(b.fireworks * 0.35); b.flyers = Math.ceil(b.flyers / 3); }
  return b;
}
