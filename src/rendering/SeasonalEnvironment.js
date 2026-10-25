import * as THREE from 'three';
import { blendedPalette, withAccent, paletteFor } from '../holidays/SeasonalPalette.js';
import { SNOW_UNIFORMS, snowCover, localWeather, CLIMATES } from '../effects/SnowAccumulation.js';
import { Snowfall } from '../effects/Snowfall.js';
import { FallingLeaves } from '../effects/FallingLeaves.js';
import { ParticleField, GroundFog } from '../effects/AmbientParticles.js';
import { buildDecorations, DecorationSet } from '../holidays/DecorationSpawner.js';
import { addSnow } from '../effects/SnowAccumulation.js';
import { mat, PALETTE as P } from '../world/Materials.js';
import { litWindow } from '../world/Models.js';
import { geometryFor } from '../world/HolidayProps.js';

// The season made visible. Given the theme of the moment (season, how far
// into it, any holiday and where we are), this colours the land, trees, sky
// and light from the seasonal palette, dresses the town for the season
// (spring flower beds and blossom, summer flowers and pennants, autumn hay,
// pumpkins and fallen leaves), runs the season's ambient life (butterflies,
// fireflies, drifting leaves and petals, clouds, mist) and lays snow from the
// simulation's own weather. Colours ease towards their targets over a few
// seconds, so a change of season or holiday is a transition, not a cut.

const tmp = new THREE.Color(), tmp2 = new THREE.Color();
const ease = (dt, rate = 0.9) => Math.min(1, dt * rate);

export class SeasonalEnvironment {
  /** world: the World (scene, terrain, sim, quality). */
  constructor(world) {
    this.world = world;
    this.place = 'hearth';
    this.root = new THREE.Group();
    this.root.name = 'seasonal';
    world.scene.add(this.root);
    this.colors = { grass: new THREE.Color(P.grass), leaf: new THREE.Color(P.leaf), leafDark: new THREE.Color(P.leafDark), pine: new THREE.Color(P.pine), sky: new THREE.Color('#a9d4dc'), sun: new THREE.Color('#fff1d6'), hemiSky: new THREE.Color('#d8ecff'), hemiGround: new THREE.Color('#5b6e45') };
    this.targets = null;
    this.sunPower = 1; this.fogScale = 1; this.dim = 1; this.night = 1;
    this.leafMats = [mat(P.leaf), mat(P.leafDark), mat(P.pine)];
    this.groundBase = world.terrain.ground.material.color.clone();
    this.baseGrass = new THREE.Color(P.grass);
    this.roadBase = Object.fromEntries(Object.entries(world.terrain.roadMaterials).map(([k, m]) => [k, m.color.clone()]));
    SNOW_UNIFORMS.uSnowColor.value = new THREE.Color('#f6f9fd');
    this.cover = 0; this.coverTarget = 0;
    this.dressing = null; this.dressingKey = '';
    this.leaving = [];
    this.effects = {};
    this.clouds = null;
    // The village's tree crowns get their own white materials so each tree's
    // shade can be its own colour (autumn's mix of orange, gold and red).
    this.crowns = [world.terrain.roundCrowns, world.terrain.forestCrowns].filter(Boolean).map((mesh, i) => {
      mesh.material = addSnow(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }));
      const start = new THREE.Color(i ? P.leafDark : P.leaf);
      const cur = Array.from({ length: mesh.count }, () => start.clone());
      cur.forEach((c, k) => mesh.setColorAt(k, c));
      return { mesh, cur, offset: i };
    });
  }

  /** Switch to another place: 'hearth', or a kingdom with its scene (ground meshes and layout). */
  setPlace(place, scene = null) {
    this.place = place;
    this.kingdomScene = scene;
    this.kingdomGround = scene ? scene.layout.geos[0] : null;
    this.kingdomGroundBase = this.kingdomGround ? this.kingdomGround.material.color.clone() : null;
    this.dressingKey = '';
    this.retire(this.dressing); this.dressing = null;
    for (const k of Object.keys(this.effects)) { this.retire(this.effects[k]); delete this.effects[k]; }
  }

  retire(thing) { if (thing) { thing.fadeOut(); this.leaving.push(thing); } }

  /**
   * About twice a second: set colour targets and rebuild what the theme
   * calls for. theme: { season, t, holiday, source, hour }; ctx: { state,
   * settings, budget, reduced, sites, density, trees }.
   */
  sync(theme, ctx) {
    const kingdom = this.place;
    const pal = withAccent(blendedPalette(theme.season, theme.t, kingdom), theme.holiday?.id);
    if (!ctx.settings.atmosphere) Object.assign(pal, paletteFor(1, kingdom), { lanterns: pal.lanterns, dim: 1, night: 1 });
    this.palette = pal;
    this.targets = pal;
    // Snow: from the simulation's weather on the kingdom calendar; a fixed seasonal look when previewing or following the real calendar.
    const climate = CLIMATES[kingdom] ?? CLIMATES.hearth;
    let cover = 0, frost = 0;
    if (theme.source === 'game') ({ cover, frost } = snowCover(ctx.state, kingdom));
    else if (theme.season === 3) { cover = Math.min(1, 0.55 * climate.snow); frost = climate.frost; }
    if (theme.holiday?.id === 'winter') cover = Math.max(cover, Math.min(0.5, 0.35 * climate.snow));
    if (this.coverSource !== theme.source || this.coverPlace !== kingdom || theme.source === 'preview' && this.coverPreview !== theme.holiday?.id + ':' + theme.season) this.coverFast = 2.5;
    this.coverSource = theme.source; this.coverPlace = kingdom; this.coverPreview = theme.holiday?.id + ':' + theme.season;
    this.coverTarget = cover;
    SNOW_UNIFORMS.uFrost.value = frost;
    // Season dressing (rebuilt when the season or the town changes).
    const season = theme.season;
    const key = `${kingdom}:${season}:${ctx.siteKey}:${ctx.settings.effects ? ctx.density.toFixed(2) : 'off'}`;
    if (key !== this.dressingKey) {
      this.dressingKey = key;
      this.retire(this.dressing);
      this.dressing = ctx.settings.effects && ctx.sites ? buildDecorations(`season-${season}`, { sites: ctx.sites, density: ctx.density, trees: ctx.trees, seedKey: kingdom }) : null;
      if (this.dressing) this.root.add(this.dressing.group);
    }
    this.syncEffects(theme, ctx);
  }

  /** The season's ambient life and weather particles, each bounded by the budget. */
  syncEffects(theme, ctx) {
    const { budget, reduced, settings } = ctx;
    const weather = theme.source === 'game' ? localWeather(ctx.state, this.place) : { kind: theme.season === 3 ? 'snow' : 'clear', intensity: 0.5 };
    this.weather = weather;
    const hour = theme.hour;
    const day = hour >= 7 && hour < 19, dusk = hour >= 19 || hour < 4;
    const want = {};
    const snowy = weather.kind === 'snow' || (theme.holiday?.id === 'winter' && weather.kind !== 'rain' && (CLIMATES[this.place]?.snow ?? 1) > 0.5);
    if (settings.snow && snowy) want.snow = () => new Snowfall(budget.particles * (weather.kind === 'snow' ? 1 : 0.35), { reducedMotion: reduced });
    if (settings.atmosphere) {
      if (theme.season === 2 && !snowy) want.leaves = () => new FallingLeaves('leaves', budget.particles * 0.18, { reducedMotion: reduced });
      if (theme.season === 0 && day && weather.kind !== 'rain') want.petals = () => new FallingLeaves('petals', budget.particles * 0.1, { reducedMotion: reduced });
      if ((theme.season === 0 || theme.season === 1) && day && weather.kind !== 'rain') want.butterflies = () => new ParticleField({ count: Math.max(6, Math.round(budget.flyers * 1.5)), area: [60, 3, 60], floor: 0.6, shape: 'butterfly', motion: 'hover', colors: ['#ffd23c', '#ff8fc0', '#7fd3ff', '#ffffff', '#ffa040'], size: 0.55, speed: 1, opacity: 0.95, seed: 9 });
      if (theme.season === 1 && dusk && weather.kind !== 'rain') want.fireflies = () => new ParticleField({ count: Math.max(12, Math.round(budget.particles * 0.08)), area: [70, 3, 70], floor: 0.5, shape: 'glow', motion: 'hover', colors: ['#d8ff6a', '#fff27a', '#b8ff8a'], size: 0.3, speed: 1, opacity: 1, additive: true, seed: 13 });
      const misty = weather.kind === 'fog' || (theme.season === 3 && (hour < 9 || hour > 17)) || this.palette.groundFog;
      if (misty) want.fog = () => new GroundFog(budget.fog, { color: this.palette.fogTint ?? (theme.season === 3 ? '#e4ecf6' : '#d8dce8'), opacity: this.palette.groundFog ? 0.5 : 0.35 });
    }
    for (const [k, make] of Object.entries(want)) if (!this.effects[k]) { const e = make(); this.effects[k] = e; for (const o of e.objects ?? [e.object]) this.root.add(o); }
    for (const k of Object.keys(this.effects)) if (!want[k]) { this.retire(this.effects[k]); delete this.effects[k]; }
    this.syncClouds(theme, budget, weather);
  }

  syncClouds(theme, budget, weather) {
    const n = Math.round(budget.clouds * ([0.7, 0.6, 0.9, 0.7][theme.season] + (weather.kind === 'rain' || weather.kind === 'snow' ? 0.4 : 0)));
    if (this.clouds?.length === n) return;
    if (this.clouds) for (const c of this.clouds) this.root.remove(c);
    this.cloudMat ??= new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
    let s = 77;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    this.clouds = Array.from({ length: n }, (_, i) => {
      const g = new THREE.Group();
      for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(geometryFor('ico'), this.cloudMat); m.scale.set(6 + rand() * 5, 2.2 + rand() * 1.4, 5 + rand() * 3); m.position.set((k - 1.5) * 4, rand() * 1.2, (rand() - 0.5) * 3); g.add(m); }
      g.userData = { x: (rand() - 0.5) * 300, z: -60 + rand() * 120, y: 44 + rand() * 14, v: 1.2 + rand() * 1.6 };
      g.position.set(g.userData.x, g.userData.y, g.userData.z);
      this.root.add(g);
      return g;
    });
  }

  /** Per frame: ease colours, apply them, move the ambient effects. */
  update(dt, time, center, { pixelScale, reduced, night = 0 }) {
    const t = this.targets;
    if (t) {
      const k = ease(dt, 0.8);
      for (const key of ['grass', 'leaf', 'leafDark', 'pine', 'sky', 'sun', 'hemiSky', 'hemiGround']) this.colors[key].lerp(tmp.set(t[key]), k);
      this.sunPower += (t.sunPower - this.sunPower) * k;
      this.fogScale += (t.fog - this.fogScale) * k;
      this.dim += (t.dim - this.dim) * k;
      this.night += (t.night - this.night) * k;
      this.apply(t, k);
    }
    // Snow settles and melts gradually; a change of preview or place switches within a second or two.
    this.cover += (this.coverTarget - this.cover) * ease(dt, this.coverFast > 0 ? 3 : 0.35);
    this.coverFast = Math.max(0, (this.coverFast ?? 0) - dt);
    SNOW_UNIFORMS.uSnow.value = this.cover;
    // Windows glow on long evenings; holiday nights glow brighter still.
    this.windowBoost = 1 + (this.night - 1) * night;
    const calm = reduced ? 0.4 : 1;
    this.dressing?.update(dt, time, { night, calm });
    const env = { weather: this.weather, pixelScale };
    for (const e of Object.values(this.effects)) e.update(dt, time, center, env);
    for (const c of this.clouds ?? []) {
      const u = c.userData;
      u.x += u.v * dt * calm;
      if (u.x > 160) u.x = -160;
      c.position.set(u.x, u.y, u.z);
    }
    this.leaving = this.leaving.filter((x) => {
      if (x instanceof DecorationSet) x.update(dt, time, { night, calm });
      else x.update(dt, time, center, env);
      if (!x.faded) return true;
      for (const o of x.objects ?? [x.object ?? x.group]) o?.parent?.remove(o);
      x.dispose();
      return false;
    });
  }

  apply(pal, k = 1) {
    const terrain = this.world.terrain;
    if (this.place === 'hearth') {
      // Ground: vertex colours keep their variation; the material colour moves them to the season.
      tmp.copy(this.colors.grass);
      terrain.ground.material.color.setRGB(this.groundBase.r * tmp.r / this.baseGrass.r, this.groundBase.g * tmp.g / this.baseGrass.g, this.groundBase.b * tmp.b / this.baseGrass.b);
      for (const [k, m] of Object.entries(terrain.roadMaterials)) m.color.copy(this.roadBase[k]).lerp(tmp2.set(pal.road.tint), pal.road.amount);
      terrain.petals.visible = (pal.flowers ?? 0) > 0;
      this.easeCrowns(pal.crowns, k);
    } else if (this.kingdomGround) {
      const summer = tmp2.set(paletteFor(1, this.place).grass);
      tmp.copy(this.colors.grass);
      const b = this.kingdomGroundBase;
      this.kingdomGround.material.color.setRGB(b.r * tmp.r / summer.r, b.g * tmp.g / summer.g, b.b * tmp.b / summer.b);
    }
    this.leafMats[0].color.copy(this.colors.leaf);
    this.leafMats[1].color.copy(this.colors.leafDark);
    this.leafMats[2].color.copy(this.colors.pine);
  }

  /** Ease each crown towards its own shade from the season's list. Stops writing once settled. */
  easeCrowns(crowns, k) {
    if (!crowns) return;
    for (const { mesh, cur, offset } of this.crowns) {
      let moved = false;
      for (let i = 0; i < cur.length; i++) {
        tmp.set(crowns[(i * 7 + offset * 3) % crowns.length]);
        const c = cur[i];
        if (Math.abs(c.r - tmp.r) + Math.abs(c.g - tmp.g) + Math.abs(c.b - tmp.b) < 0.004) continue;
        c.lerp(tmp, k);
        mesh.setColorAt(i, c);
        moved = true;
      }
      if (moved && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Colours for the sky and light, read by World.updateSky. */
  get sky() { return { day: this.colors.sky, sun: this.colors.sun, sunPower: this.sunPower * this.dim, hemiSky: this.colors.hemiSky, hemiGround: this.colors.hemiGround, fog: this.fogScale, windows: this.windowBoost ?? 1 }; }

  dispose() {
    this.retire(this.dressing);
    for (const x of [...this.leaving, ...Object.values(this.effects)]) x.dispose();
    this.leaving = [];
    this.effects = {};
    this.world.scene.remove(this.root);
  }
}

export { litWindow };
