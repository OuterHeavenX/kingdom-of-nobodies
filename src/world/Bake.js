import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry batching. A procedural building is assembled from dozens of small
// parts that share a handful of materials; once assembled it never changes
// until the simulation changes it, so its static parts are merged into one
// mesh per material. A cottage goes from ~40 draw calls to ~8, a tower from
// hundreds to about a dozen. Instanced meshes and animated parts (flames,
// cranes) are kept as they are.

const KEEP = (o) => o.isInstancedMesh || o.userData.flames || o.userData.crane || o.userData.noBake || o.isLight || o.isSprite || o.isPoints;

/** Merge a group's static meshes by material. Returns a new group (the input is consumed). */
export function bakeGroup(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const kept = [];
  const visit = (o) => {
    if (o !== group && KEEP(o)) { kept.push(o); return; }
    if (o.isMesh && o.visible !== false && !Array.isArray(o.material)) {
      const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) { b = { material: o.material, cast: o.castShadow, geos: [] }; buckets.set(key, b); }
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((geo.attributes.position.count) * 2), 2));
      if (!geo.attributes.normal) geo.computeVertexNormals();
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      b.geos.push(geo);
      if (o.userData.ownGeometry) o.geometry.dispose();
    }
    for (const child of o.children) visit(child);
  };
  visit(group);
  const out = new THREE.Group();
  out.position.copy(group.position);
  out.rotation.copy(group.rotation);
  out.scale.copy(group.scale);
  out.userData = { ...group.userData };
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    mesh.userData.baked = true;
    out.add(mesh);
  }
  for (const o of kept) {
    // Re-parent kept objects with their transform relative to the group.
    o.updateMatrixWorld(true);
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    o.removeFromParent();
    m.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  return out;
}

/** Free the geometry a baked node owns (shared geometries and materials are left alone). */
export function disposeBaked(node) {
  node.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.isMesh && (o.userData.baked || o.userData.ownGeometry)) o.geometry.dispose();
  });
}
