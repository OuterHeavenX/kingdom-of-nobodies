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
import { KingdomScene, soldierBlock } from './KingdomScene.js';
import { BattleView } from './BattleView.js';
import { WeatherLayer } from './WeatherLayer.js';
import { HEARTH, KINGDOMS } from '../region/RegionData.js';

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
    this.weather?.setQuality(q);
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
    this.flyTo(0, 0, 55);
  }

  home() {
    this.clearAway();
    this.village.visible = true;
    this.mode = 'village';
    this.awayId = null;
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
    if (this.militia) { const m = this.raycaster.intersectObject(this.militia, true)[0]; if (m?.object.userData.armyId) { this.onPick?.('army', m.object.userData.armyId); return; } }
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

  render(dt, time) {
    const s = this.sim.state;
    const sky = this.weather.update(s.weather?.today, dt, this.controls.target, time);
    this.scene.fog.near = sky.fogNear; this.scene.fog.far = sky.fogFar;
    if (this.mode !== 'village') return this.renderAway(dt, time, sky);
    if (time - this.lastSync > 0.4) {
      this.syncMilitia();
      this.syncPlots();
      this.villagers.sync(s.citizens, s.day);
      this.terrain.setForest(s.commons.forest / s.commons.forestCap);
      this.terrain.syncRoads(s.roads ?? []);
      this.applySeason(seasonIndex(s.day));
      this.caravans.sync(s, navGrid(s).version);
      this.syncFestival();
      this.lastSync = time;
    }
    this.updateSky(s.minute / 60, time, sky);
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
    this.updateSky(this.sim.state.minute / 60, time, sky);
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
    this.sun.intensity = (0.15 + light * 2.3) * weather.light;
    this.hemi.intensity = (0.45 + light * 1.25) * (0.75 + weather.light * 0.25);
    const sky = this.scene.background;
    const day = this.mode === 'kingdom' && this.away?.layout?.sky ? this.tmpColor.set(this.away.layout.sky) : this.dayColor;
    sky.copy(this.nightColor).lerp(day, light);
    if (weather.light < 1) sky.lerp(this.greyColor, (1 - weather.light) * 0.8);
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
    // Trees sway with the wind of the day.
    if (this.mode === 'village' && this.terrain.treeGroup) this.terrain.treeGroup.rotation.z = Math.sin(time * 1.3) * 0.004 * weather.wind;
    if (this.mode !== 'village') return;
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
