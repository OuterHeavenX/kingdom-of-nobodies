import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 16. The production build must reference compiled, hashed assets under the
// GitHub Pages base path, never the raw /src entry point.
test('16. production build uses correct GitHub Pages asset paths', () => {
  const out = mkdtempSync(join(tmpdir(), 'kon-build-'));
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { stdio: 'pipe' });
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /src="\/src\//, 'no raw source entry');
  const assets = [...html.matchAll(/(?:src|href)="(\/kingdom-of-nobodies\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(assets.some((a) => a.endsWith('.js')), 'script asset');
  assert.ok(assets.some((a) => a.endsWith('.css')), 'stylesheet asset');
  for (const a of assets) assert.ok(existsSync(join(out, a.replace('/kingdom-of-nobodies/', ''))), `${a} exists`);
  assert.match(html, /id="boot"/, 'startup screen present');
});
