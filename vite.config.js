import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function buildId() {
  const sha = (process.env.GITHUB_SHA || (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'local'; } })()).slice(0, 7);
  return `${sha} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export default defineConfig({
  base: '/kingdom-of-nobodies/',
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
  define: { __BUILD__: JSON.stringify(buildId()) },
});
