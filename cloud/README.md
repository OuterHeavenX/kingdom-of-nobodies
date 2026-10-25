# Optional cloud backup (Cloudflare Worker + D1)

The game is **local-first**. It saves to IndexedDB (with a localStorage copy) and
never needs a network connection. This folder contains an *optional* backup
service so a player can sign in and continue the same kingdom on another device.

**Status: implemented and tested in-process, not deployed.** The Worker, the D1
schema, the browser client and the conflict handling are covered by
`tests/cloud-saves.test.js`, which runs the real Worker code against a real SQL
database (node:sqlite standing in for D1) and a stubbed GitHub sign-in. Until
someone deploys the Worker with the secrets below and sets
`VITE_CLOUD_SAVE_URL` for the GitHub Pages build, the Cloud panel in the game
says that cloud backup is not set up and everything else works as before.

## What it does

- Sign-in with GitHub OAuth. The OAuth client secret exists only as a Worker
  secret. The GitHub access token is used once, to read the account id, and is
  then discarded. The Worker issues its own random session token. Only a
  SHA-256 hash of that token is stored. The token reaches the browser in the
  URL fragment, which is never sent to a server.
- Upload, download, a list of slots, and a backup history of the last six
  revisions per slot, each of which can be restored.
- Optimistic concurrency. Every upload states the revision it replaces. If the
  cloud has moved on, the service answers `409 Conflict` and nothing is
  overwritten. The game then shows both copies (saved time, year, population,
  save version, device) and lets the player choose. Before replacing the
  device's own world, the game downloads it as a file.
- Server-side validation with the same rules the game uses
  (`src/persistence/SaveValidation.js`):
  - the format;
  - the checksum;
  - the supported versions;
  - the world structure;
  - non-negative integer accounts;
  - a 6 MB save limit (7 MB per request).
- Per-user rate limits: 20 writes and 120 reads a minute.
- CORS and sign-in redirects only for `ALLOWED_ORIGIN`.
- Optional AES-GCM encryption of every stored save. D1 is also encrypted at
  rest by Cloudflare.
- A daily cron removes expired sessions, sign-in states and rate counters.

## Deploying it

You need a Cloudflare account, `wrangler` (`npm i -g wrangler`), and a GitHub
account to own the OAuth app.

1. **Create the database**
   ```bash
   cd cloud/worker
   cp wrangler.toml.example wrangler.toml      # wrangler.toml is git-ignored
   wrangler d1 create kingdom-of-nobodies      # copy the database_id into wrangler.toml
   wrangler d1 execute kingdom-of-nobodies --remote --file=schema.sql
   ```
2. **Create a GitHub OAuth app.** Go to GitHub → Settings → Developer settings →
   OAuth Apps → New.
   - Homepage URL: `https://outerheavenx.github.io/kingdom-of-nobodies/`
   - Authorization callback URL:
     `https://<your-worker>.workers.dev/auth/github/callback`
3. **Store the secrets.** Never put them in the repository.
   ```bash
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   # optional: 32 random bytes, base64 — enables AES-GCM sealing of stored saves
   openssl rand -base64 32 | wrangler secret put SAVE_ENCRYPTION_KEY
   ```
   If you set `SAVE_ENCRYPTION_KEY`, keep a copy somewhere safe. Saves sealed
   with it cannot be read without it.
4. **Deploy:** `wrangler deploy`.
5. **Point the game at it.** In the repository's GitHub settings, add an Actions
   *variable* (not a secret, since the address is public) named
   `VITE_CLOUD_SAVE_URL` with the Worker's URL. The Pages workflow passes it to
   `vite build`. Rebuild and redeploy the site.
6. **Verify end to end** before telling players it works:
   - Sign in from the Cloud panel on one device, then upload.
   - Sign in on a second device, download, and check that the population,
     families, banks and Chronicle match.
   - Save on both devices and confirm that the conflict dialog appears.

## Running the tests

```bash
node --test tests/cloud-saves.test.js
```
