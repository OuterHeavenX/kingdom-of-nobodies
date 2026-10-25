// The colours of the year. Each season has a full palette for the land, the
// trees, the sky and the light; holidays add accents on top. The renderer
// blends from one season to the next over the last part of each season, so
// the valley changes colour gradually instead of overnight.
//
// Kingdom palettes shift these for their own climate and landscape:
// Greenvale's fields run greener and more golden, Ironhold's stone and
// mountain air run cold, Saltmere's coast stays mild and bright.

export const SEASON_PALETTES = [
  { // Spring: vibrant fresh grass, blossom, warm soft light
    name: 'Spring', grass: '#7fd25a', leaf: '#74c95a', leafDark: '#58ad4f', pine: '#2f7a4f',
    sky: '#9fd8f4', horizon: '#e9f6ff', sun: '#fff0d2', sunPower: 1.0, hemiSky: '#e4f3ff', hemiGround: '#6f9a4a',
    fog: 1.0, road: { tint: '#8a6a48', amount: 0.14 }, crowns: ['#74c95a', '#86d465', '#63b951'], blossom: true, flowers: 1,
  },
  { // Summer: rich deep green, bright high sun
    name: 'Summer', grass: '#5fbc47', leaf: '#3fa548', leafDark: '#2f8a40', pine: '#2a6f47',
    sky: '#7ccaf5', horizon: '#dff3ff', sun: '#fff7e2', sunPower: 1.18, hemiSky: '#dff1ff', hemiGround: '#5b8a40',
    fog: 1.15, road: { tint: '#d9c08e', amount: 0.08 }, crowns: ['#3fa548', '#4fb44f', '#368f3f'], flowers: 0.8,
  },
  { // Autumn: orange, red and gold trees; golden light
    name: 'Autumn', grass: '#b7b25a', leaf: '#f08a2a', leafDark: '#d4452c', pine: '#356b45',
    sky: '#b9d3e2', horizon: '#f5e2c4', sun: '#ffd28c', sunPower: 0.98, hemiSky: '#ffe9c8', hemiGround: '#8a7240',
    fog: 0.9, road: { tint: '#8a5a2a', amount: 0.1 }, crowns: ['#f08a2a', '#e8c13a', '#d4452c', '#f2a93b'], fallenLeaves: true, flowers: 0,
  },
  { // Winter: pale frosty ground, cool clear skies, long blue shadows
    name: 'Winter', grass: '#9fae94', leaf: '#93a38e', leafDark: '#7d8f7c', pine: '#285c42',
    sky: '#c9dcea', horizon: '#f2f7fb', sun: '#e8f0ff', sunPower: 0.86, hemiSky: '#eef5ff', hemiGround: '#8d9a90',
    fog: 0.8, road: { tint: '#f4f7fa', amount: 0.18 }, crowns: ['#93a38e', '#8a9a86', '#a0ae99'], flowers: 0,
  },
];

/** Per-kingdom shifts: [season] => partial palette. Missing entries fall back to the shared palette. */
export const KINGDOM_PALETTES = {
  hearth: {},
  greenvale: {
    0: { grass: '#86da5e' }, 1: { grass: '#6cc94f' }, 2: { grass: '#c9b65a', crowns: ['#f2a93b', '#e8c13a', '#f08a2a'] }, 3: { grass: '#a7b598' },
  },
  ironhold: {
    0: { grass: '#8fb37a', sky: '#a9c6dc' }, 1: { grass: '#7fae66', sky: '#9fc4e0' }, 2: { grass: '#9e9a6a', sky: '#b0c2d0' },
    3: { grass: '#b9c2c4', sky: '#c3d2de', sun: '#dfe9ff', sunPower: 0.8 },
  },
  saltmere: {
    0: { grass: '#b9d27a', sky: '#a6dcf2' }, 1: { grass: '#c9cf86', sky: '#86d2f5', sunPower: 1.22 }, 2: { grass: '#cdbf86', sky: '#bfdcea' },
    3: { grass: '#c4c4a4', sky: '#c4dde8', sun: '#f2f2ea', sunPower: 0.92 },
  },
};

/**
 * Holiday accents: tints laid over the season (amount 0..1) and the colours
 * of the holiday's lanterns. They colour the atmosphere without turning the
 * whole scene one colour.
 */
export const HOLIDAY_ACCENTS = {
  newyear: { sky: '#3a3f8a', skyAmount: 0.12, lanterns: ['#ffd36b', '#ffffff', '#8fc8ff'], night: 1.25 },
  valentine: { sky: '#ffb3d1', skyAmount: 0.18, fog: '#ffd3e4', lanterns: ['#ff6fa8', '#ff3d6e', '#ffc2da'] },
  stpatrick: { sky: '#b8f0c0', skyAmount: 0.1, lanterns: ['#3fd46b', '#a8f07a', '#f4e04d'] },
  spring: { sky: '#fde7ff', skyAmount: 0.1, lanterns: ['#ffd1f0', '#c7e9ff', '#fff3a8', '#d4ffc9'] },
  solstice: { sky: '#ffd27a', skyAmount: 0.12, lanterns: ['#ffb347', '#ff7a45', '#ffe066'], night: 1.15 },
  founders: { sky: '#cfe6ff', skyAmount: 0.06, lanterns: ['#ffd36b', '#e8564a', '#5b9bd5'] },
  harvest: { sky: '#ffc98a', skyAmount: 0.14, lanterns: ['#ffb347', '#ffd36b'] },
  halloween: { sky: '#6b3fa0', skyAmount: 0.22, fog: '#8a6ab0', lanterns: ['#ff8c1a', '#9b4dff', '#ffb347'], dim: 0.82, groundFog: true },
  gratitude: { sky: '#f2b874', skyAmount: 0.12, lanterns: ['#ffb347', '#e8873a', '#ffd36b'] },
  winter: { sky: '#dfe8ff', skyAmount: 0.08, lanterns: ['#ff4d4d', '#3fd46b', '#ffd36b', '#6fb7ff', '#ffffff'], night: 1.3 },
};

const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Linear blend of two '#rrggbb' colours. */
export function mixHex(a, b, t) {
  const A = hex(a), B = hex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}

/** The palette of one season in one place. */
export function paletteFor(season, kingdom = 'hearth') {
  return { ...SEASON_PALETTES[season], ...(KINGDOM_PALETTES[kingdom]?.[season] ?? {}) };
}

/** How far into the next season the look has moved: 0 until the last 20% of a season, then up to 1. */
export const blendWeight = (t) => Math.max(0, Math.min(1, (t - 0.8) / 0.2));

/**
 * The blended palette for a moment: { season, t } from seasonProgress. Only
 * colours and numbers blend; lists (crowns) and flags follow whichever season
 * dominates.
 */
export function blendedPalette(season, t, kingdom = 'hearth', count = 4) {
  const a = paletteFor(season, kingdom), b = paletteFor((season + 1) % count, kingdom);
  const w = blendWeight(t);
  const out = { ...(w < 0.5 ? a : b) };
  for (const k of ['grass', 'leaf', 'leafDark', 'pine', 'sky', 'horizon', 'sun', 'hemiSky', 'hemiGround']) out[k] = mixHex(a[k], b[k], w);
  for (const k of ['sunPower', 'fog']) out[k] = a[k] + (b[k] - a[k]) * w;
  out.road = { tint: mixHex(a.road.tint, b.road.tint, w), amount: a.road.amount + (b.road.amount - a.road.amount) * w };
  out.weight = w;
  return out;
}

/** The palette with a holiday's accents laid on top. */
export function withAccent(palette, holidayId) {
  const acc = HOLIDAY_ACCENTS[holidayId];
  if (!acc) return { ...palette, lanterns: ['#ffd27a'], dim: 1, night: 1 };
  return { ...palette, sky: mixHex(palette.sky, acc.sky, acc.skyAmount), lanterns: acc.lanterns, dim: acc.dim ?? 1, night: acc.night ?? 1, fogTint: acc.fog ?? null, groundFog: !!acc.groundFog };
}
