import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrain } from './Terrain.js';
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

// Seasonal tints: [ground, leaves, roofs-to-snow]. Ground and leaves multiply
// their base colour; roofs blend towards snow in winter.
const SEASON_LOOK = [
  { ground: '#ffffff', leaf: '#ffffff', snow: 0 },
  { ground: '#f4ffe8', leaf: '#eef7dc', snow: 0 },
  { ground: '#f2dcb4', leaf: '#ffb46a', snow: 0 },
  { ground: '#e8eef4', leaf: '#b9c8bf', snow: 0.72 },
];
const ROOFS = [P.roofRed, P.roofBrown, P.roofSlate, P.thatch];
const LABEL_LIMIT = 14;

// The Three.js presentation of the simulation. It only reads simulation state;
// all changes flow the other way through Simulation methods.

export class WebGLUnavailableError extends Error {}

const OUTLINE = { FOR_SALE: '#cdb36a', BUILDING: '#ff9a3c', OWNED: '#f4efe2', COUNCIL: '#9fc3e6', SELECTED: '#ffffff' };

export class World {
  constructor(container, sim, { quality = 'high', labels = true } = {}) {
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

    this.terrain = buildTerrain(this.scene);
    this.plotLayer = new THREE.Group();
    this.scene.add(this.plotLayer);
    this.plotNodes = new Map();
    this.market = null;
    this.villagers = new Villagers(this.scene);
    this.fires = new Map();
    this.caravans = new CaravanLayer(this.scene);
    this.followCaravanId = null;
    this.festivalDecor = null;
    this.festivalKey = '';
    this.roadBase = Object.fromEntries(Object.entries(this.terrain.roadMaterials).map(([k, m]) => [k, m.color.clone()]));
    this.roadWorks = new Map();
    this.roadWorkLayer = new THREE.Group();
    this.scene.add(this.roadWorkLayer);
    this.memorial = null;
    this.season = -1;
    this.leafBase = this.terrain.leafMaterials.map((m) => m.color.clone());
    this.groundBase = this.terrain.ground.material.color.clone();
    this.roofMats = ROOFS.map((c) => mat(c));
    this.roofBase = this.roofMats.map((m) => m.color.clone());
    this.followId = null;

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
    this.setQuality(quality);
    this.syncPlots(true);
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q === 'high' ? 2 : 1.25));
    this.renderer.shadowMap.enabled = q === 'high';
    this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 512, q === 'high' ? 2048 : 512);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    this.resize();
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
    for (const plot of s.plots) {
      const project = plot.projectId ? s.projects.find((p) => p.id === plot.projectId) : null;
      const business = plot.businessId ? s.businesses.find((b) => b.id === plot.businessId) : null;
      const stageProgress = project ? stageFraction(project) : 0;
      const open = business ? isTrading(business) : plot.building && ['bakery', 'tavern', 'general_store', 'blacksmith', 'lumberyard', 'stall'].includes(plot.building.type) ? false : undefined;
      const status = project ? 'BUILDING' : plot.marketStatus === 'FOR_SALE' ? 'FOR_SALE' : plot.ownerId === 'council' ? 'COUNCIL' : 'OWNED';
      const selected = this.sim.selected.kind === 'plot' && this.sim.selected.id === plot.id;
      const sig = [plot.building?.type, plot.building?.level, (plot.building?.condition ?? 100) < 60, plot.constructionStatus, project?.kind, project?.buildingType, Math.round(stageProgress * 4), open, status, selected, business?.type, burning.has(plot.id), business?.type === 'farm' || plot.building?.type === 'farm' ? season : ''].join('|');
      let node = this.plotNodes.get(plot.id);
      if (node && node.userData.sig === sig && !force) continue;
      if (node) { this.plotLayer.remove(node); disposeInstanced(node); }
      node = this.makePlot(plot, project, business, stageProgress, open, status, selected, burning.has(plot.id), season);
      node.userData.sig = sig;
      this.plotLayer.add(node);
      this.plotNodes.set(plot.id, node);
    }
    for (const [id, node] of this.plotNodes) if (!s.plots.some((p) => p.id === id)) { this.plotLayer.remove(node); disposeInstanced(node); this.plotNodes.delete(id); }
    if (s.council.marketplace && !this.market) this.market = this.makeMarket();
    this.syncMemorial();
    this.syncRoadWorks();
  }

  /** The Founders' Memorial stands in the square; it gains a crown once every founder has passed. */
  syncMemorial() {
    const s = this.sim.state;
    if (!s.monuments?.some((m) => m.id === 'founders')) return;
    const allPassed = !s.citizens.some((c) => c.founder);
    if (this.memorial && this.memorial.userData.allPassed === allPassed) return;
    if (this.memorial) this.scene.remove(this.memorial);
    const m = memorialModel(allPassed);
    m.position.set(-4.6, 0, -4.6);
    m.rotation.y = Math.PI / 4;
    m.userData.allPassed = allPassed;
    m.traverse((o) => { o.userData.monument = 'founders'; });
    this.scene.add(m);
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
    if (this.festivalDecor) { this.scene.remove(this.festivalDecor); this.festivalDecor = null; }
    if (!live) return;
    this.festivalDecor = festivalModel(f, traditions);
    this.scene.add(this.festivalDecor);
  }

  /** Seasonal colour of the land, trees and (in winter) snow on roofs. */
  applySeason(index) {
    if (index === this.season) return;
    this.season = index;
    const look = SEASON_LOOK[index];
    const t = new THREE.Color();
    this.terrain.ground.material.color.copy(this.groundBase).multiply(t.set(look.ground));
    this.terrain.leafMaterials.forEach((m, i) => m.color.copy(this.leafBase[i]).multiply(t.set(look.leaf)));
    const snow = new THREE.Color('#f4f7fa');
    this.roofMats.forEach((m, i) => m.color.copy(this.roofBase[i]).lerp(snow, look.snow));
    // Roads frost over in winter and turn to mud in the spring thaw; meadow flowers bloom in spring and summer.
    for (const [k, m] of Object.entries(this.terrain.roadMaterials)) m.color.copy(this.roadBase[k]).lerp(index === 3 ? snow : new THREE.Color('#8a6a48'), index === 3 ? 0.45 : index === 0 ? 0.18 : 0);
    this.terrain.petals.visible = index <= 1;
  }

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
    for (const sz of [-1, 1]) part(g, G.box(), edge, [plot.w, 0.05, t], [0, 0.05, sz * plot.d / 2], null, false);
    for (const sx of [-1, 1]) part(g, G.box(), edge, [t, 0.05, plot.d], [sx * plot.w / 2, 0.05, 0], null, false);
    const inner = new THREE.Group();
    inner.rotation.y = facingAngle(plot);
    g.add(inner);
    const opts = { id: plot.id, w: plot.w, d: plot.d, open, level: plot.building?.level ?? 1, condition: plot.building?.condition ?? 100, season };
    if (project && (project.kind === 'upgrade' || project.kind === 'repair')) {
      // Existing building stays in use under scaffolding while it is expanded or repaired.
      const type = business ? business.type === 'farm' ? 'farm' : business.type : plot.building.type;
      inner.add(constructionModel(type, 'FINISHING', progress, { ...opts, level: opts.level + (project.kind === 'upgrade' && progress > 0.5 ? 1 : 0) }));
    } else if (project) {
      const type = project.kind === 'demolition' ? plot.building?.type : project.buildingType;
      inner.add(constructionModel(type ?? 'cottage', project.kind === 'demolition' ? 'DEMOLISHING' : plot.constructionStatus, progress, { ...opts, oldType: plot.building?.type }));
    } else if (plot.building) {
      inner.add(buildingModel(business ? business.type === 'farm' ? 'farm' : business.type : plot.building.type, opts));
    } else {
      part(inner, G.plane(), mat('#86b06d'), [plot.w - 0.3, 1, plot.d - 0.3], [0, 0.03, 0], null, false);
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
    this.scene.add(g);
    return g;
  }

  pick(e) {
    if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 12 || performance.now() - this.down.t > 600) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const people = this.raycaster.intersectObjects(this.villagers.root.children, true).filter((h) => h.object.visible);
    if (people.length) {
      const id = this.villagers.pick(people[0].object);
      if (id) { this.sim.select('citizen', id); this.onPick?.('citizen', id); return; }
    }
    if (this.memorial && this.raycaster.intersectObject(this.memorial, true).length) { this.onPick?.('memorial', 'founders'); return; }
    const carts = this.raycaster.intersectObjects(this.caravans.root.children, true);
    if (carts.length && carts[0].object.userData.caravanId) { this.onPick?.('caravan', carts[0].object.userData.caravanId); return; }
    const plots = this.raycaster.intersectObjects(this.plotLayer.children, true);
    if (plots.length) {
      const id = plots[0].object.userData.plotId;
      if (id) { this.sim.select('plot', id); this.onPick?.('plot', id); }
    }
  }

  /** Smoothly move the camera target to a point. */
  focusOn(x, z) { this.focus = new THREE.Vector3(x, 0, z); this.followId = null; }

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

  render(dt, time) {
    const s = this.sim.state;
    if (time - this.lastSync > 0.4) {
      this.syncPlots();
      this.villagers.sync(s.citizens, s.day);
      this.terrain.setForest(s.commons.forest / s.commons.forestCap);
      this.terrain.syncRoads(s.roads ?? []);
      this.applySeason(seasonIndex(s.day));
      this.caravans.sync(s, navGrid(s).version);
      this.syncFestival();
      this.lastSync = time;
    }
    this.updateSky(s.minute / 60, time);
    const selected = this.sim.selected.kind === 'citizen' ? this.sim.selected.id : null;
    this.villagers.update(s.citizens, dt, time, selected, s.day, this.controls.target, this.quality);
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
    if (this.focus) {
      const t = this.controls.target;
      const delta = this.v.copy(this.focus).sub(t).multiplyScalar(Math.min(1, dt * 4));
      t.add(delta);
      this.camera.position.add(delta);
      if (delta.lengthSq() < 0.0004 && !this.followId && !this.followCaravanId) this.focus = null;
    }
    this.controls.target.x = Math.max(-72, Math.min(72, this.controls.target.x));
    this.controls.target.z = Math.max(-72, Math.min(72, this.controls.target.z));
    // Shadows follow the area being looked at, so outer districts are lit too.
    this.sun.target.position.copy(this.controls.target);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.showLabels) this.updateLabels(s.citizens, selected);
  }

  updateSky(hour, time) {
    // Sun travels east to west from 6:00 to 20:00.
    const dayT = (hour - 6) / 14;
    const elevation = Math.sin(Math.max(0, Math.min(1, dayT)) * Math.PI);
    const light = Math.max(0, Math.min(1, elevation * 1.6));
    const night = 1 - light;
    const az = (dayT - 0.5) * Math.PI;
    const ct = this.controls.target;
    this.sun.position.set(ct.x + Math.sin(az) * 60, 12 + elevation * 60, ct.z + 30 + Math.cos(az) * 10);
    this.sun.intensity = 0.15 + light * 2.3;
    this.hemi.intensity = 0.45 + light * 1.25;
    const sky = this.scene.background;
    sky.copy(this.nightColor).lerp(this.dayColor, light);
    if (light > 0.05 && light < 0.6) sky.lerp(this.duskColor, 0.35 * (1 - Math.abs(light - 0.3) / 0.3));
    this.scene.fog.color.copy(sky);
    this.sun.color.setHSL(0.1, 0.6, 0.6 + light * 0.3);
    const glow = Math.max(0, night - 0.25) * 2.2;
    litWindow.emissiveIntensity = 0.05 + glow;
    this.terrain.lampGlass.emissiveIntensity = glow * 1.4;
    const flicker = 0.85 + Math.sin(time * 13) * 0.08 + Math.sin(time * 7.3) * 0.07;
    this.terrain.fire.scale.y = 1.5 * flicker;
    this.terrain.fireLight.intensity = (8 + night * 40) * flicker;
    forgeGlow.emissiveIntensity = 1 + Math.sin(time * 5) * 0.3;
    for (const node of this.plotNodes.values()) for (const child of node.children) if (child.userData.flames) child.scale.y = 0.9 + Math.sin(time * 11 + node.position.x) * 0.12;
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
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

function stageFraction(p) {
  const s = stagesFor(p.kind)[p.stageIndex];
  return s ? Math.min(1, p.work / s.work) : 0;
}

function disposeInstanced(node) {
  node.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
}
