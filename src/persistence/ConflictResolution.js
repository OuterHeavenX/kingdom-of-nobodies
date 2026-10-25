// Deciding what to do when this device and the cloud both hold a save.
// The rule is simple and never silent: a save is only replaced automatically
// when the other copy is a direct continuation of it. If both have moved on
// since they were last in step, it is a conflict and the player chooses.
//
// `sync` is the device's record of the last successful exchange:
//   { revision, checksum, lastSyncedAt }
// `local` is the summary of the save on this device, `cloud` the summary
// stored with the cloud slot (with its `revision`), or null if none.

export function compareSaves(local, cloud, sync) {
  if (!cloud) return local ? { action: 'upload', reason: 'There is no cloud backup yet.' } : { action: 'none', reason: 'Nothing to sync.' };
  if (!local) return { action: 'download', reason: 'This device has no saved kingdom.' };
  if (local.checksum === cloud.checksum) return { action: 'in-sync', reason: 'This device and the cloud hold the same save.' };
  const knewCloud = sync && sync.revision === cloud.revision;
  const localChanged = !sync || sync.checksum !== local.checksum;
  if (knewCloud && localChanged) return { action: 'upload', reason: 'Only this device has moved on since the last sync.' };
  if (!localChanged && sync && cloud.revision > sync.revision) return { action: 'download', reason: 'Only the cloud has moved on (another device saved).' };
  return { action: 'conflict', reason: 'Both this device and the cloud have changed since they were last in step.', local, cloud };
}

/** Lines the conflict dialog shows for one side. */
export function describeSide(meta, label) {
  if (!meta) return `${label}: none`;
  const when = meta.savedAt ? new Date(meta.savedAt).toLocaleString() : 'unknown time';
  return `${label}: saved ${when} · Year ${meta.year} · ${meta.population} people · save v${meta.version}${meta.device ? ` · ${meta.device}` : ''}`;
}
