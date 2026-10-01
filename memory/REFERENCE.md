# Reference — Mosaic internals

Companion to `MEMORY.md`. Detailed mechanics for the two integration points that are not obvious from reading the code: the rebrand contract and the dashboard ↔ editor bridge.

---

## 1. Rebrand classification (Part 1)

Full table in `REBRAND.md` at the repo root. Headline numbers:

| Bucket              | Files                           | Treatment          |
| ------------------- | ------------------------------- | ------------------ |
| USER_VISIBLE        | 27 + 57 locale JSON + 10 assets | → "Mosaic"         |
| INTERNAL            | ~490                            | untouched          |
| LEGAL / attribution | LICENSE ×4, docs                | untouched          |
| URL / domain        | 9                               | 8 kept, 1 replaced |

### The one asymmetry worth knowing

Locale files are edited **values only**. Keys such as `madeWithExcalidraw`, `mermaidToExcalidraw` and `excalidrawLib` keep their upstream spelling because they are the contract between code, `t()` lookups and the Crowdin sync.

The rewrite script is `scripts/brand/rebrand-locales.js` and it is idempotent (re-running it reports `0/58 locale files updated`). It protects exactly one substring: `Excalidraw+`.

`Excalidraw-JSON-Daten` (a German compound) is deliberately **not** protected — it is a product reference in prose. It was an early bug, caught by inspecting the diff.

### `packages/mosaic-brand`

Single source of truth. Imported by both apps.

- Vite consumers need an alias — it is an un-built TS workspace package (`excalidraw-app/vite.config.mts`, `mosaic-dashboard/vite.config.mts`).
- The editor builds it through `scripts/buildBase.js`, whose esbuild `alias` map also needed an entry, otherwise `packages/common` stopped bundling.
- `packages/tsconfig.base.json` needed the `paths` entry for the same reason (TS6059 otherwise).
- `mosaic-dashboard/tsconfig.json` intentionally has **no `rootDir`**, because `@mosaic/brand` resolves outside the package.

---

## 2. Dashboard ↔ editor bridge (Part 2, STEP 6)

### Direction of travel

```
dashboard  --(iframe src)-->  /editor/#board=<id>
editor     --(IndexedDB)-->  mosaic-dashboard DB, table "boards"
editor     --(postMessage)--> parent frame: mosaic:saving / mosaic:saved
```

### Hash contract

`#board=<id>` is read by `getBoardIdFromHash()` in `excalidraw-app/boardMode.ts` via `URLSearchParams`, so `#board=<id>&other=x` also parses. Anything without `board=` leaves the editor on its normal code path — that is what keeps Part 1's "editor unaffected" guarantee true.

The scene is **not** passed in the URL. The editor hydrates from IndexedDB itself. Embedding a possibly multi-megabyte scene in a fragment would bloat history, leak board content into it, and create a precedence question (URL vs DB) with no upside.

### Autosave

`startBoardAutosave()` wires four triggers: a 10 s interval, `visibilitychange` to hidden, `beforeunload`, and Ctrl/Cmd+S.

- Ctrl+S is intercepted with `preventDefault()` in the **capture** phase so the editor's own "save to disk" handler does not also fire a download dialog.
- All triggers funnel through one guarded `runSave` with an in-flight flag — otherwise an autosave racing a manual save writes twice and bumps `sceneVersion` for nothing.
- Failures are logged, never thrown: the user must be able to keep drawing and have the next tick retry.

`sceneVersion` is the compare-and-set token the dashboard uses to reject a stale write. Every editor write bumps it; `saveBoardScene({ baseVersion })` refuses to overwrite when the stored version has moved on.

### Thumbnails

`captureThumbnail()` reads the already-rendered `<canvas>` rather than re-rendering via `exportToBlob` — that API is not on `ExcalidrawImperativeAPI`, and copying the canvas captures exactly what the user sees.

Two details that matter:

- downscaled to 480×300, because the canvas backing store is HiDPI-sized and a PNG there would consume the IndexedDB quota;
- **JPEG, not PNG**, and painted onto a white backing fill. The editor canvas is transparent; a transparent PNG renders as a black rectangle on most dashboards.

### Why native IndexedDB in the editor

Dexie is not a dependency of `excalidraw-app`. Adding it would change the editor bundle and open a second schema-version negotiation against the dashboard's open connection. `indexedDB.open(name)` with **no version** always attaches to the existing version, so the editor cannot force a re-creation.

### Fallback behaviour

If board mode cannot load (corrupt row, blocked database), `App.tsx` logs `[mosaic] failed to load board`, resolves the initial-data promise with `null` and the editor opens an empty usable canvas. Leaving that promise pending would render a permanently blank editor with no error surfaced anywhere.

---

## 3. Data model

`mosaic-dashboard/src/db/schema.ts`.

`Board.folderId` is nullable with three distinct meanings in `lib/selectors.ts`:

- `undefined` — no folder filter (All boards)
- `null` — only unfiled boards
- a string — only that folder

This tri-state is the subtlest part of the filtering API; there is a dedicated test for each case.

`trashedAt` is a soft-delete marker (`null` = live). Boards are only hard-deleted by explicit "delete forever" or by the 30-day purge that runs on app boot _before_ the first read.

The activity audit row is appended inside the same `db/operations` function that mutates a board, so it cannot be bypassed by accident.

---

## 4. e2e harness gotchas (all of these cost real debugging time)

`mosaic-dashboard/e2e/smoke.spec.ts`, run via `yarn test:e2e`.

1. **`MOSAIC_DASHBOARD_BASE`** must be `/` for e2e. Production serves the dashboard at `/dashboard/`; leaving that base in makes Vite 404 everything Playwright requests at `/`.
2. **Editor dev server must run with `EXCALIDRAW_BASE_PATH=/editor`** and `VITE_APP_ENABLE_ESLINT=false`. The latter because `vite-plugin-checker` runs eslint in-process and crashed the dev server under e2e load (exit `0xC0000409`).
3. **Ports.** The editor defaults to 3001 from `.env.development`, which collides with the dashboard. The harness pins editor=3000, dashboard=3101.
4. **`canvas.excalidraw__canvas` matches two elements** (a static scene layer and an interactive layer). Target `.interactive`.
5. **The shape tools have no stable `data-testid`** — they are rendered from a dynamic list. The smoke test selects the rectangle tool with the `r` shortcut, which is both stable and closer to how a user draws.
6. **The board card "..." button must be genuinely visible**, not hover-revealed. `display: none` and `opacity: 0` are both "hidden" to Playwright, and forcing a click then dispatches at the coordinates and lands on the card — which toggles selection instead of opening the menu. It is also the right call for touch and keyboard users.
7. **A card is a dnd-kit draggable**, so hovering it can leave a CSS transform mid-transition and Playwright's "stable" check never settles. Hover the card first, then click the menu button with `force: true` — safe here _because_ the button is really visible, unlike the case in (6).
8. **`[data-testid^="folder-"]` also matches `folder-name-input`** (the create form). Select on `[data-folder-id]`.
9. **"All boards" lists every board regardless of folder.** Asserting a board disappears from it after being filed in a folder is wrong; assert against the folder view and the sidebar counter instead.

---

## 5. UI notes

- `BoardCard`'s click handler short-circuits while the context menu is open. React portals propagate synthetic events along the _React_ tree, so a click on a portaled menu item also bubbles to the card — which would open the board instead of running the menu action.
- Move/Download expand inline inside the single menu panel rather than opening a nested popover: a second floating menu needs its own flip logic and dismisses when the pointer crosses the gap between panels.
- The DndContext lives in `DndProvider` at the **shell** level, not in `BoardGrid`, because the drop targets are the sidebar folder rows and a dnd-kit context only reaches its own subtree. Droppable ids are prefixed `folder:` to keep them from colliding with board ids.
- Styling is SCSS modules plus one reset nested under `.dashboardRoot`. Nothing can reach the editor app, which is a separate Vite app with its own stylesheet, but keeping the reset scoped makes that structurally obvious.

---

## 6. Serialisation trap: `appState.collaborators`

`AppState.collaborators` is a **`Map`** at runtime. `JSON.stringify` flattens it to `{}`, so anything that round-trips a scene through JSON silently produces a corrupt value.

Board mode hit this: saving a board wrote `collaborators: {}`, and reopening it crashed the editor with `TypeError: e.appState.collaborators.forEach is not a function`. Draw, save, close, reopen -- broken. `restoreAppState` does not rebuild the Map.

Handled in `excalidraw-app/boardMode.ts`:

- `serializeScene` destructures the field out before `JSON.stringify`. It is ephemeral socket presence and should never have been persisted anyway.
- `parseStoredScene` deletes it on the way back, so scenes written by an older build also load.

**Any future code that serialises `AppState` must do the same.** Search for `getAppState()` and check.

---

## 7. E2E harness, Part 3 version

`yarn e2e` = `scripts/build-e2e.mjs` (builds both apps with matching base paths) then `playwright test` against `mosaic-dashboard/e2e/preview-server.mjs`, which mirrors `docker/nginx.conf`.

Traps beyond the ones in section 4:

1. **`path.normalize` on a URL pathname is a Windows bug.** `normalize("/editor/")` returns `\editor\`, so `startsWith("/editor/")` silently fails and the dashboard's index.html gets served for `/editor/`. Path handling stays plain strings.
2. **`deleteDatabase` is blocked by Dexie.** `resetLocalData` used it; Dexie's open connection fires `onblocked` and the delete never happens, so every spec inherited the previous run's boards. Clear the tables with a readwrite transaction instead -- that cannot block.
3. **Abort external font requests carefully.** The editor preloads fonts from an upstream CDN. Aborting leaves its `FontFace` promises unsettled and Chromium cascades an abort into the in-flight module preloads, so a _later_ load mounts with an empty `#root` and no error. Fulfil them with an empty body instead: they fail fast and cleanly.
4. **Three base-path values must agree** -- editor `EXCALIDRAW_BASE_PATH`, dashboard `VITE_EDITOR_BASE`, server `EDITOR_BASE`. Wrong -> 404 on a hashed chunk and a blank canvas, no exception.
5. The editor's PWA **service worker must not register when embedded** -- see `excalidraw-app/index.tsx` and the note in section 2.

### Known non-defect: the full-reload persistence assertion

The persistence spec deliberately navigates back via the in-app back link rather than a hard browser reload. A hard reload tears the iframe down mid-load and Chromium aborts its subresource requests, leaving the re-created editor blank in this environment. The SPA path is the real product behaviour and is covered. If this is ever revisited, check a network log first -- it is very likely environmental, not a Mosaic defect.

---

## 8. Where the upstream-sync conflict policy lives

`scripts/sync-upstream.policy.json` is the single source of truth. Both `sync-upstream.sh` and `sync-upstream.ps1` read it at runtime. Do not inline the patterns into either script -- that is exactly the duplication that drifts.

The rule is one line: branded files keep the Mosaic side (`--ours`), everything else takes upstream (`--theirs`). Only `packages/excalidraw/locales/en.json` is branded; the other 57 locales are Crowdin-managed and must take upstream.
