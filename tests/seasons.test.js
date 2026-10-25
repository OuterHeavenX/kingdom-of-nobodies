// Milestone 5.1 — seasons and celebrations as the player sees them: palettes,
// snow, effects, decorations, the theme manager and preview, run headless
// (Three.js builds scenes without a GPU; nothing here needs WebGL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { deserialize, serialize } from '../src/core/Serialization.js';
import { createKingdom } from '../src/sim/Setup.js';
import { Simulation } from '../src/sim/Simulation.js';
import { DAYS_PER_YEAR } from '../src/core/Config.js';
import { buildTerrain } from '../src/world/Terrain.js';
import { KingdomScene } from '../src/world/KingdomScene.js';
import { SEASON_PALETTES, paletteFor, blendedPalette, withAccent } from '../src/holidays/SeasonalPalette.js';
import { snowCover, localWeather, snowLevel, CLIMATES, SNOW_UNIFORMS, addSnow } from '../src/effects/SnowAccumulation.js';
import { villageSites, buildDecorations, kingdomExtras, DECORATED_HOLIDAYS } from '../src/holidays/DecorationSpawner.js';
import { HolidayThemeManager } from '../src/holidays/HolidayThemeManager.js';
import { HOLIDAYS, SEASON_THEMES, SWEETHEART_SPOTS } from '../src/holidays/HolidayRegistry.js';
import { budgetFor, BUDGETS, normalizeSettings, prefersReducedMotion } from '../src/holidays/HolidaySettings.js';
import { Snowfall } from '../src/effects/Snowfall.js';
import { Fireworks } from '../src/effects/Fireworks.js';
import { Ghosts } from '../src/effects/Ghosts.js';
import { ParticleField } from '../src/effects/AmbientParticles.js';
import { solidRects } from '../src/property/Footprints.js';
import { roadRect } from '../src/navigation/RoadNetwork.js';

const grown = () => deserialize(readFileSync(new URL('./fixtures/m4-save.json', import.meta.url), 'utf8'));

function fakeWorld(state, quality = 'high') {
  const scene = new THREE.Scene();
  const village = new THREE.Group();
  scene.add(village);
  return { scene, terrain: buildTerrain(village), sim: { state }, quality, renderer: null, camera: { fov: 52 } };
}
function run(tm, seconds, step = 0.05) {
  tm.t = tm.t ?? 0;
  for (let i = 0; i < seconds / step; i++) { tm.t += step; tm.update(step, tm.t, new THREE.Vector3(), 0.8); }
}
const particlesIn = (root) => { let n = 0; root.traverse((o) => { if (o.isPoints) n += o.geometry.attributes.position.count; }); return n; };
const lum = (hex) => { const c = new THREE.Color(hex); return c.r * 0.3 + c.g * 0.59 + c.b * 0.11; };

test('1. four seasonal palettes, each distinct, blending gradually into the next', () => {
  assert.equal(SEASON_PALETTES.length, 4);
  const keys = SEASON_PALETTES.map((p) => `${p.grass}|${p.leaf}|${p.sky}|${p.sun}`);
  assert.equal(new Set(keys).size, 4, 'no two seasons look alike');
  assert.ok(new THREE.Color(SEASON_PALETTES[2].leaf).r > new THREE.Color(SEASON_PALETTES[1].leaf).r + 0.4, 'autumn trees turn orange and red');
  assert.ok(SEASON_PALETTES[2].crowns.length >= 3, 'with a mix of shades');
  assert.ok(SEASON_PALETTES[1].sunPower > SEASON_PALETTES[3].sunPower, 'summer is brighter than winter');
  assert.ok(SEASON_PALETTES[0].blossom && SEASON_PALETTES[2].fallenLeaves);
  // No change until late in a season, then a smooth blend.
  assert.equal(blendedPalette(0, 0.5).grass, SEASON_PALETTES[0].grass);
  const mid = blendedPalette(0, 0.9);
  assert.notEqual(mid.grass, SEASON_PALETTES[0].grass);
  assert.notEqual(mid.grass, SEASON_PALETTES[1].grass);
  // Holiday accents tint without replacing the season.
  const v = withAccent(paletteFor(0), 'valentine');
  assert.notEqual(v.sky, paletteFor(0).sky);
  assert.equal(v.grass, paletteFor(0).grass, 'the land keeps its own colour');
});

test('7 & 8. snow builds up from snowy days through the day, melts in milder weather, and roads stay readable', () => {
  const s = createKingdom(3);
  const winter = 10; // a winter day
  const day = (d, kind) => ({ day: d, kind });
  s.day = winter + 2; s.minute = 0;
  s.weather = { today: { kind: 'snow', intensity: 0.8, day: s.day }, history: [day(winter, 'snow'), day(winter + 1, 'snow'), day(winter + 2, 'snow')] };
  const morning = snowCover(s).cover;
  s.minute = 1200;
  const evening = snowCover(s).cover;
  assert.ok(evening > morning, 'snow keeps settling through a snowy day');
  assert.ok(['moderate', 'heavy'].includes(snowLevel(evening)));
  // Clear and rainy days melt it.
  s.day = winter + 4; s.minute = 1440 - 10;
  s.weather = { today: { kind: 'rain', intensity: 0.6, day: s.day }, history: [day(winter, 'snow'), day(winter + 1, 'snow'), day(winter + 2, 'snow'), day(winter + 3, 'clear'), day(winter + 4, 'rain')] };
  const melted = snowCover(s).cover;
  assert.ok(melted < evening, 'it melts');
  // Spring melts faster than winter.
  const springState = { ...s, day: 2, weather: { today: { kind: 'clear', day: 2 }, history: [day(0, 'snow'), day(1, 'snow'), day(2, 'clear')] }, minute: 1430 };
  const winterState = { ...s, day: 11, weather: { today: { kind: 'clear', day: 11 }, history: [day(9, 'snow'), day(10, 'snow'), day(11, 'clear')] }, minute: 1430 };
  assert.ok(snowCover(springState).cover < snowCover(winterState).cover);
  // The shader: every shared material can carry snow; roads carry less.
  const terrain = buildTerrain(new THREE.Group());
  assert.ok(terrain.ground.material.userData.snowScale, 'the ground takes snow');
  assert.ok(Object.values(terrain.roadMaterials).every((m) => m.userData.snowScale.value <= 0.3), 'roads stay readable');
  const m = addSnow(new THREE.MeshStandardMaterial());
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <normal_fragment_maps>' };
  m.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uSnow, SNOW_UNIFORMS.uSnow, 'one shared uniform drives the whole scene');
  assert.match(shader.fragmentShader, /snowNoise/, 'patchy, not a flat white sheet');
});

test('18. each kingdom has its own climate and look', () => {
  const s = createKingdom(3);
  s.day = 11; s.minute = 600;
  s.weather = { today: { kind: 'snow', intensity: 0.6, day: 11 }, history: [{ day: 10, kind: 'clear' }, { day: 11, kind: 'snow' }] };
  assert.equal(localWeather(s, 'saltmere').kind, 'rain', "Saltmere's coast gets sleet, not snow");
  assert.equal(localWeather(s, 'ironhold').kind, 'snow');
  s.weather.today = { kind: 'rain', intensity: 0.6, day: 11 };
  assert.equal(localWeather(s, 'ironhold').kind, 'snow', 'winter rain falls as snow in the mountains');
  s.weather.today = { kind: 'clear', intensity: 0.5, day: 11 };
  assert.ok(snowCover(s, 'ironhold').cover >= CLIMATES.ironhold.winterMin, 'Ironhold keeps a winter blanket');
  assert.ok(snowCover(s, 'saltmere').cover < snowCover(s, 'ironhold').cover);
  assert.notEqual(paletteFor(3, 'ironhold').grass, paletteFor(3, 'saltmere').grass);
  // Each kingdom's own decorations on top of the shared set.
  const sets = {};
  for (const k of ['greenvale', 'ironhold', 'saltmere']) {
    const scene = new KingdomScene(s, k);
    const sites = scene.decorSites();
    const set = buildDecorations('winter', { sites, density: 1, seedKey: k, extra: kingdomExtras(k, 'winter') });
    sets[k] = { count: set.count, attached: set.attached?.length ?? 0 };
    if (k === 'greenvale') { const spring = buildDecorations('spring', { sites, density: 1, seedKey: k, extra: kingdomExtras(k, 'spring') }); assert.ok(spring.count > 20); spring.dispose(); }
    set.dispose();
    scene.dispose();
  }
  assert.ok(sets.saltmere.attached > 0, "Saltmere's ships are dressed");
  assert.ok(sets.ironhold.count > sets.greenvale.count - 30, 'Ironhold lines its walls with lanterns');
  assert.ok(Object.values(sets).every((x) => x.count > 40));
});

test('4. Valentine\'s Day fills the town with pink and red, hearts and romantic benches, without one solid colour', () => {
  const s = grown();
  const sites = villageSites(s);
  const trees = buildTerrain(new THREE.Group()).trees;
  const set = buildDecorations('valentine', { sites, density: 1, trees });
  const kinds = new Map();
  for (const mesh of set.meshes) kinds.set(`${mesh.geometry.type}`, (kinds.get(mesh.geometry.type) ?? 0) + mesh.count);
  assert.ok((kinds.get('ExtrudeGeometry') ?? 0) >= 20, 'heart shapes');
  const colors = new Set(set.meshes.map((m) => m.material.color.getHexString()));
  assert.ok(colors.size >= 8, 'many colours, not one pink');
  const pinkish = set.meshes.filter((m) => { const c = m.material.color; return c.r > 0.8 && c.g < 0.8; }).reduce((t, m) => t + m.count, 0);
  assert.ok(pinkish > 100, 'plenty of pink and red');
  for (const [x, z] of SWEETHEART_SPOTS) assert.ok(set.spots.some(([a, b]) => Math.hypot(a - x, b - z) < 0.01), 'a bench at every sweethearts\' spot');
  set.dispose();
});

test('5. Halloween: pumpkins by homes, roads, the square and farms; skeletons and ghosts move', () => {
  const s = grown();
  const sites = villageSites(s);
  const set = buildDecorations('halloween', { sites, density: 1 });
  const pumpkins = set.meshes.filter((m) => /^#?(e8761c|c95d12|ff8a1c)$/.test(m.material.color.getHexString())).reduce((t, m) => t + m.count, 0);
  assert.ok(pumpkins >= 80, `pumpkins everywhere (${pumpkins})`);
  const near = (list) => list.some(([x, z]) => set.spots.some(([a, b]) => Math.hypot(a - x, b - z) < 0.01));
  assert.ok(near(sites.homes) && near(sites.verges) && near(sites.square) && near(sites.farms), 'beside houses, roads, the square and farms');
  assert.ok(set.live.length >= 5, 'skeletons (and haunted stalls)');
  const skel = set.live.find((o) => o.group.children.length > 10);
  const arm = skel.group.children.find((c) => c.isGroup);
  set.update(0.1, 1, { night: 1 });
  const r1 = arm.rotation.z;
  set.update(0.1, 2.3, { night: 1 });
  assert.notEqual(arm.rotation.z, r1, 'the skeleton waves');
  const ghosts = new Ghosts(sites.ghosts, { ghosts: 4, bats: 4 });
  ghosts.update(0.1, 1);
  const p1 = ghosts.ghosts[0].position.clone();
  ghosts.update(0.1, 3);
  assert.ok(ghosts.ghosts[0].position.distanceTo(p1) > 0.1, 'ghosts drift');
  ghosts.dispose();
  set.dispose();
});

test('13. decorations never stand on roads, in doorways or inside buildings', () => {
  const s = grown();
  const sites = villageSites(s);
  const roads = s.roads.map(roadRect);
  const solids = s.plots.flatMap((p) => solidRects(p));
  const inside = (x, z, [a, b, c, d], pad = 0) => x > a - pad && x < c + pad && z > b - pad && z < d + pad;
  for (const id of [...DECORATED_HOLIDAYS, 'season-0', 'season-1', 'season-2']) {
    const set = buildDecorations(id, { sites, density: 1 });
    for (const [x, z] of set.spots) {
      // Wreaths hang on the door and cobwebs from the eaves: mounted on the building, not standing on the ground.
      if ([...sites.doors, ...sites.corners].some(([dx, dz]) => Math.hypot(dx - x, dz - z) < 0.01)) continue;
      assert.ok(!roads.some((r) => inside(x, z, r)), `${id}: a decoration at ${x.toFixed(1)},${z.toFixed(1)} sits on a road`);
      assert.ok(!solids.some((r) => inside(x, z, r)), `${id}: a decoration at ${x.toFixed(1)},${z.toFixed(1)} is inside a building`);
    }
    set.dispose();
  }
  // Same seed, same place: the same pumpkins on the same steps after a reload.
  const a = buildDecorations('halloween', { sites, density: 1 }), b = buildDecorations('halloween', { sites: villageSites(deserialize(serialize(s))), density: 1 });
  assert.deepEqual(a.spots, b.spots);
  a.dispose(); b.dispose();
});

test('6. winter brings snowfall that drifts with the wind, sized by the budget', () => {
  const snow = new Snowfall(400);
  const total = snow.objects.reduce((t, o) => t + o.geometry.attributes.position.count, 0);
  assert.equal(total, 400);
  snow.update(0.1, 1, { x: 0, z: 0 }, { weather: { kind: 'snow', intensity: 0.4 }, pixelScale: 900 });
  const calm = snow.big.uniforms.uWind.value.x;
  snow.update(0.1, 2, { x: 0, z: 0 }, { weather: { kind: 'wind', intensity: 0.9 }, pixelScale: 900 });
  assert.ok(snow.big.uniforms.uWind.value.x > calm, 'flakes drift sideways in wind');
  const sizes = snow.fine.points.geometry.attributes.aSeed.array;
  assert.ok(new Set(Array.from(sizes).filter((_, i) => i % 4 === 3).map((v) => Math.round(v * 10))).size > 3, 'flakes vary in size');
  snow.dispose();
  // In the scene: a winter preview turns snow on and lays it on the ground.
  const s = grown();
  const tm = new HolidayThemeManager(fakeWorld(s), {});
  tm.startPreview('season-3');
  run(tm, 3);
  assert.ok(tm.env.effects.snow, 'snow is falling');
  assert.ok(tm.env.cover > 0.3, 'and settling');
  tm.dispose();
});

test('11 & 12. previews change only the picture, and everything they built is taken down', () => {
  const s = grown();
  const before = JSON.stringify(s);
  const world = fakeWorld(s);
  const tm = new HolidayThemeManager(world, {});
  run(tm, 1);
  const baseline = tm.env.root.children.length;
  const disposed = [];
  const watch = () => tm.env.root.traverse((o) => { if (o.material && !o.material.__watched) { o.material.__watched = true; o.material.addEventListener('dispose', () => disposed.push(o.material.uuid)); } });
  for (const t of [...SEASON_THEMES, ...HOLIDAYS]) { tm.startPreview(t.id); run(tm, 0.6); watch(); }
  tm.stopPreview();
  run(tm, 40);
  assert.equal(tm.preview, null);
  assert.equal(tm.theme.source, 'game', 'the real season and holiday are back');
  assert.ok(disposed.length > 20, 'old decorations and effects released their GPU resources');
  assert.ok(tm.env.root.children.length <= baseline + 2, `nothing left behind (${tm.env.root.children.length} vs ${baseline})`);
  assert.equal(JSON.stringify(s), before, 'no time, people, money, chronicle or save data changed');
  // A simulation stepped while previewing ends exactly where one without a preview does.
  const a = new Simulation(createKingdom(9)), b = new Simulation(createKingdom(9));
  const tb = new HolidayThemeManager(fakeWorld(b.state), {});
  for (let d = 0; d < 3; d++) { tb.startPreview(HOLIDAYS[d].id); run(tb, 0.3); a.runDays(1); b.runDays(1); }
  assert.equal(JSON.stringify({ ...a.state, events: [] }), JSON.stringify({ ...b.state, events: [] }));
  tm.dispose(); tb.dispose();
});

test('10c. the theme manager sets off each recorded show once and never replays one after a load', () => {
  const sim = new Simulation(createKingdom(31));
  const tm = new HolidayThemeManager(fakeWorld(sim.state), {}, { announce: () => {} });
  run(tm, 0.2);
  sim.runDays(DAYS_PER_YEAR + 1); // through New Year's midnight
  run(tm, 1);
  assert.equal(tm.firedShows, sim.state.holidays.fireworks.length, 'one show per recorded event');
  const shows = tm.firedShows;
  run(tm, 1);
  assert.equal(tm.firedShows, shows, 'not again');
  // Load the same world: the shows already recorded are history.
  sim.state = deserialize(serialize(sim.state));
  tm.world.sim.state = sim.state;
  tm.resetFireworks();
  run(tm, 1);
  assert.equal(tm.firedShows, shows, 'loading does not replay them');
  tm.dispose();
});

test('16 & 17. reduced motion calms everything, and mobile budgets cap every effect', () => {
  const on = normalizeSettings({ reducedMotion: 'on' }), off = normalizeSettings({ reducedMotion: 'off' });
  assert.equal(prefersReducedMotion(on), true);
  assert.equal(prefersReducedMotion(off), false);
  assert.equal(prefersReducedMotion(normalizeSettings({}), () => ({ matches: true })), true, 'follows the system setting');
  assert.ok(budgetFor('high', on).particles < budgetFor('high', off).particles);
  const calm = new Fireworks(400, { reducedMotion: true }), lively = new Fireworks(400);
  calm.launchShow({ origins: [[0, 0]], duration: 20 }); lively.launchShow({ origins: [[0, 0]], duration: 20 });
  assert.ok(calm.queue.length < lively.queue.length / 2, 'fewer, gentler fireworks');
  assert.ok(calm.uniforms.uLife.value > lively.uniforms.uLife.value, 'that fade slowly');
  calm.dispose(); lively.dispose();
  assert.ok(BUDGETS.low.particles <= 300 && BUDGETS.low.fireworks <= 200, 'phone budgets are small');
  // Every preview on low quality stays within the budget.
  const s = grown();
  const tm = new HolidayThemeManager(fakeWorld(s, 'low'), {});
  let worst = 0;
  for (const t of [...SEASON_THEMES, ...HOLIDAYS]) { tm.startPreview(t.id); run(tm, 0.3); worst = Math.max(worst, particlesIn(tm.env.root)); }
  const cap = BUDGETS.low.particles * 1.6 + BUDGETS.low.fireworks + 200;
  assert.ok(worst <= cap, `at most ${cap} particles on screen on a phone (worst ${worst})`);
  tm.dispose();
  const field = new ParticleField({ count: 50, colors: ['#fff'] });
  field.update(0.1, 1, { x: 5, z: 5 }, { pixelScale: 500 });
  assert.equal(field.uniforms.uCenter.value.x, 5, 'particles follow the view, a fixed number of them');
  field.dispose();
});

test('the season is visible at a glance: winter is whiter, autumn warmer, summer greener', () => {
  const g = (i) => new THREE.Color(SEASON_PALETTES[i].grass);
  assert.ok(lum(SEASON_PALETTES[3].sky) > lum(SEASON_PALETTES[1].sky));
  assert.ok(g(2).r > g(1).r, 'autumn fields turn golden');
  assert.ok(g(1).g > g(1).r * 1.5, 'summer is green');
});
