import { holidayAt, seasonProgress, realWorldTheme, nextHoliday } from './HolidayCalendar.js';
import { HOLIDAY_BY_ID, SEASON_THEMES, holidayName } from './HolidayRegistry.js';
import { DURATIONS, budgetFor, prefersReducedMotion, normalizeSettings } from './HolidaySettings.js';
import { buildDecorations, villageSites, siteSignature, kingdomExtras, DecorationSet } from './DecorationSpawner.js';
import { SeasonalEnvironment } from '../rendering/SeasonalEnvironment.js';
import { FloatingHearts } from '../effects/FloatingHearts.js';
import { FallingLeaves } from '../effects/FallingLeaves.js';
import { Ghosts } from '../effects/Ghosts.js';
import { Fireworks } from '../effects/Fireworks.js';
import { KINGDOMS } from '../region/RegionData.js';

// One place decides how the world looks right now: the HolidayThemeManager.
//
// About twice a second (never every frame) it works out the theme: the
// season and how far into it, and the holiday if one is on. That comes from
// the kingdom's own date, or the real-world date if the player asked to
// match their calendar, or the preview the player picked. All three only
// read: none of them changes the simulation's time, its state or its saves.
//
// When the theme changes it builds the new decoration set and effects, fades
// the old ones out and disposes their GPU resources once invisible. It fires
// each fireworks show once: the simulation records every show by its
// occurrence (see culture/Holidays.js), and shows already recorded when the
// world was loaded are never replayed.

const SEEN_KEY = 'kingdom-of-nobodies-holidays-seen';

function readSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) ?? []; } catch { return []; } }
function writeSeen(list) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-30))); } catch { /* private mode: announcements may repeat after a reload */ } }

export class HolidayThemeManager {
  /** world: the World. hooks: { announce(text), bell() } */
  constructor(world, settings = {}, hooks = {}) {
    this.world = world;
    this.hooks = hooks;
    this.settings = normalizeSettings(settings);
    this.env = new SeasonalEnvironment(world);
    this.place = 'hearth';
    this.preview = null; // { id: holiday id or 'season-N', hour }
    this.theme = null;
    this.set = null;
    this.setKey = '';
    this.leaving = [];
    this.effects = {};
    this.fireworks = null;
    this.firedShows = 0;
    this.lastCheck = -1;
    this.shownAt = 0;
    this.lingering = null;
    this.seen = readSeen();
    this.resetFireworks();
  }

  /** Shows already recorded in this state are history: they are never set off again (e.g. after a load). */
  resetFireworks() {
    this.playedShows = new Set((this.world.sim.state.holidays?.fireworks ?? []).map((f) => f.key));
  }

  get state() { return this.world.sim.state; }
  get quality() { return this.world.quality === 'low' ? 'low' : this.world.quality === 'medium' ? 'medium' : 'high'; }
  get reduced() { return prefersReducedMotion(this.settings); }
  get budget() { return budgetFor(this.quality, this.settings); }

  setSettings(settings) {
    this.settings = normalizeSettings(settings);
    this.setKey = ''; this.env.dressingKey = '';
    for (const k of Object.keys(this.effects)) { this.retire(this.effects[k]); delete this.effects[k]; }
    if (this.fireworks) { this.fireworks.stop(); this.retire(this.fireworks); this.fireworks = null; }
    this.check(true);
  }

  /** Change which place is drawn: 'hearth' or a kingdom id (with its KingdomScene). */
  setPlace(place, scene = null) {
    this.place = place;
    this.scene = scene;
    this.env.setPlace(place, scene);
    this.setKey = '';
    for (const k of Object.keys(this.effects)) { this.retire(this.effects[k]); delete this.effects[k]; }
    if (this.fireworks) { this.fireworks.stop(); this.retire(this.fireworks); this.fireworks = null; }
    this.check(true);
  }

  // --- Preview ---------------------------------------------------------------------------

  /** Show a season or holiday without touching the simulation. `id` is a holiday id or 'season-N'. */
  startPreview(id, { night = null } = {}) {
    const def = HOLIDAY_BY_ID[id];
    const season = def ? def.season : SEASON_THEMES.find((t) => t.id === id)?.season;
    if (season == null) return false;
    const darkByDefault = ['halloween', 'winter', 'newyear', 'solstice', 'founders'].includes(id);
    if (this.fireworks) this.fireworks.stop();
    this.preview = { id, season, holiday: def ?? null, hour: (night ?? darkByDefault) ? 21 : 12 };
    this.previewShows = 0;
    this.check(true);
    return true;
  }

  setPreviewNight(night) { if (this.preview) { this.preview.hour = night ? 21 : 12; this.check(true); } }

  /** Back to the kingdom's real season and holiday, immediately. */
  stopPreview() {
    this.preview = null;
    if (this.fireworks) this.fireworks.stop();
    this.check(true);
  }

  /** Replay the preview's fireworks (Preview tool only). */
  replayFireworks() { if (this.preview?.holiday?.fireworks) this.launchFireworks(); }

  // --- Theme -----------------------------------------------------------------------------

  /** The theme of the moment. Pure reading: it never changes the state. */
  resolve(now = Date.now()) {
    const s = this.state;
    const hour = s.minute / 60;
    if (this.preview) {
      const p = this.preview;
      const holiday = p.holiday ? { def: p.holiday, id: p.holiday.id, key: `preview-${p.id}`, phase: p.holiday.midnight ? 'day' : 'on', name: holidayName(p.holiday, 'on'), icon: p.holiday.icon, minutesToMidnight: null } : null;
      return { source: 'preview', season: p.season, t: 0.4, holiday, hour: p.hour };
    }
    if (this.settings.realCalendar) {
      const r = realWorldTheme(new Date(now), { enabled: s.holidays?.enabled });
      return { source: 'real', season: r.season, t: r.t, holiday: this.settings.effects ? r.holiday : null, hour };
    }
    const sp = seasonProgress(s.day, s.minute);
    let holiday = this.settings.effects ? holidayAt(s.day, s.minute, { enabled: s.holidays?.enabled, scale: DURATIONS[this.settings.duration] }) : null;
    // A holiday's look lasts at least `linger` real seconds, however fast time runs (until the next one begins).
    const t = performance.now();
    if (holiday) {
      if (this.lingering?.key !== holiday.key) this.shownAt = t;
      this.lingering = holiday;
    } else if (this.lingering && t - this.shownAt < this.settings.linger * 1000) {
      holiday = { ...this.lingering, phase: this.lingering.midnight ? 'day' : 'after', minutesToMidnight: null };
    } else this.lingering = null;
    return { source: 'game', season: sp.season, t: sp.t, holiday, hour };
  }

  /** About twice a second (or when forced): resolve the theme and apply it if anything changed. */
  check(force = false, time = performance.now() / 1000) {
    if (!force && time - this.lastCheck < 0.5) return;
    this.lastCheck = time;
    const theme = this.resolve();
    this.theme = theme;
    const sites = this.sites();
    const ctx = { state: this.state, settings: this.settings, budget: this.budget, reduced: this.reduced, sites: sites.sites, siteKey: sites.key, density: this.budget.decorations, trees: this.place === 'hearth' ? this.world.terrain.trees : [] };
    this.env.sync(theme, ctx);
    this.applyHoliday(theme, ctx);
    if (theme.source !== 'preview') this.announce(theme);
    this.watchFireworks(theme);
  }

  /** Decoration sites for the current place, recomputed only when the town's layout changes. */
  sites() {
    if (this.place !== 'hearth') {
      if (this.kingdomSites?.scene !== this.scene) this.kingdomSites = { scene: this.scene, value: this.scene?.decorSites() ?? null };
      return { sites: this.kingdomSites.value, key: this.place };
    }
    const sig = siteSignature(this.state);
    if (this.villageSig !== sig) { this.villageSig = sig; this.villageSitesValue = villageSites(this.state); this.villageKey = (this.villageKey ?? 0) + 1; }
    return { sites: this.villageSitesValue, key: 'v' + this.villageKey };
  }

  applyHoliday(theme, ctx) {
    const h = theme.holiday;
    const id = this.settings.effects ? h?.id ?? null : null;
    const key = id ? `${this.place}:${id}:${ctx.siteKey}:${ctx.density.toFixed(2)}:${this.quality}` : '';
    if (key !== this.setKey) {
      this.setKey = key;
      this.retire(this.set);
      this.set = null;
      if (id && ctx.sites) {
        const lanterns = this.env.palette?.lanterns;
        this.set = buildDecorations(id, { sites: ctx.sites, density: ctx.density, lanterns, trees: ctx.trees, seedKey: this.place, kingdom: this.place, kingdomColor: 'gold', extra: kingdomExtras(this.place, id) });
        this.env.root.add(this.set.group);
      }
    }
    // Effects that belong to the holiday (and its phase).
    const want = {};
    const e = h?.def?.effects ?? [];
    const b = ctx.budget, reduced = ctx.reduced;
    if (id && this.settings.atmosphere) {
      if (e.includes('hearts')) want.hearts = () => new FloatingHearts(b.particles * 0.16, { reducedMotion: reduced });
      if (id === 'valentine') want.blossom = () => new FallingLeaves('blossom', b.particles * 0.08, { reducedMotion: reduced });
      if (id === 'newyear' && h.phase !== 'eve') want.confetti = () => new FallingLeaves('confetti', b.particles * 0.2, { reducedMotion: reduced });
      if (e.includes('sparks') && ctx.sites?.features?.[0]) { const [x, z] = ctx.sites.features[0]; want.sparks = () => new FloatingHearts(b.particles * 0.06, { kind: 'sparks', reducedMotion: reduced, center: { x, z } }); }
      if (e.includes('ghosts')) want.ghosts = () => new Ghosts(ctx.sites?.ghosts ?? [[0, 0]], { ghosts: Math.max(2, Math.round(b.flyers * 0.5)), bats: reduced ? 2 : b.flyers, reducedMotion: reduced });
    }
    for (const [k, make] of Object.entries(want)) if (!this.effects[k]) { const fx = make(); this.effects[k] = fx; for (const o of fx.objects ?? [fx.object]) this.env.root.add(o); }
    for (const k of Object.keys(this.effects)) if (!want[k]) { this.retire(this.effects[k]); delete this.effects[k]; }
    // A preview of a holiday with fireworks plays one show on entry.
    if (theme.source === 'preview' && h?.def?.fireworks && !this.previewShows) { this.previewShows = 1; this.launchFireworks(); }
    if (theme.source === 'real' && h?.def?.fireworks && this.realShown !== h.key) { this.realShown = h.key; this.launchFireworks(); }
  }

  announce(theme) {
    const h = theme.holiday;
    // Wait until there is somewhere to say it (the HUD attaches after the world starts).
    if (!h || !this.hooks.announce || this.seen.includes(h.key)) return;
    this.seen.push(h.key);
    writeSeen(this.seen);
    const where = this.place === 'hearth' ? 'First Hearth' : KINGDOMS[this.place]?.name ?? 'the kingdom';
    this.hooks.announce?.(`${h.icon} ${h.name} in ${where}: ${h.phase === 'day' && h.def.dayText ? h.def.dayText : h.def.text}.`);
  }

  /** New fireworks recorded by the simulation (once per occurrence) set off a show here. */
  watchFireworks(theme) {
    if (theme.source !== 'game') return;
    for (const f of this.state.holidays?.fireworks ?? []) {
      if (this.playedShows.has(f.key)) continue;
      this.playedShows.add(f.key);
      if (this.settings.fireworks && this.settings.effects) this.launchFireworks();
      if (f.id === 'newyear' && this.settings.sound) this.hooks.bell?.();
    }
  }

  launchFireworks() {
    if (!this.settings.fireworks || !this.settings.effects) return;
    if (!this.fireworks) {
      this.fireworks = new Fireworks(this.budget.fireworks, { reducedMotion: this.reduced });
      this.env.root.add(this.fireworks.object);
      this.fireworks.update(0, this.clock ?? performance.now() / 1000);
    }
    const sites = this.sites().sites;
    this.fireworks.launchShow({ origins: sites?.fireworks ?? [[0, 0]], duration: this.reduced ? 16 : 24, height: sites?.fireworksHeight });
    this.firedShows++;
  }

  retire(x) { if (x) { x.fadeOut?.(); this.leaving.push(x); } }

  /** Per frame: cheap updates only (uniforms, a few moving props). */
  update(dt, time, center, night) {
    this.clock = time;
    this.check(false, time);
    // World units to pixels at unit distance, for particle sizes: drawing-buffer height over the view's vertical extent.
    const fov = ((this.world.camera?.fov ?? 45) * Math.PI) / 180;
    const pixelScale = (this.world.renderer?.domElement?.height ?? 900) / (2 * Math.tan(fov / 2));
    const calm = this.reduced ? 0.4 : 1;
    const env = { weather: this.env.weather, pixelScale };
    this.env.update(dt, time, center, { pixelScale, reduced: this.reduced, night });
    this.set?.update(dt, time, { night, calm });
    for (const fx of Object.values(this.effects)) fx instanceof Ghosts ? fx.update(dt, time) : fx.update(dt, time, center, env);
    this.fireworks?.update(dt, time, pixelScale);
    this.leaving = this.leaving.filter((x) => {
      if (x instanceof DecorationSet) x.update(dt, time, { night, calm });
      else if (x instanceof Ghosts) x.update(dt, time);
      else if (x instanceof Fireworks) x.update(dt, time, pixelScale);
      else x.update(dt, time, center, env);
      const done = x instanceof Fireworks ? !x.active : x.faded;
      if (!done) return true;
      for (const o of x.objects ?? [x.object ?? x.group]) o?.parent?.remove(o);
      x.dispose();
      return false;
    });
  }

  /** What the HUD shows: the holiday (with the New Year countdown) and what is coming up. */
  get status() {
    const t = this.theme;
    if (!t) return null;
    const s = this.state;
    return {
      source: t.source, season: t.season, holiday: t.holiday ? { id: t.holiday.id, name: t.holiday.name, icon: t.holiday.icon, phase: t.holiday.phase, minutesToMidnight: t.holiday.minutesToMidnight ?? null } : null,
      next: t.source === 'game' ? nextHoliday(s.day, s.minute, { enabled: s.holidays?.enabled, scale: DURATIONS[this.settings.duration] }) : null,
      preview: this.preview?.id ?? null, decorations: this.set?.count ?? 0, fireworks: !!this.fireworks?.active,
    };
  }

  dispose() {
    for (const x of [this.set, ...Object.values(this.effects), this.fireworks, ...this.leaving]) x?.dispose();
    this.env.dispose();
  }
}
