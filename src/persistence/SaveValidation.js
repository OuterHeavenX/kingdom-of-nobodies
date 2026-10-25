// Save validation shared by the game and the cloud backup service. It has no
// dependencies, so the Cloudflare Worker bundles exactly the same rules the
// browser uses. A save is an envelope { format, version, build, savedAt,
// checksum, data } where `data` is the JSON text of the world.

export const FORMAT = 'kingdom-of-nobodies';
export const MAX_SAVE_BYTES = 6 * 1024 * 1024;
export const MIN_VERSION = 2;
export const MAX_VERSION = 8; // keep in step with SAVE_VERSION (v0.5.2 saves are version 8)

export function checksum(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

const isInt = (v) => Number.isInteger(v);

/**
 * Validate an envelope's text. Returns { ok, error?, meta? } where meta is a
 * small summary safe to show and store separately (no personal data beyond
 * what the save itself names).
 */
export function validateEnvelope(text) {
  if (typeof text !== 'string' || !text.length) return { ok: false, error: 'empty save' };
  if (text.length > MAX_SAVE_BYTES) return { ok: false, error: `save is larger than ${Math.round(MAX_SAVE_BYTES / 1048576)} MB` };
  let env;
  try { env = JSON.parse(text); } catch { return { ok: false, error: 'not valid JSON' }; }
  if (!env || typeof env !== 'object' || env.format !== FORMAT) return { ok: false, error: 'not a Kingdom of Nobodies save' };
  if (!isInt(env.version) || env.version < MIN_VERSION || env.version > MAX_VERSION) return { ok: false, error: `unsupported save version ${env.version}` };
  if (typeof env.data !== 'string' || typeof env.checksum !== 'string') return { ok: false, error: 'save is missing its data' };
  if (checksum(env.data) !== env.checksum) return { ok: false, error: 'checksum mismatch' };
  let s;
  try { s = JSON.parse(env.data); } catch { return { ok: false, error: 'world data is not valid JSON' }; }
  const problems = validateWorld(s);
  if (problems.length) return { ok: false, error: `invalid world: ${problems.slice(0, 3).join(', ')}` };
  return { ok: true, meta: summarise(env, s) };
}

/** Structural checks on the world itself. */
export function validateWorld(s) {
  const problems = [];
  if (!s || typeof s !== 'object') return ['missing world'];
  for (const key of ['citizens', 'businesses', 'plots', 'chronicle']) if (!Array.isArray(s[key])) problems.push(`${key} missing`);
  if (!s.accounts || typeof s.accounts !== 'object') problems.push('accounts missing');
  else for (const [k, v] of Object.entries(s.accounts)) if (!isInt(v) || v < 0) { problems.push(`account ${k} invalid`); break; }
  if (!isInt(s.day) || s.day < 1) problems.push('bad day');
  for (const c of s.citizens ?? []) if (!c || typeof c.id !== 'string' || typeof c.firstName !== 'string') { problems.push('a citizen record is malformed'); break; }
  return problems;
}

export function summarise(env, s) {
  const year = Math.floor((s.day - 1) / 12) + 1;
  return {
    version: env.version, build: String(env.build ?? '').slice(0, 40), savedAt: String(env.savedAt ?? '').slice(0, 40),
    day: s.day, year, population: s.citizens.length, kingdomName: String(s.kingdomName ?? 'Kingdom of Nobodies').slice(0, 60),
    seed: isInt(s.seed) ? s.seed : null, checksum: env.checksum, bytes: JSON.stringify(env).length,
  };
}
