import { validateEnvelope } from '../../../src/persistence/SaveValidation.js';

// Kingdom of Nobodies — optional cloud backup service (Cloudflare Worker + D1).
//
// The game is local-first: this service only stores copies of saves for
// players who sign in, so the same kingdom can be continued on another
// device. Authentication uses GitHub OAuth (an established provider): the
// client secret lives only in the Worker's encrypted environment, never in
// the browser or the repository. After sign-in the Worker issues its own
// random session token; only a SHA-256 hash of it is stored.
//
// Endpoints (all JSON; CORS restricted to ALLOWED_ORIGIN):
//   GET    /auth/github/start?return=<url>   → redirect to GitHub
//   GET    /auth/github/callback            → redirect back with #kon_session=<token>
//   GET    /api/me                          → { user }
//   DELETE /api/session                     → sign out
//   GET    /api/saves                       → { saves: [meta] }
//   GET    /api/saves/:slot                 → { meta, envelope }
//   PUT    /api/saves/:slot                 → body { envelope, baseRevision, device } → 200 { meta } | 409 { conflict, meta }
//   GET    /api/saves/:slot/revisions       → { revisions: [meta] }   (backup history)
//   GET    /api/saves/:slot/revisions/:rev  → { meta, envelope }

const SESSION_DAYS = 30;
const KEEP_REVISIONS = 6;
const LIMITS = { read: 120, write: 20 }; // requests per user per minute
const SLOT = /^[a-z0-9-]{1,24}$/;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

function cors(env, req) {
  const origin = req.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS', vary: 'origin', 'access-control-max-age': '600' };
}

function b64url(bytes) {
  const u8 = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(text) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }

// --- Optional application-level encryption at rest (AES-GCM) ---------------------
async function aesKey(env) {
  if (!env.SAVE_ENCRYPTION_KEY) return null;
  const raw = Uint8Array.from(atob(env.SAVE_ENCRYPTION_KEY), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text) {
  const key = await aesKey(env);
  if (!key) return 'plain:' + text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return 'aes:' + b64url(iv) + ':' + b64url(ct);
}
async function unseal(env, stored) {
  if (stored.startsWith('plain:')) return stored.slice(6);
  const [, ivs, cts] = stored.split(':');
  const dec = (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  const key = await aesKey(env);
  if (!key) throw new Error('encryption key missing');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: dec(ivs) }, key, dec(cts)));
}

// --- Sessions and rate limits ------------------------------------------------------
async function userFrom(env, req) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length < 20) return null;
  const row = await env.DB.prepare('SELECT s.user_id, u.login FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(await sha256(token), Date.now()).first();
  return row ? { id: row.user_id, login: row.login, tokenHash: await sha256(token) } : null;
}

async function limited(env, user, kind) {
  const window = Math.floor(Date.now() / 60000);
  const key = `${user.id}:${kind}:${window}`;
  await env.DB.prepare('INSERT INTO rate (key, n, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1').bind(key, (window + 2) * 60000).run();
  const row = await env.DB.prepare('SELECT n FROM rate WHERE key = ?').bind(key).first();
  return (row?.n ?? 0) > LIMITS[kind];
}

// --- OAuth ---------------------------------------------------------------------------
function safeReturn(env, url) {
  try {
    const u = new URL(url);
    const allowed = (env.ALLOWED_ORIGIN ?? '').split(',').map((s) => s.trim());
    return allowed.includes(u.origin) ? u.toString() : null;
  } catch { return null; }
}

async function authStart(env, req, url) {
  if (!env.GITHUB_CLIENT_ID) return json({ error: 'sign-in is not configured' }, 503);
  const back = safeReturn(env, url.searchParams.get('return') ?? '');
  if (!back) return json({ error: 'return address not allowed' }, 400);
  const state = randomToken(18);
  await env.DB.prepare('INSERT INTO oauth_states (state, return_to, expires_at) VALUES (?, ?, ?)').bind(state, back, Date.now() + 10 * 60000).run();
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  gh.searchParams.set('redirect_uri', `${url.origin}/auth/github/callback`);
  gh.searchParams.set('state', state);
  gh.searchParams.set('scope', 'read:user');
  gh.searchParams.set('allow_signup', 'true');
  return Response.redirect(gh.toString(), 302);
}

async function authCallback(env, req, url, fetchImpl) {
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state) return json({ error: 'missing code' }, 400);
  const row = await env.DB.prepare('SELECT return_to FROM oauth_states WHERE state = ? AND expires_at > ?').bind(state, Date.now()).first();
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
  if (!row) return json({ error: 'sign-in expired; please try again' }, 400);
  const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/auth/github/callback` }),
  });
  const tok = await tokenRes.json().catch(() => ({}));
  if (!tok.access_token) return json({ error: 'GitHub did not confirm the sign-in' }, 401);
  const userRes = await fetchImpl('https://api.github.com/user', { headers: { authorization: `Bearer ${tok.access_token}`, accept: 'application/vnd.github+json', 'user-agent': 'kingdom-of-nobodies-cloud' } });
  const gh = await userRes.json().catch(() => ({}));
  if (!gh.id) return json({ error: 'could not read the GitHub account' }, 401);
  // The GitHub token is used once and discarded; only our own session is kept.
  const userId = `gh:${gh.id}`;
  await env.DB.prepare('INSERT INTO users (id, login, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET login = excluded.login').bind(userId, String(gh.login ?? '').slice(0, 60), Date.now()).run();
  const session = randomToken(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(session), userId, Date.now(), Date.now() + SESSION_DAYS * 86400000).run();
  // The token travels in the URL fragment, which browsers never send to servers.
  return Response.redirect(`${row.return_to.split('#')[0]}#kon_session=${session}`, 302);
}

// --- Saves -----------------------------------------------------------------------------
const metaOf = (row) => row && { slot: row.slot, revision: row.revision, savedAt: row.saved_at, uploadedAt: row.uploaded_at, device: row.device, version: row.version, day: row.day, year: row.year, population: row.population, checksum: row.checksum, bytes: row.bytes, kingdomName: row.kingdom_name };

async function listSaves(env, user) {
  const { results } = await env.DB.prepare('SELECT * FROM saves WHERE user_id = ? ORDER BY slot').bind(user.id).all();
  return json({ saves: results.map(metaOf) });
}

async function getSave(env, user, slot) {
  const row = await env.DB.prepare('SELECT * FROM saves WHERE user_id = ? AND slot = ?').bind(user.id, slot).first();
  if (!row) return json({ error: 'no such save' }, 404);
  return json({ meta: metaOf(row), envelope: await unseal(env, row.body) });
}

async function putSave(env, user, slot, req) {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 7 * 1024 * 1024) return json({ error: 'save too large' }, 413);
  const text = await req.text();
  if (text.length > 7 * 1024 * 1024) return json({ error: 'save too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'request is not JSON' }, 400); }
  const check = validateEnvelope(body?.envelope);
  if (!check.ok) return json({ error: `rejected: ${check.error}` }, check.error.includes('larger') ? 413 : 400);
  const device = String(body.device ?? 'unknown device').slice(0, 60);
  const base = Number.isInteger(body.baseRevision) ? body.baseRevision : null;
  const current = await env.DB.prepare('SELECT * FROM saves WHERE user_id = ? AND slot = ?').bind(user.id, slot).first();
  // Never silently overwrite: the client must say which revision it is replacing.
  if (current && base !== current.revision) return json({ conflict: true, meta: metaOf(current) }, 409);
  if (!current && base !== null && base !== 0) return json({ conflict: true, meta: null }, 409);
  const revision = (current?.revision ?? 0) + 1;
  const m = check.meta;
  const sealed = await seal(env, body.envelope);
  const now = Date.now();
  if (current) await env.DB.prepare('INSERT INTO save_revisions (user_id, slot, revision, saved_at, uploaded_at, device, version, day, year, population, checksum, bytes, kingdom_name, body) SELECT user_id, slot, revision, saved_at, uploaded_at, device, version, day, year, population, checksum, bytes, kingdom_name, body FROM saves WHERE user_id = ? AND slot = ?').bind(user.id, slot).run();
  await env.DB.prepare('INSERT INTO saves (user_id, slot, revision, saved_at, uploaded_at, device, version, day, year, population, checksum, bytes, kingdom_name, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, slot) DO UPDATE SET revision = excluded.revision, saved_at = excluded.saved_at, uploaded_at = excluded.uploaded_at, device = excluded.device, version = excluded.version, day = excluded.day, year = excluded.year, population = excluded.population, checksum = excluded.checksum, bytes = excluded.bytes, kingdom_name = excluded.kingdom_name, body = excluded.body')
    .bind(user.id, slot, revision, m.savedAt, now, device, m.version, m.day, m.year, m.population, m.checksum, m.bytes, m.kingdomName, sealed).run();
  // Keep a bounded backup history.
  await env.DB.prepare('DELETE FROM save_revisions WHERE user_id = ? AND slot = ? AND revision <= ?').bind(user.id, slot, revision - 1 - KEEP_REVISIONS).run();
  const row = await env.DB.prepare('SELECT * FROM saves WHERE user_id = ? AND slot = ?').bind(user.id, slot).first();
  return json({ meta: metaOf(row) });
}

async function listRevisions(env, user, slot) {
  const { results } = await env.DB.prepare('SELECT * FROM save_revisions WHERE user_id = ? AND slot = ? ORDER BY revision DESC').bind(user.id, slot).all();
  return json({ revisions: results.map(metaOf) });
}

async function getRevision(env, user, slot, rev) {
  const row = await env.DB.prepare('SELECT * FROM save_revisions WHERE user_id = ? AND slot = ? AND revision = ?').bind(user.id, slot, rev).first();
  if (!row) return json({ error: 'no such revision' }, 404);
  return json({ meta: metaOf(row), envelope: await unseal(env, row.body) });
}

/** The request handler. `fetchImpl` is injectable for tests. */
export async function handle(req, env, fetchImpl = fetch) {
  const url = new URL(req.url);
  const headers = cors(env, req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  try {
    if (url.pathname === '/auth/github/start' && req.method === 'GET') return authStart(env, req, url);
    if (url.pathname === '/auth/github/callback' && req.method === 'GET') return authCallback(env, req, url, fetchImpl);
    if (!url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404, headers);
    const user = await userFrom(env, req);
    if (!user) return json({ error: 'sign in required' }, 401, headers);
    const write = req.method === 'PUT' || req.method === 'DELETE';
    if (await limited(env, user, write ? 'write' : 'read')) return json({ error: 'too many requests; try again in a minute' }, 429, headers);
    const respond = (r) => { for (const [k, v] of Object.entries(headers)) r.headers.set(k, v); return r; };
    if (url.pathname === '/api/me' && req.method === 'GET') return respond(json({ user: { id: user.id, login: user.login } }));
    if (url.pathname === '/api/session' && req.method === 'DELETE') { await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash).run(); return respond(json({ ok: true })); }
    if (url.pathname === '/api/saves' && req.method === 'GET') return respond(await listSaves(env, user));
    const m = url.pathname.match(/^\/api\/saves\/([^/]+)(?:\/revisions(?:\/(\d+))?)?$/);
    if (!m || !SLOT.test(m[1])) return respond(json({ error: 'not found' }, 404));
    const slot = m[1];
    if (url.pathname.endsWith('/revisions') && req.method === 'GET') return respond(await listRevisions(env, user, slot));
    if (m[2] && req.method === 'GET') return respond(await getRevision(env, user, slot, Number(m[2])));
    if (req.method === 'GET') return respond(await getSave(env, user, slot));
    if (req.method === 'PUT') return respond(await putSave(env, user, slot, req));
    return respond(json({ error: 'method not allowed' }, 405));
  } catch (e) {
    return json({ error: 'the cloud service had a problem', detail: String(e.message).slice(0, 120) }, 500, headers);
  }
}

export default {
  fetch: (req, env) => handle(req, env),
  // Daily clean-up of expired sessions, sign-in states and rate counters.
  scheduled: async (_event, env) => {
    const now = Date.now();
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
    await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now).run();
    await env.DB.prepare('DELETE FROM rate WHERE expires_at < ?').bind(now).run();
  },
};
