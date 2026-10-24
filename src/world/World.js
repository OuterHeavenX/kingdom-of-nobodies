import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrain } from './Terrain.js';
import { buildingModel, constructionModel, forSaleSign, litWindow, forgeGlow } from './Models.js';
import { Villagers } from './Villagers.js';
import { mat, G, part } from './Materials.js';
import { STAGES, REFIT_STAGE, DEMOLITION } from '../core/Config.js';
import { facingAngle } from '../property/LandRegistry.js';
import { isTrading } from '../economy/Businesses.js';

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
    this.scene.fog = new THREE.Fog(this.scene.background, 70, 150);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
    this.camera.position.set(34, 40, 52);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, minDistance: 10, maxDistance: 110, maxPolarAngle: Math.PI * 0.46, enablePan: true, screenSpacePanning: false });
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
    el.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; this.focus = null; });
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
    for (const plot of s.plots) {
      const project = plot.projectId ? s.projects.find((p) => p.id === plot.projectId) : null;
      const business = plot.businessId ? s.businesses.find((b) => b.id === plot.businessId) : null;
      const stageProgress = project ? stageFraction(project) : 0;
      const open = business ? isTrading(business) : plot.building && ['bakery', 'tavern', 'general_store', 'blacksmith', 'lumberyard', 'stall'].includes(plot.building.type) ? false : undefined;
      const status = project ? 'BUILDING' : plot.marketStatus === 'FOR_SALE' ? 'FOR_SALE' : plot.ownerId === 'council' ? 'COUNCIL' : 'OWNED';
      const selected = this.sim.selected.kind === 'plot' && this.sim.selected.id === plot.id;
      const sig = [plot.building?.type, plot.constructionStatus, project?.buildingType, Math.round(stageProgress * 4), open, status, selected, business?.type].join('|');
      let node = this.plotNodes.get(plot.id);
      if (node && node.userData.sig === sig && !force) continue;
      if (node) { this.plotLayer.remove(node); disposeInstanced(node); }
      node = this.makePlot(plot, project, business, stageProgress, open, status, selected);
      node.userData.sig = sig;
      this.plotLayer.add(node);
      this.plotNodes.set(plot.id, node);
    }
    if (s.council.marketplace && !this.market) this.market = this.makeMarket();
  }

  makePlot(plot, project, business, progress, open, status, selected) {
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
    const opts = { id: plot.id, w: plot.w, d: plot.d, open };
    if (project) {
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
    const plots = this.raycaster.intersectObjects(this.plotLayer.children, true);
    if (plots.length) {
      const id = plots[0].object.userData.plotId;
      if (id) { this.sim.select('plot', id); this.onPick?.('plot', id); }
    }
  }

  /** Smoothly move the camera target to a point. */
  focusOn(x, z) { this.focus = new THREE.Vector3(x, 0, z); }

  render(dt, time) {
    const s = this.sim.state;
    if (time - this.lastSync > 0.4) {
      this.syncPlots();
      this.villagers.sync(s.citizens);
      this.terrain.setForest(s.commons.forest / s.commons.forestCap);
      this.lastSync = time;
    }
    this.updateSky(s.minute / 60, time);
    const selected = this.sim.selected.kind === 'citizen' ? this.sim.selected.id : null;
    this.villagers.update(s.citizens, dt, time, selected);
    if (this.focus) {
      const t = this.controls.target;
      const delta = this.v.copy(this.focus).sub(t).multiplyScalar(Math.min(1, dt * 4));
      t.add(delta);
      this.camera.position.add(delta);
      if (delta.lengthSq() < 0.0004) this.focus = null;
    }
    this.controls.target.x = Math.max(-40, Math.min(40, this.controls.target.x));
    this.controls.target.z = Math.max(-36, Math.min(36, this.controls.target.z));
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
    this.sun.position.set(Math.sin(az) * 60, 12 + elevation * 60, 30 + Math.cos(az) * 10);
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
  }

  updateLabels(citizens, selected) {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const seen = new Set();
    for (const c of citizens) {
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
      this.v.set(node.position.x, 2.9, node.position.z).project(this.camera);
      const visible = node.visible && this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      el.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const text = c.firstName;
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('selected', c.id === selected);
      el.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
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
  const stages = p.kind === 'construction' ? STAGES : p.kind === 'refit' ? [REFIT_STAGE] : [{ work: DEMOLITION.work }];
  const s = stages[p.stageIndex];
  return s ? Math.min(1, p.work / s.work) : 0;
}

function disposeInstanced(node) {
  node.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
}
