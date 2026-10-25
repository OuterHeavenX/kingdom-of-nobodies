import { describeSide } from '../persistence/ConflictResolution.js';
import { esc } from './util.js';

// The optional cloud backup card in Council → Kingdom & settings.

export function cloudCard(game) {
  const cloud = game.cloud;
  if (!cloud?.client.configured) {
    return `<div class="card"><h3>☁️ Cloud backup</h3><p class="muted" style="font-size:12px">Not set up for this copy of the game. Your kingdom is saved on this device; use Export to move it by hand. (Cloud backup is optional and needs the backup service deployed — see cloud/README.md.)</p></div>`;
  }
  const c = cloud.client;
  const last = cloud.lastResult;
  const record = cloud.readRecord();
  const pending = cloud.pending;
  if (!c.signedIn) return `<div class="card"><h3>☁️ Cloud backup</h3><p class="muted" style="font-size:12px">Sign in to keep a backup of this kingdom online and continue it on another device. Playing never needs a connection.</p><button class="btn primary" data-act="cloud-signin">Sign in with GitHub</button></div>`;
  return `<div class="card"><h3>☁️ Cloud backup</h3>
    <dl class="kv"><dt>This device</dt><dd>${esc(c.deviceLabel())}</dd><dt>Last synced</dt><dd>${record.lastSyncedAt ? esc(new Date(record.lastSyncedAt).toLocaleString()) : 'never'}${record.revision ? ` (revision ${record.revision})` : ''}</dd>
    ${last ? `<dt>Last attempt</dt><dd>${esc(last.action)}${last.error ? `: ${esc(last.error)}` : ''}</dd>` : ''}</dl>
    ${pending ? `<div class="conflict"><strong>Two different saves</strong><p class="muted" style="font-size:12px">${esc(pending.reason)} Choose which to keep; the other is backed up first.</p>
      <div class="belief">${esc(describeSide(pending.local, 'This device'))}</div><div class="belief">${esc(describeSide(pending.cloud, 'Cloud'))}</div>
      <div class="grid2"><button class="btn" data-act="cloud-keep" data-id="local">Keep this device's</button><button class="btn" data-act="cloud-keep" data-id="cloud">Keep the cloud's</button></div></div>` : ''}
    <div class="grid2" style="margin-top:8px"><button class="btn primary" data-act="cloud-sync">⇅ Sync now</button><button class="btn" data-act="cloud-signout">Sign out</button></div>
    <label class="toggle">Back up automatically <input type="checkbox" data-act="cloud-auto" ${cloud.auto ? 'checked' : ''}></label></div>`;
}
