<div align="center">

# Mosaic

**A visual whiteboard, rebranded — plus a dashboard for your boards.**

[![CI](https://github.com/dramatic4678565/mosaic/actions/workflows/ci.yml/badge.svg)](https://github.com/dramatic4678565/mosaic/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`/dashboard` in this image is Mosaic's own dashboard. The editor lives at `/app/` (see [Layout](#deployment-layout)).

</div>

---

## What Mosaic is

Mosaic is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw) with two things added:

1. **A rebrand.** Every user-visible string, the logo, the favicons, the PWA icons, the OG image and all 58 locales now say _Mosaic_.
2. **A dashboard.** Boards, folders, favourites, an activity timeline and a trash — all stored locally in IndexedDB, all opening back into the editor.

Built as a monorepo:

| App | Location | What it is |
| --- | --- | --- |
| Editor | `excalidraw-app/`, `packages/` | the whiteboard (upstream Excalidraw, rebranded) |
| Dashboard | `mosaic-dashboard/` | boards, folders, favourites, activity |
| Brand | `packages/mosaic-brand/` | single source of truth for product strings |

### Screenshots

| Dashboard                        | Editor                     |
| -------------------------------- | -------------------------- |
| ![Dashboard](docs/dashboard.png) | ![Editor](docs/editor.png) |

Regenerate with `node scripts/screenshots.js` after `yarn build:all`.

---

## Quickstart

### Local development

Requires Node 20+ and Yarn 1.22.

```bash
yarn install
yarn start
```

That single command runs **both** apps via [`concurrently`](https://www.npmjs.com/package/concurrently); Ctrl+C stops both.

| URL                               | What                             |
| --------------------------------- | -------------------------------- |
| <http://localhost:3000/>          | editor (redirects to `/editor/`) |
| <http://localhost:3000/editor/>   | editor, its real dev mount       |
| <http://localhost:3002/>          | dashboard                        |
| <http://localhost:3002/dashboard> | dashboard                        |

Run them separately if you prefer: `yarn start:editor` and `yarn start:dashboard`.

**Why the dashboard is not also on :3000.** The two apps share one IndexedDB, and IndexedDB is partitioned per origin, so the editor iframe must be same-origin with the dashboard or every board opens blank. The dashboard therefore owns its origin (:3002) and proxies `/editor` back to the editor on it. Serving the dashboard from the editor's port instead would serve its HTML at `/dashboard` while its asset URLs stayed root-relative (`/assets/…`), which the editor answers with 404 — so it would need the dashboard's entire dev module graph proxied too. Ports and mount paths live in [`.env.development`](.env.development).

To check the dev wiring in a browser:

```bash
yarn --cwd mosaic-dashboard test:e2e:dev
```

That suite drives the running dev servers; `yarn e2e` is the separate built-output suite.

#### Storage: local by default

Development stores boards in IndexedDB, not in the database. `VITE_API_URL` is absent from `.env.development` and `.env.e2e`, so [`src/lib/storage/index.ts`](mosaic-dashboard/src/lib/storage/index.ts) selects the local adapter and logs which one it picked:

```
[storage] backend: indexeddb
```

Both adapters implement one interface, so components import `{ storage }` and never know which is live. Nothing is left out of the local adapter, which is what lets the whole existing test suite stay offline and hermetic.

To work against the real API instead, run `vercel dev` — see [`docs/DEPLOY.md`](docs/DEPLOY.md#3-local-development).

#### Migrations

The Postgres schema lives in [`db/migrations/`](db/migrations) and is applied with a ledger, so it is safe to re-run:

```bash
# .env.local needs the DIRECT Neon connection string (migrations, not pooled traffic)
yarn db:migrate
```

### Docker

```bash
docker compose up --build     # -> http://localhost:8080
```

One image serves both apps. Requires Docker Desktop.

### Tests

```bash
yarn test:typecheck   # tsc, all workspaces
yarn test:code        # eslint, --max-warnings=0
yarn test:other       # prettier
yarn test:app --watch=false   # editor unit tests (~2400)
yarn test:dashboard   # dashboard unit tests (52)
yarn e2e              # Playwright: builds both apps, then 24 specs
yarn test:e2e:dev     # Playwright against running dev servers (needs `yarn start`)
yarn test:e2e:collab  # collaboration latency, measured against the live room server
yarn verify:brand     # rebrand guard — did an internal identifier get renamed?
yarn db:migrate       # apply db/migrations to Neon (needs DATABASE_URL)
```

`yarn verify:brand` is the most important one after touching anything bulk. See [`REBRAND.md`](REBRAND.md).

The dashboard's unit tests bind to the IndexedDB adapter explicitly rather than to `{ storage }`, so they can never reach a real database even if `VITE_API_URL` happens to be set in your environment.

---

## Deployment layout

```
/         -> mosaic-dashboard     (the dashboard)
/app/     -> excalidraw-app       (the editor)
```

Deployed on **Vercel**, with boards stored in **Neon Postgres** and served by serverless functions under `/api`. See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full runbook.

Both must be **one origin**. Three settings have to agree, and each app and the server needs its own:

| Value                         | Set in                 | Default |
| ----------------------------- | ---------------------- | ------- |
| editor build base             | `EXCALIDRAW_BASE_PATH` | `/`     |
| iframe URL the dashboard uses | `VITE_EDITOR_BASE`     | `/app/` |
| where the editor is mounted   | nginx / `EDITOR_BASE`  | `/app/` |

Get one wrong and the editor 404s a hashed chunk and renders a blank canvas with no error. `scripts/build-e2e.mjs` sets them together for the e2e build.

Requires a secure context (HTTPS, or `localhost`) — IndexedDB, service workers and the editor's workers all need one.

---

## Live collaboration

Real-time sync runs on a self-hosted [excalidraw-room](https://github.com/excalidraw/excalidraw-room) server at **<https://excalidraw-room-5yet.onrender.com>** (Render free tier), pointed at by `VITE_APP_WS_SERVER_URL`.

Run one locally (optional, behind a compose profile):

```bash
docker compose --profile collab up --build collab   # -> localhost:8081
```

Two separate things used to make a remote edit take ~60 s, and both were fixed: the client pointed at upstream's rate-limited public collab server, **and** `SYNC_FULL_SCENE_INTERVAL_MS` throttled outbound scene updates to once per **20 s**. See [`docs/COLLAB.md`](docs/COLLAB.md) for hosting options and how to debug latency if it returns.

---

## Upstream sync

Mosaic tracks `excalidraw/excalidraw`. A GitHub Action merges upstream daily and opens a **pull request** — it never auto-merges.

```bash
yarn sync-upstream              # Linux / macOS
.\scripts\sync-upstream.ps1     # Windows PowerShell
yarn sync-upstream:dry          # preview which files would conflict
```

On conflict: **branded files keep the Mosaic version, everything else takes upstream.** Branded files win because our product identity lives in a handful of files; upstream wins elsewhere so security and bug fixes land as-is.

Full policy: [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md). Machine-readable version that both the shell and PowerShell scripts read: `scripts/sync-upstream.policy.json`.

---

## Layout

```
excalidraw-app/     editor app + board mode (bridge to the dashboard)
packages/           excalidraw/* packages + mosaic-brand
mosaic-dashboard/   dashboard app (boards, folders, activity, trash)
  src/lib/storage/  StorageAdapter interface + indexeddb/api backends
docker/             nginx config
api/                Vercel serverless functions (health, boards)
db/                 Postgres schema + migrator
scripts/
  brand/            rebrand tooling + verification
  sync-upstream.*   upstream merge (bash + PowerShell)
  build-e2e.mjs     cross-platform e2e build with matching base paths
  copy-editor-to-dist.mjs  copies the editor build into the dashboard's dist
  screenshots.js    regenerates README images
memory/             project notes — read MEMORY.md before changing anything
docs/               DEPLOY.md, COLLAB.md, README screenshots
```

`memory/MEMORY.md` records the traps: what must **never** be renamed, the Windows-specific pitfalls, and which test failures are pre-existing noise.

---

## Upstream-only workflows

Four inherited GitHub Actions are disabled because they target the upstream project's accounts and secrets (`*.yml.disabled`). Reasons are in [`.github/workflows/README.md`](.github/workflows/README.md).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

- do not rename internal identifiers — `yarn verify:brand` will fail
- `yarn test:code` runs with `--max-warnings=0`; warnings are errors
- keep every UI string going through `t()` in the dashboard, and through the locale files in the editor

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) — Mosaic is a fork of Excalidraw, which is MIT licensed. See [NOTICE](NOTICE) for attribution. The upstream copyright notice is preserved verbatim and must not be altered.
