import { Simulation } from '../sim/Simulation.js';
import { createKingdom } from '../sim/Setup.js';
import { GameClock } from './GameClock.js';
import { SaveManager } from './SaveManager.js';
import { World, WebGLUnavailableError } from '../world/World.js';
import { HUD } from '../ui/HUD.js';

/* global __BUILD__ */
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
const SETTINGS_KEY = 'kingdom-of-nobodies-settings';
const AUTOSAVE_MS = 60000;

// Application wiring: load or create the kingdom, start the renderer and UI,
// run the frame loop and keep the world saved.
export class Game {
  constructor() {
    this.build = BUILD;
    this.saves = new SaveManager(BUILD);
    this.settings = { labels: true, quality: null, ...readSettings() };
    this.frameTimes = [];
  }

  async start() {
    const { state, source } = await this.saves.load();
    this.loadSource = source;
    this.sim = new Simulation(state ?? createKingdom(Math.floor(Math.random() * 1e9)));
    this.clock = new GameClock(() => this.sim.step());
    this.startWorld();
    this.hud = new HUD(this);
    if (this.world) this.world.onPick = (kind, id) => (kind === 'memorial' ? this.hud.showMemorial() : this.hud.openDetail(kind, id, { push: false }));
    this.lastChronicle = this.sim.state.nextId.chronicle;
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    setInterval(() => this.save(), AUTOSAVE_MS);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saves.saveNow(this.sim.state); });
    window.addEventListener('pagehide', () => this.saves.saveNow(this.sim.state));
    if (source) this.hud.toasts.show(source.includes('Milestone 1') ? 'Your First Hearth village has been brought into the Living Society.' : `Welcome back. Day ${this.sim.state.day} continues.`);
    if (!state) this.save();
  }

  startWorld() {
    const container = document.getElementById('world');
    try {
      this.world = new World(container, this.sim, { quality: this.settings.quality ?? 'high', labels: this.settings.labels });
      this.world.setLabels(this.settings.labels);
    } catch (e) {
      this.world = null;
      const fallback = document.getElementById('world-fallback');
      fallback.hidden = false;
      fallback.innerHTML = e instanceof WebGLUnavailableError
        ? '<div><strong>3D view unavailable</strong><br>This browser could not start WebGL, so the village can’t be drawn. The simulation is still running — use the tabs below to follow your citizens.</div>'
        : `<div><strong>The 3D view failed to start</strong><br>${String(e.message).replace(/</g, '&lt;')}<br>The simulation keeps running; use the tabs below.</div>`;
      console.error(e);
    }
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    try {
      this.clock.advance(dt);
      this.announce();
      if (this.world) {
        this.world.render(dt, now / 1000);
        this.autoQuality(dt);
      }
      this.hud.update(now);
    } catch (e) {
      console.error(e);
      if (!this.errorShown) { this.errorShown = true; this.hud?.toasts.show(`Something went wrong: ${e.message}`, { bad: true, ms: 8000 }); }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Toast milestone chronicle entries as they happen. */
  announce() {
    const s = this.sim.state;
    if (s.nextId.chronicle === this.lastChronicle) return;
    for (const e of s.chronicle) if (e.id > this.lastChronicle && e.importance >= 3) this.hud.toasts.show(e.text);
    this.lastChronicle = s.nextId.chronicle;
  }

  /** If the device struggles during the first seconds and the player has not chosen, switch to battery-saver graphics. */
  autoQuality(dt) {
    if (this.settings.quality || this.qualityChecked) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 240) return;
    this.qualityChecked = true;
    const avg = this.frameTimes.slice(60).reduce((a, b) => a + b, 0) / (this.frameTimes.length - 60);
    if (avg > 1 / 38) { this.world.setQuality('low'); this.hud.toasts.show('Switched to battery-saver graphics for smoother play.'); }
  }

  setSetting(key, value) {
    this.settings[key] = value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    if (key === 'labels') this.world?.setLabels(value);
    if (key === 'quality') this.world?.setQuality(value);
  }

  async save(announce = false) {
    const ok = await this.saves.save(this.sim.state);
    if (announce) this.hud.toasts.show(ok ? 'Kingdom saved on this device.' : 'Saving is unavailable in this browser.', { bad: !ok });
    return ok;
  }

  lastSavedText() {
    const d = this.saves.lastSaved;
    return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  }

  async newKingdom() {
    await this.saves.clear();
    this.replaceState(createKingdom(Math.floor(Math.random() * 1e9)));
    this.hud.toasts.show('A new kingdom begins. Five strangers light the first hearth.');
    this.save();
  }

  async importSave(file) {
    try {
      const state = await this.saves.importFile(file);
      this.replaceState(state);
      await this.save();
      this.hud.toasts.show(`Imported a kingdom on day ${state.day}.`);
    } catch (e) {
      this.hud.toasts.show(`Import failed: ${e.message}`, { bad: true, ms: 7000 });
    }
  }

  async restoreSnapshot() {
    const state = await this.saves.loadSnapshot();
    if (!state) { this.hud.toasts.show('No recovery snapshot has been taken yet.', { bad: true }); return; }
    this.replaceState(state);
    await this.save();
    this.hud.toasts.show(`Restored the recovery snapshot from day ${state.day}.`);
  }

  replaceState(state) {
    this.sim.state = state;
    state.events = [];
    this.sim.selected = { kind: 'citizen', id: state.citizens[0]?.id ?? null };
    this.lastChronicle = state.nextId.chronicle;
    if (this.world) this.world.syncPlots(true);
    this.hud.openTab('citizens');
  }
}

function readSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {}; } catch { return {}; }
}
