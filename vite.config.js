import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

function buildId() {
  const sha = (process.env.GITHUB_SHA || (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'local'; } })()).slice(0, 7);
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const BUILD = buildId();

/**
 * The service worker is generated with the build: its cache is named after
 * the build, so every deployment gets a fresh cache and old ones are removed.
 * Pages are fetched network-first (a new deployment is picked up at once, the
 * cached copy only serves when offline); hashed assets are cache-first (their
 * names change whenever their content does). Saves live in IndexedDB and
 * localStorage, which the worker never touches.
 */
function serviceWorker() {
  return {
    name: 'kon-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const assets = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f));
      const icons = readdirSync('public/icons').map((f) => `icons/${f}`);
      const precache = ['./', 'manifest.webmanifest', ...icons, ...assets];
      const version = BUILD.replace(/[^\w]+/g, '-');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `// Kingdom of Nobodies service worker (generated at build ${BUILD}).
const CACHE = 'kon-${version}';
const PRECACHE = ${JSON.stringify(precache)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('kon-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first, so a new deployment is never hidden behind a stale page.
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); return res; }).catch(() => caches.match('./')));
    return;
  }
  if (req.url.includes('/assets/') || req.url.includes('/icons/')) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
` });
    },
  };
}

export default defineConfig({
  base: '/kingdom-of-nobodies/',
  plugins: [serviceWorker()],
  // Three.js goes in its own chunk so a game update does not make returning players re-download the engine.
  build: { outDir: 'dist', chunkSizeWarningLimit: 900, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  // The optional cloud backup address is public configuration (no secrets); unset means local saves only.
  define: { __BUILD__: JSON.stringify(BUILD), __CLOUD_URL__: JSON.stringify(process.env.VITE_CLOUD_SAVE_URL ?? '') },
});
