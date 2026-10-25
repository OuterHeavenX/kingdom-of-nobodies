import { serialize, deserialize } from '../core/Serialization.js';
import { validateEnvelope } from './SaveValidation.js';

// Keeps one world and its cloud backup in step, on the player's terms.
// Local saving is never touched by anything here: a failed upload or a
// network error leaves the device's saves exactly as they were. Downloads
// replace the world only when the player asks, or when the cloud is a pure
// continuation of this device's last sync; real conflicts wait for a choice.

const SYNC_KEY = 'kingdom-of-nobodies-cloud-sync';

export class CloudSync {
  constructor({ client, storage = globalThis.localStorage, build = 'dev', getState, setState, exportBackup = null }) {
    Object.assign(this, { client, storage, build, getState, setState, exportBackup });
    this.pending = null; // a conflict awaiting the player's choice
    this.lastResult = null;
    this.auto = this.readRecord().auto ?? false;
  }

  readRecord() { try { return JSON.parse(this.storage.getItem(SYNC_KEY)) ?? {}; } catch { return {}; } }
  writeRecord(r) { try { this.storage.setItem(SYNC_KEY, JSON.stringify({ ...this.readRecord(), ...r })); } catch { /* ignore */ } }
  setAuto(on) { this.auto = !!on; this.writeRecord({ auto: this.auto }); }

  /** The envelope to upload: the world stamped with the revision it will become. */
  envelopeFor(nextRevision) {
    const state = this.getState();
    state.sync = { revision: nextRevision, lastSyncedAt: new Date().toISOString(), deviceLabel: this.client.deviceLabel() };
    return serialize(state, this.build);
  }

  async upload(baseRevision) {
    const text = this.envelopeFor((baseRevision ?? 0) + 1);
    const res = await this.client.upload(text, baseRevision ?? 0);
    if (res.conflict) return { action: 'conflict', cloud: res.meta };
    this.writeRecord({ revision: res.meta.revision, checksum: res.meta.checksum, lastSyncedAt: new Date().toISOString() });
    return { action: 'uploaded', meta: res.meta };
  }

  async download() {
    const { envelope, meta } = await this.client.download();
    const state = deserialize(envelope);
    this.setState(state);
    this.writeRecord({ revision: meta.revision, checksum: meta.checksum, lastSyncedAt: new Date().toISOString() });
    return { action: 'downloaded', meta };
  }

  /** Sync now: upload, download or report a conflict. Never overwrites silently. */
  async syncNow({ allowDownload = true } = {}) {
    try {
      const local = serialize(this.getState(), this.build);
      const plan = await this.client.plan(local, this.readRecord());
      let result;
      if (plan.action === 'upload') result = await this.upload(plan.cloud?.revision ?? 0);
      else if (plan.action === 'download' && allowDownload) result = await this.download();
      else if (plan.action === 'conflict' || (plan.action === 'download' && !allowDownload)) { this.pending = { local: plan.local, cloud: plan.cloud, reason: plan.reason }; result = { action: 'conflict', ...this.pending }; }
      else result = { action: plan.action };
      if (result.action === 'conflict') this.pending = { local: plan.local ?? validateEnvelope(local).meta, cloud: result.cloud ?? plan.cloud, reason: plan.reason };
      this.lastResult = { ...result, at: new Date().toISOString() };
      return result;
    } catch (e) {
      this.lastResult = { action: 'error', error: e.message, at: new Date().toISOString() };
      return this.lastResult;
    }
  }

  /**
   * The player chose which copy to keep. The copy being replaced is offered
   * as a download first (local), or stays in the cloud's revision history.
   */
  async resolve(keep) {
    const conflict = this.pending;
    if (!conflict) return { action: 'none' };
    try {
      if (keep === 'local') {
        const r = await this.upload(conflict.cloud?.revision ?? 0);
        if (r.action === 'conflict') { this.pending = { ...conflict, cloud: r.cloud }; return r; }
        this.pending = null;
        return { ...r, replaced: 'cloud (kept in its backup history)' };
      }
      if (keep === 'cloud') {
        this.exportBackup?.(this.getState());
        const r = await this.download();
        this.pending = null;
        return { ...r, replaced: 'this device (a backup file was downloaded first)' };
      }
    } catch (e) { return { action: 'error', error: e.message }; }
    return { action: 'none' };
  }

  /** Restore an older cloud revision onto this device (after exporting the current world). */
  async restoreRevision(rev) {
    const { envelope, meta } = await this.client.revision(rev);
    this.exportBackup?.(this.getState());
    this.setState(deserialize(envelope));
    this.writeRecord({ revision: null, checksum: meta.checksum, lastSyncedAt: new Date().toISOString() });
    return { action: 'restored', meta };
  }
}
