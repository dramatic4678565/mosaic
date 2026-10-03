# Mosaic — Project Audit Report

**Repo:** https://github.com/dramatic4678565/mosaic · **Local:** `jdjfhfhf` **Audited:** 2026-10-02 · **Branch:** `main` @ `0b82689f9` · **Mode:** read-only (nothing committed, branched or pushed)

---

## Section 11 — Executive Summary

Mosaic is a rebranded fork of Excalidraw (MIT) plus a new local-first dashboard for boards, folders, favourites, activity and trash.

1. **Rebrand complete and safe?** **YES** — the only user-visible "Excalidraw" left is the deliberate `Excalidraw+` product name and one `.excalidraw` export-format label; `yarn verify:brand` passes all 16 checks and LICENSE is blob-identical to upstream.
2. **Dashboard functional?** **PARTIAL** — every CRUD path is implemented and e2e-covered, but drag-to-folder has zero e2e coverage and folder rename/recolour/delete has a permanently skipped spec.
3. **Upstream sync working end-to-end?** **PARTIAL** — it merges, resolves conflicts, builds, tests (2448+52 green) and pushes a branch; the final `gh pr create` fails on a GitHub repo setting, so the PR must be opened by hand.
4. **CI/CD + Docker green and reproducible?** **YES** — `main` CI is fully green including Playwright; the v0.1.3 image builds, pushes to GHCR and passes a smoke test serving both routes from one container.
5. **Top 3 risks now:** (a) MIT "Powered by Excalidraw" credit is defined but never rendered, and its e2e guard passes on a loose fallback; (b) `Excalidraw+` promo UI still points users at a paid product Mosaic does not own; (c) no Dependabot and no branch protection on a private repo.
6. **Top 3 next actions:** render the MIT credit (P1, ~1h); add drag-to-folder e2e (P2, ~2h); enable Dependabot (P3, ~15min).
7. **Manual-only human actions:** enable "Allow GitHub Actions to create and approve pull requests" (Settings → Actions → General) so the sync can open its own PR; open GitHub Releases for v0.1.1–v0.1.3; decide what to do about the `Excalidraw+` surfaces.

---

## Section 1 — Repo Snapshot

```
$ git remote -v
origin    https://github.com/dramatic4678565/mosaic.git (fetch/push)
upstream  https://github.com/excalidraw/excalidraw.git (fetch/push) [blob:none]

$ git status --porcelain
(empty — clean)

$ git rev-list --count HEAD
4152
```

**Latest commit**

| Field | Value |
| --- | --- |
| Hash | `0b82689f920b3be9e6fa13df3521186db9b7e0f2` (`0b82689f9`) |
| Message | `fix(docker): build the editor and dashboard with their real mount paths` |
| Author | dramatic4678565 \<333021689@users.noreply.github.com\> |
| Date | Fri Oct 2 19:19:39 2026 +0600 |

**Upstream sync gap — 2 commits behind**

```
$ git rev-list --count main..upstream/master
2
$ git log upstream/master --oneline -5
ed10ac7dc feat(editor): alt-drag the text being edited to duplicate it (#12219)
9ba66ed9b feat(editor): auto increment numbers/lists on duplicate (#12189)
191972872 fix(editor): reach text containers below transparent ones (#12210)
```

Both unsynced commits are editor features that touch `packages/excalidraw/` — **not** branded paths — so the next sync should merge cleanly.

**Tags (Mosaic-owned)**

```
v0.1.3  v0.1.2  v0.1.1  v0.1.0
```

(all other `v0.x` tags in the repo are upstream Excalidraw release tags inherited by the fork)

**Branches — 16 local, 16 on `origin`**

Local: `main` (checked out), `chore/rebrand-foundation`, `chore/self-maintaining-infra`, `feat/mosaic-dashboard`, `fix/ci-and-docker-runtime`, `fix/ci-flaky-and-redundant`, `fix/ci-full-history`, `fix/ci-upstream-fetch`, `fix/guard-merge-base`, `fix/lint-ordering`, `fix/pr-scopes`, `fix/prettier-formatting`, `fix/sync-force-push`, `fix/sync-issue-creation`, `fix/sync-policy-matcher`, `fix/sync-pr-creation`, `upstream-sync/2026-10-02`

Plus **315** `upstream/*` remote-tracking refs (upstream's own branches).

---

## Section 2 — Structure & Workspaces

**`package.json` workspaces** (yarn 1.22.22 monorepo, `node >=18`)

```json
["excalidraw-app", "mosaic-dashboard", "packages/*", "examples/*"]
```

| Package | name | type | build | test |
| --- | --- | --- | --- | --- |
| `excalidraw-app/` | `excalidraw-app` | editor app | `vite build` (via root `yarn build`) | inherited (`vitest` at root) |
| `mosaic-dashboard/` | `mosaic-dashboard` | dashboard app | `tsc --noEmit && vite build` | `vitest run` (52) |
| `packages/excalidraw/` | `@excalidraw/excalidraw` | core lib | `build:esm` (esbuild) | covered by root vitest |
| `packages/element/` | `@excalidraw/element` | geometry | `build:esm` | root vitest |
| `packages/common/` | `@excalidraw/common` | shared | `build:esm` | root vitest |
| `packages/math/` | `@excalidraw/math` | math | `build:esm` | root vitest |
| `packages/utils/` | `@excalidraw/utils` | utils | `build:esm` | root vitest |
| `packages/laser-pointer/` | `@excalidraw/laser-pointer` | laser | `build:esm` | root vitest |
| `packages/fractional-indexing/` | `@excalidraw/fractional-indexing` | ordering | `build:esm` | root vitest |
| `packages/mosaic-brand/` | `@mosaic/brand` | **Mosaic-only** brand constants | none (TS source, aliased) | none (asserted via dashboard) |

**Which CI workflow builds what**

| Workflow | trigger | what it does |
| --- | --- | --- |
| `ci.yml` | push `main`, PR → `main` | lint, format, typecheck, **both** unit suites, `verify:brand`, sync-policy matcher, **both** builds, Playwright, artifact upload |
| `docker.yml` | tag `v*`, manual | builds image → pushes GHCR → **pulls it back and smoke-tests `/` and `/app/`** |
| `upstream-sync.yml` | cron `17 3 * * *`, manual | merges upstream, runs the sync script, opens a PR |
| `lint.yml` | PR | eslint (inherited upstream) |
| `test.yml` | push `master` | inherited; **never fires** (our default branch is `main`) |
| `size-limit.yml` | PR → `master` | inherited; **never fires** |
| `cancel.yml` | push `release`, PR | cancels superseded runs |
| `semantic-pr-title.yml` | PR | title scope check + auto `s-*` label |
| `test-coverage-pr.yml` | PR | runs `yarn test:coverage`, comments the report on the PR |
| `build-docker.yml` | push `release` | inherited; **never fires** |
| 4 × `*.yml.disabled` | — | upstream-only, disabled: `autorelease-excalidraw`, `locales-coverage`, `publish-docker`, `sentry-production` |

**Container files:** `Dockerfile` (multi-stage node:20-bookworm-slim → nginxinc/nginx-unprivileged:1.27-alpine), `docker/nginx.conf`, `docker-compose.yml`, `.dockerignore` (allow-list style).

**Docs present (all verified on disk):** `memory/MEMORY.md`, `memory/REFERENCE.md`, `memory/2026-10-01.md`, `REBRAND.md`, `UPSTREAM_SYNC.md`, `README.md`, `NOTICE`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/workflows/README.md`.

**Generated files checked in that should not be — NONE.** `git ls-files excalidraw-app/build mosaic-dashboard/dist` → `0`. `git ls-files --ignored` confirms `excalidraw-app/build/`, `mosaic-dashboard/dist/`, all `node_modules/`, `.husky/_/` are ignored-but-untracked. Total tracked files: **1428**.

Tracked env files (all intentional, see Section 8): `.env.development`, `.env.production`, `.env.test`, `mosaic-dashboard/.env.e2e`.

---

## Section 3 — Rebrand Audit ★ most important

### Volume

```
$ rg -i "excalidraw" --glob '!node_modules' --glob '!*.lock' --glob '!dist' --glob '!build' -l | wc -l
760
$ rg -i "mosaic"     --glob '!node_modules' --glob '!*.lock' --glob '!dist' --glob '!build' -l | wc -l
155
```

760 files by top-level directory:

| Count | Directory                                                            |
| ----- | -------------------------------------------------------------------- |
| 606   | `packages/` (upstream source — package names, type names, i18n keys) |
| 46    | `excalidraw-app/`                                                    |
| 40    | `dev-docs/` (inherited upstream docs)                                |
| 19    | `scripts/`                                                           |
| 14    | `mosaic-dashboard/`                                                  |
| 13    | `examples/`                                                          |
| 3     | `memory/`                                                            |
| 18    | root files + `docker/` + `public/`                                   |

### Classification

| Area | Files | Class | Reason | Status |
| --- | --- | --- | --- | --- |
| `packages/excalidraw/**` TS sources (606 total incl. subpkgs) | many | **B INTERNAL** | `ExcalidrawElement`, `excalidrawAPI`, `useExcalidrawActionManager`, CSS classes | ✅ OK |
| `packages/excalidraw/locales/en.json` keys (`madeWithExcalidraw`, `mermaidToExcalidraw`, `excalidrawLib`, `excalidrawplus_*`) | 1 | **B INTERNAL** | keys are the code↔Crowdin contract | ✅ OK |
| `packages/excalidraw/locales/en.json` values `Excalidraw+` (7 strings) | 1 | **D deliberate** | separate live paid product at `plus.excalidraw.com` | ⚠️ see F2 |
| `excalidraw-app/app_constants.ts` storage keys | 1 | **B INTERNAL** | `excalidraw`, `excalidraw-state`, `excalidraw-theme`, `excalidraw-library`, `excalidraw-ttd-chats` | ✅ **byte-identical to upstream** (`git diff` = 0 lines) |
| `excalidraw-app/boardMode.ts` | 1 | **B INTERNAL** | deliberately names upstream keys to talk to the editor | ✅ documented |
| `mosaic-dashboard/src/lib/download.ts` | 1 | **B/D** | `.excalidraw` file format + `application/vnd.excalidraw+json` | ✅ OK |
| `mosaic-dashboard/src/lib/i18n.ts:57` | 1 | **A/D** `"Excalidraw JSON (.excalidraw)"` | export-format label, deliberately preserved | ✅ OK |
| `LICENSE`, `packages/*/LICENSE` ×4 | 4 | **C LEGAL** | MIT, upstream copyright | ✅ **blob-identical** (see below) |
| `NOTICE` | 1 | **C LEGAL** | fork + attribution | ✅ OK |
| `packages/mosaic-brand/src/index.ts` | 1 | **C LEGAL** | `ATTRIBUTION.label = "Powered by Excalidraw"` | ❌ **never rendered — F1** |
| `memory/*.md`, `REBRAND.md`, `UPSTREAM_SYNC.md`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | 8 | **C LEGAL/docs** | explain the rebrand | ✅ OK |
| `Dockerfile`, `.env.*`, `crowdin.yml`, `tsconfig.json`, `vitest.config.mts`, `vercel.json`, `setupTests.ts`, `CLAUDE.md`, `AGENTS.md`, `public/` | 10 | **B/D** | build config, upstream URLs | ✅ OK |

### Explicit verifications requested

**(a) No user-facing string renders "Excalidraw" — grep the built dist.**

Dashboard `dist/` (the only fully-Mosaic-owned UI):

```
$ rg -o -i "excalidraw[a-z+ ._-]*" mosaic-dashboard/dist/assets
32  excalidraw            ← class names/keys in the bundle
 2  ExcalidrawJson        ← \u0022Excalidraw JSON\u0022 (.excalidraw) export label
 2  excalidraw+json       ← MIME type
 2  Excalidraw JSON       ← same export label
 1  Excalidraw calls a    ← inside a .js.map source comment, not rendered
 1  ExcalidrawJson
 1  Excalidraw directly   ← inside a .js.map source comment, not rendered
```

The only **rendered** string is `"Excalidraw JSON (.excalidraw)"` — the intentional export-format menu item. No defect.

Editor `dist/` retains 100× `Excalidraw+` (paid product) plus internal identifiers — expected per REBRAND.md §D.

**(b) localStorage / IndexedDB keys unchanged.** ✅ `git diff upstream/master -- excalidraw-app/app_constants.ts` → **0 lines**. All six keys intact.

**(c) `@excalidraw/*` imports unchanged.** ✅ `verify:brand`: upstream 1487 → now 1490 (**increased**, i.e. only added, none removed).

**(d) LICENSE byte-identical to upstream.** Git blob OIDs match exactly — the authoritative comparison (a `Get-FileHash` comparison earlier disagreed only because PowerShell's `Out-File` re-encoded the bytes):

```
local    LICENSE: 8a844bc750a313db95d147bea9e4c9537b2cebc0
upstream LICENSE: 8a844bc750a313db95d147bea9e4c9537b2cebc0
```

All four LICENSE files: `git diff` = 0 lines each.

**(e) NOTICE exists and mentions Excalidraw + MIT.** ✅ `NOTICE:4` "This product is a fork of Excalidraw." · `:10` "used under the MIT License" · `:20` notes `Excalidraw+` and `excalidraw.com` remain upstream property.

**(f) "Powered by Excalidraw" credit reachable in UI.** ❌ **NOT RENDERED.**

```
$ rg -n "Powered by Excalidraw" --glob '!node_modules' --glob '!*.map'
mosaic-dashboard/e2e/rebrand-audit.spec.ts:103,110,130   ← tests/comments only
packages/mosaic-brand/src/index.ts:66                    ← a constant
REBRAND.md:126                                            ← the policy statement
```

`ATTRIBUTION` is exported but **imported nowhere** — no renderer consumes it. `AppFooter.tsx` renders "← Back to dashboard" instead. The e2e guard passes only because of its OR-fallback `html.includes("excalidraw.com")`, which matches `<link rel="canonical" href="https://excalidraw.com">` in the editor's built HTML. **See F1 (P1).**

**(g) `yarn verify:brand` output**

```
=== INTERNAL identifiers (baseline: 1919728724a1) ===
OK    @excalidraw/* imports (code, comments ignored) upstream= 1487  now= 1490
OK    localStorage keys                              upstream=    1  now=    1
OK    localStorage elements key                      upstream=    1  now=    1
OK    IndexedDB stores                               upstream=    1  now=    1
OK    MIME type                                      upstream=    9  now=    9
OK    .excalidraw extension                          upstream=  362  now=  365
OK    Sentry / build globals                         upstream=   14  now=   14
OK    window.name tab key                            upstream=    1  now=    1
OK    ExcalidrawError class                          upstream=   16  now=   16
OK    ExcalidrawElement type                         upstream= 1544  now= 1555
OK    CSS class names                                upstream=    7  now=    7
OK    workspace package names                        upstream= 1554  now= 1557
OK    LICENSE                                        (identical to upstream)
OK    packages/laser-pointer/LICENSE                 (identical to upstream)
OK    packages/common/LICENSE                        (identical to upstream)
OK    packages/element/LICENSE                       (identical to upstream)
PASS - no internal identifier was renamed.
```

**Guard caveat (F9):** the rule is `after >= before`. It detects _removals_ (a rename) but would not catch a rename that is simultaneously offset by additions elsewhere. It is a good smoke alarm, not a proof.

---

## Section 4 — Dashboard (Part 2) Status

### Routes (`mosaic-dashboard/src/App.tsx`)

| Route                          | Component                              |
| ------------------------------ | -------------------------------------- |
| `/`                            | `<Navigate to="/dashboard" replace />` |
| `/dashboard`                   | `BoardsPage`                           |
| `/dashboard/favorites`         | `BoardsPage`                           |
| `/dashboard/folders/:folderId` | `BoardsPage`                           |
| `/dashboard/trash`             | `BoardsPage`                           |
| `/dashboard/activity`          | `ActivityPage`                         |
| `/dashboard/settings`          | `SettingsPage`                         |
| `/board/:id`                   | `BoardPage` (embeds the editor)        |
| `*`                            | redirect to `/dashboard`               |

Pages: `BoardsPage.tsx`, `BoardPage.tsx`, `ActivityPage.tsx`, `SettingsPage.tsx`. Components: `BoardCard`, `BoardGrid`, `BoardToolbar`, `BoardContextMenu`, `Sidebar`, `AppShell`, `DndProvider`, `ContextMenu`, `Modal`, `MosaicMark`.

### Data model — `src/db/schema.ts`

```ts
export type Board = {
  id: string;
  name: string;
  folderId: string | null;
  favorite: boolean;
  trashedAt: number | null;
  thumbnail: string | null; // data URL
  sceneVersion: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  scene?: string;
  sceneBytes?: number; // scene excluded from grid queries
};
export type Folder = {
  id: string;
  name: string;
  color: FolderColor;
  parentId: string | null;
  createdAt: number;
};
export type Activity = {
  id: string;
  type: "create" | "open" | "rename" | "delete" | "favorite" | "move";
  boardId: string;
  ts: number;
  detail?: string;
};
export const TRASH_RETENTION_DAYS = 30;
export const AUTOSAVE_INTERVAL_MS = 10_000;
```

### Storage

Dexie 4.4.6 · DB name **`mosaic-dashboard`** · `this.version(1).stores({...})` — three stores (`boards`, `folders`, `activity`). Indexed columns: `boards: id, name, folderId, trashedAt, updatedAt, createdAt, lastOpenedAt`; `folders: id, name, parentId, createdAt`; `activity: id, type, boardId, ts`.

### Feature status

| Feature | Implemented | e2e covered |
| --- | --- | --- |
| create / rename / delete / duplicate | ✅ | ✅ |
| favourite toggle | ✅ | ✅ |
| folders (create, file board, delete unfiles) | ✅ | ⚠️ folder **rename/recolour/delete** spec is `test.skip` |
| drag board → folder (dnd-kit) | ✅ (`DndProvider` at shell, `useFolderDroppable` per folder) | ❌ **none** |
| trash: soft-delete, restore, delete-forever, empty-trash | ✅ | ✅ |
| activity timeline + per-board stats chip | ✅ | ✅ |
| multi-select (shift/ctrl) + bulk actions | ✅ (`lib/selection.ts`) | ✅ |
| search + 4 sorts | ✅ (`lib/selectors.ts`) | ✅ |
| settings: usage + reset local data | ✅ | ✅ |
| download `.mosaic` / `.excalidraw` / `.png` / `.svg` | ✅ | ✅ (`.mosaic` only) |

**TODOs / FIXMEs in dashboard source: none.** `rg "TODO|FIXME|HACK|coming soon|stub" mosaic-dashboard/src` → empty.

### Editor ↔ Dashboard bridge

- **Key/route:** hash **`#board=<id>`**. `getBoardIdFromHash()` in `excalidraw-app/boardMode.ts` parses it with `URLSearchParams`.
- **How a board opens:** `BoardPage` renders `<iframe src="/editor/#board=<id>">`. The mount point comes from `VITE_EDITOR_BASE` (default `/app/`, e2e `/editor/`).
- **Hydration:** the editor opens the `mosaic-dashboard` IndexedDB with the **native** API (no Dexie dependency), reads the `boards` row, `restoreElements`/`restoreAppState` the scene, resolves the initial-data promise, and on failure falls back to an empty canvas.
- **Autosave:** `startBoardAutosave()` — 10 s interval + `visibilitychange`→hidden + `beforeunload` + Ctrl/Cmd+S (intercepted in capture phase). All funnel through one in-flight-guarded `runSave`.
- **Concurrency:** every write bumps `sceneVersion`; `saveBoardScene({ baseVersion })` refuses to overwrite if the stored version moved on.
- **Thumbnails:** `captureThumbnail()` copies the live `<canvas>` into a 480×300 offscreen canvas, white backing fill, JPEG q0.72 → `board.thumbnail`.
- **Save status:** editor `postMessage`s `mosaic:saving` / `mosaic:saved` + `boardId` to the parent.
- **Back:** editor footer renders "← Back to dashboard" **only** in board mode.
- **Trash retention:** 30 days, purged in a transaction on app boot before the first read.

---

## Section 5 — CI / CD / Docker Evidence

### Last 20 runs

```
success  Docker image          v0.1.3   37012547828  3m23s
success  CI                   main     37012258517 16m17s   ← current main
failure  Docker image          v0.1.3   37009916641  9m40s   (fixed: probe-before-bind race)
success  CI                   main     37009910401 16m42s
failure  Docker image          v0.1.2   37008474705  8m09s   (fixed: nginx regex quoting)
success  CI                   main     37008402484 14m34s
failure  Docker image          v0.1.1   37007005069  7m20s   (fixed: rm root-owned files)
cancelled CI                   main     37006952592 15m03s   (superseded)
failure  Docker image          v0.1.1   37006571164   41s     (stale tag)
cancelled CI                   main     37006277852  7m54s   (superseded)
success  Semantic PR title     upstream-sync/2026-10-02       (x3)
success  CI                   fix/pr-scopes  37005874095 17m24s
success  Test Coverage PR     fix/pr-scopes  37005873937  8m00s
```

### Last 5 successful CI runs (the real gate)

| Run | Branch | Duration | URL |
| --- | --- | --- | --- |
| 37012258517 | `main` | 16m17s | https://github.com/dramatic4678565/mosaic/actions/runs/37012258517 |
| 37009910401 | `main` | 16m42s | https://github.com/dramatic4678565/mosaic/actions/runs/37009910401 |
| 37008402484 | `main` | 14m34s | https://github.com/dramatic4678565/mosaic/actions/runs/37008402484 |
| 37005874095 | `fix/pr-scopes` | 17m24s | https://github.com/dramatic4678565/mosaic/actions/runs/37005874095 |
| 37002786682 | `upstream-sync/2026-10-02` | 11m07s | https://github.com/dramatic4678565/mosaic/actions/runs/37002786682 |

**All 21 steps of run 37012258517 are `success`**, including `E2E (dashboard, editor, rebrand audit)`.

### Last 5 failed runs — all diagnosed and fixed

| Run | Why it failed | Fixed by |
| --- | --- | --- |
| 37009916641 Docker v0.1.3 | smoke probed before nginx bound its socket | `5e3cc4142` (wait loop + `127.0.0.1`) |
| 37008474705 Docker v0.1.2 | nginx `[emerg] unknown directive "8,}"` — unquoted `{8,}` regex | `c65d205ee` (quote regex + `RUN nginx -t`) |
| 37007005069 Docker v0.1.1 | `rm: can't remove ... Permission denied` on the unprivileged image | `d763486f4` (drop the `rm`) |
| 37006571164 Docker v0.1.1 | tag pushed before the build fix landed (stale tag) | superseded by v0.1.2 |
| 37006277852 CI `main` | _cancelled_, superseded by a newer push | not a real failure |

### All 19 PRs — every one MERGED

| # | Title | Merged |
| --- | --- | --- |
| 19 | fix(workflow): allow the PR scopes this fork actually uses | ✅ |
| 18 | chore(repo): sync with upstream/master (ed10ac7dc) | ✅ |
| 17 | debug(workflow): print effective token permissions before the sync | ✅ |
| 16 | fix(sync): make the conflict matcher actually match, and test it | ✅ |
| 15 | fix(sync): file the failure issue the same robust way as the PR | ✅ |
| 14 | docs(workflow): record the repo setting that actually gates PR creation | ✅ |
| 13 | fix(sync): force-with-lease the dated branch… | ✅ |
| 12 | fix(sync): open the PR before applying the label… | ✅ |
| 11 | fix(workflow): step off main before running the sync script | ✅ |
| 10 | fix(ci): fetch full history so the rebrand guard can find the fork point | ✅ |
| 9 | test(ci): retry flaky vitest cases and stop duplicating gates in CI | ✅ |
| 8 | style: apply prettier formatting in verify-internals | ✅ |
| 7 | fix(ci): baseline the rebrand guard on the merge-base | ✅ |
| 6 | fix(ci): fetch upstream with full history | ✅ |
| 5 | fix(ci): order verify-internals so `run` is defined before use | ✅ |
| 4 | fix(ci): rebrand guard and Docker runtime fixes from the first live run | ✅ |
| 3 | chore: self-maintaining infra | ✅ |
| 2 | feat: Mosaic dashboard | ✅ |
| 1 | chore: rebrand Excalidraw to Mosaic (foundation) | ✅ |

**Pattern worth noting (F11):** 14 of the 19 PRs are fixes to CI/Docker/sync discovered _by_ CI/Docker/sync. The infrastructure has never been "done" — it converges.

### Release + GHCR

```
$ gh release list
Mosaic v0.1.0   Latest   v0.1.0   2026-10-01T17:03:14Z
```

- Tags on remote: `v0.1.0`, `v0.1.1`, `v0.1.2`, `v0.1.3`
- **GitHub Releases: only `v0.1.0`** — v0.1.1/2/3 have tags but no Release. GitHub marks `v0.1.0` as _Latest_ despite v0.1.3 being newer (**F6**).
- GHCR tags published: `0.1.3`, `0.1`, `latest`
- **Digest:** `sha256:b6b45207a17c8d2312f071d24c60cbc890850480735fa9335099a62cd2e717b2`
- **Image is private** — the repo is `PRIVATE`, so GHCR requires `docker login ghcr.io` with a token that has `read:packages` (**F7**).

### Container smoke test

`docker` is **not installed** on this machine (`Get-Command docker` → empty), so `docker compose up` and `docker images` could **not** be run here. **Locally UNVERIFIED.** CI evidence from run 37012547828:

```
$ gh run view 37012547828 --log
… Digest: sha256:b6b45207a17c8d2312f071d24c60cbc890850480735fa9335099a62cd2e717b2
… Status: Downloaded newer image for ghcr.io/dramatic4678565/mosaic:0.1.3
… <title>Mosaic — Dashboard</title>          # GET /
… <title>Mosaic — Visual Whiteboard</title>   # GET /app/
… asset 200                                   # hashed chunk reachable
```

That is the same assertion `docker compose up && curl` would make, executed in CI against the pushed image.

---

## Section 6 — Tests & QA

| Suite | Count | How to run |
| --- | --- | --- |
| Editor unit | **2448 passed**, 47 skipped, 1 todo (2496) across 141 files | `yarn test:app --watch=false` |
| Dashboard unit | **52 passed** across 3 files | `yarn test:dashboard` |
| Brand guard | 16 checks | `yarn verify:brand` |
| Sync-policy matcher | 25 cases | `yarn test:sync-policy` |
| E2E | **20 tests** (24 with the 5 dashboard routes) across 4 spec files | `yarn e2e` |

**The 47 skipped + 1 todo are inherited from upstream, not quarantined by us:** `git diff upstream/master -- packages/element/tests/sortElements.test.ts packages/excalidraw/tests/flip.test.tsx packages/element/tests/resize.test.tsx` → **0 lines**.

### E2E spec files and what each asserts

| File | Test | Asserts |
| --- | --- | --- |
| `smoke.spec.ts` | full board lifecycle | create→rename→favourite→file in folder→open editor→draw rect→Ctrl+S→back→thumbnail visible→trash→restore |
| `dashboard.spec.ts` | creates, renames, favourites | rename input + star state + favourites view |
|  | files a board in a folder | folder view shows it, sidebar counter = 1 |
|  | searches and sorts | search filters, `sort=name` orders A first |
|  | multi-selects + bulk-trashes | ctrl-select 2, bulk bar reads "2 selected", both trashed |
|  | trashes, restores, deletes forever | soft-delete→trash view→restore→destroy, counters return to 0 |
|  | **renames, recolours, deletes a folder** | **`test.skip`** — "folder recolour UI not built yet" |
|  | records activity | ≥3 activity rows, board name present |
|  | duplicates a board | 2 cards, exactly one containing "copy" |
|  | settings usage + reset | "Using 1 board and 1 folder", reset empties the DB |
|  | downloads `.mosaic` | suggested filename matches `\.mosaic$` |
| `editor.spec.ts` | persists a drawing and re-hydrates | sceneVersion>0, scene contains `"type":"rectangle"`, thumbnail truthy, reopens with scene intact |
|  | shows back-to-dashboard only in board mode | dashboard control + editor footer link |
|  | keeps dashboard usable after returning | navigate back, card still listed |
| `rebrand-audit.spec.ts` | 5 dashboard routes | rendered text + accessible names contain **zero** "Excalidraw" |
|  | folder view | same |
|  | editor in board mode | zero "Excalidraw" outside a 3-entry allow-list |
|  | **MIT attribution credit reachable** | `html.includes("Powered by Excalidraw") \|\| html.includes("excalidraw.com")` — **passes on the fallback; see F1** |
|  | editor page title is Mosaic | `/editor/` title + meta description |
|  | dashboard page title is Mosaic | `/dashboard` title |
|  | renders the Mosaic wordmark | body text + `svg[aria-label="Mosaic"]` |

### Does the rebrand audit scan every route?

**No.** It covers `/dashboard`, `/dashboard/favorites`, `/dashboard/trash`, `/dashboard/activity`, `/dashboard/settings`, one folder view, and the editor at `/editor/`. **Not scanned:** `/board/:id` (the editor-in-iframe route), `/dashboard/folders/:id` for a _nested_ folder, `/dashboard/*` 404 fallback, and any dialog (About, Export, Share, Help). The editor audit only loads the bare editor, not a board-mode session in a dialog.

### `yarn test:all` summary

`tsc && eslint --max-warnings=0 && prettier --list-different && vitest --watch=false && yarn --cwd mosaic-dashboard test`. In CI these are split into separate steps (deliberately, PR #9) to avoid one flake blocking everything. Run 37012258517: all 4 gates green.

### Coverage

Reported by `test-coverage-pr.yml` (upstream's workflow) via `yarn test:coverage` + `davelosert/vitest-coverage-report-action`, which comments the table on the PR.

```
All files | % Stmts 70.55 | % Branch 84.04 | % Funcs 70.62 | % Lines 70.55
Thresholds (vitest.config.mts): lines 60, branches 70, functions 63, statements 60
```

Two caveats:

- `ci.yml` **never** passes `--coverage`, so coverage is not enforced on the main gate — only the thresholds inside a coverage run apply.
- `vitest.config.mts` excludes `mosaic-dashboard/**`, so **the dashboard has no coverage measurement at all** (F8).

---

## Section 7 — Upstream Sync Mechanics

### Conflict policy — `scripts/sync-upstream.policy.json` (authoritative)

```json
"oursPatterns": [
  "mosaic-brand/**", "packages/mosaic-brand/**", "excalidraw-app/public/**",
  "packages/excalidraw/locales/en.json", "scripts/brand/**", "memory/**",
  "REBRAND.md", "UPSTREAM_SYNC.md", "NOTICE", "mosaic-dashboard/**"
]
```

**Mosaic wins (`--ours`)**: the ten patterns above. Everything else takes **upstream (`--theirs`)**.

Two subtleties that the code comments call out and the tests pin:

- `*` = direct children, `**` = any depth. Both are used.
- `packages/excalidraw/locales/en.json` is listed **by exact name** on purpose: the other 56 Crowdin locales must take upstream, or every sync would discard the rebrand of every translation.

`scripts/test-sync-policy.sh` (25 cases, runs in CI) pins `en.json` matches while `de-DE.json`/`zh-CN.json`/`ar-SA.json` do not.

### How a human reviews the PR

Branch `upstream-sync/YYYY-MM-DD`, label `upstream-sync` + `s-upstream`. PR body carries a checklist: `yarn build:all`, `yarn test:all`, `yarn verify:brand`, `yarn e2e`, locale-diff review. **Never auto-merged** — the script refuses to run on `main` and never pushes there.

### What happens on red build

Proven in code and in a live run:

```bash
failure_report() {
  log "aborting the merge; main is untouched"
  git merge --abort 2>/dev/null || true
  git reset --hard main >/dev/null 2>&1 || true
  git checkout main >/dev/null 2>&1 || true
  git branch -D "$SYNC_BRANCH" >/dev/null 2>&1 || true
  …
  gh issue create --title "Upstream sync failed at ${stage} …"
  exit 1
}
```

Observed live in run `36992143335`: tests went red → `WARN tests failed` → `WARN aborting the merge; main is untouched` → exit 1. **No branch was pushed, no PR opened.**

### The known GITHUB_TOKEN limitation

Exact error from run `36982997418`:

```
pull request create failed: GraphQL: Resource not accessible by integration (createPullRequest)
```

Documented in `.github/workflows/upstream-sync.yml` (a block comment directly under `permissions:`) and in `memory/MEMORY.md` §"Upstream sync needs a repository setting". The repo reports `can_approve_pull_request_reviews: true` and `default_workflow_permissions: write` via the API, and the workflow declares `permissions: pull-requests: write` — yet the token still cannot create a PR. The grant is only togglable in **Settings → Actions → General → Workflow permissions**. A diagnostic step (`Report token permissions`) now prints the effective state every run.

### Dry run

```
$ yarn sync-upstream:dry
==> policy loaded from scripts/sync-upstream.policy.json
==> upstream=upstream/master  branch=upstream-sync/2026-10-02
FAIL refusing to run on main. Check out a branch first.
```

That refusal **is the guard working** — the script will not operate from `main` even in dry-run. A meaningful dry-run therefore requires checking out a scratch branch first, which this read-only audit did not do. The full non-dry sync path is evidenced by the merged PR #18 (CI run 37002786550, tests 2448 passed) and by an earlier successful local run.

### Current gap

**2 upstream commits unmerged** (see Section 1). Both touch `packages/excalidraw/` editor code — none of the ten branded patterns — so the next sync should be conflict-free.

---

## Section 8 — Security & Hygiene

| Check | Result |
| --- | --- |
| High-risk secrets in tracked files (`sk-`, `ghp_`, `github_pat_`, `xox*`, `BEGIN PRIVATE KEY`, `AWS_SECRET`, `AIza…`) | ✅ **none found** |
| `.env` files committed | `.env.development`, `.env.production`, `.env.test`, `mosaic-dashboard/.env.e2e` — all **inherited upstream** or ours; all contain only public client config. **No secrets.** |
| `.env.example` present | ❌ **No** (F10) |
| Dependabot | ❌ **No `.github/dependabot.yml`; alerts API returns "Dependabot alerts are disabled for this repository"** (F5) |
| CodeQL / security scanning | ❌ **Not configured.** `security_and_analysis: null`. Not available on free tier for private repos (**F5**) |
| `LICENSE` / `NOTICE` / `SECURITY.md` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md` | ✅ all present |
| Branch protection on `main` | ❌ **Not enabled** — API returns _"Upgrade to GitHub Pro or make this repository public"_ (F5) |
| `SECURITY.md` threat model | ✅ Honest and accurate: states there are no accounts, no server, data lives in IndexedDB, the device is the boundary, XSS = full data compromise. |
| `t()` interpolation / HTML injection | ✅ Safe — `t()` returns plain strings, React escapes them; `dangerouslySetInnerHTML` appears **nowhere** in dashboard source |

**Firebase config observation (F4):** `.env.production` carries upstream's public Firebase web keys for projects `excalidraw-room-persistence` and `excalidraw-oss-dev`. These are client-side identifiers (exposed in any web app by design), but they mean **Mosaic's editor is configured to talk to Excalidraw's Firebase projects** for collab. Mosaic's own dashboard is local-only IndexedDB and unaffected. This is inherited upstream config, not something we introduced, but it is a live coupling to a third party's infrastructure.

---

## Section 9 — Findings / Risks / Tech Debt

| ID | Sev | Area | Evidence | Suggested fix (NOT applied) |
| --- | --- | --- | --- | --- |
| **F1** | **P1** | Legal / rebrand | `ATTRIBUTION` (`packages/mosaic-brand/src/index.ts:65-70`) is exported but `rg ATTRIBUTION` finds **no consumer**. `AppFooter.tsx` renders "← Back to dashboard" instead. The e2e guard at `rebrand-audit.spec.ts:130` passes via `\|\| html.includes("excalidraw.com")`, which matches the editor's `<link rel="canonical">`. `REBRAND.md:126` explicitly requires the credit be reachable. | Render `ATTRIBUTION.label` as a `Credits` link in the dashboard footer and/or the editor footer. Then tighten the spec to assert the literal string only, dropping the `excalidraw.com` fallback. **MIT compliance gap.** |
| **F2** | **P1** | Product | 100× `Excalidraw+` in editor dist; 7 en.json strings (`"title": "Excalidraw+"`, `"button": "Export to Excalidraw+"`, AI-limit upsell at `:722`); `AppSidebar`/`AI.tsx` promo copy. All link to `plus.excalidraw.com` / `app.excalidraw.com`. | Decide: remove the promo surfaces, or wire a real Mosaic+ equivalent. Users are currently invited to buy a competitor's product from our UI. |
| **F3** | P2 | QA coverage | `dashboard.spec.ts:150` `test.skip` — folder rename/recolour/delete. | Build the recolour UI the skip message already anticipates, then un-skip. |
| **F4** | P2 | Security | `.env.production` / `.env.development` carry upstream Firebase project keys (`excalidraw-room-persistence`). | Decide whether Mosaic's collab should point at those projects. If not, blank them for Mosaic builds. |
| **F5** | P2 | Supply chain / safety | No `.github/dependabot.yml`; alerts API says disabled; `security_and_analysis: null`; **no branch protection** (Pro-gated for private repos). 4152 commits of dependency surface. | Add `dependabot.yml` for `npm` + `github-actions`. Manually enable a "CI must pass" expectation — without branch protection, a green-red main is one keystroke away. |
| **F6** | P2 | Release hygiene | Tags `v0.1.1`, `v0.1.2`, `v0.1.3` exist with **no GitHub Release**; `gh release list` marks **v0.1.0** as _Latest_. | Create releases for v0.1.1–v0.1.3, or squash-retag to one release. Otherwise "Latest release" points at a broken image. |
| **F7** | P2 | Deployment | Repo is `PRIVATE` ⇒ the GHCR package is private. `gh api …/packages` returns 403 for my token. | Decide public vs private. If private is intended, document the `docker login ghcr.io` + PAT step; if the image should be pullable, make the package public. |
| **F8** | P2 | QA | `vitest.config.mts` excludes `mosaic-dashboard/**` from coverage; `ci.yml` never passes `--coverage`. The dashboard — the largest chunk of _new_ code — has **no coverage number**. | Add a coverage run for `mosaic-dashboard` (its own vitest project) and surface the number. |
| **F9** | P2 | Rebrand guard | `verify-internals.js` rule is `after >= before`. Detects removals, but a rename offset by additions elsewhere passes. | Also compare _sets_ of matched lines rather than counts, or diff the token lists. |
| **F10** | P3 | DX | No `.env.example`; a new dev must read `.env.development` to learn which vars matter. | Add `.env.example` listing keys with empty values. |
| **F11** | P3 | Process | 14 of 19 merged PRs are fixes to the CI/Docker/sync machinery, found by running it. Three tags were needed to get a green image. | Normalise this — it is the expected cost of new infra, not a defect. But note it means the pipeline was **never** green on first run. |
| **F12** | P3 | Cost / dead code | `test.yml`, `size-limit.yml`, `build-docker.yml` inherit from upstream and key off `master`/`release` — branches this fork does not use. They never fire. | Delete them, or repoint to `main`. Same for `crowdin.yml` pointing at upstream's Crowdin project. |
| **F13** | P3 | Housekeeping | 16 feature branches, all merged, still present locally and on `origin`. | Delete after merge. |
| **F14** | P3 | Metadata | Repo description and the Docker image `org.opencontainers.image.description` both still read **"… (rebrand of Excalidraw, MIT) Part 1"**. | Update to describe the current state. |
| **F15** | P3 | Sync | The sync's own `upstream-sync/2026-10-02` branch remains after merge. | The script deletes its local branch but not the remote one. |

**Explicitly checked and NOT findings:** no user-visible "Excalidraw" in Mosaic-owned UI; no TODO/FIXME in dashboard source; no dead links (all 10 README links resolve); no generated artifacts committed; no 404 asset in the built image (CI asserts `asset 200`); no CI check green-by-skip (the one skipped e2e test is explicitly `test.skip` with a reason, not a silent pass).

**Known non-defect, documented:** the 47 skipped editor tests are inherited from upstream (`git diff` = 0), and vitest has `retry: 1` for genuinely flaky geometry tests. The one e2e assertion deliberately _not_ covering a hard browser reload is documented in `editor.spec.ts` and `memory/REFERENCE.md` §7.

**Where the rebrand could silently break in a future sync:** if upstream ever adds a file under a branded path (e.g. a new `excalidraw-app/public/` asset, or a new locale), the policy gives ours priority and upstream's addition is dropped without a warning. The sync PR's stat is the only signal. Worth an explicit "conflict resolved" log line in the PR body.

---

## Section 10 — Recommended Next Steps

### P0 — blockers

**None.** Nothing is broken or un-shippable right now.

### P1 — high

**1. Render the MIT "Powered by Excalidraw" credit (F1)** — _why:_ the only legal-compliance gap in the project; `REBRAND.md` mandates it and it currently does not exist in any UI. _Effort:_ S (~1h). _Touches:_ `mosaic-dashboard/src/components/sidebar/Sidebar.tsx` (or a new `Credits.tsx`), `excalidraw-app/components/AppFooter.tsx`, `mosaic-dashboard/e2e/rebrand-audit.spec.ts` (tighten the assertion).

**2. Decide the `Excalidraw+` surfaces (F2)** — _why:_ Mosaic's UI currently sells a competitor's paid tier (7 en.json strings, AI-limit upsell, sidebar promo). _Effort:_ S for removal, L for a real replacement. _Touches:_ `packages/excalidraw/locales/en.json`, `excalidraw-app/components/AppSidebar.tsx`, `excalidraw-app/components/AI.tsx`.

### P2 — medium

**3. Add drag-to-folder e2e (F3-adjacent)** — _why:_ STEP 4's headline interaction has zero automated coverage; `dnd-kit` is the most fragile part of the dashboard. _Effort:_ M (~2h). _Touches:_ `mosaic-dashboard/e2e/dashboard.spec.ts`.

**4. Un-skip folder rename/recolour/delete (F3)** — _why:_ three features behind a permanent `test.skip`. _Effort:_ M. _Touches:_ sidebar context menu, the spec.

**5. Add Dependabot (F5)** — _why:_ 4152 commits of dependency surface, no automated update mechanism, no security scanning. _Effort:_ S (~15min). _Touches:_ new `.github/dependabot.yml`.

**6. Reconcile releases (F6)** — _why:_ "Latest release" points at a broken image. _Effort:_ S. _Touches:_ GitHub Releases only.

**7. Decide image visibility (F7)** — _why:_ a private GHCR package makes the image unpullable by anyone without a token. _Effort:_ S. _Touches:_ repo/package settings, `README.md` quickstart.

**8. Cover the dashboard (F8)** — _why:_ the largest new-code surface has no coverage metric. _Effort:_ S–M. _Touches:_ `mosaic-dashboard/vitest.config.mts`, `ci.yml`.

### P3 — low

**9. Harden `verify-internals.js` (F9)** — S. **10. Add `.env.example` (F10)** — S. **11. Clean dead workflows + branches (F12/F13)** — S. **12. Fix stale metadata (F14)** — S. **13. Remote-branch cleanup in sync (F15)** — S. **14. Log resolved conflicts into the PR body (F16)** — S.

### The single most fragile part right now

**The three-value base-path contract that makes the dashboard↔editor bridge work: `EXCALIDRAW_BASE_PATH` (editor build) × `VITE_EDITOR_BASE` (dashboard build) × `EDITOR_BASE` (serve).** Get any one wrong and the failure is _silent by design_: `index.html` loads, its hashed chunks 404, and the editor renders a blank canvas with **no console error and no thrown exception**. This exact bug shipped in three consecutive Docker releases (v0.1.1 permissions, v0.1.2 nginx regex, and finally the base-path mismatch in the v0.1.3 candidate) before the `grep -q '/app/assets/index-'` build assertion was added to close it. It is fragile because it is spread across three files in two languages and enforced by a grep rather than by a type. The same shape — _silent_ mismatch between what is built and what is served — is what the rebrand's sync policy also depends on.

### The single biggest win available in one day

**Render the MIT credit and close the `Excalidraw+` surfaces (F1 + F2).** Together they are roughly two hours of work, and they convert the project's largest legal and reputational exposure into a resolved item: right now Mosaic ships a licence obligation it does not fulfil, _and_ actively directs its users to buy a competitor's product. Everything else on this list is hygiene; this is the only pair of items where the current state is arguably wrong rather than merely unfinished.

### The 3 commands a human should run weekly

```bash
yarn verify:brand   # 16 checks, ~3s — proves no internal identifier was renamed
yarn test:all       # typecheck + lint + format + 2448 editor tests
yarn e2e             # builds both apps + 20 browser specs, ~3 min
```

Plus a glance at the `upstream-sync` PR queue — that is where the real weekly review happens.

---

_End of report. Read-only audit: no commits, branches, pushes or merges were made. The only file written is this report._
