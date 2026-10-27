// UI, rendering, audio and service-worker fixes: the live sheet keeps a search
// box and a scroll intact, Then & Now is never overdrawn, scene props follow a
// replaced kingdom, audio nodes and contexts are let go, the service worker
// only keeps good copies of the page, and the boot watchdog waits for slow
// but progressing loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { patchAround, SheetActivity } from '../src/ui/LiveSheet.js';
import { World, clippedCopy } from '../src/world/World.js';
import { addSnow } from '../src/effects/SnowAccumulation.js';
import { litWindow } from '../src/world/Models.js';
import { Simulation } from '../src/sim/Simulation.js';
import { createKingdom } from '../src/sim/Setup.js';
import { FakeAudioContext, memoryStorage } from './fake-audio.js';
import { AudioManager } from '../src/audio/AudioManager.js';

// --- A minimal DOM: elements, text, attributes and moving nodes ------------------------

class FakeNode {
  constructor() { this.parentNode = null; this.childNodes = []; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] ?? null : null; }
  insertBefore(node, ref) {
    node.parentNode?.removeChild(node);
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    assert.ok(i >= 0, 'reference node is a child');
    this.childNodes.splice(i, 0, node);
    node.parentNode = this;
    return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    assert.ok(i >= 0, 'removing a child');
    this.childNodes.splice(i, 1);
    node.parentNode = null;
    if (node.contains(FakeEl.focused)) FakeEl.focused = null; // detaching blurs, as in a browser
    return node;
  }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}

class FakeText extends FakeNode {
  constructor(text) { super(); this.nodeType = 3; this.text = text; }
}

class FakeEl extends FakeNode {
  constructor(tag, attrs = {}, ...kids) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    for (const k of kids) this.appendChild(typeof k === 'string' ? new FakeText(k) : k);
  }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(''); }
  focus() { FakeEl.focused = this; }
}
FakeEl.focused = null;
const el = (tag, attrs, ...kids) => new FakeEl(tag, attrs, ...kids);
const root = (...kids) => el('div', { id: 'sheet-body' }, ...kids);

// --- 1. Search boxes keep their focus through live refreshes ----------------------------

test('ui 1: a live refresh replaces everything around the focused search box, never the box', () => {
  const input = el('input', { class: 'search', type: 'search', 'data-act': 'citizen-search', value: '' });
  input.value = 'em'; // typed, not yet in any attribute
  const body = root(el('div', { class: 'demo' }, 'Population 5'), input, el('div', { class: 'list' }, 'Emma'));
  input.focus();
  const fresh = root(el('div', { class: 'demo' }, 'Population 6'), el('input', { class: 'search', type: 'search', 'data-act': 'citizen-search', value: 'em' }), el('div', { class: 'list' }, 'Emma', 'Emmett'));
  assert.equal(patchAround(body, fresh, input), true);
  assert.equal(body.childNodes[1], input, 'the very same input element');
  assert.equal(FakeEl.focused, input, 'it was never detached, so it keeps the focus');
  assert.equal(input.value, 'em', 'and what was typed');
  assert.equal(body.textContent, 'Population 6EmmaEmmett', 'the rest is the new content');
  assert.equal(body.childNodes.length, 3);
});

test('ui 1: nested boxes are kept with their ancestors updated; no single match means no patch', () => {
  const input = el('input', { class: 'search', 'data-act': 'hist-search' });
  const wrap = el('section', { class: 'old' }, el('b', {}, 'Year 3'), input, el('ul', {}, 'a'));
  const body = root(el('p', {}, 'chips'), wrap);
  input.focus();
  const fresh = root(el('p', {}, 'chips!'), el('section', { class: 'new' }, el('b', {}, 'Year 4'), el('input', { class: 'search', 'data-act': 'hist-search' }), el('ul', {}, 'b')), el('p', {}, 'tail'));
  assert.equal(patchAround(body, fresh, input), true);
  assert.equal(body.childNodes[1], wrap, 'the ancestor stays');
  assert.equal(wrap.getAttribute('class'), 'new', 'with the new attributes');
  assert.equal(body.textContent, 'chips!Year 4btail');
  assert.equal(FakeEl.focused, input);
  // Another view (no box), or two candidates: refuse, so the caller decides.
  const other = root(el('p', {}, 'Families'));
  assert.equal(patchAround(body, other, input), false);
  const twice = root(el('input', { class: 'search', 'data-act': 'hist-search' }), el('input', { class: 'search', 'data-act': 'hist-search' }));
  assert.equal(patchAround(body, twice, input), false);
  assert.equal(body.textContent, 'chips!Year 4btail', 'nothing changed on refusal');
});

test('ui 1: the HUD keeps the box on a live refresh (and on a keystroke re-render)', () => {
  const hud = readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
  assert.match(hud, /patchAround\(body, t\.content, keep\)/);
  assert.match(hud, /if \(!force\) return;/, 'a periodic refresh that cannot keep the box skips instead');
  const css = readFileSync(new URL('../src/styles/panels.css', import.meta.url), 'utf8');
  assert.match(css, /\.search \{[^}]*font-size: 16px/, 'search boxes are 16px so iPhone Safari does not zoom on focus');
});

// --- 2. Touch scrolls end with pointercancel; momentum holds updates ------------------

test('ui 2: a cancelled pointer (a native scroll) ends the hold, and scrolling holds it a second', () => {
  let t = 0;
  const a = new SheetActivity({ now: () => t });
  assert.equal(a.busy(), false);
  a.down();
  t = 5000;
  assert.equal(a.busy(), true, 'held while the finger is down');
  a.up(); // pointercancel goes through the same path
  t = 5100;
  assert.equal(a.busy(), true, 'briefly after');
  t = 5300;
  assert.equal(a.busy(), false, 'then live again: before the fix it stayed frozen after a scroll');
  a.scrolled();
  t = 6000;
  assert.equal(a.busy(), true, 'momentum scrolling holds updates');
  t = 6400;
  assert.equal(a.busy(), false, 'one second after the last scroll they resume');
  a.up();
  assert.equal(a.busy(), false, 'a stray pointerup does not hold anything');
});

test('ui 2: the HUD clears the hold on pointercancel and listens to scrolling', () => {
  const hud = readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
  assert.match(hud, /addEventListener\('pointercancel', \(\) => this\.activity\.up\(\)\)/);
  assert.match(hud, /addEventListener\('scroll'/);
  assert.match(hud, /!this\.activity\.busy\(now\)/);
});

// --- 3, 5, 6. The 3D view (three in Node, no renderer) -----------------------------------

function fakeWorld(seed = 7) {
  const sim = new Simulation(createKingdom(seed));
  const w = Object.create(World.prototype);
  Object.assign(w, {
    sim, village: new THREE.Group(), plotLayer: new THREE.Group(), plotNodes: new Map(), ghosts: new Map(), market: null, memorial: null, thenNow: null,
    roadWorks: new Map(), roadWorkLayer: new THREE.Group(), renderer: { localClippingEnabled: false }, mode: 'village', cranes: [],
  });
  w.village.add(w.plotLayer, w.roadWorkLayer);
  w.refreshSkyline = () => {};
  w.flyTo = () => {};
  w.focusOn = () => {};
  w.home = () => { w.mode = 'village'; };
  w.syncPlots(true);
  return w;
}
const builtPlot = (w) => w.sim.state.plots.find((p) => p.building);

test('ui 3: Then & Now is not overdrawn when the real building is rebuilt underneath it', () => {
  const w = fakeWorld();
  const plot = builtPlot(w);
  assert.equal(w.showThenNow(plot.id, 1, 0.5), true);
  assert.equal(w.plotNodes.get(plot.id).visible, false, 'the real building is hidden');
  // The property changes while Then & Now is open (here: it gets selected), so syncPlots rebuilds it.
  w.sim.selected = { kind: 'plot', id: plot.id };
  w.syncPlots();
  const rebuilt = w.plotNodes.get(plot.id);
  assert.equal(rebuilt.visible, false, 'the rebuilt node stays hidden (it used to come back visible)');
  w.ghost(plot.id);
  assert.equal(w.ghosts.has(plot.id), false, 'and it is never ghosted');
  w.exitThenNow(false);
  assert.equal(w.plotNodes.get(plot.id).visible, true, 'shown again when Then & Now ends');
});

test('ui 6: Then & Now copies keep the snow shader and follow the night glow; ending it frees crop instances', () => {
  const src = addSnow(new THREE.MeshStandardMaterial({ color: '#888888' }), 0.6);
  const plane = new THREE.Plane();
  const copy = clippedCopy(src, plane);
  assert.equal(copy.onBeforeCompile, src.onBeforeCompile, 'the snow patch is carried over (Material.clone drops it)');
  assert.equal(copy.customProgramCacheKey(), 'snow');
  assert.deepEqual(copy.clippingPlanes, [plane]);
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  copy.onBeforeCompile(shader, null);
  assert.ok(shader.uniforms.uSnow && shader.fragmentShader.includes('uSnowColor'), 'the copy compiles with snow');

  const w = fakeWorld();
  const plot = builtPlot(w);
  plot.building = { ...plot.building, type: 'farm', level: 1 }; // visual only: a farm has instanced crops
  w.showThenNow(plot.id, 1, 0.5);
  const meshes = [];
  w.thenNow.root.traverse((o) => { if (o.isMesh && o.userData.ownMaterial) meshes.push(o); });
  assert.ok(meshes.length > 0);
  assert.ok(meshes.every((m) => m.material.userData.clippedFrom), 'every copy knows its original');
  const glowing = meshes.find((m) => m.material.userData.clippedFrom === litWindow) ?? meshes[0];
  glowing.material.userData.clippedFrom.emissiveIntensity = 2.25;
  w.syncThenNowMaterials();
  assert.equal(glowing.material.emissiveIntensity, 2.25, 'night glow reaches the copy');
  let disposed = 0, instanced = 0;
  w.thenNow.root.traverse((o) => { if (o.isInstancedMesh) { instanced++; o.addEventListener('dispose', () => disposed++); } });
  assert.ok(instanced > 0, 'the farm has instanced crops');
  w.exitThenNow(false);
  assert.equal(disposed, instanced, 'their instance buffers are freed');
  glowing.material.userData.clippedFrom.emissiveIntensity = 0.05;
  litWindow.emissiveIntensity = 0.05;
});

test('ui 5: market stalls and the memorial go when the new kingdom has none', () => {
  const w = fakeWorld();
  const s = w.sim.state;
  s.council.marketplace = true;
  s.monuments = [...(s.monuments ?? []).filter((m) => m.id !== 'founders'), { id: 'founders' }];
  w.syncPlots(true);
  assert.ok(w.market && w.market.parent === w.village, 'stalls stand in the square');
  assert.ok(w.memorial && w.memorial.parent === w.village, 'the memorial stands');
  // A new / imported / restored / cloud kingdom without either.
  w.sim.state = createKingdom(99);
  w.sim.state.council.marketplace = false;
  w.sim.state.monuments = (w.sim.state.monuments ?? []).filter((m) => m.id !== 'founders');
  w.syncPlots(true);
  // (Booleans, not the objects: a failing assert would print the whole scene graph.)
  assert.equal(w.market === null, true, 'the stalls are gone (they used to stay)');
  assert.equal(w.memorial === null, true, 'the memorial is gone (it used to stay)');
  assert.equal(w.village.children.filter((c) => c.userData.monument === 'founders').length, 0);
});

// --- 4. Coming home from a visit through the HUD; a preview ends with the kingdom --------

test('ui 4: Then & Now comes home through the HUD; replacing the kingdom stops a Holiday Preview', () => {
  const hud = readFileSync(new URL('../src/ui/HUD.js', import.meta.url), 'utf8');
  assert.match(hud, /mode !== 'village'\) this\.visit\('hearth'\);\n\s+const ok = this\.game\.world\?\.showThenNow/);
  const game = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
  assert.match(game, /if \(this\.world\?\.themes\.preview\) this\.world\.themes\.stopPreview\(\);/);
});

// --- Audio ---------------------------------------------------------------------------

function withTimers(fn) {
  const real = globalThis.setTimeout;
  const queue = [];
  globalThis.setTimeout = (cb) => { queue.push(cb); return { unref() {} }; };
  const restore = () => { globalThis.setTimeout = real; };
  let out;
  try { out = fn(() => { while (queue.length) queue.shift()(); }); } catch (e) { restore(); throw e; }
  if (out?.then) return out.finally(restore);
  restore();
  return out;
}

test('audio: an effect lets go of its stereo panner as well as its gain', () => {
  const a = new AudioManager({ storage: memoryStorage(), AudioContextClass: FakeAudioContext, getState: () => null, getWorld: () => null });
  a.enable();
  const panners = [];
  const make = a.ctx.createStereoPanner.bind(a.ctx);
  a.ctx.createStereoPanner = () => { const p = make(); panners.push(p); return p; };
  withTimers((flush) => {
    assert.equal(a.sfx('coins'), true);
    assert.equal(panners.length, 1);
    assert.equal(panners[0].outputs.length, 1, 'connected to the bus while it plays');
    flush();
  });
  assert.equal(panners[0].outputs.length, 0, 'disconnected afterwards (it used to stay on the bus for good)');
  a.dispose();
});

test('audio: the New Year bells context sleeps when hidden and when idle, and wakes to ring', async () => {
  const listeners = {};
  const saved = { AudioContext: globalThis.AudioContext, document: globalThis.document, add: globalThis.addEventListener };
  globalThis.AudioContext = FakeAudioContext;
  globalThis.document = { hidden: false, addEventListener: (k, fn) => { listeners[k] = fn; } };
  globalThis.addEventListener = (k, fn) => { listeners['w:' + k] = fn; };
  const { unlockAudio, ringBells, bellsState, resetBells } = await import('../src/ui/Bells.js');
  try {
    await withTimers(async (flush) => {
      unlockAudio();
      assert.equal(bellsState(), 'running', 'the tap unlocks it');
      flush();
      assert.equal(bellsState(), 'suspended', 'then it rests until it is needed');
      assert.equal(ringBells(), true);
      await Promise.resolve(); await Promise.resolve();
      assert.equal(bellsState(), 'running', 'woken to ring');
      document.hidden = true;
      listeners.visibilitychange();
      assert.equal(bellsState(), 'suspended', 'suspended while the game is hidden');
      assert.equal(ringBells(), false, 'and silent there');
      document.hidden = false;
      assert.equal(ringBells(), true);
      await Promise.resolve(); await Promise.resolve();
      flush();
      assert.equal(bellsState(), 'suspended', 'asleep again once the bells have died away');
    });
  } finally {
    resetBells();
    globalThis.AudioContext = saved.AudioContext;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    if (saved.add === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = saved.add;
  }
});

// --- 7. The service worker keeps only good copies of the game's page ---------------------

async function serviceWorkerSource() {
  const { default: config } = await import('../vite.config.js');
  const plugin = config.plugins.find((p) => p.name === 'kon-service-worker');
  let source = null;
  plugin.generateBundle.call({ emitFile: (f) => { source = f.source; } }, {}, { 'assets/index-abc.js': {} });
  return source;
}

test('ui 7: navigations only refresh the offline page from ok, same-origin responses for the app root', async () => {
  const source = await serviceWorkerSource();
  const handlers = {};
  const puts = [];
  let next = null;
  const cache = { put: (k, v) => { puts.push([k, v]); return Promise.resolve(); }, addAll: () => Promise.resolve() };
  const ctx = vm.createContext({
    URL, Promise,
    self: { location: new URL('https://example.org/kingdom-of-nobodies/sw.js'), addEventListener: (k, fn) => { handlers[k] = fn; } },
    caches: { open: () => Promise.resolve(cache), match: () => Promise.resolve('cached'), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
    fetch: () => Promise.resolve(next),
  });
  vm.runInContext(source, ctx);
  const navigate = async (url, res) => {
    next = { ...res, clone() { return { copy: url }; } };
    let out;
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url }, respondWith: (p) => { out = p; } });
    const r = await out;
    await new Promise((resolve) => setImmediate(resolve));
    return r;
  };
  const root = 'https://example.org/kingdom-of-nobodies/';
  const ok = { ok: true, status: 200, type: 'basic', redirected: false };
  assert.equal((await navigate(root, { ...ok, ok: false, status: 503 })).status, 503, 'an error page is still shown');
  assert.equal(puts.length, 0, 'but never cached as the offline page (it used to be)');
  await navigate(root, { ok: false, status: 0, type: 'opaqueredirect', redirected: false });
  await navigate(root, { ...ok, redirected: true });
  await navigate(root + 'other.html', ok);
  assert.equal(puts.length, 0, 'redirects and other pages are not kept either');
  await navigate(root + '?autostart', ok);
  assert.equal(puts.length, 1, 'a good copy of the app root is');
  assert.equal(puts[0][0], './');
});

// --- Boot watchdog: progress-aware, not a fixed 15 s reload --------------------------------

function bootWatchdog({ retried = false } = {}) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?Startup guard[\s\S]*?)<\/script>/)[1];
  let now = 0;
  const intervals = [], observers = [], timeouts = [];
  const runTimeouts = () => { for (const t of timeouts) if (!t.done && t.at <= now) { t.done = true; t.f(); } };
  const storage = new Map(retried ? [['kon-retried', '1']] : []);
  const boot = { classList: { add: (c) => { boot.cls = c; } }, querySelector: () => ({ set textContent(v) { boot.text = v; } }) };
  const env = {
    reloads: 0, failed: () => boot.cls === 'failed',
    advance(ms, { busy = false } = {}) {
      if (busy) { now += ms; runTimeouts(); for (const f of intervals) f(); return; }
      for (let t = 0; t < ms; t += 1000) { now += 1000; runTimeouts(); for (const f of intervals) f(); }
    },
    progress() { for (const o of observers) o(); },
  };
  const window = { addEventListener() {} };
  const ctx = vm.createContext({
    window, Date: { now: () => now },
    setTimeout: (f, ms) => { timeouts.push({ f, at: now + ms }); return timeouts.length; }, setInterval: (f) => { intervals.push(f); return intervals.length; }, clearInterval: (id) => { intervals[id - 1] = () => {}; },
    sessionStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    location: { pathname: '/kingdom-of-nobodies/', hash: '', replace: () => { env.reloads++; } },
    navigator: { onLine: true },
    document: { hidden: false, getElementById: (id) => (id === 'boot' ? boot : null), addEventListener() {} },
    PerformanceObserver: class { constructor(cb) { observers.push(cb); } observe() {} },
  });
  vm.runInContext(script, ctx);
  env.window = window;
  return env;
}

test('boot: a slow first load that keeps making progress is never reloaded at 15 s', () => {
  const env = bootWatchdog();
  for (let i = 0; i < 9; i++) { env.advance(10000); env.progress(); } // a file finishes every 10 s, for 90 s
  assert.equal(env.reloads, 0, 'no reload while files keep arriving (a fixed 15 s timer reloaded here)');
  assert.equal(env.failed(), false);
  env.advance(25000, { busy: true }); // the main thread busy raising a large kingdom
  assert.equal(env.reloads, 0, 'busy is not stalled');
  env.window.__konStarted = true;
  env.advance(60000);
  assert.equal(env.reloads, 0, 'started: the watchdog stands down');
});

test('boot: a real stall is retried once with a fresh copy, then the player is asked', () => {
  const env = bootWatchdog();
  env.advance(19000);
  assert.equal(env.reloads, 0);
  env.advance(2000);
  assert.equal(env.reloads, 1, 'twenty silent seconds: one fresh reload');
  const again = bootWatchdog({ retried: true });
  again.advance(21000);
  assert.equal(again.reloads, 0, 'never a reload loop');
  assert.equal(again.failed(), true, 'the player gets the retry button');
});
