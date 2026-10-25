import { seasonIndex } from '../core/Calendar.js';

// Snow on the ground, roofs, fences, trees, walls and stalls.
//
// How much snow lies is worked out from the simulation's own weather (the
// last twelve days it recorded) rather than a second climate model: each
// snowy day adds cover through the day, and milder days melt it, faster in
// rain or sun and out of winter. Each kingdom reads that weather through its
// own climate: Ironhold's mountain town keeps a winter blanket, Saltmere's
// coast mostly sees sleet. Nothing is stored: a reloaded world shows exactly
// the snow it had.
//
// Drawing it: every shared material gets a small shader addition that
// whitens surfaces facing the sky, in patches from a world-space noise, so
// roof slopes and the tops of fences and walls collect snow while walls stay
// clear and the ground keeps its variation. Roads take much less, so they
// stay readable.

export const CLIMATES = {
  hearth: { snow: 1, melt: 1, winterMin: 0, frost: 0.3, wet: 'rain' },
  greenvale: { snow: 0.85, melt: 1.1, winterMin: 0, frost: 0.25, wet: 'rain' },
  ironhold: { snow: 1.7, melt: 0.55, winterMin: 0.45, frost: 0.5, wet: 'snow' },
  saltmere: { snow: 0.2, melt: 2.2, winterMin: 0, frost: 0.08, wet: 'rain' },
};

/** The weather a kingdom sees today: the region's weather through its climate. */
export function localWeather(state, kingdom = 'hearth') {
  const w = state.weather?.today ?? { kind: 'clear', intensity: 0.5 };
  const c = CLIMATES[kingdom] ?? CLIMATES.hearth;
  const winter = seasonIndex(state.day) === 3;
  if (w.kind === 'snow' && c.snow < 0.5) return { ...w, kind: 'rain', sleet: true };
  if (w.kind === 'rain' && winter && c.wet === 'snow') return { ...w, kind: 'snow' };
  return w;
}

const ADD = 0.34; // cover a full day of steady snow lays down
const MELT = [0.3, 0.55, 0.3, 0.07]; // per day, by season

/**
 * Snow cover in [0, 1] and frost in [0, 1] for a place, from the recorded
 * weather. `minuteOfDay` spreads today's snowfall or melt through the day.
 */
export function snowCover(state, kingdom = 'hearth') {
  const c = CLIMATES[kingdom] ?? CLIMATES.hearth;
  const history = state.weather?.history ?? [];
  const today = state.weather?.today;
  let cover = 0;
  for (const h of history) {
    const isToday = h.day === state.day;
    const frac = isToday ? Math.max(0, Math.min(1, (state.minute ?? 0) / 1440)) : 1;
    const season = seasonIndex(h.day);
    const kind = isToday && today ? localWeather(state, kingdom).kind : climateKind(h.kind, season, c);
    const intensity = isToday && today ? today.intensity ?? 0.6 : 0.6;
    if (kind === 'snow') cover += ADD * c.snow * (0.5 + intensity) * frac;
    else cover -= MELT[season] * c.melt * (kind === 'rain' ? 1.6 : kind === 'clear' ? 1.25 : 1) * frac;
    cover = Math.max(0, Math.min(1, cover));
  }
  const winter = seasonIndex(state.day) === 3;
  if (winter) cover = Math.max(cover, c.winterMin);
  return { cover, frost: winter ? c.frost : 0 };
}

function climateKind(kind, season, c) {
  if (kind === 'snow' && c.snow < 0.5) return 'rain';
  if (kind === 'rain' && season === 3 && c.wet === 'snow') return 'snow';
  return kind;
}

/** A light dusting is at least 0.15, moderate 0.4, heavy 0.75: the levels the panel names. */
export function snowLevel(cover) {
  return cover >= 0.75 ? 'heavy' : cover >= 0.4 ? 'moderate' : cover >= 0.12 ? 'light' : 'none';
}

// --- The shader ------------------------------------------------------------------------

/** Uniforms shared by every snowy material; changing them changes the whole scene at once. */
export const SNOW_UNIFORMS = {
  uSnow: { value: 0 },
  uFrost: { value: 0 },
  uSnowColor: { value: null }, // set by the renderer (a THREE.Color)
};

const patched = new WeakSet();

/**
 * Add snow to a MeshStandardMaterial. `scale` lowers it for surfaces that
 * must stay readable (roads take 0.3). Safe to call twice.
 */
export function addSnow(material, scale = 1) {
  if (!material || patched.has(material) || !material.isMeshStandardMaterial) return material;
  patched.add(material);
  const local = { value: scale };
  material.userData.snowScale = local;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uSnow = SNOW_UNIFORMS.uSnow;
    shader.uniforms.uFrost = SNOW_UNIFORMS.uFrost;
    shader.uniforms.uSnowColor = SNOW_UNIFORMS.uSnowColor;
    shader.uniforms.uSnowScale = local;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 snowP = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      snowP = instanceMatrix * snowP;
    #endif
    vSnowWorld = (modelMatrix * snowP).xyz;
  }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSnowWorld;
uniform float uSnow;
uniform float uFrost;
uniform float uSnowScale;
uniform vec3 uSnowColor;
float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float snowNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(snowHash(i), snowHash(i + vec2(1.0, 0.0)), u.x), mix(snowHash(i + vec2(0.0, 1.0)), snowHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float up = dot(normalize(normal), upView);
    float cover = clamp(uSnow * uSnowScale, 0.0, 1.0);
    float n = snowNoise(vSnowWorld.xz * 0.45) * 0.65 + snowNoise(vSnowWorld.xz * 1.7) * 0.35;
    float facing = smoothstep(0.35, 0.8, up);
    float amount = facing * smoothstep(1.0 - cover * 1.25, 1.12 - cover * 1.25, n + 0.12);
    float frost = facing * uFrost * uSnowScale * 0.28;
    diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, clamp(max(amount * 0.94, frost), 0.0, 1.0));
  }`);
  };
  material.customProgramCacheKey = () => 'snow';
  material.needsUpdate = true;
  return material;
}
