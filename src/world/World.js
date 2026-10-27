import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrain } from './Terrain.js';
import { TIME } from '../core/Config.js';
import { buildingModel, constructionModel, forSaleSign, litWindow, forgeGlow, memorialModel, fireModel } from './Models.js';
import { Villagers } from './Villagers.js';
import { CaravanLayer } from './Caravans.js';
import { navGrid } from '../navigation/NavigationGrid.js';
import { routeById } from '../region/RegionManager.js';
import { GATES } from '../navigation/RoadNetwork.js';
import { festivalModel } from './Festival.js';
import { mat, G, part, PALETTE as P } from './Materials.js';
import { stagesFor } from '../property/Construction.js';
import { facingAngle } from '../property/LandRegistry.js';
import { isTrading } from '../economy/Businesses.js';
import { seasonIndex } from '../core/Calendar.js';
import { byId } from '../core/EntityRegistry.js';
import { KingdomScene, soldierBlock } from './KingdomScene.js';
import { BattleView } from './BattleView.js';
import { WeatherLayer } from './WeatherLayer.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';
import { HolidayThemeManager } from '../holidays/HolidayThemeManager.js';
import { buildingDims } from '../property/Footprints.js';
import { eraForType } from '../civilization/Architecture.js';
import { serviceIn } from '../civilization/Infrastructure.js';
import { propertyOn } from '../civilization/PropertyHistory.js';
import { bakeGroup, disposeBaked } from './Bake.js';
import { massingModel } from './ProceduralArchitecture.js';
import { setFacadeGlow, setGlassEnvironment } from './Facades.js';
import { VehicleLayer } from './Vehicles.js';
import { HiddenHandLayer } from './HiddenHandLayer.js';

/** Buildings taller than this get a distant stand-in (level of detail) and may fade when they hide a villager. */
const TALL = 18;
/** Plot models rebuilt per sync at most (a redevelopment wave is spread over several frames). */
const REBUILDS_PER_SYNC = 8;

// Seasons, holidays, snow and their effects are drawn by the HolidayThemeManager
// (src/holidays) and the SeasonalEnvironment it drives (src/rendering).
const LABEL_LIMIT = 14;

// The Three.js presentation of the simulation. It only reads simulation state;
// all changes flow the other way through Simulation methods.

export class WebGLUnavailableError extends Error {}

const OUTLINE = { FOR_SALE: '#cdb36a', BUILDING: '#ff9a3c', OWNED: '#f4efe2', COUNCIL: '#9fc3e6', SELECTED: '#ffffff' };

export class World {
  constructor(container, sim, { quality = 'high', labels = true, holidays = {} } = {}) {
    this.container = container;
    this.sim = sim;
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
    } catch (e) {
      throw new WebGLUnavailableError(e.message);
    }
    if (!this.renderer.getContext()) throw new WebGLUnavailableError('No WebGL context');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.dayColor = new THREE.Color('#a9d4dc');
    this.duskColor = new THREE.Color('#e7a27a');
    this.nightColor = new THREE.Color('#14223d');
    this.greyColor = new THREE.Color('#8f9aa3');
    this.tmpColor = new THREE.Color();
    this.scene.background = this.dayColor.clone();
    this.scene.fog = new THREE.Fog(this.scene.background, 120, 290);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 520);
    this.camera.position.set(34, 40, 52);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, minDistance: 10, maxDistance: 160, maxPolarAngle: Math.PI * 0.46, enablePan: true, screenSpacePanning: false });
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.target.set(0, 0, 2);

    this.hemi = new THREE.HemisphereLight('#d8ecff', '#5b6e45', 1.6);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    this.sun.castShadow = true;
    Object.assign(this.sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 160 });
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // Everything that belongs to First Hearth lives under one group, so a visit
    // to another kingdom (or a battle replay) can hide it without rebuilding it.
    this.village = new THREE.Group();
    this.scene.add(this.village);
    this.mode = 'village';
    this.away = null;
    this.terrain = buildTerrain(this.village);
    this.plotLayer = new THREE.Group();
    this.village.add(this.plotLayer);
    this.plotNodes = new Map();
    this.market = null;
    this.villagers = new Villagers(this.village);
    this.vehicles = new VehicleLayer(this.village);
    this.cranes = [];
    this.skyline = 0;
    this.ghosts = new Map();
    this.thenNow = null;
    this.renderer.localClippingEnabled = false;
    this.fires = new Map();
    this.caravans = new CaravanLayer(this.village);
    this.weather = new WeatherLayer(this.scene);
    this.militia = null;
    this.militiaKey = '';
    this.followCaravanId = null;
    this.festivalDecor = null;
    this.festivalKey = '';
    this.roadBase = Object.fromEntries(Object.entries(this.terrain.roadMaterials).map(([k, m]) => [k, m.color.clone()]));
    this.roadWorks = new Map();
    this.roadWorkLayer = new THREE.Group();
    this.village.add(this.roadWorkLayer);
    this.memorial = null;
    this.hand = new HiddenHandLayer(this);
    this.followId = null;
    this.night = 0;

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);
    this.labelEls = new Map();
    this.showLabels = labels;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.focus = null;
    this.lastSync = -1;
    this.v = new THREE.Vector3();
    this.down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; this.focus = null; this.followId = null; this.followCaravanId = null; });
    el.addEventListener('pointerup', (e) => this.pick(e));
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.quality = quality;
    this.themes = new HolidayThemeManager(this, holidays);
    this.setQuality(quality);
    this.syncPlots(true);
    this.refreshSkyline();
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    // Three levels: high (full resolution, soft 2048 shadows), medium (lighter shadows), low (battery saver: no shadows).
    this.renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1.25) * (this.resolutionScale ?? 1));
    // Glass reflects a small pre-filtered sky except in battery-saver mode.
    if (q === 'low') setGlassEnvironment(null);
    else setGlassEnvironment(this.glassSky ??= skyEnvironment(this.renderer));
    this.renderer.shadowMap.enabled = q !== 'low';
    const map = q === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(map, map);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this.weather?.setQuality(q);
    if (this.themes) this.themes.setSettings(this.themes.settings);
    this.resize();
  }

  // --- Views: First Hearth, a visited kingdom, a battle replay -----------------------

  /** Enter another kingdom's 3D scene (or come home with 'hearth'). Simulation time runs on regardless. */
  visit(kid) {
    if (!kid || kid === HEARTH) return this.home();
    this.clearAway();
    this.away = new KingdomScene(this.sim.state, kid);
    this.scene.add(this.away.group);
    this.village.visible = false;
    this.mode = 'kingdom';
    this.awayId = kid;
    this.themes.setPlace(kid, this.away);
    this.followId = null; this.followCaravanId = null;
    this.flyTo(0, 4, 85);
  }

  /** Replay a recorded battle on stylised ground. */
  showBattle(battle) {
    if (!battle) return;
    this.clearAway();
    this.away = new BattleView(battle);
    this.scene.add(this.away.group);
    this.village.visible = false;
    this.mode = 'battle';
    this.awayId = battle.id;
    this.themes.setPlace('battle', null);
    this.flyTo(0, 0, 55);
  }

  home() {
    this.clearAway();
    this.village.visible = true;
    this.mode = 'village';
    this.awayId = null;
    this.themes.setPlace('hearth');
    this.flyTo(0, 2, 70);
  }

  clearAway() {
    // Name labels belong to whichever place is on screen; they are rebuilt for the new view.
    for (const el of this.labelEls.values()) el.remove();
    this.labelEls.clear();
    if (!this.away) return;
    this.scene.remove(this.away.group);
    this.away.dispose();
    this.away = null;
  }

  /** Smoothly move the camera to look at a point from a given distance. */
  flyTo(x, z, distance = null) {
    this.focus = new THREE.Vector3(x, 0, z);
    this.focusDistance = distance;
  }

  /** The whole settlement from above. */
  overview() { this.followId = null; this.followCaravanId = null; this.flyTo(0, 2, this.mode === 'village' ? 120 : 90); }

  /** First Hearth's militia, drawn at the north gate while it musters or stands ready. */
  syncMilitia() {
    const armies = (this.sim.state.military?.armies ?? []).filter((a) => a.owner === HEARTH && ['MUSTERING', 'READY'].includes(a.status));
    const key = armies.map((a) => `${a.id}:${a.soldiers}`).join(',');
    if (key === this.militiaKey) return;
    this.militiaKey = key;
    if (this.militia) { this.village.remove(this.militia); this.militia = null; }
    if (!armies.length) return;
    this.militia = new THREE.Group();
    armies.forEach((a, i) => {
      const block = soldierBlock(Math.min(20, Math.max(4, a.citizenIds.length * 2)), '#e8c06a');
      block.position.set(-6 + i * 10, 0, -70);
      block.traverse((o) => { o.userData.armyId = a.id; });
      this.militia.add(block);
    });
    this.village.add(this.militia);
  }

  setLabels(on) { this.showLabels = on; this.labelLayer.style.display = on ? '' : 'none'; }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 52 : 42;
    // Keep the village centred in the part of the screen the bottom sheet leaves visible.
    const inset = Math.min(this.bottomInset ?? 0, h * 0.6);
    if (inset > 0) this.camera.setViewOffset(w, h, 0, inset * 0.45, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** Adaptive resolution: a fraction of the quality preset's pixel ratio (0.6..1). */
  setResolutionScale(v) {
    const next = Math.max(0.6, Math.min(1, Math.round(v * 10) / 10));
    if (next === (this.resolutionScale ?? 1)) return;
    this.resolutionScale = next;
    const dpr = window.devicePixelRatio || 1;
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1.25) * next);
    this.resize();
  }

  setBottomInset(px) {
    if (Math.abs((this.bottomInset ?? 0) - px) < 2) return;
    this.bottomInset = px;
    this.resize();
  }

  /** Rebuild plot visuals whose state signature changed. */
  syncPlots(force = false) {
    const s = this.sim.state;
    const season = seasonIndex(s.day);
    const burning = new Set((s.fires ?? []).map((f) => f.plotId));
    let budget = force ? Infinity : REBUILDS_PER_SYNC;
    let cranesChanged = false;
    for (const plot of s.plots) {
      const project = plot.projectId ? s.projects.find((p) => p.id === plot.projectId) : null;
      const business = plot.businessId ? s.businesses.find((b) => b.id === plot.businessId) : null;
      const stageProgress = project ? stageFraction(project) : 0;
      const open = business ? isTrading(business) : plot.building && ['bakery', 'tavern', 'general_store', 'blacksmith', 'lumberyard', 'stall'].includes(plot.building.type) ? false : undefined;
      const status = project ? 'BUILDING' : plot.marketStatus === 'FOR_SALE' ? 'FOR_SALE' : plot.ownerId === 'council' ? 'COUNCIL' : 'OWNED';
      const selected = this.sim.selected.kind === 'plot' && this.sim.selected.id === plot.id;
      const b = plot.building;
      const sig = [b?.type, b?.level, (b?.condition ?? 100) < 60, b?.era, b?.seed, b?.floors, plot.constructionStatus, project?.kind, project?.buildingType, project?.targetEra, Math.round(stageProgress * 4), open, status, selected, business?.type, burning.has(plot.id), business?.type === 'farm' || b?.type === 'farm' ? season : ''].join('|');
      let node = this.plotNodes.get(plot.id);
      if (node && node.userData.sig === sig && !force) continue;
      // A selection change is cheap and immediate; heavy rebuilds are spread across frames.
      if (node && budget <= 0 && node.userData.sig.split('|').slice(0, 12).join('|') !== sig.split('|').slice(0, 12).join('|')) continue;
      budget--;
      if (node) { this.plotLayer.remove(node); disposeBaked(node); this.unghost(plot.id); }
      node = this.makePlot(plot, project, business, stageProgress, open, status, selected, burning.has(plot.id), season);
      node.userData.sig = sig;
      // Then & Now draws this property itself; the real building stays hidden until it ends.
      if (this.thenNow?.plotId === plot.id) node.visible = false;
      this.plotLayer.add(node);
      this.plotNodes.set(plot.id, node);
      cranesChanged = true;
    }
    for (const [id, node] of this.plotNodes) if (!s.plots.some((p) => p.id === id)) { this.plotLayer.remove(node); disposeBaked(node); this.plotNodes.delete(id); cranesChanged = true; }
    if (cranesChanged || force) this.refreshSkyline();
    if (s.council.marketplace && !this.market) this.market = this.makeMarket();
    else if (!s.council.marketplace && this.market) { this.village.remove(this.market); disposeBaked(this.market); this.market = null; }
    this.syncMemorial();
    this.syncRoadWorks();
  }

  /** After plots change: the cranes to animate, the skyline height, and camera limits that fit it. */
  refreshSkyline() {
    this.cranes = [];
    let top = 0;
    for (const node of this.plotNodes.values()) {
      for (const c of node.userData.cranes ?? []) this.cranes.push(c);
      top = Math.max(top, node.userData.height ?? 0);
    }
    this.skyline = top;
    // Tall skylines need room to step back, a longer view and a larger shadow volume.
    this.controls.maxDistance = Math.min(280, 160 + Math.max(0, top - 20) * 1.3);
    this.camera.far = 520 + top * 2;
    this.camera.updateProjectionMatrix();
    Object.assign(this.sun.shadow.camera, { far: 160 + top * 1.5 });
    this.sun.shadow.camera.updateProjectionMatrix();
    const civ = this.sim.state.civ;
    this.terrain.setLighting(civ ? serviceIn(this.sim.state, 'Old Town', 'power') : 0, this.sim.state.roads ?? []);
  }

  /**
   * Tall buildings between the camera and the villager being followed or
   * selected fade to a glass outline, so a skyline never hides the story.
   * With "see-through towers" on, every tall building near the view centre does.
   */
  updateOcclusion() {
    const s = this.sim.state;
    const id = this.followId ?? (this.sim.selected.kind === 'citizen' ? this.sim.selected.id : null);
    const c = id ? byId(s.citizens, id) : null;
    const want = new Set();
    if (c) {
      const to = new THREE.Vector3(c.x, 1.2, c.z);
      const from = this.camera.position;
      const dir = to.clone().sub(from);
      const len = dir.length();
      this.raycaster.set(from, dir.normalize());
      this.raycaster.far = len - 1;
      for (const h of this.raycaster.intersectObjects(this.plotLayer.children, true)) {
        const pid = h.object.userData.plotId;
        if (pid && (this.plotNodes.get(pid)?.userData.height ?? 0) > 6) want.add(pid);
      }
      this.raycaster.far = Infinity;
    }
    // In Then & Now, tall neighbours step aside so the property can be seen.
    if (this.thenNow) {
      const tp = this.thenNow.plot;
      for (const p of s.plots) if (p.id !== tp.id && (this.plotNodes.get(p.id)?.userData.height ?? 0) > 8 && Math.hypot(p.x - tp.x, p.z - tp.z) < 16) want.add(p.id);
    }
    if (this.seeThrough) {
      const t = this.controls.target;
      for (const p of s.plots) if ((this.plotNodes.get(p.id)?.userData.height ?? 0) > TALL && Math.hypot(p.x - t.x, p.z - t.z) < 26) want.add(p.id);
    }
    for (const pid of [...this.ghosts.keys()]) if (!want.has(pid)) this.unghost(pid);
    for (const pid of want) if (!this.ghosts.has(pid)) this.ghost(pid);
  }

  ghost(pid) {
    const node = this.plotNodes.get(pid);
    const plot = this.sim.state.plots.find((p) => p.id === pid);
    if (!node || !plot?.building || this.thenNow?.plotId === pid) return;
    const dm = buildingDims(plot, plot.building);
    const box = new THREE.Mesh(G.box(), GHOST);
    box.scale.set(dm.w, dm.h, dm.d);
    box.position.set(plot.x, dm.h / 2, plot.z);
    box.rotation.y = facingAngle(plot);
    box.userData.plotId = pid;
    for (const ch of node.children) if (ch.isLOD || (ch.isGroup && !ch.userData.keepVisible)) ch.visible = false;
    this.plotLayer.add(box);
    this.ghosts.set(pid, box);
  }

  unghost(pid) {
    const box = this.ghosts.get(pid);
    if (!box) return;
    this.plotLayer.remove(box);
    this.ghosts.delete(pid);
    const node = this.plotNodes.get(pid);
    if (node) for (const ch of node.children) ch.visible = true;
  }

  setSeeThrough(on) { this.seeThrough = !!on; }

  // --- Then & Now ----------------------------------------------------------------------

  /**
   * Show a property as it stood on `day` beside (or instead of) what stands
   * now. Visual only: the simulation, the property and its records are not
   * touched. `split` (0..1) moves the dividing line across the plot.
   */
  showThenNow(plotId, day, split = 0.5) {
    const s = this.sim.state;
    const plot = s.plots.find((p) => p.id === plotId);
    if (!plot) return false;
    if (this.mode !== 'village') this.home();
    this.exitThenNow(false);
    const past = propertyOn(s, plotId, day);
    const now = plot.building;
    const make = (rec) => {
      if (!rec?.t && !rec?.type) {
        const g = new THREE.Group();
        part(g, G.plane(), mat('#86b06d'), [plot.w - 0.3, 1, plot.d - 0.3], [0, 0.03, 0], null, false);
        return g;
      }
      const b = rec.type ? rec : { type: rec.t, era: rec.e, seed: rec.s, floors: rec.f, level: rec.l, name: rec.n };
      return buildingModel(b.type, { id: plot.id, w: plot.w, d: plot.d, open: true, level: b.level ?? 1, condition: 100, season: seasonIndex(s.day), b, plot });
    };
    const node = this.plotNodes.get(plotId);
    if (node) node.visible = false;
    this.unghost(plotId);
    const angle = facingAngle(plot);
    const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const planeThen = new THREE.Plane(), planeNow = new THREE.Plane();
    const clip = (group, plane) => {
      group.traverse((o) => {
        if (!o.isMesh) return;
        o.material = clippedCopy(o.material, plane);
        o.userData.ownMaterial = true;
      });
    };
    const root = new THREE.Group();
    const thenG = make(past), nowG = make(now);
    for (const gg of [thenG, nowG]) { gg.rotation.y = angle; gg.position.set(plot.x, 0, plot.z); root.add(gg); }
    clip(thenG, planeThen);
    clip(nowG, planeNow);
    // A thin glowing divider shows where the past ends and the present begins.
    const divider = new THREE.Mesh(G.box(), DIVIDER);
    const h = Math.max(4, buildingDims(plot, now ?? { type: 'cottage' }).h + 2, past?.t ? buildingDims(plot, { type: past.t, era: past.e, floors: past.f }).h + 2 : 0);
    divider.scale.set(0.06, h, Math.max(plot.w, plot.d));
    divider.rotation.y = angle;
    root.add(divider);
    this.village.add(root);
    this.renderer.localClippingEnabled = true;
    this.thenNow = { plotId, day, root, planeThen, planeNow, right, plot, divider, split, height: h };
    this.setThenNowSplit(split);
    this.flyTo(plot.x, plot.z, Math.max(40, h * 1.8));
    return true;
  }

  setThenNowSplit(split) {
    const t = this.thenNow;
    if (!t) return;
    t.split = Math.max(0, Math.min(1, split));
    const half = Math.max(t.plot.w, t.plot.d) / 2;
    const offset = (t.split - 0.5) * 2 * half;
    const center = new THREE.Vector3(t.plot.x, 0, t.plot.z).addScaledVector(t.right, offset);
    // "Then" keeps the part left of the line, "Now" the part right of it.
    t.planeThen.setFromNormalAndCoplanarPoint(t.right.clone().negate(), center);
    t.planeNow.setFromNormalAndCoplanarPoint(t.right.clone(), center);
    t.divider.position.set(center.x, t.height / 2, center.z);
    t.divider.visible = t.split > 0.01 && t.split < 0.99;
  }

  exitThenNow(restoreView = true) {
    const t = this.thenNow;
    if (!t) return;
    this.village.remove(t.root);
    t.root.traverse((o) => { if (o.isMesh && o.userData.ownMaterial) o.material.dispose(); });
    disposeBaked(t.root); // its own geometry and the instance buffers of crops and the like

    const node = this.plotNodes.get(t.plotId);
    if (node) node.visible = true;
    this.renderer.localClippingEnabled = false;
    this.thenNow = null;
    if (restoreView) this.focusOn(t.plot.x, t.plot.z);
  }

  /**
   * Then & Now's clipped copies follow their originals' light: night window
   * glow, the forge's flicker, fading. Called each frame while it is shown.
   */
  syncThenNowMaterials() {
    this.thenNow?.root.traverse((o) => {
      const src = o.isMesh && o.userData.ownMaterial ? o.material.userData.clippedFrom : null;
      if (!src) return;
      if (src.emissiveIntensity !== undefined) o.material.emissiveIntensity = src.emissiveIntensity;
      o.material.opacity = src.opacity;
    });
  }

  /** The Founders' Memorial stands in the square; it gains a crown once every founder has passed. */
  syncMemorial() {
    const s = this.sim.state;
    if (!s.monuments?.some((m) => m.id === 'founders')) {
      // A new, imported or restored kingdom may have none.
      if (this.memorial) { this.village.remove(this.memorial); disposeBaked(this.memorial); this.memorial = null; }
      return;
    }
    const allPassed = !s.citizens.some((c) => c.founder);
    if (this.memorial && this.memorial.userData.allPassed === allPassed) return;
    if (this.memorial) this.village.remove(this.memorial);
    const m = memorialModel(allPassed);
    m.position.set(-4.6, 0, -4.6);
    m.rotation.y = Math.PI / 4;
    m.userData.allPassed = allPassed;
    m.traverse((o) => { o.userData.monument = 'founders'; });
    this.village.add(m);
    this.memorial = m;
  }

  /** Road works in progress: a pegged-out strip that fills in as the crew works. */
  syncRoadWorks() {
    const active = (this.sim.state.roadProjects ?? []).filter((p) => p.status === 'BUILDING');
    const keep = new Set();
    for (const p of active) {
      const progress = Math.min(1, p.work / p.need.work);
      const key = `${p.id}:${Math.round(progress * 5)}:${p.waiting ? 'w' : ''}`;
      keep.add(key);
      if (this.roadWorks.has(key)) continue;
      for (const [k, g] of this.roadWorks) if (k.startsWith(p.id + ':')) { this.roadWorkLayer.remove(g); this.roadWorks.delete(k); }
      const g = new THREE.Group();
      const along = p.w >= p.d;
      part(g, G.plane(), mat('#a68a64', { transparent: true, opacity: 0.55 }), [p.w, 1, p.d], [p.x, 0.03, p.z], null, false);
      const done = along ? [p.w * progress, 1, p.d] : [p.w, 1, p.d * progress];
      if (progress > 0) part(g, G.plane(), mat(p.kind === 'stone' ? '#b9b2a2' : '#c9b48e'), done, along ? [p.x - p.w / 2 + done[0] / 2, 0.04, p.z] : [p.x, 0.04, p.z - p.d / 2 + done[2] / 2], null, false);
      const len = along ? p.w : p.d;
      for (let t = 0; t <= len; t += 3) for (const side of [-1, 1]) {
        const px = along ? p.x - p.w / 2 + t : p.x + side * (p.w / 2 + 0.2), pz = along ? p.z + side * (p.d / 2 + 0.2) : p.z - p.d / 2 + t;
        part(g, G.box(), mat('#e9d8b4'), [0.08, 0.5, 0.08], [px, 0.25, pz], null, false);
      }
      if (p.waiting) part(g, G.dodeca(), mat(P.stone), [0.8, 0.4, 0.7], [p.x, 0.2, p.z], null, false);
      this.roadWorkLayer.add(g);
      this.roadWorks.set(key, g);
    }
    for (const [k, g] of this.roadWorks) if (!keep.has(k)) { this.roadWorkLayer.remove(g); this.roadWorks.delete(k); }
  }

  /** Festival decorations in the square while one is prepared or under way. */
  syncFestival() {
    const f = this.sim.state.culture?.current;
    const traditions = this.sim.state.culture?.traditions ?? [];
    const live = f && (f.phase === 'PREPARING' || f.phase === 'ACTIVE');
    const key = live ? `${f.name}:${f.phase}:${traditions.length}` : '';
    if (key === this.festivalKey) return;
    this.festivalKey = key;
    if (this.festivalDecor) { this.village.remove(this.festivalDecor); this.festivalDecor = null; }
    if (!live) return;
    this.festivalDecor = festivalModel(f, traditions);
    this.village.add(this.festivalDecor);
  }

  /** The seasonal festival's own dressing gives way to the holiday's when both would fill the square. */
  festivalVisibility() { if (this.festivalDecor) this.festivalDecor.visible = !this.themes.set; }

  makePlot(plot, project, business, progress, open, status, selected, burning, season) {
    const g = new THREE.Group();
    g.position.set(plot.x, 0, plot.z);
    const hit = new THREE.Mesh(G.plane(), new THREE.MeshBasicMaterial({ visible: false }));
    hit.scale.set(plot.w, 1, plot.d);
    hit.position.y = 0.06;
    hit.userData.plotId = plot.id;
    g.add(hit);
    const color = selected ? OUTLINE.SELECTED : OUTLINE[status];
    const edge = mat(color, { emissive: color, emissiveIntensity: selected ? 0.6 : 0.08 });
    const t = selected ? 0.22 : status === 'FOR_SALE' ? 0.07 : 0.12;
    // The plot outline is one mesh (four strips merged).
    const outline = new THREE.Group();
    for (const sz of [-1, 1]) part(outline, G.box(), edge, [plot.w, 0.05, t], [0, 0.05, sz * plot.d / 2], null, false);
    for (const sx of [-1, 1]) part(outline, G.box(), edge, [t, 0.05, plot.d], [sx * plot.w / 2, 0.05, 0], null, false);
    const baked = bakeGroup(outline);
    baked.userData.keepVisible = true;
    g.add(baked);
    let inner = new THREE.Group();
    inner.rotation.y = facingAngle(plot);
    const b = plot.building;
    const opts = { id: plot.id, w: plot.w, d: plot.d, open, level: b?.level ?? 1, condition: b?.condition ?? 100, season, b, plot, era: b?.era ?? 1, seed: b?.seed, floors: b?.floors };
    const typeOf = () => (business ? (business.type === 'farm' ? 'farm' : business.type) : b.type);
    let tall = false;
    if (project && (project.kind === 'upgrade' || project.kind === 'repair')) {
      // Existing building stays in use under scaffolding while it is expanded or repaired.
      inner.add(constructionModel(typeOf(), 'FINISHING', progress, { ...opts, level: opts.level + (project.kind === 'upgrade' && progress > 0.5 ? 1 : 0) }));
    } else if (project && project.kind === 'rebuild' && project.stageIndex < 0 && b) {
      // Planned but not begun: the old building stands, pegged out for the new one.
      inner.add(buildingModel(typeOf(), opts));
      part(inner, G.box(), mat('#e0b23a'), [0.1, 1.2, 0.1], [plot.w / 2 - 1, 0.6, plot.d / 2 - 1], null, false);
    } else if (project) {
      const type = project.kind === 'demolition' ? b?.type : project.buildingType;
      const era = project.targetEra ?? eraForType(this.sim.state, type ?? 'cottage');
      const stage = project.kind === 'demolition' ? 'DEMOLISHING' : plot.constructionStatus;
      inner.add(constructionModel(type ?? 'cottage', stage, progress, { ...opts, era, seed: project.seed ?? opts.seed, floors: project.floors, oldType: b?.type ?? project.oldBuilding?.type, oldBuilding: b ?? project.oldBuilding }));
    } else if (b) {
      inner.add(buildingModel(typeOf(), opts));
      tall = buildingDims(plot, b).h > TALL;
    } else {
      part(inner, G.plane(), mat('#86b06d'), [plot.w - 0.3, 1, plot.d - 0.3], [0, 0.03, 0], null, false);
    }
    inner = bakeGroup(inner);
    const cranes = [];
    inner.traverse((o) => { if (o.userData.crane) cranes.push(o); });
    g.userData.cranes = cranes;
    if (tall) {
      // Far away, a tower is drawn as its massing alone.
      const lod = new THREE.LOD();
      const far = bakeGroup(massingModel(b, buildingDims(plot, b)));
      far.rotation.y = inner.rotation.y;
      lod.addLevel(inner, 0);
      lod.addLevel(far, 150);
      g.add(lod);
      g.userData.height = buildingDims(plot, b).h;
    } else {
      g.add(inner);
      g.userData.height = b ? buildingDims(plot, b).h : 0;
    }
    if (status === 'FOR_SALE') {
      const sign = forSaleSign();
      sign.position.set(plot.w / 2 - 0.6, 0, plot.d / 2 - 0.6);
      g.add(sign);
    }
    if (burning) {
      const f = fireModel();
      f.userData.flames = true;
      g.add(f);
    }
    g.traverse((o) => { o.userData.plotId = plot.id; });
    return g;
  }

  makeMarket() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const stall = buildingModel('stall', { id: 'm' + i, open: true });
      stall.position.set(Math.cos(a) * 7, 0, Math.sin(a) * 7);
      stall.rotation.y = -a - Math.PI / 2;
      stall.scale.setScalar(0.7);
      g.add(stall);
    }
    this.village.add(g);
    return g;
  }

  pick(e) {
    if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 12 || performance.now() - this.down.t > 600) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.mode === 'kingdom') { const hit = this.away.pick(this.raycaster); if (hit) this.onPick?.(hit.kind, hit.id); return; }
    if (this.mode === 'battle') return;
    if (this.hand.pickPlacement(this.raycaster)) return;
    if (this.militia) { const m = this.raycaster.intersectObject(this.militia, true)[0]; if (m?.object.userData.armyId) { this.onPick?.('army', m.object.userData.armyId); return; } }
    const riders = this.raycaster.intersectObjects(this.vehicles.root.children, true);
    if (riders.length && riders[0].object.userData.citizenId) { const id = riders[0].object.userData.citizenId; this.sim.select('citizen', id); this.onPick?.('citizen', id); return; }
    const people = this.raycaster.intersectObjects(this.villagers.root.children, true).filter((h) => h.object.visible);
    if (people.length) {
      const id = this.villagers.pick(people[0].object);
      if (id) { this.sim.select('citizen', id); this.onPick?.('citizen', id); return; }
    }
    if (this.memorial && this.raycaster.intersectObject(this.memorial, true).length) { this.onPick?.('memorial', 'founders'); return; }
    if (this.hand.pick(this.raycaster)) { this.onPick?.('stone', 'stone-1'); return; }
    const carts = this.raycaster.intersectObjects(this.caravans.root.children, true);
    if (carts.length && carts[0].object.userData.caravanId) { this.onPick?.('caravan', carts[0].object.userData.caravanId); return; }
    const plots = this.raycaster.intersectObjects(this.plotLayer.children, true);
    if (plots.length) {
      const id = plots[0].object.userData.plotId;
      if (id) { this.sim.select('plot', id); this.onPick?.('plot', id); }
    }
  }

  /** Smoothly move the camera target to a point (optionally zooming to a distance). */
  focusOn(x, z, distance = null) { this.focus = new THREE.Vector3(x, 0, z); this.focusDistance = distance; this.followId = null; }

  /** Keep the camera on a citizen as they move, until the player drags the view. */
  follow(id) { this.followId = id; this.followCaravanId = null; this.focus = null; }

  /** Watch a caravan: its cart when it is in the valley, otherwise the gate it will come through. */
  followCaravan(id) {
    this.followId = null;
    this.followCaravanId = id;
    const cv = this.sim.state.trade?.caravans.find((c) => c.id === id);
    if (cv && !this.caravans.positionOf(id)) {
      const route = cv.leg ? routeById(cv.leg.route) : null;
      const gate = GATES[route?.gate ?? 'west'];
      this.focusOn(gate.x * 0.7, gate.z * 0.7);
      this.followCaravanId = id;
    }
  }

  /** `tickSeconds` is the real time one simulation tick takes at the current game speed. */
  render(dt, time, tickSeconds = TIME.realSecondsPerTick) {
    const s = this.sim.state;
    // The theme's weather: the kingdom's own (through each kingdom's climate), or the preview's.
    const sky = this.weather.update(this.themes.env.weather ?? s.weather?.today, dt, this.controls.target, time);
    this.themes.update(dt, time, this.controls.target, this.night);
    this.scene.fog.near = sky.fogNear; this.scene.fog.far = sky.fogFar;
    if (this.mode !== 'village') return this.renderAway(dt, time, sky);
    if (time - this.lastSync > 0.4) {
      this.syncMilitia();
      this.syncPlots();
      this.villagers.sync(s.citizens, s.day);
      if (time - (this.lastOcclusion ?? 0) > 0.25) { this.updateOcclusion(); this.lastOcclusion = time; }
      this.terrain.setForest(s.commons.forest / s.commons.forestCap);
      this.terrain.syncRoads(s.roads ?? []);
      this.caravans.sync(s, navGrid(s).version);
      this.syncFestival();
      this.festivalVisibility();
      this.lastSync = time;
    }
    this.updateSky(this.visualHour(), time, sky);
    this.hand.update(dt, time, this.night);
    const selected = this.sim.selected.kind === 'citizen' ? this.sim.selected.id : null;
    this.villagers.update(s.citizens, dt, time, selected, s.day, this.controls.target, this.quality, tickSeconds);
    this.vehicles.update(s.citizens, dt, tickSeconds);
    for (let i = 0; i < this.cranes.length; i++) this.cranes[i].rotation.y = Math.sin(time * 0.15 + i * 1.7) * 1.4;
    this.caravans.update(dt, time);
    if (this.followCaravanId) {
      const p = this.caravans.positionOf(this.followCaravanId);
      if (p) (this.focus ??= new THREE.Vector3()).set(p.x, 0, p.z);
    }
    if (this.followId) {
      const c = byId(s.citizens, this.followId);
      if (c) (this.focus ??= new THREE.Vector3()).set(c.x, 0, c.z);
      else this.followId = null;
    }
    this.controls.target.x = Math.max(-72, Math.min(72, this.controls.target.x));
    this.controls.target.z = Math.max(-72, Math.min(72, this.controls.target.z));
    // Shadows follow the area being looked at, so outer districts are lit too.
    this.moveCamera(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.showLabels) this.updateLabels(s.citizens, selected);
  }

  /** A visited kingdom or a battle replay: the simulation keeps running; only this view is drawn. */
  renderAway(dt, time, sky) {
    if (this.mode === 'kingdom' && time - this.lastSync > 0.6) { this.away.sync(this.sim.state); this.lastSync = time; }
    this.away.update(dt, time);
    this.updateSky(this.visualHour(), time, sky);
    this.moveCamera(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.showLabels && this.mode === 'kingdom') this.updateForeignLabels();
  }

  moveCamera(dt) {
    if (this.focus) {
      const t = this.controls.target;
      const delta = this.v.copy(this.focus).sub(t).multiplyScalar(Math.min(1, dt * 4));
      t.add(delta);
      this.camera.position.add(delta);
      if (this.focusDistance) {
        const off = this.camera.position.clone().sub(t);
        const len = off.length();
        off.setLength(len + (this.focusDistance - len) * Math.min(1, dt * 3));
        this.camera.position.copy(t).add(off);
        if (Math.abs(len - this.focusDistance) < 0.5) this.focusDistance = null;
      }
      if (delta.lengthSq() < 0.0004 && !this.focusDistance && !this.followId && !this.followCaravanId) this.focus = null;
    }
    this.sun.target.position.copy(this.controls.target);
    this.controls.update();
  }

  updateForeignLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const t = this.controls.target;
    const seen = new Set();
    const placed = [];
    const nodes = [...this.away.people.entries()].map(([id, n]) => [id, n, (n.position.x - t.x) ** 2 + (n.position.z - t.z) ** 2]).sort((a, b) => a[2] - b[2]).slice(0, 10);
    for (const [id, node] of nodes) {
      const p = this.sim.state.foreign?.people[id];
      if (!p) continue;
      let el = this.labelEls.get(id);
      if (!el) { el = document.createElement('div'); el.className = 'label foreign'; this.labelLayer.appendChild(el); this.labelEls.set(id, el); }
      seen.add(id);
      this.v.set(node.position.x, 2.9 * node.scale.y, node.position.z).project(this.camera);
      const sx = ((this.v.x + 1) / 2) * w, sy = ((1 - this.v.y) / 2) * h;
      const vis = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1 && !placed.some(([px, py]) => Math.abs(px - sx) < 56 && Math.abs(py - sy) < 22);
      el.style.display = vis ? '' : 'none';
      if (!vis) continue;
      placed.push([sx, sy]);
      const text = p.role === 'ruler' ? `👑 ${p.firstName}` : p.firstName;
      if (el.textContent !== text) el.textContent = text;
      el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.labelEls) if (!seen.has(id)) { el.remove(); this.labelEls.delete(id); }
  }

  updateSky(hour, time, weather = { light: 1, wind: 0 }) {
    // Sun travels east to west from 6:00 to 20:00.
    const dayT = (hour - 6) / 14;
    const elevation = Math.sin(Math.max(0, Math.min(1, dayT)) * Math.PI);
    const light = Math.max(0, Math.min(1, elevation * 1.6));
    const night = 1 - light;
    const az = (dayT - 0.5) * Math.PI;
    const ct = this.controls.target;
    this.sun.position.set(ct.x + Math.sin(az) * 60, 12 + elevation * 60, ct.z + 30 + Math.cos(az) * 10);
    // Overcast skies dim the sun and flatten the light; the clear-sky colour depends on where you are.
    const look = this.themes.env.sky;
    this.night = night;
    this.sun.intensity = (0.15 + light * 2.3) * weather.light * look.sunPower;
    this.hemi.intensity = (0.45 + light * 1.25) * (0.75 + weather.light * 0.25);
    this.hemi.color.copy(look.hemiSky);
    this.hemi.groundColor.copy(look.hemiGround);
    const sky = this.scene.background;
    // The season's sky, shifted towards each kingdom's own (Ironhold's mountain air, Saltmere's sea light).
    const day = this.tmpColor.copy(look.day);
    if (this.mode === 'kingdom' && this.away?.layout?.sky) day.lerp(this.dayColor.clone().set(this.away.layout.sky), 0.35);
    sky.copy(this.nightColor).lerp(day, light);
    if (weather.light < 1) sky.lerp(this.greyColor, (1 - weather.light) * 0.8);
    if (light > 0.05 && light < 0.6) sky.lerp(this.duskColor, 0.35 * (1 - Math.abs(light - 0.3) / 0.3));
    this.scene.fog.color.copy(sky);
    this.sun.color.copy(look.sun).lerp(this.duskColor, (1 - light) * 0.5);
    this.scene.fog.near *= look.fog; this.scene.fog.far *= look.fog;
    const glow = Math.max(0, night - 0.25) * 2.2;
    litWindow.emissiveIntensity = 0.05 + glow * look.windows;
    setFacadeGlow(glow * look.windows * 0.85);
    this.terrain.lampGlass.emissiveIntensity = glow * 1.4;
    const flicker = 0.85 + Math.sin(time * 13) * 0.08 + Math.sin(time * 7.3) * 0.07;
    this.terrain.fire.scale.y = 1.5 * flicker;
    this.terrain.fireLight.intensity = (8 + night * 40) * flicker;
    forgeGlow.emissiveIntensity = 1 + Math.sin(time * 5) * 0.3;
    if (this.thenNow) this.syncThenNowMaterials();
    // Trees sway with the wind of the day.
    if (this.mode === 'village' && this.terrain.treeGroup) this.terrain.treeGroup.rotation.z = Math.sin(time * 1.3) * 0.004 * weather.wind;
    if (this.mode !== 'village') return;
    for (const node of this.plotNodes.values()) for (const child of node.children) if (child.userData.flames) child.scale.y = 0.9 + Math.sin(time * 11 + node.position.x) * 0.12;
  }

  /** The hour the sky shows: the kingdom's, or the preview's (day or night). Visual only. */
  visualHour() {
    const t = this.themes.theme;
    return t?.source === 'preview' ? t.hour : this.sim.state.minute / 60;
  }

  updateLabels(citizens, selected) {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const seen = new Set();
    // Only the nearest villagers to the view centre carry name labels, plus the selected one.
    const t = this.controls.target;
    let near = citizens.filter((c) => this.villagers.nodes.get(c.id)?.visible)
      .map((c) => [c, (c.x - t.x) ** 2 + (c.z - t.z) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, LABEL_LIMIT).map(([c]) => c);
    const sel = selected && citizens.find((c) => c.id === selected);
    if (sel) near = [sel, ...near.filter((c) => c !== sel)];
    const placed = [];
    for (const c of near) {
      const node = this.villagers.nodes.get(c.id);
      if (!node) continue;
      let el = this.labelEls.get(c.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'label';
        this.labelLayer.appendChild(el);
        this.labelEls.set(c.id, el);
      }
      seen.add(c.id);
      this.v.set(node.position.x, 2.9 * node.scale.y, node.position.z).project(this.camera);
      const visible = node.visible && this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      const sx = ((this.v.x + 1) / 2) * w, sy = ((1 - this.v.y) / 2) * h;
      // Skip labels that would sit on top of one already placed (the selected one always shows).
      const crowded = visible && c.id !== selected && placed.some(([px, py]) => Math.abs(px - sx) < 52 && Math.abs(py - sy) < 22);
      el.style.display = visible && !crowded ? '' : 'none';
      if (!visible || crowded) continue;
      placed.push([sx, sy]);
      const text = c.firstName;
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('selected', c.id === selected);
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.labelEls) if (!seen.has(id)) { el.remove(); this.labelEls.delete(id); }
  }

  dispose() {
    this.themes.dispose();
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

function stageFraction(p) {
  const s = stagesFor(p.kind, p)[p.stageIndex];
  return s ? Math.min(1, p.work / s.work) : 0;
}

/**
 * A copy of a material clipped by `plane`. Material.clone() does not carry
 * onBeforeCompile, so the snow shader (and its program key) are passed on by
 * hand; `clippedFrom` lets the copy follow the original's glow each frame.
 */
export function clippedCopy(material, plane) {
  const m = material.clone();
  if (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) m.onBeforeCompile = material.onBeforeCompile;
  if (material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) m.customProgramCacheKey = material.customProgramCacheKey;
  m.clippingPlanes = [plane];
  m.clipShadows = true;
  m.userData.clippedFrom = material;
  return m;
}

const GHOST = new THREE.MeshStandardMaterial({ color: '#cfe6f2', transparent: true, opacity: 0.18, roughness: 0.2, metalness: 0.3, depthWrite: false });
const DIVIDER = new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.85 });

/** A tiny pre-filtered sky for glass reflections (made once). */
function skyEnvironment(renderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 16, 12);
  const colors = [];
  const pos = geo.attributes.position;
  const top = new THREE.Color('#7fb6e8'), mid = new THREE.Color('#e9f3f8'), low = new THREE.Color('#7a9a6a');
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 10; const c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(low, -y * 1.5); colors.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(scene, 0.04).texture;
  pm.dispose();
  geo.dispose();
  return tex;
}
