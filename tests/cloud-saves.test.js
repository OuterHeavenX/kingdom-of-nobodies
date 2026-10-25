// Milestone 5 — optional cloud saves (Phase F). The Worker runs here against a
// real SQL database (node:sqlite standing in for D1) and a stubbed GitHub, so
// sign-in, upload, conflict detection and restore are exercised end to end
// in-process. This does NOT prove the deployed service works: that needs the
// Worker deployed with its secrets (see cloud/README.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../cloud/worker/src/index.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { createKingdom } from '../src/sim/Setup.js';
import { Simulation } from '../src/sim/Simulation.js';
import { validateEnvelope } from '../src/persistence/SaveValidation.js';
import { compareSaves } from '../src/persistence/ConflictResolution.js';
import { CloudSaveClient } from '../src/persistence/CloudSaveClient.js';
import { CloudSync } from '../src/persistence/CloudSync.js';

const ORIGIN = 'https://outerheavenx.github.io';
const API = 'https://cloud.example.workers.dev';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../cloud/worker/schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return { prepare: (sql) => stmt(sql) };
}

function env(extra = {}) {
  return { DB: d1(), ALLOWED_ORIGIN: ORIGIN, GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret-never-in-browser', ...extra };
}

/** A stand-in for GitHub's OAuth and user endpoints. */
const github = (id, login) => async (url) => {
  if (String(url).includes('access_token')) return new Response(JSON.stringify({ access_token: `gho_${id}` }), { headers: { 'content-type': 'application/json' } });
  if (String(url).includes('api.github.com/user')) return new Response(JSON.stringify({ id, login }), { headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 404 });
};

async function signIn(e, id = 1, login = 'player') {
  const start = await handle(new Request(`${API}/auth/github/start?return=${encodeURIComponent(ORIGIN + '/kingdom-of-nobodies/')}`), e);
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cb = await handle(new Request(`${API}/auth/github/callback?code=abc&state=${state}`), e, github(id, login));
  assert.equal(cb.status, 302);
  const back = cb.headers.get('location');
  assert.ok(back.startsWith(ORIGIN), 'redirects only to the allowed game origin');
  const token = /#kon_session=([\w-]+)/.exec(back)[1];
  assert.ok(!back.includes('gho_'), 'the GitHub token is never handed to the browser');
  return token;
}

const call = (e, method, path, token, body) => handle(new Request(API + path, { method, headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), e);

/** A CloudSaveClient whose fetch goes straight into the Worker. */
function clientFor(e, token, deviceLabel) {
  const store = new Map([['kingdom-of-nobodies-cloud-session', token], ['kingdom-of-nobodies-device', deviceLabel]]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const client = new CloudSaveClient({ endpoint: API, storage, fetchImpl: (url, init) => handle(new Request(url, { ...init, headers: { origin: ORIGIN, ...init.headers } }), e) });
  return { client, storage };
}

test('unauthorised requests are rejected and one player cannot read another\'s saves', async () => {
  const e = env();
  assert.equal((await call(e, 'GET', '/api/saves')).status, 401);
  assert.equal((await call(e, 'GET', '/api/saves', 'not-a-real-token-at-all-xx')).status, 401);
  const alice = await signIn(e, 1, 'alice');
  const bob = await signIn(e, 2, 'bob');
  const text = serialize(createKingdom(3));
  assert.equal((await call(e, 'PUT', '/api/saves/main', alice, { envelope: text, baseRevision: 0, device: 'Alice phone' })).status, 200);
  assert.equal((await call(e, 'GET', '/api/saves/main', bob)).status, 404, 'Bob sees no save of Alice\'s');
  const list = await (await call(e, 'GET', '/api/saves', bob)).json();
  assert.deepEqual(list.saves, []);
  // Signing out ends the session.
  await call(e, 'DELETE', '/api/session', alice);
  assert.equal((await call(e, 'GET', '/api/me', alice)).status, 401);
});

test('malformed, tampered and oversized saves are rejected by the service', async () => {
  const e = env();
  const t = await signIn(e);
  assert.equal((await call(e, 'PUT', '/api/saves/main', t, { envelope: 'garbage', baseRevision: 0 })).status, 400);
  const env1 = JSON.parse(serialize(createKingdom(3)));
  env1.data = env1.data.replace('"day":1', '"day":2');
  assert.equal((await call(e, 'PUT', '/api/saves/main', t, { envelope: JSON.stringify(env1), baseRevision: 0 })).status, 400, 'checksum mismatch');
  const bad = JSON.parse(serialize(createKingdom(3)));
  const data = JSON.parse(bad.data); data.accounts.treasury = -5; bad.data = JSON.stringify(data);
  const { checksum } = await import('../src/persistence/SaveValidation.js');
  bad.checksum = checksum(bad.data);
  assert.equal((await call(e, 'PUT', '/api/saves/main', t, { envelope: JSON.stringify(bad), baseRevision: 0 })).status, 400, 'invalid world');
  const huge = 'x'.repeat(7.5 * 1024 * 1024);
  assert.equal((await call(e, 'PUT', '/api/saves/main', t, { envelope: huge, baseRevision: 0 })).status, 413);
  assert.equal((await call(e, 'PUT', '/api/saves/../etc', t, { envelope: serialize(createKingdom(3)), baseRevision: 0 })).status, 404, 'slot names are restricted');
});

test('acceptance: save on a phone, restore on a desktop, continue the same world; conflicts are detected', async () => {
  const e = env({ SAVE_ENCRYPTION_KEY: Buffer.from(new Uint8Array(32).fill(7)).toString('base64') });
  const token = await signIn(e, 42, 'traveller');
  // The iPhone: a kingdom that has lived a while.
  const phoneSim = new Simulation(createKingdom(21));
  phoneSim.runDays(30);
  const phone = clientFor(e, token, 'iPhone 15 Pro Max');
  const phoneSync = new CloudSync({ client: phone.client, storage: phone.storage, getState: () => phoneSim.state, setState: (st) => { phoneSim.state = st; } });
  const up = await phoneSync.syncNow();
  assert.equal(up.action, 'uploaded', JSON.stringify(up));
  // The desktop: a fresh browser with a different, new kingdom.
  const deskSim = new Simulation(createKingdom(99));
  const desk = clientFor(e, token, 'Desktop');
  const backups = [];
  const deskSync = new CloudSync({ client: desk.client, storage: desk.storage, getState: () => deskSim.state, setState: (st) => { deskSim.state = st; }, exportBackup: (st) => backups.push(serialize(st)) });
  const first = await deskSync.syncNow();
  assert.equal(first.action, 'conflict', 'two different worlds: the desktop is asked, not overwritten');
  assert.ok(deskSync.pending.local && deskSync.pending.cloud);
  assert.equal(deskSync.pending.cloud.device, 'iPhone 15 Pro Max');
  for (const k of ['savedAt', 'year', 'population', 'version']) assert.ok(k in deskSync.pending.cloud, `the choice shows ${k}`);
  const r = await deskSync.resolve('cloud');
  assert.equal(r.action, 'downloaded');
  assert.equal(backups.length, 1, 'the desktop\'s own world was exported before being replaced');
  // The same world, intact.
  const a = phoneSim.state, b = deskSim.state;
  for (const k of ['citizens', 'businesses', 'plots', 'chronicle', 'finance', 'guilds', 'faith', 'military', 'foreign', 'region', 'diplomacy', 'government']) assert.equal(JSON.stringify(b[k]), JSON.stringify(a[k]), `${k} restored intact`);
  assert.equal(b.day, a.day);
  // Continue on the desktop and sync: a plain continuation uploads without asking.
  deskSim.runDays(3);
  assert.equal((await deskSync.syncNow()).action, 'uploaded');
  // The phone, which has also moved on, must now choose.
  phoneSim.runDays(2);
  assert.equal((await phoneSync.syncNow()).action, 'conflict', 'diverged saves are detected');
  // Backup history keeps the earlier revision restorable.
  const revs = await phone.client.revisions();
  assert.ok(revs.revisions.length >= 1);
  const old = await phone.client.revision(revs.revisions.at(-1).revision);
  assert.ok(validateEnvelope(old.envelope).ok);
  assert.ok(deserialize(old.envelope).citizens.length > 0);
});

test('cloud failures never damage the local world', async () => {
  const sim = new Simulation(createKingdom(5));
  const before = JSON.stringify(sim.state);
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const offline = new CloudSaveClient({ endpoint: API, storage, fetchImpl: async () => { throw new Error('network down'); } });
  const sync = new CloudSync({ client: offline, storage, getState: () => sim.state, setState: () => { throw new Error('must not replace the world'); } });
  const res = await sync.syncNow();
  assert.equal(res.action, 'error');
  assert.equal(JSON.stringify(sim.state), before, 'the world is untouched');
  const notConfigured = new CloudSaveClient({ endpoint: null, storage });
  assert.equal(notConfigured.configured, false, 'the game runs without any cloud service');
});

test('the conflict rules never overwrite a diverged save', () => {
  const L = { checksum: 'a' }, C = { checksum: 'b', revision: 3 };
  assert.equal(compareSaves(L, null, null).action, 'upload');
  assert.equal(compareSaves(null, C, null).action, 'download');
  assert.equal(compareSaves({ checksum: 'b' }, C, null).action, 'in-sync');
  assert.equal(compareSaves(L, C, { revision: 3, checksum: 'z' }).action, 'upload');
  assert.equal(compareSaves(L, C, { revision: 2, checksum: 'a' }).action, 'download');
  assert.equal(compareSaves(L, C, { revision: 2, checksum: 'z' }).action, 'conflict');
  assert.equal(compareSaves(L, C, null).action, 'conflict');
});

test('no credentials are shipped with the game', () => {
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${f.name}`; if (f.isDirectory()) walk(p); else if (/\.(js|html|css)$/.test(f.name)) files.push(p); } };
  walk(new URL('../src', import.meta.url).pathname);
  if (existsSync(new URL('../dist', import.meta.url).pathname)) walk(new URL('../dist', import.meta.url).pathname);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/client_secret\s*[:=]\s*['"][^'"]+['"]/.test(text), `${f} contains no client secret`);
    assert.ok(!/gh[opsu]_[A-Za-z0-9]{20,}/.test(text), `${f} contains no GitHub token`);
    assert.ok(!/GITHUB_CLIENT_SECRET/.test(text), `${f} never references the Worker secret`);
  }
  assert.ok(!existsSync(new URL('../cloud/worker/wrangler.toml', import.meta.url).pathname), 'no deployed configuration is committed');
});

test('v0.5.2: a game still on an older save format cannot overwrite a kingdom saved in the newer one', async () => {
  const e = env();
  const t = await signIn(e);
  const now = serialize(createKingdom(5));
  const first = await call(e, 'PUT', '/api/saves/main', t, { envelope: now, baseRevision: 0 });
  assert.equal(first.status, 200);
  const rev = (await first.json()).meta.revision;
  // The same world written by a v0.5.1 build (format 7).
  const old = JSON.parse(serialize(createKingdom(5)));
  const data = JSON.parse(old.data); data.version = 7; delete data.civ;
  old.data = JSON.stringify(data); old.version = 7;
  const { checksum } = await import('../src/persistence/SaveValidation.js');
  old.checksum = checksum(old.data);
  const res = await call(e, 'PUT', '/api/saves/main', t, { envelope: JSON.stringify(old), baseRevision: rev });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /format 8/);
  // And an old format downloaded by this build is upgraded, not refused.
  assert.equal(deserialize(JSON.stringify(old)).version, 8);
});
