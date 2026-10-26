// Rasterise the app icon sources (public/icons/*.svg) to the PNG sizes iOS,
// Android and browsers ask for, using the Chromium that Playwright drives.
//   node scripts/build-icons.mjs
// The PNGs are committed, so a normal build does not need a browser.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = new URL('../public/icons/', import.meta.url);

const JOBS = [
  ['icon.svg', 'icon-1024.png', 1024],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'apple-touch-icon.png', 180],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-192.png', 192],
  ['favicon.svg', 'favicon-32.png', 32],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [src, out, size] of JOBS) {
  const svg = readFileSync(new URL(src, dir), 'utf8');
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#0a281d"><img width="${size}" height="${size}" style="display:block" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></body></html>`);
  await page.waitForFunction(() => document.images[0].complete);
  // Opaque PNGs: iOS shows transparency in home-screen icons as black.
  writeFileSync(new URL(out, dir), await page.screenshot({ type: 'png', omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log(`${out} ${size}×${size}`);
}
await browser.close();
