import { validateEnvelope } from './SaveValidation.js';
import { compareSaves } from './ConflictResolution.js';

// The browser side of the optional cloud backup. Nothing here is needed to
// play: if no service address is configured, or the network is down, every
// method fails softly and local saves are untouched. The session token from
// sign-in is kept in this browser's storage only; there are no secrets in
// the game's code.

const TOKEN_KEY = 'kingdom-of-nobodies-cloud-session';
const DEVICE_KEY = 'kingdom-of-nobodies-device';
export const SLOT = 'main';

/* global __CLOUD_URL__ */
export const configuredEndpoint = () => (typeof __CLOUD_URL__ === 'string' && __CLOUD_URL__) || null;

export class CloudSaveClient {
  constructor({ endpoint = configuredEndpoint(), storage = globalThis.localStorage, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.endpoint = endpoint ? endpoint.replace(/\/$/, '') : null;
    this.storage = storage;
    this.fetch = fetchImpl;
    this.lastError = null;
  }

  get configured() { return !!this.endpoint && !!this.fetch; }
  get token() { try { return this.storage?.getItem(TOKEN_KEY) ?? null; } catch { return null; } }
  get signedIn() { return !!this.token; }

  /** A friendly, stable label for this device (shown in conflict choices). */
  deviceLabel() {
    try {
      let label = this.storage.getItem(DEVICE_KEY);
      if (!label) {
        const ua = globalThis.navigator?.userAgent ?? '';
        const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Browser';
        label = `${kind} ${Math.random().toString(36).slice(2, 6)}`;
        this.storage.setItem(DEVICE_KEY, label);
      }
      return label;
    } catch { return 'this device'; }
  }

  signInUrl(returnTo) { return `${this.endpoint}/auth/github/start?return=${encodeURIComponent(returnTo)}`; }

  /** After the sign-in redirect, pick the session token out of the URL fragment and clean the address bar. */
  captureSession(location = globalThis.location, history = globalThis.history) {
    const m = /[#&]kon_session=([A-Za-z0-9_-]{20,})/.exec(location?.hash ?? '');
    if (!m) return false;
    try { this.storage.setItem(TOKEN_KEY, m[1]); } catch { return false; }
    history?.replaceState?.(null, '', location.pathname + location.search);
    return true;
  }

  async request(method, path, body) {
    if (!this.configured) throw new Error('Cloud backup is not set up for this game.');
    let res;
    try {
      res = await this.fetch(this.endpoint + path, { method, headers: { authorization: `Bearer ${this.token ?? ''}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { this.lastError = 'offline'; throw new Error('Could not reach the cloud (offline?).'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { try { this.storage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
    if (res.status === 409) return { conflict: true, meta: data.meta ?? null };
    if (!res.ok) { this.lastError = data.error ?? `HTTP ${res.status}`; throw new Error(data.error ?? `Cloud error ${res.status}`); }
    return data;
  }

  me() { return this.request('GET', '/api/me'); }
  list() { return this.request('GET', '/api/saves'); }
  async download(slot = SLOT) {
    const data = await this.request('GET', `/api/saves/${slot}`);
    const check = validateEnvelope(data.envelope);
    if (!check.ok) throw new Error(`The cloud copy is damaged: ${check.error}.`);
    return data;
  }
  upload(envelope, baseRevision, slot = SLOT) { return this.request('PUT', `/api/saves/${slot}`, { envelope, baseRevision, device: this.deviceLabel() }); }
  revisions(slot = SLOT) { return this.request('GET', `/api/saves/${slot}/revisions`); }
  revision(rev, slot = SLOT) { return this.request('GET', `/api/saves/${slot}/revisions/${rev}`); }
  async signOut() { try { await this.request('DELETE', '/api/session'); } catch { /* the local sign-out still happens */ } try { this.storage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

  /**
   * Work out what a sync should do, without changing anything.
   * `localText` is the local envelope; `sync` the world's record of the last exchange.
   */
  async plan(localText, sync) {
    const local = localText ? validateEnvelope(localText).meta ?? null : null;
    const { saves } = await this.list();
    const cloud = saves.find((x) => x.slot === SLOT) ?? null;
    return { ...compareSaves(local, cloud, sync), local, cloud };
  }
}
