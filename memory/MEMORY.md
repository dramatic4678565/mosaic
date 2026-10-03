# Project Memory — Mosaic

Curated long-term notes for anyone (human or agent) working in this repo. Deep detail on the rebrand classification, the IndexedDB bridge and the e2e harness lives in `REFERENCE.md` next to this file. Day-by-day work logs are in `2026-10-01.md`.

**Read `MEMORY.md` before changing anything in `excalidraw-app/` or `packages/`.**

---

## Deployment layout (get this wrong and the iframe is blank)

```
/        -> mosaic-dashboard      (docker/nginx.conf serves the dashboard at root)
/app/    -> excalidraw-app        (the editor)
```

Both apps must be served from **one origin** — they share one IndexedDB.

Three values have to agree, and they live in three different places because each app and the server needs its own:

| Value | Set where | Default |
| --- | --- | --- |
| editor base used by the editor build | `EXCALIDRAW_BASE_PATH` | `/` |
| editor URL the dashboard points its iframe at | `VITE_EDITOR_BASE` | `/app/` |
| where the editor is mounted | `EDITOR_BASE` (preview server / nginx) | `/app/` |

Get one wrong and the editor 404s a hashed chunk and renders a blank canvas with **no error**. `scripts/build-e2e.mjs` sets them together for the e2e build.

`scripts/sync-upstream.policy.json` is the single source of truth for sync conflict resolution; `scripts/sync-upstream.sh` and `.ps1` both read it. Do not duplicate those patterns into a script.

### Upstream sync needs a repository setting, not just workflow permissions

If the sync pushes its branch and then fails at `gh pr create` with `GraphQL: Resource not accessible by integration (createPullRequest)`, the workflow's `permissions:` block is fine and something else is wrong.

GitHub has **two independent settings**. The workflow declares `pull-requests: write`, but that alone does not let `GITHUB_TOKEN` open a PR. The repository must also have

> Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests"

enabled. In the API that is `can_approve_pull_request_reviews`:

```bash
gh api --method PUT repos/dramatic4678565/mosaic/actions/permissions/workflow \
  -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true
```

This cost three CI cycles to diagnose, because the workflow file looks correct and the error names permissions generically. It is currently enabled.

---

## What this project is

Mosaic is a fork of Excalidraw (MIT) plus a new dashboard app.

| App | Location | Job |
| --- | --- | --- |
| Editor | `excalidraw-app/` + `packages/` | the whiteboard (upstream Excalidraw, rebranded) |
| Dashboard | `mosaic-dashboard/` | boards, folders, favourites, activity (new, Part 2) |
| Brand | `packages/mosaic-brand/` | single source of truth for user-visible strings |

Repos: `origin` = `dramatic4678565/mosaic`, `upstream` = `excalidraw/excalidraw`.

---

## Safety traps

### Do not rename internal identifiers — this is the single most important rule

Part 1 rebranded Excalidraw → Mosaic for **end users only**. `REBRAND.md` has the full classification table. The short version:

_NEVER_ change these, even though they say "Excalidraw":

- npm package names (`@excalidraw/excalidraw`, `@excalidraw/element`, …) and any import path that uses them — 491 files import them
- `localStorage` keys: `excalidraw`, `excalidraw-state`, `excalidraw-collab`, `excalidraw-theme`, `excalidraw-debug`, `excalidraw-library`
- IndexedDB stores: `excalidraw-library`, `excalidraw-ttd-chats`
- Build globals: `PLACEHOLDER:EXCALIDRAW_APP_FONTS`, `EXCALIDRAW_ASSET_PATH`
- `window.name = "_excalidraw"` (library-install tab reuse)
- the `.excalidraw` file extension and `application/vnd.excalidraw+json`
- `ExcalidrawError`, `ExcalidrawElement`, `ExcalidrawAPI`, `ExcalidrawLogo`, the `ExcalidrawLogo*` / `excalidraw-ui-*` CSS class names
- `LICENSE` files (MIT — the copyright notice belongs to upstream authors)
- the `Excalidraw+` product name and `plus.excalidraw.com` / `app.excalidraw.com`

**Verify after any bulk edit:**

```
node scripts/brand/verify-internals.js
```

It diffs the working tree against `upstream/master` for each protected category and fails if any count drifted. It also asserts the LICENSE files are byte-identical.

### The editor refuses to be embedded same-origin — but board mode needs it

`excalidraw-app/App.tsx` has a guard: if the editor is iframed by a page on its own origin it renders "I'm not a pretzel!" and stops. The threat is a _user authored scene_ embedding the editor to attack a viewer (clickjacking / self-XSS).

Board mode (`#board=<id>`) is a deliberate, narrowly scoped exception — the Mosaic dashboard is first-party code, not user content. **If you widen this exception, you are re-opening a real vulnerability.** Keep it keyed on the board hash.

### The dashboard and the editor must be same-origin

They share one IndexedDB (`mosaic-dashboard`). IndexedDB is partitioned per origin, so if the dashboard and the editor are served from different origins the editor looks in an empty database and _every board opens blank_.

- dev: `mosaic-dashboard/vite.config.mts` proxies `/editor` → the editor dev server, and the editor dev server is started with `EXCALIDRAW_BASE_PATH=/editor` so its module URLs carry the prefix. Both halves are required: dropping the base makes the editor emit `/App.tsx`, which the browser requests from the dashboard origin, where it 404s.
- prod: one nginx serves both.

### Dexie is opened at version 10, not 1

Dexie multiplies its `version(1)` declaration by 10 internally. Opening the same database with a lower version throws `VersionError`. The editor side (`excalidraw-app/boardMode.ts`) deliberately opens with **no version** so it always attaches to whatever exists and can never force a re-creation.

### The dashboard must not be collected by the root vitest run

`vitest.config.mts` excludes `mosaic-dashboard/**`. Its tests need the `@/` alias, `fake-indexeddb` loaded before Dexie, and its own `setupFiles`; running them under the root config fails in ways that look like real breakage. Run them with `yarn test:dashboard`.

---

## Commands

```
yarn test:typecheck        # tsc over packages + excalidraw-app + dashboard/src
yarn test:code             # eslint --max-warnings=0 (must be clean)
yarn test:other            # prettier --list-different (must be clean)
yarn test:app --watch=false   # editor unit tests (~2400, slow)
yarn test:dashboard        # dashboard unit tests (fast, 52)
yarn e2e                   # Playwright (builds both apps, then 25 specs, ~1.5 min)
yarn build                 # editor build
yarn build:dashboard       # dashboard build
yarn build:all             # both
yarn build:e2e             # both, with e2e base paths
yarn verify:brand          # rebrand guard: no internal identifier was renamed
yarn sync-upstream         # Linux/macOS (bash)
.\scripts\sync-upstream.ps1   # Windows PowerShell
yarn docker:up             # http://localhost:8080
```

Ports: editor dev server defaults to `VITE_APP_PORT` from `.env.development` (**3001**). The e2e harness serves pre-built bundles on **3101** so it never collides with a dev server.

### Windows-only traps in this repo

- `path.normalize("/editor/")` returns `\editor\` on Windows. Never normalize a URL pathname — it silently breaks every `startsWith` check. This cost hours in `mosaic-dashboard/e2e/preview-server.mjs`.
- **Never use inline `FOO=bar cmd` in an npm script.** It is POSIX-only and silently does the wrong thing in cmd.exe. Put dev-time values in `.env.<mode>` files and read them with Vite's `loadEnv` — that is how the dev ports and mount paths are now configured. (A Node wrapper, `scripts/run-bash.mjs` / `scripts/build-e2e.mjs`, is the equivalent for shell scripts.)
- `@` inside a PowerShell string adjacent to a variable is parsed as a splat / hashtable key. Use `'... {0}@{1}' -f $a, $b` instead of `"... $a@$b"`.

### Local dev layout (one command)

`yarn start` runs both apps via `concurrently`; Ctrl+C stops both.

| URL                               | App                       |
| --------------------------------- | ------------------------- |
| `http://localhost:3000/`          | editor (302 → `/editor/`) |
| `http://localhost:3000/editor/`   | editor                    |
| `http://localhost:3002/`          | dashboard                 |
| `http://localhost:3002/dashboard` | dashboard                 |

**The dashboard owns its origin and proxies `/editor` back to the editor on it.** It must be same-origin with the editor or board mode breaks (IndexedDB is partitioned per origin). The editor must _not_ proxy `/dashboard`: the dashboard's route table (`/dashboard`, `/dashboard/trash`, … `/board/:id`) assumes it is mounted at the root of its origin, and its asset URLs are root-absolute, so serving it under a prefix on another port 404s every chunk. Full reasoning is in the comment above `server:` in `excalidraw-app/vite.config.mts`.

Two traps that cost real time here:

- The router basename is **`MOSAIC_DASHBOARD_BASENAME`, default `""`** and is deliberately _not_ derived from Vite's `base`. Deriving it turns `/dashboard/trash` into `/dashboard/dashboard/trash` whenever the app is served from a sub-path. Production sets `base=/`, which reduced to `""` anyway, so production behaviour is unchanged.
- The dev-server root redirect must be a **real 302**, not a `req.url` rewrite. A rewrite makes Vite emit a relative `index.tsx`, which the browser resolves against `/` as `/index.tsx` → 404, so the editor renders only its static `<h1>` and nothing else, with no error in any log. It also has to be `unshift`ed onto the middleware stack — `use()` appends, and Vite's own index.html handler answers `/` first.

Verify the dev wiring with `yarn test:e2e:dev` (needs `yarn start` running). It is deliberately separate from `yarn e2e`, which builds and serves its own bundles and therefore cannot see dev-server behaviour at all.

### Upstream menu items are hidden, not deleted

`FEATURE_FLAGS` in `packages/mosaic-brand` gates the five inherited items (Excalidraw+, GitHub, Follow us, Discord, Sign up) in `excalidraw-app/components/AppMainMenu.tsx`. All default `false`.

**Do not "clean up" the wrapped JSX.** It is upstream code that still ships, and the flags exist so it can be restored with a one-line change instead of being hand-reconstructed from upstream. `yarn --cwd mosaic-dashboard test:e2e:dev` covers the menu; it runs in both the dev and built-output suites.

Three upstream links remain elsewhere in the editor — the welcome-screen guest CTA, the guest banner, and the encryption blog link in `labels.link`. They are pinned explicitly in `e2e/menu-hide.spec.ts` rather than ignored, so a new leak fails the suite. Removing those three is an open decision.

### PowerShell syntax check without running anything

```powershell
$errs = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path "scripts/sync-upstream.ps1").Path, [ref]$null, [ref]$errs) | Out-Null
if ($errs) { $errs } else { "ok" }
```

For the bash script, use Git Bash (`C:\Program Files\Git\bin\bash.exe -n`) — `bash` on PATH may be the WSL stub and refuse to run.

---

## Known non-defects

- **Vitest is flaky on this machine (Windows).** A pristine `upstream/master` worktree with zero local changes fails a _different_ set of tests on each run (observed: 9, 1, 1 failures across three runs). Every one of them passes in isolation. Do not chase these as regressions without first reproducing them on the untouched baseline.
- `jsx-ast-utils` prints "The prop value with an expression type of MetaProperty could not be resolved" during lint. Pre-existing upstream noise; exit code is still 0.
- Radix `"use client"` bundler warnings during the editor build are upstream.
