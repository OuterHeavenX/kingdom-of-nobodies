import * as THREE from 'three';
import { addSnow } from '../effects/SnowAccumulation.js';

// Procedural facade textures. Each facade kind is a 4×4 atlas of window bays
// (one bay wide, one storey tall); a building's walls repeat it across their
// width and height, so a forty-storey tower costs no more than a cottage.
// A matching emissive atlas lights some of the windows at night. Everything
// is drawn once on a canvas at start-up and shared by every building.

const TILE = 64, N = 4, SIZE = TILE * N;

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const KINDS = {
  brick(ctx, x, y, r, lit, glow) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#d8d0c6';
    for (let row = 0; row < 8; row++) for (let k = -1; k < 5; k++) ctx.fillRect(x + k * 16 + (row % 2 ? 8 : 0), y + row * 8, 15, 7);
    ctx.fillStyle = '#efe9e0'; ctx.fillRect(x + 20, y + 10, 24, 38);
    pane(ctx, x + 22, y + 12, 20, 34, lit, '#41505c');
    ctx.fillStyle = '#efe9e0'; ctx.fillRect(x + 31, y + 12, 2, 34); ctx.fillRect(x + 22, y + 28, 20, 2);
    ctx.fillStyle = '#bfb6aa'; ctx.fillRect(x + 18, y + 48, 28, 4);
    if (lit) glowRect(glow, x + 22, y + 12, 20, 34);
  },
  factory(ctx, x, y, r, lit, glow) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#d6cdc2';
    for (let row = 0; row < 8; row++) for (let k = -1; k < 5; k++) ctx.fillRect(x + k * 16 + (row % 2 ? 8 : 0), y + row * 8, 15, 7);
    pane(ctx, x + 6, y + 10, 52, 36, lit, '#3e4a52');
    ctx.fillStyle = '#5a5f63';
    for (let i = 1; i < 6; i++) ctx.fillRect(x + 6 + i * 52 / 6, y + 10, 2, 36);
    for (let i = 1; i < 3; i++) ctx.fillRect(x + 6, y + 10 + i * 12, 52, 2);
    if (lit) glowRect(glow, x + 6, y + 10, 52, 36);
  },
  concrete(ctx, x, y, r, lit, glow) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#e4e4e2'; ctx.fillRect(x, y + 50, TILE, 14);
    pane(ctx, x + 2, y + 16, 60, 28, lit, '#4a5d6c');
    ctx.fillStyle = '#d0d0cc'; for (const mx of [20, 41]) ctx.fillRect(x + mx, y + 16, 3, 28);
    if (lit) glowRect(glow, x + 2, y + 16, 60, 28);
  },
  deco(ctx, x, y, r, lit, glow) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#e2dccd'; ctx.fillRect(x, y, 8, TILE); ctx.fillRect(x + 56, y, 8, TILE);
    ctx.fillStyle = '#d3cab4'; ctx.fillRect(x + 2, y, 3, TILE); ctx.fillRect(x + 59, y, 3, TILE);
    pane(ctx, x + 16, y + 8, 32, 44, lit, '#38505e');
    ctx.fillStyle = '#e8e1d0'; ctx.fillRect(x + 31, y + 8, 2, 44); for (const yy of [22, 37]) ctx.fillRect(x + 16, y + yy, 32, 2);
    if (lit) glowRect(glow, x + 16, y + 8, 32, 44);
  },
  glass(ctx, x, y, r, lit, glow) {
    const g = ctx.createLinearGradient(x, y, x + TILE, y + TILE);
    g.addColorStop(0, '#f4fbff'); g.addColorStop(0.5, '#c9dbe6'); g.addColorStop(1, '#e8f2f8');
    ctx.fillStyle = g; ctx.fillRect(x, y, TILE, TILE);
    if (lit) { ctx.fillStyle = 'rgba(255,214,140,0.55)'; ctx.fillRect(x + 4, y + 6, 56, 46); glowRect(glow, x + 4, y + 6, 56, 46, 0.9); }
    ctx.fillStyle = '#8a959c'; ctx.fillRect(x, y + 54, TILE, 10);
    ctx.fillStyle = '#b4bec4'; ctx.fillRect(x, y, 2, TILE); ctx.fillRect(x + 31, y, 2, 54);
  },
  eco(ctx, x, y, r, lit, glow) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, TILE, TILE);
    pane(ctx, x + 8, y + 6, 48, 36, lit, '#4c6a72');
    ctx.fillStyle = '#7fae5c'; ctx.fillRect(x, y + 46, TILE, 12);
    const rr = seeded(7 + x * 3 + y);
    for (let i = 0; i < 9; i++) { ctx.fillStyle = rr() < 0.5 ? '#5a8f45' : '#9cc96a'; ctx.beginPath(); ctx.arc(x + 4 + i * 7, y + 47 + rr() * 6, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#dcdcd6'; ctx.fillRect(x, y + 58, TILE, 6);
    if (lit) glowRect(glow, x + 8, y + 6, 48, 36);
  },
  solar(ctx, x, y, r, lit, glow) {
    const g = ctx.createLinearGradient(x, y, x, y + TILE);
    g.addColorStop(0, '#e9fbf7'); g.addColorStop(1, '#bfe3dc');
    ctx.fillStyle = g; ctx.fillRect(x, y, TILE, TILE);
    if (lit) { ctx.fillStyle = 'rgba(255,224,160,0.5)'; ctx.fillRect(x + 6, y + 4, 52, 48); glowRect(glow, x + 6, y + 4, 52, 48, 0.85); }
    ctx.fillStyle = '#e2c46a'; for (const fx of [0, 20, 42]) ctx.fillRect(x + fx, y, 4, TILE);
    ctx.fillStyle = '#9fb7b2'; ctx.fillRect(x, y + 56, TILE, 8);
  },
};

function pane(ctx, x, y, w, h, lit, dark) {
  ctx.fillStyle = lit ? '#ffd98a' : dark;
  ctx.fillRect(x, y, w, h);
  if (!lit) { ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(x, y, w * 0.45, h); }
}
function glowRect(ctx, x, y, w, h, a = 1) { ctx.fillStyle = `rgba(255,200,120,${a})`; ctx.fillRect(x, y, w, h); }

const cache = new Map();
const lightMaterials = new Set();
const glassMaterials = new Set();
let envMap = null;

function atlas(kind) {
  if (cache.has(kind)) return cache.get(kind);
  if (typeof document === 'undefined') return null;
  const make = () => { const c = document.createElement('canvas'); c.width = c.height = SIZE; return c; };
  const base = make(), glow = make();
  const bctx = base.getContext('2d'), gctx = glow.getContext('2d');
  gctx.fillStyle = '#000'; gctx.fillRect(0, 0, SIZE, SIZE);
  const r = seeded(kind.length * 977 + 13);
  const share = kind === 'glass' || kind === 'solar' ? 0.42 : 0.34;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) KINDS[kind](bctx, i * TILE, j * TILE, r, r() < share, gctx);
  const tex = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 2;
    return t;
  };
  const out = { map: tex(base), glow: tex(glow) };
  cache.set(kind, out);
  return out;
}

const materials = new Map();
/** A facade material: a kind of wall with windows, tinted. Shared by every building that uses it. */
export function facadeMaterial(kind, tint = '#ffffff') {
  const key = `${kind}|${tint}`;
  if (materials.has(key)) return materials.get(key);
  const a = atlas(kind);
  const glass = kind === 'glass' || kind === 'solar';
  const m = new THREE.MeshStandardMaterial({
    color: tint, map: a?.map ?? null, emissive: '#ffffff', emissiveMap: a?.glow ?? null, emissiveIntensity: 0,
    roughness: glass ? 0.22 : 0.85, metalness: glass ? 0.55 : 0.02, flatShading: true,
  });
  if (glass) { m.envMap = envMap; m.envMapIntensity = 0.9; glassMaterials.add(m); }
  addSnow(m, 0.6);
  lightMaterials.add(m);
  materials.set(key, m);
  return m;
}

/** Night glow for every facade's windows (0 by day). */
export function setFacadeGlow(v) { for (const m of lightMaterials) m.emissiveIntensity = v; }

/** A reflection map for glass (a small pre-filtered sky); null switches reflections off. */
export function setGlassEnvironment(tex) {
  envMap = tex;
  for (const m of glassMaterials) { m.envMap = tex; m.needsUpdate = true; }
}

/**
 * A wall box whose sides repeat the facade (one tile per bay and storey);
 * the top and bottom are left off (roofs are drawn separately).
 */
export function facadeGeometry(w, h, d, floors, bay = 2.4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const cols = (len) => Math.max(1, Math.round(len / bay)) / N;
  const rows = Math.max(1, floors) / N;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceCols = [cols(d), cols(d), 0, 0, cols(w), cols(w)];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    if (f === 2 || f === 3) { uv.setXY(i, 0.01, 0.99); continue; }
    uv.setXY(i, uv.getX(i) * faceCols[f], uv.getY(i) * rows);
  }
  uv.needsUpdate = true;
  return g;
}

export const FACADE_KINDS = Object.keys(KINDS);
