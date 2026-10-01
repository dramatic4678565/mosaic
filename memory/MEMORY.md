# Project Memory — Mosaic

Curated long-term notes for anyone (human or agent) working in this repo. Deep
detail on the rebrand classification, the IndexedDB bridge and the e2e harness
lives in `REFERENCE.md` next to this file. Day-by-day work logs are in
`2026-10-01.md`.

**Read `MEMORY.md` before changing anything in `excalidraw-app/` or `packages/`.**

---

## What this project is

Mosaic is a fork of Excalidraw (MIT) plus a new dashboard app.

| App | Location | Job |
|---|---|---|
| Editor | `excalidraw-app/` + `packages/` | the whiteboard (upstream Excalidraw, rebranded) |
| Dashboard | `mosaic-dashboard/` | boards, folders, favourites, activity (new, Part 2) |
| Brand | `packages/mosaic-brand/` | single source of truth for user-visible strings |

Repos: `origin` = `dramatic4678565/mosaic`, `upstream` = `excalidraw/excalidraw`.

---

## Safety traps

### Do not rename internal identifiers — this is the single most important rule

Part 1 rebranded Excalidraw → Mosaic for **end users only**. `REBRAND.md` has the
full classification table. The short version:

*NEVER* change these, even though they say "Excalidraw":

- npm package names (`@excalidraw/excalidraw`, `@excalidraw/element`, …) and any
  import path that uses them — 491 files import them
- `localStorage` keys: `excalidraw`, `excalidraw-state`, `excalidraw-collab`,
  `excalidraw-theme`, `excalidraw-debug`, `excalidraw-library`
- IndexedDB stores: `excalidraw-library`, `excalidraw-ttd-chats`
- Build globals: `PLACEHOLDER:EXCALIDRAW_APP_FONTS`, `EXCALIDRAW_ASSET_PATH`
- `window.name = "_excalidraw"` (library-install tab reuse)
- the `.excalidraw` file extension and `application/vnd.excalidraw+json`
- `ExcalidrawError`, `ExcalidrawElement`, `ExcalidrawAPI`, `ExcalidrawLogo`,
  the `ExcalidrawLogo*` / `excalidraw-ui-*` CSS class names
- `LICENSE` files (MIT — the copyright notice belongs to upstream authors)
- the `Excalidraw+` product name and `plus.excalidraw.com` / `app.excalidraw.com`

**Verify after any bulk edit:**

```
node scripts/brand/verify-internals.js
```

It diffs the working tree against `upstream/master` for each protected category
and fails if any count drifted. It also asserts the LICENSE files are
byte-identical.

### The editor refuses to be embedded same-origin — but board mode needs it

`excalidraw-app/App.tsx` has a guard: if the editor is iframed by a page on its
own origin it renders "I'm not a pretzel!" and stops. The threat is a *user
authored scene* embedding the editor to attack a viewer (clickjacking / self-XSS).

Board mode (`#board=<id>`) is a deliberate, narrowly scoped exception — the
Mosaic dashboard is first-party code, not user content. **If you widen this
exception, you are re-opening a real vulnerability.** Keep it keyed on the board
hash.

### The dashboard and the editor must be same-origin

They share one IndexedDB (`mosaic-dashboard`). IndexedDB is partitioned per
origin, so if the dashboard and the editor are served from different origins the
editor looks in an empty database and *every board opens blank*.

- dev: `mosaic-dashboard/vite.config.mts` proxies `/editor` → the editor dev
  server, and the editor dev server is started with `EXCALIDRAW_BASE_PATH=/editor`
  so its module URLs carry the prefix. Both halves are required: dropping the
  base makes the editor emit `/App.tsx`, which the browser requests from the
  dashboard origin, where it 404s.
- prod: one nginx serves both.

### Dexie is opened at version 10, not 1

Dexie multiplies its `version(1)` declaration by 10 internally. Opening the same
database with a lower version throws `VersionError`. The editor side
(`excalidraw-app/boardMode.ts`) deliberately opens with **no version** so it
always attaches to whatever exists and can never force a re-creation.

### The dashboard must not be collected by the root vitest run

`vitest.config.mts` excludes `mosaic-dashboard/**`. Its tests need the `@/`
alias, `fake-indexeddb` loaded before Dexie, and its own `setupFiles`; running
them under the root config fails in ways that look like real breakage.
Run them with `yarn test:dashboard`.

---

## Commands

```
yarn test:typecheck        # tsc over packages + excalidraw-app + dashboard/src
yarn test:code             # eslint --max-warnings=0 (must be clean)
yarn test:other            # prettier --list-different (must be clean)
yarn test:app --watch=false   # editor unit tests (~2400, slow)
yarn test:dashboard        # dashboard unit tests (fast, 52)
yarn test:e2e              # Playwright smoke test (~13s, needs both dev servers)
yarn build                 # editor build
yarn build:dashboard       # dashboard build
yarn build:all             # both
```

Ports: editor dev server defaults to `VITE_APP_PORT` from `.env.development`
(**3001**). The e2e harness overrides to **3000** and puts the dashboard on
**3101** so they never collide.

---

## Known non-defects

- **Vitest is flaky on this machine (Windows).** A pristine `upstream/master`
  worktree with zero local changes fails a *different* set of tests on each run
  (observed: 9, 1, 1 failures across three runs). Every one of them passes in
  isolation. Do not chase these as regressions without first reproducing them on
  the untouched baseline.
- `jsx-ast-utils` prints "The prop value with an expression type of MetaProperty
  could not be resolved" during lint. Pre-existing upstream noise; exit code is
  still 0.
- Radix `"use client"` bundler warnings during the editor build are upstream.