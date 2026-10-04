# Deploying Mosaic

Production is a single Vercel project serving two things from one origin:

```
/         -> mosaic-dashboard/dist        the dashboard (React + Vite)
/app/     -> mosaic-dashboard/dist/editor the editor (excalidraw-app build)
/api/*    -> api/*.ts                      Vercel serverless functions -> Neon
```

One origin is not a preference. The dashboard and the editor must share an origin, because the editor iframe reads board scenes from the same place the dashboard wrote them. Get the mount wrong and the editor 404s a hashed chunk and renders a blank canvas with no error message.

---

## 1. One-time setup

### 1.1 Neon

Create a project and note the region. Mosaic needs two connection strings, and using the wrong one is the single most common cause of a broken deploy:

| Which | Where it goes | Why |
| --- | --- | --- |
| **Pooled** | Vercel `DATABASE_URL` | Serverless functions open a burst of short-lived connections per deploy. The pooled endpoint multiplexes them over a small pool; the direct endpoint will exhaust its connection limit under load and start returning errors. |
| **Direct** | your local `.env.local`, for `yarn db:migrate` | Migrations are long-running statements and must not be queued behind application traffic. |

Neon shows both under **Connection**. Do not hand-edit the hostname to derive one from the other — current Neon endpoints carry a compute segment (`ep-<name>.c-7.<region>.aws.neon.tech`) that is easy to get wrong. Copy the exact string from the console.

### 1.2 Schema

```bash
yarn install
# .env.local must contain the DIRECT connection string:
#   DATABASE_URL=postgresql://...
yarn db:migrate
```

Safe to run repeatedly: `db/migrate.mjs` keeps a `_migrations` ledger and skips files already applied. Each file runs in its own transaction, so a failure leaves neither a half-applied schema nor a ledger row claiming success.

Verify:

```bash
yarn db:migrate      # -> "0 applied, N skipped"
```

### 1.3 Vercel

```bash
vercel link
vercel env add DATABASE_URL   # paste the POOLED string
vercel env add COOKIE_SECRET   # any long random string
```

Generate a cookie secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set both for **Production and Preview**. Without them on Preview, every pull request preview has a dashboard that loads and an API that 500s.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Pooled connection string. Secret. |
| `COOKIE_SECRET` | yes | HMAC key for the `mosaic_uid` cookie. The API **refuses to start** in production without it rather than fall back to a well-known key. Secret. |

Neither may be named with a `VITE_` prefix. Everything `VITE_`-prefixed is inlined into the public JavaScript bundle.

---

## 2. Deploying

```bash
vercel --prod
```

`vercel.json` drives everything:

- `buildCommand: yarn build:all` — builds the dashboard **and** the editor, then copies the editor into `dist/editor/` (`scripts/copy-editor-to-dist.mjs`).
- `outputDirectory: mosaic-dashboard/dist`
- rewrites `/app/*` -> `/editor/*` so the editor is reachable at the nginx-style path, and sends everything that is not `api/`, `app/`, `editor/`, `assets/` or `favicon` to `index.html` for client-side routing.

Deploys are atomic per commit, so a red build never replaces a working site.

### Verify the deploy

```bash
curl -s https://<your-domain>/api/health
# {"ok":true,"db":"ok","ts":"..."}

curl -sI https://<your-domain>/          # 200, the dashboard
curl -sI https://<your-domain>/app/      # 200, the editor
```

`/api/health` is unauthenticated on purpose and touches no user data — it is the one endpoint safe to poll from a monitor. It reports `503` with `{"ok":false}` when the process is up but the database is not, which distinguishes a database outage from a broken function.

---

## 3. Local development

Local development does **not** use the API. `VITE_API_URL` is absent from `.env.development` and `.env.e2e`, so `src/lib/storage/index.ts` selects IndexedDB and everything stays offline and hermetic.

To exercise the API locally instead:

```bash
vercel dev
```

> On Windows, `vercel dev` currently fails to bind its internally-assigned port (`listen EACCES: permission denied $PORT`, then "Failed to detect a server running on port NNNNN") for a project with no detected framework. The handlers can be exercised directly against Neon instead — compile `api/` to CommonJS and invoke the default export with a `Request`.

`.env.local` at the repo root holds the direct `DATABASE_URL` for migrations. It is git-ignored; confirm with `git check-ignore -v .env.local`. Vite also merges `.env.local` into client builds, which is why the database string must never be a `VITE_`-prefixed variable.

---

## 4. How the pieces fit

### Storage backend selection

`mosaic-dashboard/src/lib/storage/index.ts` picks a backend once, at startup, and logs it:

```
[storage] backend: api          # VITE_API_URL is set
[storage] backend: indexeddb    # VITE_API_URL is absent
```

Presence is the switch, and **an empty value counts as present**. Production sets `VITE_API_URL=` (empty) because the functions are same-origin, so requests are already root-relative. Treating empty as absent would silently put production back on IndexedDB, where every board lives in one visitor's browser.

Both backends implement one interface (`lib/storage/types.ts`); components import `{ storage }` and never know which is live. `lib/storage/indexeddb.ts` is the only module in the app that imports `dexie`.

### Current scope, honestly

Boards are server-backed. **Folders and the activity feed are not** — STEP 3 only specified `api/health.ts` and `api/boards/*`, so no endpoints exist for them and `lib/storage/api.ts` delegates them to IndexedDB rather than inventing calls that would 404. A visible consequence: the API writes its own `activity` rows when a board is created, renamed, favourited or trashed, but nothing reads them yet, so they accumulate server-side while the UI reads the local rows. Adding `api/folders/*` and `api/activity` would let the adapter drop that fallback.

### Identity

`mosaic_uid` is an **anonymous** id, not a login. A visitor gets one signed cookie on their first request and it scopes every row's `owner_uid`. There is no password, email or recovery. The cookie is signed, not encrypted — signing is what makes a client-supplied uid unforgeable, which is the property owner-scoping depends on, and there is nothing secret in a random UUID the server minted itself.

Ownership is enforced in SQL: every query filters `owner_uid`, and a row that exists but belongs to someone else returns `404`, not `403`, so the API never confirms that an id is real.

### Rate limiting

100 requests/minute per uid, in-memory and per instance. Serverless instances are ephemeral and there is no shared store, so this stops a runaway client on a warm instance; it is not a security control and does not survive a cold start. Anything that must hold across instances needs a real store.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/api/health` returns `{"ok":false,"db":"error"}` | `DATABASE_URL` missing, or the **direct** endpoint is rate-limiting | Check the variable exists on the environment you deployed to; switch to the pooled string |
| Functions 500 with `COOKIE_SECRET must be set in production` | Secret not set | `vercel env add COOKIE_SECRET` and redeploy |
| Dashboard loads but no boards, silently | `VITE_API_URL` missing from the dashboard build | It must be in `mosaic-dashboard/.env.production` — Vite reads that directory, not the repo root |
| Editor renders a blank canvas | Editor mount mismatch | `/app` must rewrite to `/editor`, and `VITE_EDITOR_BASE` must agree. See "Deployment layout" in the README |
| `yarn test:other` fails on `.vercel/*.json` | Vercel's local build cache is not ignored | `.vercel/` is in `.eslintignore`, which prettier uses via `--ignore-path` |

### Inspecting data

```bash
yarn db:migrate                       # ledger state, no connection string printed
node -e "..."                         # ad-hoc queries; use the MCP server or psql
```

The Neon MCP server (`https://mcp.neon.tech/mcp`, configured in `opencode.json`) gives schema and query access without a local client. The `neon` and `neon-postgres` skills in `.agents/skills/` cover connection handling and SQL safety.

---

## 6. Related

- [`../README.md`](../README.md) — architecture, tests, collaboration
- [`COLLAB.md`](COLLAB.md) — the excalidraw-room server
- [`../REBRAND.md`](../REBRAND.md) — naming rules and `yarn verify:brand`
