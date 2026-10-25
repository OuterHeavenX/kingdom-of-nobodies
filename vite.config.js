import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function buildId() {
  const sha = (process.env.GITHUB_SHA || (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'local'; } })()).slice(0, 7);
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default defineConfig({
  base: '/kingdom-of-nobodies/',
  // Three.js goes in its own chunk so a game update does not make returning players re-download the engine.
  build: { outDir: 'dist', chunkSizeWarningLimit: 900, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  // The optional cloud backup address is public configuration (no secrets); unset means local saves only.
  define: { __BUILD__: JSON.stringify(buildId()), __CLOUD_URL__: JSON.stringify(process.env.VITE_CLOUD_SAVE_URL ?? '') },
});
