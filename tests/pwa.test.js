import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// The iPhone app experience: real icon files at the sizes iOS and the
// manifest ask for, a valid manifest whose paths resolve under the GitHub
// Pages base, and a page set up for standalone mode and the safe areas.

const png = (path) => {
  const b = readFileSync(path);
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `${path} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
};

test('pwa: icons are genuine PNGs with the right dimensions (opaque for the Home Screen)', () => {
  for (const [file, size] of [['icon-1024.png', 1024], ['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32], ['icon-maskable-512.png', 512], ['icon-maskable-192.png', 192]]) {
    const { w, h, colorType } = png(`public/icons/${file}`);
    assert.deepEqual([w, h], [size, size], file);
    assert.equal(colorType, 2, `${file} is RGB without transparency`);
  }
  for (const svg of ['icon.svg', 'icon-maskable.svg', 'favicon.svg']) assert.match(readFileSync(`public/icons/${svg}`, 'utf8'), /<svg[^>]+viewBox/);
});

test('pwa: the manifest is valid and every icon it names exists', () => {
  const m = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(m.name, 'Kingdom of Nobodies');
  assert.ok(m.short_name.length <= 12);
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  assert.ok(m.icons.some((i) => i.sizes === '192x192' && i.purpose === 'any'));
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(existsSync(`public/${i.src.replace('./', '')}`), i.src);
  // Relative to the manifest, so they resolve under https://outerheavenx.github.io/kingdom-of-nobodies/.
  assert.equal(new URL(m.start_url, 'https://outerheavenx.github.io/kingdom-of-nobodies/manifest.webmanifest').href, 'https://outerheavenx.github.io/kingdom-of-nobodies/');
});

test('pwa: the page is set up for the Home Screen, the Dynamic Island and the safe areas', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /rel="apple-touch-icon"[^>]+apple-touch-icon\.png/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /apple-mobile-web-app-title/);
  assert.match(html, /env\(safe-area-inset-top\)/);
  assert.match(html, /id="boot-go"/, 'a Start / Continue button');
  assert.match(html, /id="boot-sound"/, 'an Enable sound control on the title screen');
  assert.match(readFileSync('src/styles/main.css', 'utf8'), /overscroll-behavior: none/, 'no page scrolling fights the game');
});
