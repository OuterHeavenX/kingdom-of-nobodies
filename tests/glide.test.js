import test from 'node:test';
import assert from 'node:assert/strict';
import { glide } from '../src/world/Glide.js';

const node = () => ({ position: { x: 0, z: 0, set(x, _y, z) { this.x = x; this.z = z; } } });

test('glide: a drawn walker covers each tick at a steady pace, without hurry-stop-hurry at slow speeds', () => {
  const n = node(), u = {};
  const tick = 1; // ¼× speed: one tick a second
  const xs = [];
  for (let f = 0; f < 60; f++) { glide(n, u, 3, 0, 1 / 60, tick, 12); xs.push(n.position.x); }
  const steps = xs.map((x, i) => x - (xs[i - 1] ?? 0));
  assert.ok(Math.abs(xs.at(-1) - 3) < 1e-9, 'arrives as the next tick is due');
  assert.ok(steps.every((s) => Math.abs(s - 3 / 60) < 1e-9), 'the same distance every frame');
  glide(n, u, 6, 0, 1 / 60, tick, 12);
  assert.ok(Math.abs(n.position.x - (3 + 3 / 60)) < 1e-9, 'a new tick starts a new leg from where it is drawn');
});

test('glide: long jumps snap, and fast speeds keep up within a frame', () => {
  const n = node(), u = {};
  glide(n, u, 40, 0, 1 / 60, 0.25, 12);
  assert.equal(n.position.x, 40, 'teleports are not animated');
  glide(n, u, 42, 0, 1 / 60, 0.25 / 20, 12);
  assert.equal(n.position.x, 42, 'at 20× a tick is shorter than a frame');
});
