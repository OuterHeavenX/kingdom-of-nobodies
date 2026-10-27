// Save safety: a kingdom on this device must never be lost to a sync, an
// older build of the game, a full browser quota or a racing upload. Each test
// here reproduces a way a saved kingdom could be destroyed before v0.5.4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../cloud/worker/src/index.js';
import { serialize, deserialize } from '../src/core/Serialization.js';
import { SAVE_VERSION, CIV } from '../src/core/Config.js';
import { SaveManager } from '../src/core/SaveManager.js';
import { createKingdom } from '../src/sim/Setup.js';
import { MAX_SAVE_BYTES, checksum } from '../src/persistence/SaveValidation.js';
import { CloudSaveClient } from '../src/persistence/CloudSaveClient.js';
import { CloudSync } from '../src/persistence/CloudSync.js';
import { recordPropertyChanges, propertyTimeline } from '../src/civilization/PropertyHistory.js';

// --- Cloud service in-process (node:sqlite standing in for D1) -------------------------
const ORIGIN = 'https://outerheavenx.github.io';
const API = 'https://cloud.example.workers.dev';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../cloud/worker/schema.sql', import.meta.url), 'utf8'));
  const out = { raw: db, beforeFirst: null };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => { await out.beforeFirst?.(sql); return db.prepare(sql).get(...args) ?? null; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  out.prepare = (sql) => stmt(sql);
  return out;
}
const cloudEnv = (extra = {}) => ({ DB: d1(), ALLOWED_ORIGIN: ORIGIN, GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', ...extra });
const github = async (url) => {
  if (String(url).includes('access_token')) return new Response(JSON.stringify({ access_token: 'gho_test' }), { headers: { 'content-type': 'application/json' } });
  if (String(url).includes('api.github.com/user')) return new Response(JSON.stringify({ id: 7, login: 'player' }), { headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 404 });
};
async function signIn(e) {
  const start = await handle(new Request(`${API}/auth/github/start?return=${encodeURIComponent(ORIGIN + '/kingdom-of-nobodies/')}`), e);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cb = await handle(new Request(`${API}/auth/github/callback?code=abc&state=${state}`), e, github);
  return /#kon_session=([\w-]+)/.exec(cb.headers.get('location'))[1];
}
const call = (e, method, path, token, body) => handle(new Request(API + path, { method, headers: { origin: ORIGIN, authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), e);
function device(e, token, label, state, log = []) {
  const store = new Map([['kingdom-of-nobodies-cloud-session', token], ['kingdom-of-nobodies-device', label]]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const client = new CloudSaveClient({ endpoint: API, storage, fetchImpl: (url, init) => handle(new Request(url, { ...init, headers: { origin: ORIGIN, ...init.headers } }), e) });
  const box = { state };
  const sync = new CloudSync({ client, storage, getState: () => box.state, setState: (st) => { log.push('set'); box.state = st; }, exportBackup: () => log.push('export') });
  return { sync, box, log };
}

// --- Browser storage fakes ----------------------------------------------------------------
function fakeLocalStorage(quota = Infinity) {
  const items = new Map();
  const used = () => [...items].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    items,
    get length() { return items.size; },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      v = String(v);
      if (used() - (items.get(k)?.length ?? 0) - (items.has(k) ? k.length : 0) + k.length + v.length > quota) { const err = new Error('The quota has been exceeded.'); err.name = 'QuotaExceededError'; throw err; }
      items.set(k, v);
    },
    removeItem: (k) => items.delete(k),
  };
}

/** Just enough IndexedDB for SaveManager: one database, one store, async requests. */
function fakeIndexedDB() {
  const data = new Map();
  const db = {
    createObjectStore() {},
    close() {},
    transaction(_name, mode) {
      const queue = [];
      const tx = {};
      let scheduled = false;
      const pump = () => {
        while (queue.length) { const [req, op] = queue.shift(); req.result = op(); req.onsuccess?.(); }
        tx.oncomplete?.();
      };
      const enqueue = (op) => {
        const req = {};
        queue.push([req, op]);
        if (!scheduled) { scheduled = true; setTimeout(pump, 0); }
        return req;
      };
      const write = (op) => { if (mode !== 'readwrite') throw new Error('ReadOnlyError'); return enqueue(op); };
      tx.objectStore = () => ({
        get: (k) => enqueue(() => data.get(k)),
        getAllKeys: () => enqueue(() => [...data.keys()]),
        put: (v, k) => write(() => { data.set(k, v); return k; }),
        delete: (k) => write(() => { data.delete(k); }),
      });
      return tx;
    },
  };
  return { data, open() { const req = {}; setTimeout(() => { req.result = db; req.onupgradeneeded?.(); req.onsuccess?.(); }, 0); return req; } };
}

async function withBrowser({ quota = Infinity, idb = true } = {}, fn) {
  const ls = fakeLocalStorage(quota);
  const db = idb ? fakeIndexedDB() : null;
  globalThis.localStorage = ls;
  if (db) globalThis.indexedDB = db;
  const warn = console.warn;
  console.warn = () => {};
  try { return await fn({ ls, db }); } finally { delete globalThis.localStorage; delete globalThis.indexedDB; console.warn = warn; }
}

/** An envelope as a newer build (save format SAVE_VERSION + 1) would write it. */
function futureEnvelope(seed, savedAt) {
  const env = JSON.parse(serialize(createKingdom(seed), 'next'));
  const data = JSON.parse(env.data);
  data.version = SAVE_VERSION + 1;
  data.somethingNew = { introducedIn: SAVE_VERSION + 1 };
  env.data = JSON.stringify(data);
  env.checksum = checksum(env.data);
  return JSON.stringify({ ...env, version: SAVE_VERSION + 1, savedAt });
}
const withSavedAt = (text, savedAt) => JSON.stringify({ ...JSON.parse(text), savedAt });

/** Realistic-looking bulk (it compresses like a real archive, unlike one repeated character). */
function chronicleBulk(chars) {
  const trades = ['baker', 'mason', 'weaver', 'smith', 'farmer', 'carter', 'brewer', 'scribe', 'tanner', 'potter'];
  const names = ['Ada', 'Bram', 'Cora', 'Dain', 'Elin', 'Fenn', 'Gilda', 'Hob', 'Isla', 'Jory'];
  const out = [];
  let n = 0;
  for (let i = 0; n < chars; i++) {
    const r = { id: `c${i}`, firstName: names[(i * 7) % 10], lastName: names[(i * 3 + 1) % 10] + 'son', trade: trades[(i * 11) % 10], born: (i * 37) % 6000, died: (i * 37) % 6000 + 400 + (i % 300), note: `Worked as a ${trades[i % 10]} for ${(i * 13) % 40} years and was remembered by ${(i * 17) % 90} people.` };
    out.push(r);
    n += JSON.stringify(r).length + 1;
  }
  return out;
}

// --- 1. Oversize local saves and downloads --------------------------------------------------
test('save safety: a local kingdom too large for the cloud is never treated as "no save" and downloaded over', async () => {
  const e = cloudEnv();
  const token = await signIn(e);
  const phone = device(e, token, 'Phone', createKingdom(3));
  assert.equal((await phone.sync.syncNow()).action, 'uploaded');
  // The desktop holds a long-lived kingdom whose save has outgrown the limit.
  const big = createKingdom(4);
  big.archiveBulk = 'x'.repeat(MAX_SAVE_BYTES);
  const desk = device(e, token, 'Desktop', big);
  const r = await desk.sync.syncNow();
  assert.equal(r.action, 'error', JSON.stringify(r).slice(0, 200));
  assert.match(r.error, /too large/);
  assert.deepEqual(desk.log, [], 'the cloud copy was not downloaded over the local kingdom');
  assert.equal(desk.box.state, big, 'the local world is untouched');
});

test('save safety: a kingdom larger than the old 6 MB limit backs up, and is stored compressed', async () => {
  const e = cloudEnv();
  const token = await signIn(e);
  const s = createKingdom(5);
  s.archiveBulk = chronicleBulk(7 * 1024 * 1024);
  const text = serialize(s, 'test');
  assert.ok(text.length > 7 * 1024 * 1024, 'over the old limit');
  const put = await call(e, 'PUT', '/api/saves/main', token, { envelope: text, baseRevision: 0, device: 'Desktop' });
  assert.equal(put.status, 200, await put.clone().text());
  const { n } = e.DB.raw.prepare('SELECT length(body) AS n FROM saves').get();
  assert.ok(n < 2_000_000, `stored body (${n} bytes) fits D1's 2 MB value limit`);
  const back = await (await call(e, 'GET', '/api/saves/main', token)).json();
  assert.equal(back.envelope, text, 'the save comes back byte for byte');
  // Rows written before compression are still read.
  e.DB.raw.prepare("UPDATE saves SET body = 'plain:' || ?").run(text);
  assert.equal((await (await call(e, 'GET', '/api/saves/main', token)).json()).envelope, text);
});

test('save safety: a download that follows another device always exports this device\'s world first', async () => {
  const e = cloudEnv();
  const token = await signIn(e);
  const phone = device(e, token, 'Phone', createKingdom(3));
  assert.equal((await phone.sync.syncNow()).action, 'uploaded');
  const desk = device(e, token, 'Desktop', createKingdom(9));
  assert.equal((await desk.sync.syncNow()).action, 'conflict');
  assert.equal((await desk.sync.resolve('cloud')).action, 'downloaded');
  assert.deepEqual(desk.log, ['export', 'set'], 'one backup file, then the replacement');
  // The phone moves on; the desktop has not, so its sync is a plain download.
  phone.box.state.kingdomName = 'Kingdom of Later Days';
  assert.equal((await phone.sync.syncNow()).action, 'uploaded');
  desk.log.length = 0;
  assert.equal((await desk.sync.syncNow()).action, 'downloaded');
  assert.deepEqual(desk.log, ['export', 'set'], 'the world being replaced was exported before setState');
  assert.equal(desk.box.state.kingdomName, 'Kingdom of Later Days');
});

test('save safety: after restoring an older cloud revision, Sync does not download the latest over it', async () => {
  const e = cloudEnv();
  const token = await signIn(e);
  const phone = device(e, token, 'Phone', createKingdom(3));
  phone.box.state.kingdomName = 'First Draft';
  assert.equal((await phone.sync.syncNow()).action, 'uploaded');
  phone.box.state.kingdomName = 'Second Draft';
  assert.equal((await phone.sync.syncNow()).action, 'uploaded');
  const restored = await phone.sync.restoreRevision(1);
  assert.equal(restored.action, 'restored');
  assert.equal(phone.box.state.kingdomName, 'First Draft');
  phone.log.length = 0;
  const r = await phone.sync.syncNow();
  assert.notEqual(r.action, 'downloaded', 'the restored revision is not silently replaced');
  assert.equal(r.action, 'conflict', 'the player chooses');
  assert.deepEqual(phone.log, []);
  assert.equal(phone.box.state.kingdomName, 'First Draft');
});

test('save safety: two uploads racing from the same revision cannot both win, and the slot stays usable', async () => {
  const e = cloudEnv();
  const token = await signIn(e);
  assert.equal((await call(e, 'PUT', '/api/saves/main', token, { envelope: serialize(createKingdom(1)), baseRevision: 0 })).status, 200);
  // Over the network each D1 query is a round trip, so both requests can read
  // revision 1 before either writes. Hold the reads until both have been made.
  const held = [];
  e.DB.beforeFirst = (sql) => {
    if (!sql.startsWith('SELECT * FROM saves WHERE user_id = ? AND slot = ?')) return null;
    return new Promise((release) => { held.push(release); if (held.length === 2) { e.DB.beforeFirst = null; held.forEach((r) => r()); } });
  };
  const [a, b] = await Promise.all([
    call(e, 'PUT', '/api/saves/main', token, { envelope: serialize(createKingdom(2)), baseRevision: 1, device: 'A' }),
    call(e, 'PUT', '/api/saves/main', token, { envelope: serialize(createKingdom(3)), baseRevision: 1, device: 'B' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'exactly one upload replaces revision 1');
  const winner = (await (a.status === 200 ? a : b).json()).meta;
  const slot = (await (await call(e, 'GET', '/api/saves', token)).json()).saves[0];
  assert.equal(slot.revision, winner.revision);
  assert.equal(slot.checksum, winner.checksum, 'the cloud holds the save the winner was told it holds');
  const next = await call(e, 'PUT', '/api/saves/main', token, { envelope: serialize(createKingdom(4)), baseRevision: winner.revision });
  assert.equal(next.status, 200, 'later uploads still work');
  const revs = (await (await call(e, 'GET', '/api/saves/main/revisions', token)).json()).revisions.map((m) => m.revision);
  assert.deepEqual(revs, [2, 1], 'the backup history has each revision once');
});

// --- 2. Saves written by a newer build ------------------------------------------------------
test('save safety: an older build keeps a newer-format kingdom and never founds a new one over it', async () => {
  await withBrowser({}, async ({ db }) => {
    const future = futureEnvelope(1, '2031-01-02T00:00:00.000Z');
    db.data.set('current', future);
    db.data.set('previous', withSavedAt(serialize(createKingdom(2), 'test'), '2031-01-01T00:00:00.000Z'));
    const saves = new SaveManager('test');
    const r = await saves.load();
    assert.equal(r.state, null, 'nothing older is loaded in place of the newer kingdom');
    assert.equal(r.future?.version, SAVE_VERSION + 1, 'the player can be told to update');
    assert.equal(db.data.get(`future-v${SAVE_VERSION + 1}`), future, 'a copy is kept where saves never rotate');
    // Even if this build went on to save twice, the newer kingdom survives.
    await saves.save(createKingdom(3));
    await saves.save(createKingdom(3));
    assert.equal(db.data.get(`future-v${SAVE_VERSION + 1}`), future);
    // A kept copy is never replaced.
    db.data.set('current', futureEnvelope(9, '2031-02-01T00:00:00.000Z'));
    await saves.load();
    assert.equal(db.data.get(`future-v${SAVE_VERSION + 1}`), future);
  });
});

test('save safety: without IndexedDB the newer-format kingdom is kept in localStorage', async () => {
  await withBrowser({ idb: false }, async ({ ls }) => {
    const future = futureEnvelope(1, '2031-01-02T00:00:00.000Z');
    ls.setItem('kingdom-of-nobodies-m2-backup', future);
    const r = await new SaveManager('test').load();
    assert.equal(r.state, null);
    assert.equal(r.future?.version, SAVE_VERSION + 1);
    assert.equal(ls.getItem(`kingdom-of-nobodies-future-v${SAVE_VERSION + 1}`), future);
  });
});

// --- Local storage quota ----------------------------------------------------------------------
test('save safety: when a kingdom outgrows the localStorage quota, no stale copy is left filling it', async () => {
  const small = createKingdom(6);
  const smallText = serialize(small, 'test');
  await withBrowser({ quota: smallText.length + 20_000 }, async ({ ls, db }) => {
    const saves = new SaveManager('test');
    assert.equal(await saves.save(small), true);
    assert.ok(ls.getItem('kingdom-of-nobodies-m2-backup'), 'a small kingdom fits');
    const grown = createKingdom(6);
    grown.archiveBulk = 'y'.repeat(smallText.length);
    assert.equal(await saves.save(grown), true, 'IndexedDB still holds the save');
    assert.equal(deserialize(db.data.get('current')).archiveBulk.length, grown.archiveBulk.length);
    assert.equal(ls.getItem('kingdom-of-nobodies-m2-backup'), null, 'the older copy is not left behind');
    // So the small records that live in localStorage (cloud sync state) can still be written.
    ls.setItem('kingdom-of-nobodies-cloud-sync', JSON.stringify({ revision: 3, checksum: 'abc'.repeat(1000) }));
    const { state } = await saves.load();
    assert.equal(state.archiveBulk.length, grown.archiveBulk.length, 'the grown kingdom loads');
  });
});

// --- 3. Then & Now records at the per-plot cap ------------------------------------------------
function plotWorld(records, plot) {
  return { day: 5000, plots: [plot], businesses: [], citizens: [], archive: {}, civ: { archive: { [plot.id]: records } } };
}
const building = (seed) => ({ type: 'house', era: 1, seed, floors: 1, level: 1, name: 'Hill House' });

test('save safety: at the Then & Now cap the record just made is kept, even when all older ones are structural', () => {
  const cap = CIV.archivePerPlot;
  const records = [{ d: 1, k: 'built', t: 'house', e: 1, s: 0, f: 1, l: 1, n: 'Hill House', o: 'c1', on: 'Ada Founder', bz: null }];
  for (let i = 1; i < cap; i++) records.push({ d: 1 + i * 10, k: 'rebuilt', t: 'house', e: 1, s: i, f: 1, l: 1, n: 'Hill House', from: 'House' });
  const plot = { id: 'p1', building: building(cap - 1), ownerId: 'c2', businessId: null };
  const s = plotWorld(records, plot);
  recordPropertyChanges(s);
  const list = s.civ.archive.p1;
  assert.equal(list.length, cap);
  assert.equal(list.at(-1).k, 'owner', 'the new owner is on record');
  assert.equal(list.at(-1).o, 'c2');
  assert.equal(propertyTimeline(s, 'p1').at(-1).state.o, 'c2');
  recordPropertyChanges(s);
  assert.equal(s.civ.archive.p1.length, cap, 'nothing is re-recorded the next day');
  assert.equal(s.civ.archive.p1.at(-1).o, 'c2');
});

test('save safety: thinning an old ownership note does not lose the current owner', () => {
  const cap = CIV.archivePerPlot;
  const records = [{ d: 1, k: 'built', t: 'house', e: 1, s: 0, f: 1, l: 1, n: 'Hill House', o: 'c1', on: 'Ada Founder', bz: null }, { d: 5, k: 'owner', o: 'c2', on: 'Bram Heir', prev: 'c1' }];
  for (let i = 2; i < cap; i++) records.push({ d: i * 10, k: 'rebuilt', t: 'house', e: 1, s: i, f: 1, l: 1, n: 'Hill House', from: 'House' });
  const plot = { id: 'p1', building: building(cap), ownerId: 'c2', businessId: null }; // rebuilt once more
  const s = plotWorld(records, plot);
  recordPropertyChanges(s);
  assert.equal(s.civ.archive.p1.length, cap);
  assert.equal(s.civ.archive.p1.at(-1).k, 'rebuilt');
  assert.equal(propertyTimeline(s, 'p1').at(-1).state.o, 'c2', 'the replayed owner is still the real one');
  const before = JSON.stringify(s.civ.archive.p1);
  recordPropertyChanges(s);
  assert.equal(JSON.stringify(s.civ.archive.p1), before, 'no spurious ownership record the next day');
});
