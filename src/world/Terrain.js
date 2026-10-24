import * as THREE from 'three';
import { mat, PALETTE as P, G, part } from './Materials.js';

// Ground, roads, the town square and all instanced scenery. The forest north
// of Timber Edge mirrors the simulation's forest commons: as lumberyards cut
// timber, trees there become stumps, and they grow back as the forest regrows.

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

export function buildTerrain(scene) {
  const rand = seeded(42);
  const groundGeo = new THREE.PlaneGeometry(160, 160, 40, 40).rotateX(-Math.PI / 2);
  const colors = [];
  const base = new THREE.Color(P.grass);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 48) pos.setY(i, (r - 48) * 0.08 * (0.6 + rand() * 0.8));
    const c = base.clone().offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.06);
    colors.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  const road = mat(P.path, { roughness: 1 });
  const roads = new THREE.Group();
  for (const [x, z, w, d] of [[0, 0, 74, 3.2], [0, 0, 3.2, 52], [-24, 15, 2.2, 10], [21, -4, 2.2, 6], [32, -1, 6, 2.2], [0, 15, 38, 2.4]]) {
    const m = part(roads, G.plane(), road, [w, 1, d], [x, 0.025, z], null, false);
    m.receiveShadow = true;
  }
  scene.add(roads);

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
  for (let i = 0; i < 150; i++) {
    const a = rand() * Math.PI * 2, r = 46 + rand() * 26;
    place(Math.cos(a) * r, Math.sin(a) * r, 0.8 + rand() * 0.7, rand() < 0.45 ? 'pine' : 'round');
  }
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2, r = 36 + rand() * 8;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(z) < 4 || Math.abs(x) < 4) continue;
    place(x, z, 0.7 + rand() * 0.5, 'round');
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
  for (let i = 0; i < 60; i++) {
    const x = (rand() - 0.5) * 90, z = (rand() - 0.5) * 80;
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

  return {
    fire, fireLight, lamps, lampGlass,
    /** Show as many commons trees as the forest stock supports. */
    setForest(fraction) {
      const n = Math.round(forest.length * Math.max(0, Math.min(1, fraction)));
      forestTrunks.count = n;
      forestCrowns.count = n;
      stumps.count = forest.length - n;
    },
  };
}
