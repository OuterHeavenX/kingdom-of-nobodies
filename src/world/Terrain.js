import * as THREE from 'three';
import { mat, PALETTE as P, G, part } from './Materials.js';
import { ROAD_KINDS, RIVER } from '../navigation/RoadNetwork.js';
import { bridgeModel } from './Models.js';

// Ground, roads, the town square and all instanced scenery. The forest north
// of Timber Edge mirrors the simulation's forest commons: as lumberyards cut
// timber, trees there become stumps, and they grow back as the forest regrows.

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function buildTerrain(scene) {
  const rand = seeded(42);
  const groundGeo = new THREE.PlaneGeometry(300, 300, 60, 60).rotateX(-Math.PI / 2);
  const colors = [];
  const base = new THREE.Color(P.grass);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 92) pos.setY(i, (r - 92) * 0.12 * (0.6 + rand() * 0.8));
    const c = base.clone().offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.06);
    colors.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  // Roads are drawn from simulation state (see syncRoads); the river is fixed geography.
  const roads = new THREE.Group();
  scene.add(roads);
  const river = new THREE.Group();
  const riverZ = (RIVER.zMin + RIVER.zMax) / 2, riverD = RIVER.zMax - RIVER.zMin;
  const water = new THREE.MeshStandardMaterial({ color: '#5d9db5', roughness: 0.25, metalness: 0.1, flatShading: true, emissive: '#16384a', emissiveIntensity: 0.25 });
  part(river, G.plane(), mat('#b9a77c', { roughness: 1 }), [320, 1, riverD + 3.4], [0, 0.02, riverZ], null, false);
  part(river, G.plane(), water, [320, 1, riverD], [0, 0.05, riverZ], null, false);
  for (let i = 0; i < 70; i++) {
    const x = -150 + rand() * 300, side = rand() < 0.5 ? -1 : 1;
    part(river, G.cone(4), mat('#6f8f4a'), [0.25, 0.9 + rand() * 0.6, 0.25], [x, 0.45, riverZ + side * (riverD / 2 + 0.6 + rand())], null, false);
  }
  scene.add(river);

  const square = new THREE.Group();
  part(square, G.disc(), mat(P.stone, { roughness: 1 }), [9, 1, 9], [0, 0.04, 0], null, false);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    part(square, G.box(), mat(P.stoneDark), [0.5, 0.35, 0.5], [Math.cos(a) * 1.3, 0.18, Math.sin(a) * 1.3], [0, a, 0]);
  }
  const fire = part(square, G.cone(7), new THREE.MeshStandardMaterial({ color: P.fire, emissive: '#ff7a1f', emissiveIntensity: 1.6, flatShading: true }), [1.1, 1.5, 1.1], [0, 0.85, 0], null, false);
  const logs = mat(P.trunk);
  for (let i = 0; i < 3; i++) part(square, G.cyl(6), logs, [0.25, 1.4, 0.25], [0, 0.25, 0], [Math.PI / 2, (i * Math.PI) / 3, 0], false);
  for (const [x, z, r] of [[-3.8, 2.6, 0.3], [3.6, -2.8, 2.5]]) {
    part(square, G.box(), mat(P.plank), [2, 0.12, 0.5], [x, 0.5, z], [0, r, 0]);
  }
  scene.add(square);
  const fireLight = new THREE.PointLight('#ff9a4a', 0, 16, 1.6);
  fireLight.position.set(0, 2, 0);
  scene.add(fireLight);

  const lamps = [];
  const lampGlass = new THREE.MeshStandardMaterial({ color: '#ffe3a1', emissive: '#ffb04a', emissiveIntensity: 0, flatShading: true });
  for (const [x, z] of [[-13, 2.4], [13, 2.4], [-13, -2.4], [13, -2.4], [2.4, 11], [-2.4, -13], [26, 2.4], [-26, -2.4]]) {
    const lamp = new THREE.Group();
    part(lamp, G.box(), mat(P.timberDark), [0.14, 2.6, 0.14], [0, 1.3, 0]);
    part(lamp, G.box(), lampGlass, [0.36, 0.42, 0.36], [0, 2.7, 0], null, false);
    lamp.position.set(x, 0, z);
    scene.add(lamp);
    lamps.push(lamp);
  }

  // Instanced trees: an outer ring of woodland plus the managed forest commons.
  const trunks = [], crowns = [], pines = [], forest = [];
  const place = (x, z, s, kind, commons = false) => {
    const entry = { x, z, s, kind };
    if (commons) forest.push(entry); else (kind === 'pine' ? pines : crowns).push(entry);
    trunks.push(entry);
  };
  // Woodland surrounds the valley beyond the land the town can grow into.
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2, r = 82 + rand() * 46;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    // Keep the river and the three regional roads clear of trees.
    if (z > RIVER.zMin - 3 && z < RIVER.zMax + 3) continue;
    if (Math.abs(z) < 4 && x < 0 || Math.abs(x) < 4) continue;
    place(x, z, 0.9 + rand() * 0.8, rand() < 0.45 ? 'pine' : 'round');
  }
  for (let i = 0; i < 44; i++) place(10 + rand() * 26, -20 - rand() * 14, 0.75 + rand() * 0.45, rand() < 0.5 ? 'pine' : 'round', true);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const instanced = (geometry, material, list, fn) => {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
    list.forEach((e, i) => { fn(e); mesh.setMatrixAt(i, m4.compose(v, q, sc)); });
    mesh.count = list.length;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const roundTrees = crowns.filter((t) => !forest.includes(t));
  instanced(G.cyl(6), mat(P.trunk), trunks.filter((t) => !forest.includes(t)), (e) => { v.set(e.x, 0.9 * e.s, e.z); sc.set(0.4 * e.s, 1.8 * e.s, 0.4 * e.s); });
  instanced(G.ico(), mat(P.leaf), roundTrees, (e) => { v.set(e.x, 2.5 * e.s, e.z); sc.set(2.6 * e.s, 2.4 * e.s, 2.6 * e.s); });
  instanced(G.cone(7), mat(P.pine), pines, (e) => { v.set(e.x, 2.6 * e.s, e.z); sc.set(2.2 * e.s, 3.6 * e.s, 2.2 * e.s); });
  // The commons forest is ordered so trees disappear from the edge nearest the village first.
  forest.sort((a, b) => Math.hypot(b.x - 21, b.z + 11) - Math.hypot(a.x - 21, a.z + 11));
  const forestTrunks = instanced(G.cyl(6), mat(P.trunk), forest, (e) => { v.set(e.x, 0.9 * e.s, e.z); sc.set(0.4 * e.s, 1.8 * e.s, 0.4 * e.s); });
  const forestCrowns = instanced(G.ico(), mat(P.leafDark), forest, (e) => { v.set(e.x, 2.5 * e.s, e.z); sc.set(2.5 * e.s, 2.6 * e.s, 2.5 * e.s); });
  const stumps = instanced(G.cyl(7), mat('#8a6847'), [...forest].reverse(), (e) => { v.set(e.x, 0.2, e.z); sc.set(0.5 * e.s, 0.4, 0.5 * e.s); });

  const rocks = [], flowers = [];
  for (let i = 0; i < 90; i++) {
    const x = (rand() - 0.5) * 150, z = (rand() - 0.5) * 140;
    if (Math.abs(z) < 3 || Math.abs(x) < 3) continue;
    (i % 2 ? rocks : flowers).push({ x, z, s: 0.3 + rand() * 0.5 });
  }
  instanced(G.dodeca(), mat(P.stone), rocks, (e) => { v.set(e.x, 0.15, e.z); sc.set(e.s * 1.4, e.s, e.s * 1.2); });
  const petals = new THREE.InstancedMesh(G.sphere(5), mat('#f2c84b'), flowers.length * 3);
  let k = 0;
  for (const f of flowers) for (let j = 0; j < 3; j++) {
    v.set(f.x + j * 0.3, 0.12, f.z + (j % 2) * 0.3); sc.set(0.2, 0.2, 0.2);
    petals.setMatrixAt(k++, m4.compose(v, q, sc));
  }
  scene.add(petals);

  const roadMeshes = new Map();
  const surface = {
    footpath: mat(ROAD_KINDS.footpath.color, { roughness: 1 }),
    dirt: mat(ROAD_KINDS.dirt.color, { roughness: 1 }),
    stone: mat(ROAD_KINDS.stone.color, { roughness: 0.9 }),
    ford: mat('#8fb4c4', { roughness: 0.4 }),
  };
  const makeRoad = (r) => {
    const g = new THREE.Group();
    if (r.kind === 'bridge') g.add(bridgeModel(r));
    else {
      const y = r.kind === 'stone' ? 0.034 : r.kind === 'ford' ? 0.07 : 0.026;
      const m = part(g, G.plane(), surface[r.kind] ?? surface.dirt, [r.w, 1, r.d], [r.x, y, r.z], null, false);
      m.receiveShadow = true;
      if (r.kind === 'stone') {
        // Kerb stones along both edges.
        const along = r.w >= r.d;
        const len = along ? r.w : r.d;
        for (const side of [-1, 1]) part(g, G.box(), mat(P.stoneDark), along ? [len, 0.08, 0.18] : [0.18, 0.08, len], along ? [r.x, 0.06, r.z + side * (r.d / 2)] : [r.x + side * (r.w / 2), 0.06, r.z], null, false);
      }
      if (r.kind === 'ford') for (let i = 0; i < 6; i++) part(g, G.dodeca(), mat(P.stone), [0.7, 0.25, 0.6], [r.x + (i % 2 ? 0.7 : -0.7), 0.1, r.z - r.d / 2 + 0.6 + i * (r.d - 1.2) / 5], null, false);
    }
    roads.add(g);
    return g;
  };
  return {
    fire, fireLight, lamps, lampGlass, ground, petals, roadMaterials: surface,
    leafMaterials: [mat(P.leaf), mat(P.leafDark), mat(P.pine)],
    /** Match the drawn roads to the simulation's roads (new, paved or removed). */
    syncRoads(list) {
      const keep = new Set();
      for (const r of list) {
        const key = `${r.id}:${r.kind}`;
        keep.add(key);
        if (!roadMeshes.has(key)) roadMeshes.set(key, makeRoad(r));
      }
      for (const [key, g] of roadMeshes) if (!keep.has(key)) { roads.remove(g); roadMeshes.delete(key); }
    },
    /** Show as many commons trees as the forest stock supports. */
    setForest(fraction) {
      const n = Math.round(forest.length * Math.max(0, Math.min(1, fraction)));
      forestTrunks.count = n;
      forestCrowns.count = n;
      stumps.count = forest.length - n;
    },
  };
}
