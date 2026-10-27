import { serialize, deserialize, newestSave, versionOf } from './Serialization.js';
import { SAVE_VERSION } from './Config.js';
import { yearOf } from './Calendar.js';

// Browser persistence. The primary store is IndexedDB with two slots: a new
// save is written as 'current' and the previous one is kept as 'previous' in
// the same transaction, so a failed or interrupted write never destroys the
// last good save. Once per game year a recovery snapshot is also kept, so a
// save that is valid but unwanted (or both slots damaged) can still be rolled
// back. A copy also goes to localStorage as a fallback.

const DB = 'kingdom-of-nobodies';
const STORE = 'saves';
const LS_BACKUP = 'kingdom-of-nobodies-m2-backup';
export const LEGACY_KEY = 'kingdom-of-nobodies-m1-v2';
const LEGACY_DONE = 'kingdom-of-nobodies-m1-migrated';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const out = fn(store);
    tx.oncomplete = () => { db.close(); resolve(out?.result ?? out); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('save aborted')); };
  }));
}

/**
 * The localStorage copy. A large kingdom can outgrow the browser's quota
 * (about 5 MB); then an older copy must not linger there, filling the quota
 * (the cloud sync record lives in localStorage too) and posing as a fallback.
 * It is removed only when IndexedDB holds the new save (`stored`).
 */
function writeBackup(text, stored) {
  try { localStorage.setItem(LS_BACKUP, text); return true; } catch { /* quota or privacy mode */ }
  if (stored) { try { localStorage.removeItem(LS_BACKUP); } catch { /* ignore */ } }
  return false;
}

const futureKey = (v) => `future-v${v}`;

export class SaveManager {
  constructor(build) { this.build = build; this.writing = null; this.lastSaved = null; }

  async save(state, text = serialize(state, this.build)) {
    // Serialise writes so two saves never interleave.
    const run = async () => {
      let ok = false;
      try {
        await idb('readwrite', (store) => {
          const get = store.get('current');
          const year = store.get('snapshotYear');
          get.onsuccess = () => {
            if (get.result) store.put(get.result, 'previous');
            store.put(text, 'current');
          };
          year.onsuccess = () => {
            if (year.result === yearOf(state.day)) return;
            store.put(text, 'snapshot');
            store.put(yearOf(state.day), 'snapshotYear');
          };
        });
        ok = true;
      } catch { /* fall through to localStorage */ }
      if (writeBackup(text, ok)) ok = true;
      if (ok) this.lastSaved = new Date();
      return ok;
    };
    this.writing = (this.writing ?? Promise.resolve()).then(run, run);
    return this.writing;
  }

  /** Synchronous best-effort save for page-hide, when async work may be cut short. */
  saveNow(state) {
    const text = serialize(state, this.build);
    writeBackup(text, false);
    this.save(state, text);
  }

  /** Load the newest valid save: IndexedDB current, then previous, then localStorage, then a Milestone 1 save. */
  async load() {
    const candidates = [];
    try {
      const [current, previous, snapshot] = await idb('readonly', (store) => {
        const out = { result: [] };
        const a = store.get('current'), b = store.get('previous'), c = store.get('snapshot');
        a.onsuccess = () => { out.result[0] = a.result; };
        b.onsuccess = () => { out.result[1] = b.result; };
        c.onsuccess = () => { out.result[2] = c.result; };
        return out;
      });
      // Listed last so that on a tie the regular save is reported as the source.
      candidates.push(['saved game', current], ['previous save', previous], ['yearly recovery snapshot', snapshot]);
    } catch { /* IndexedDB unavailable */ }
    try { candidates.push(['backup save', localStorage.getItem(LS_BACKUP)]); } catch { /* ignore */ }
    // A kingdom saved by a newer build cannot be read here. It is set aside
    // where no save rotation can reach it, and if it is the most recent world
    // on this device nothing is loaded (or founded) over it: the player is
    // asked to update the game instead.
    const future = await this.keepFuture(candidates);
    const best = newestSave(candidates);
    if (future && (!best || future.savedAt > best.savedAt)) return { state: null, source: null, future };
    if (best) {
      // Before an older kingdom is upgraded, its original save is kept untouched.
      const v = versionOf(best.text);
      if (v && v < SAVE_VERSION) await this.keepBackup(best.text, v);
      else await this.findBackup();
      return { state: best.state, source: best.label, upgradedFrom: v && v < SAVE_VERSION ? v : null, future };
    }
    try {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy && !localStorage.getItem(LEGACY_DONE)) {
        const state = deserialize(legacy);
        localStorage.setItem(LEGACY_DONE, '1');
        return { state, source: 'Milestone 1 village (migrated)' };
      }
    } catch (e) { console.warn('Could not migrate the Milestone 1 save:', e.message); }
    return { state: null, source: null };
  }

  /**
   * Keep every save written in a format newer than this build understands
   * under `future-vN` (once per format; an existing copy is never replaced).
   * Returns the newest such save's { version, savedAt, label, kept }, or null.
   */
  async keepFuture(candidates) {
    let newest = null;
    for (const [label, text] of candidates) {
      if (!text) continue;
      const v = versionOf(text);
      if (!Number.isInteger(v) || v <= SAVE_VERSION) continue;
      let savedAt = '';
      try { savedAt = String(JSON.parse(text).savedAt ?? ''); } catch { /* unreadable */ }
      if (!newest || savedAt > newest.savedAt) newest = { version: v, savedAt, label, text };
    }
    if (!newest) return null;
    const key = futureKey(newest.version);
    let kept = false;
    try {
      await idb('readwrite', (store) => { const r = store.get(key); r.onsuccess = () => { if (!r.result) store.put(newest.text, key); }; });
      kept = true;
    } catch {
      try { const k = `kingdom-of-nobodies-${key}`; if (!localStorage.getItem(k)) localStorage.setItem(k, newest.text); kept = true; } catch { /* no room: its own slot still holds it */ }
    }
    console.warn(`A kingdom saved in format ${newest.version} (newer than this game's ${SAVE_VERSION}) is kept as ${key}.`);
    return { version: newest.version, savedAt: newest.savedAt, label: newest.label, key, kept };
  }

  /** Find a pre-upgrade copy kept by an earlier session (the newest format wins). */
  async findBackup() {
    const newest = (keys) => keys.map((k) => /^backup-v(\d+)$/.exec(k)).filter(Boolean).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    let key = null;
    try { key = newest((await idb('readonly', (store) => store.getAllKeys())) ?? []); } catch { /* IndexedDB unavailable */ }
    if (!key) {
      try { key = newest(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i).replace(/^kingdom-of-nobodies-/, ''))); } catch { /* ignore */ }
    }
    if (key) this.backupKey = key;
    return key;
  }

  /** Keep a copy of a save in an older format (once per format version). */
  async keepBackup(text, version) {
    const key = `backup-v${version}`;
    try {
      await idb('readwrite', (store) => { const r = store.get(key); r.onsuccess = () => { if (!r.result) store.put(text, key); }; });
      this.backupKey = key;
    } catch {
      try { if (!localStorage.getItem(`kingdom-of-nobodies-${key}`)) localStorage.setItem(`kingdom-of-nobodies-${key}`, text); this.backupKey = key; } catch { /* no room: the previous slot still holds it */ }
    }
  }

  /** Download the pre-upgrade copy, if one was kept. */
  async exportBackup() {
    if (!this.backupKey) return false;
    let text = null;
    try { text = await idb('readonly', (store) => store.get(this.backupKey)); } catch { /* fall back */ }
    text = text ?? (() => { try { return localStorage.getItem(`kingdom-of-nobodies-${this.backupKey}`); } catch { return null; } })();
    if (!text) return false;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `kingdom-of-nobodies-${this.backupKey}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }

  /** The yearly recovery snapshot, if one exists, for an explicit roll-back. */
  async loadSnapshot() {
    try {
      const text = await idb('readonly', (store) => store.get('snapshot'));
      return text ? deserialize(text) : null;
    } catch { return null; }
  }

  async clear() {
    try { await idb('readwrite', (store) => { for (const k of ['current', 'previous', 'snapshot', 'snapshotYear']) store.delete(k); }); } catch { /* ignore */ }
    try { localStorage.removeItem(LS_BACKUP); localStorage.setItem(LEGACY_DONE, '1'); } catch { /* ignore */ }
  }

  exportFile(state) {
    const blob = new Blob([serialize(state, this.build)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kingdom-of-nobodies-day-${state.day}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async importFile(file) {
    return deserialize(await file.text());
  }
}
