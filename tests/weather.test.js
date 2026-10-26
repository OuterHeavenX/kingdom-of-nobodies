import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WeatherLayer } from '../src/world/WeatherLayer.js';

const rain = { kind: 'rain', intensity: 0.9 };
const target = new THREE.Vector3(0, 0, 0);

test('weather: rain streaks fall and splash on the ground, above the roads and the square', () => {
  const layer = new WeatherLayer(new THREE.Scene());
  for (let f = 0; f < 120; f++) layer.update(rain, 1 / 60, target, f / 60);
  const r = layer.rain;
  const live = r.splash.filter((s) => s.age < 0.32);
  assert.ok(live.length > 10, `${live.length} splashes in progress`);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const i = r.splash.indexOf(live[0]);
  r.rings.getMatrixAt(i, m);
  m.decompose(pos, q, sc);
  assert.ok(pos.y > 0.08, `ring drawn at y=${pos.y}, above paved roads (0.034), the square (0.04) and road markings (0.08)`);
  assert.ok(sc.x > 0, 'a live ring is visible');
});

test('weather: when the rain stops, the splash mesh releases its own GPU buffers', () => {
  const layer = new WeatherLayer(new THREE.Scene());
  layer.update(rain, 1 / 60, target, 0);
  const rings = layer.rain.rings;
  let disposed = 0;
  rings.addEventListener('dispose', () => disposed++);
  layer.update({ kind: 'clear' }, 1 / 60, target, 0.1);
  assert.equal(layer.rain, null);
  assert.equal(disposed, 1);
});
