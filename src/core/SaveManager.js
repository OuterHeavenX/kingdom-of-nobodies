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

export class SaveManager {
  constructor(build) { this.build = build; this.writing = null; this.lastSaved = null; }

  async save(state) {
    const text = serialize(state, this.build);
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
      try { localStorage.setItem(LS_BACKUP, text); ok = true; } catch { /* quota or privacy mode */ }
      if (ok) this.lastSaved = new Date();
      return ok;
    };
    this.writing = (this.writing ?? Promise.resolve()).then(run, run);
    return this.writing;
  }

  /** Synchronous best-effort save for page-hide, when async work may be cut short. */
  saveNow(state) {
    try { localStorage.setItem(LS_BACKUP, serialize(state, this.build)); } catch { /* ignore */ }
    this.save(state);
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
    const best = newestSave(candidates);
    if (best) {
      // Before an older kingdom is upgraded, its original save is kept untouched.
      const v = versionOf(best.text);
      if (v && v < SAVE_VERSION) await this.keepBackup(best.text, v);
      return { state: best.state, source: best.label, upgradedFrom: v && v < SAVE_VERSION ? v : null };
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
