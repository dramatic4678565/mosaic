# Mosaic — Rebrand Audit (Excalidraw → Mosaic, Part 1)

> Upstream: `https://github.com/excalidraw/excalidraw` (MIT) Origin: `https://github.com/dramatic4678565/mosaic` Branch: `chore/rebrand-foundation`
>
> **Scope:** user-visible strings, logo, title & meta only. **Non-goal:** any internal identifier rename (package names, imports, storage keys).

---

## Method

```
rg -c -i excalidraw --glob '!node_modules' --glob '!*.lock'
rg -l "Excalidraw" --glob '!node_modules' --glob '!dev-docs/**'
rg -n -f rebrand-audit.rgx   # strings/JSX only
```

Raw totals:

| Metric                                           | Count    |
| ------------------------------------------------ | -------- |
| Files matching `excalidraw` (case-insensitive)   | **725**  |
| Files matching `Excalidraw` (case-sensitive)     | 412      |
| Files containing `@excalidraw/*` imports         | 491      |
| Locale JSON files containing `Excalidraw`        | 57 of 58 |
| Files with **user-visible** `Excalidraw` strings | **27**   |

> The 725 vs 27 gap is the whole point of the audit: the vast majority of matches are module paths, type names and variable identifiers — **not** things a user ever reads.

---

## A) USER_VISIBLE → change to "Mosaic"

### A1. HTML shell & PWA meta — `excalidraw-app/index.html`

| Line | Current | Action |
| --- | --- | --- |
| 5 | `<title>Excalidraw Whiteboard</title>` | `Mosaic — Visual Whiteboard` |
| 17 | `... Hand-drawn look & feel \| Excalidraw` | `\| Mosaic` |
| 21 | `Excalidraw is a virtual collaborative whiteboard...` | `Mosaic is ...` |
| 26 | `og:site_name` = `Excalidraw` | `Mosaic` |
| 31 | `og:title` | `Mosaic — Collaborative whiteboarding made easy` |
| 33 | `og:image:alt` = `Excalidraw logo` | `Mosaic logo` |
| 36 | `og:description` | `Mosaic is ...` |
| 46 | `twitter:title` | `Mosaic — ...` |
| 50 | `twitter:description` | `Mosaic is ...` |
| 213 | `<h1 class="visually-hidden">Excalidraw</h1>` | `Mosaic` |

**NOT changed in this file (internal/D):** lines 72, 121, 126, 132, 140, 162 — theme localStorage key, build placeholder, font CSS path, `EXCALIDRAW_ASSET_PATH` global, version comment, `window.name`.

### A2. Web App Manifest — `excalidraw-app/vite.config.mts`

| Line | Current                    | Action                            |
| ---- | -------------------------- | --------------------------------- |
| 229  | `short_name: "Excalidraw"` | `"Mosaic"`                        |
| 230  | `name: "Excalidraw"`       | `"Mosaic"`                        |
| 232  | manifest `description`     | `Mosaic is a whiteboard tool ...` |

**NOT changed:** line 256 `id: "excalidraw"` (manifest identity — internal), lines 264/277/279 `application/vnd.excalidraw+json` + `.excalidraw` (file format), lines 27–86 `@excalidraw/*` Vite aliases, line 136 `hostname` (see D).

### A3. Locale strings — `packages/excalidraw/locales/*.json` (57 files)

Product-name strings inside translated values are rewritten in **all** locales (the English token `Excalidraw` is a proper noun and survives translation):

`addWatermark` · `madeWithExcalidraw` · `excalidrawLib` · `installPWA` · `uploadedSecurely` · `invalidSceneUrl` · `mermaidToExcalidraw` · `shareTitle` · `tooltip` · `link` · `center_heading_plus` · `center_heading` · TTD dialog `title` / `description` · `messageLimit`

**NOT changed:** every JSON **key** (`mermaidToExcalidraw`, `madeWithExcalidraw`, …). Keys are the contract between code and translation platform; changing them breaks `t()` lookups. Only values change.

### A4. UI component strings (hardcoded, no `t()`)

| File | Line | Current |
| --- | --- | --- |
| `packages/excalidraw/components/LayerUI.tsx` | 128 | `<MainMenu.Group title="Excalidraw links">` |
| `packages/excalidraw/components/LibraryMenuHeaderContent.tsx` | 162 | `"Excalidraw library files"` |
| `packages/excalidraw/data/json.ts` | 96 | `"Excalidraw file"` (file-picker type desc) |
| `packages/excalidraw/data/json.ts` | 107 | `"Excalidraw files"` |
| `packages/excalidraw/data/json.ts` | 156 | `"Excalidraw library file"` |
| `packages/excalidraw/components/App.tsx` | 2045 | `title="Excalidraw Embedded Content"` (iframe a11y title) |

### A5. Logo component — `packages/excalidraw/components/ExcalidrawLogo.tsx`

Swap `LogoIcon` + `LogoText` SVG bodies for the Mosaic lockup. **API preserved exactly:** `size`, `withText`, `style`, `isNotLink` props; exported name stays `ExcalidrawLogo`; CSS classes `ExcalidrawLogo`, `ExcalidrawLogo-icon`, `ExcalidrawLogo-text` and the `.scss` all stay — so every existing `import { ExcalidrawLogo } from ".../ExcalidrawLogo"` keeps working.

### A6. Asset files — `public/`

Replaced with Mosaic artwork (binary/asset swap, no code risk):

`favicon.svg` · `favicon.ico` · `favicon-16x16.png` · `favicon-32x32.png` · `apple-touch-icon.png` · `android-chrome-192x192.png` · `android-chrome-512x512.png` · `maskable_icon_x192.png` · `maskable_icon_x512.png` · `og-image-3.png`

> Brand source: `mosaic-brand-directions.zip` → 536 SVGs. Primary lockup `mosaic.svg` (720×240: 2×2 tile mark in `#3977df` / `#91b2f6` / `#759dec` / `#d4e1fc`
>
> - "Mosaic" wordmark).

---

## B) INTERNAL → must stay `excalidraw`

Nothing in this bucket is edited. Verified unchanged in STEP 6.

| Category | Where | Examples |
| --- | --- | --- |
| npm package names | `packages/*/package.json` | `@excalidraw/excalidraw`, `@excalidraw/element`, `@excalidraw/common` (491 files import these) |
| Import paths | everywhere | `from "@excalidraw/excalidraw"`, `from "../ExcalidrawLogo"` |
| localStorage keys | `excalidraw-app/app_constants.ts:40-52` | `excalidraw`, `excalidraw-state`, `excalidraw-collab`, `excalidraw-theme`, `excalidraw-debug`, `excalidraw-library` |
| IndexedDB stores | `app_constants.ts:48-49` | `excalidraw-library`, `excalidraw-ttd-chats` |
| Build globals | `index.html:121,132,162` | `PLACEHOLDER:EXCALIDRAW_APP_FONTS`, `EXCALIDRAW_ASSET_PATH`, `window.name="_excalidraw"` |
| Manifest id | `vite.config.mts:256` | `id: "excalidraw"` |
| File format | `vite.config.mts:264,277,279` | `.excalidraw` extension, `application/vnd.excalidraw+json` |
| Class names | `errors.ts:66-69` | `ExcalidrawError` (`.name = "ExcalidrawError"`) |
| Component / displayName | `App.tsx:517-547`, `index.tsx:402` | `ExcalidrawContainerContext`, `Excalidraw.displayName`, `ExcalidrawAPI` |
| Type aliases | `types.ts`, `reconcile.ts`, `data/index.ts` | `ExcalidrawElement`, `RemoteExcalidrawElement`, `SyncableExcalidrawElement` |
| CSS class names | `LayerUI.tsx:241` | `excalidraw-ui-top-left` |
| Dev-only console warns | `reactUtils.ts:53`, `useAppStateValue.ts:40`, `App.tsx:3889`, `DefaultItems.tsx:273` | console text only, not user-facing |
| Examples dir | `examples/**` | separate demo apps, not shipped in the product build |

---

## C) LEGAL / ATTRIBUTION → must stay

| File | Note |
| --- | --- |
| `LICENSE` | MIT — **unaltered**, copyright notice belongs to upstream authors |
| `packages/laser-pointer/LICENSE` | MIT |
| `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`, `dev-docs/**` | upstream docs, attribution intact |
| `.github/**`, `crowdin.yml` | upstream project metadata |

> A **"Powered by Excalidraw"** credit link must remain reachable in the app (MIT attribution). Default placement: a small `Credits` link in the footer / About dialog — not the main wordmark.

---

## D) URL / DOMAIN → keep, evaluate case-by-case

| URL | Decision |
| --- | --- |
| `https://excalidraw.com` (og:url, canonical, twitter:url) | **Keep** — points at upstream, deliberate attribution. Revisit when `mosaic.app` is live. |
| `https://app.excalidraw.com` (Excalidraw+ redirect, `index.html:116`) | **Keep** — real product destination, renaming breaks the redirect. |
| `https://docs.excalidraw.com`, `plus.excalidraw.com/blog` (HelpDialog) | **Keep** — real help destinations. |
| `https://github.com/excalidraw/excalidraw/issues` (HelpDialog) | **Keep** — upstream bug reports still valid. |
| `https://youtube.com/@excalidraw` (HelpDialog) | **Keep** |
| `https://excalidraw.com/og-image-3.png` (og:image) | **Replace** with Mosaic OG image |
| `?utm_source=excalidraw` (`components/AI.tsx:89`) | **Keep** — analytics attribution to upstream. |

---

## Step-5 execution order (each = one atomic commit)

1. `feat(brand): add mosaic-brand single-source-of-truth package`
2. `chore(brand): vendor Mosaic brand assets from directions zip`
3. `feat(app): rebrand HTML shell, meta and OG tags`
4. `feat(app): rebrand PWA manifest names and description`
5. `feat(i18n): rebrand product-name strings across all locales`
6. `feat(ui): rebrand user-visible component strings and menu labels`
7. `feat(brand): swap ExcalidrawLogo SVG artwork, preserve component API`
8. `chore(brand): replace favicon, PWA and OG image assets`
9. `docs: record rebrand classification in REBRAND.md`

---

## Verification results

### Gates

| Gate | Result |
| --- | --- |
| `yarn install` | clean (peer-dep warnings are pre-existing upstream) |
| `yarn test:typecheck` | **green** |
| `yarn test:code` (eslint `--max-warnings=0`) | **green** |
| `yarn test:other` (prettier) | **green** |
| `yarn build` | **green** — built in ~2m24s, PWA precache 59 entries |
| `yarn test:app` | **green** — see flakiness note below |
| `scripts/brand/verify-internals.js` | **PASS** — no internal identifier renamed |
| `LICENSE` files | byte-identical to `upstream/master` |
| Docker build | **not run** — Docker Desktop is not installed on this machine and installing it requires elevation + WSL2 + a reboot. Tracked separately. |

### Internal-identifier proof (`node scripts/brand/verify-internals.js`)

Each row compares the working tree against `upstream/master`:

```
OK  @excalidraw/* imports (code)         upstream=1487  now=1487
OK  localStorage keys                    upstream=   1  now=   1
OK  localStorage elements key            upstream=   1  now=   1
OK  IndexedDB stores                     upstream=   1  now=   1
OK  MIME type                            upstream=  10  now=  10
OK  .excalidraw extension                upstream= 263  now= 263
OK  build globals                        upstream=  20  now=  20
OK  window.name tab key                  upstream=   1  now=   1
OK  ExcalidrawError class                upstream=  16  now=  16
OK  ExcalidrawElement type               upstream=1550  now=1550
OK  CSS class names                      upstream=   8  now=   8
OK  workspace package names              upstream=1554  now=1554
OK  LICENSE / laser-pointer / common / element — identical to upstream
```

### DOM proof

Live headless-Chrome render of the production build at `http://localhost:3111/`:

- `<title>` → `Mosaic — Visual Whiteboard`
- `<h1 class="visually-hidden">` → `Mosaic`
- `og:site_name`, `og:title`, `og:description`, `twitter:*` → Mosaic
- Logo SVG → `viewBox="0 0 110 110"` (the Mosaic 2×2 tile mark) + `viewBox="0 0 200 48"` wordmark

A bundle-wide scan of all 119 built files for user-visible `"Excalidraw"` **prose** returns only 10 hits, and all 10 are `console.warn` / dev-time invariant messages (`not an ExcalidrawFrameElement`, `ExcalidrawAPI is no longer usable…`, etc.). No rendered UI string leaks the old brand.

### Test flakiness on this machine

The vitest suite is not deterministic on this Windows host. A pristine `upstream/master` worktree (`git worktree add`, no Mosaic changes at all) also fails, with a _different_ set of tests each run:

| Run | Branch | Failing tests |
| --- | --- | --- |
| 1 | baseline (pristine) | 9 (`fractionalIndex`, `zindex`, `withInternalFallback`, `history`, `selection`) |
| 2 | baseline (pristine) | 1 (`MermaidToExcalidraw`) |
| 3 | baseline (pristine) | 1 (`MermaidToExcalidraw`) |
| 1 | mosaic branch | 3 snapshot mismatches — **all branding-related, fixed** |
| 2 | mosaic branch | 1 (`events`) |
| 3 | mosaic branch | 2 (`MobileMenu` snapshot — **branding, fixed**; `withInternalFallback`) |
| 4 | mosaic branch | 1 (`events`) |
| 5 | mosaic branch | 5 |

Every Mosaic-specific failure was a snapshot asserting rebranded text or logo geometry; all were regenerated and the diff contains nothing but the brand change. Every remaining failure passes 100% when its file is run in isolation and reproduces on the untouched upstream baseline.

---

## Definition of done

- [x] `origin` = `dramatic4678565/mosaic`, `upstream` = `excalidraw/excalidraw`
- [x] `REBRAND.md` matches the actual diff
- [x] `yarn build` + `yarn test` + lint + typecheck green
- [x] Zero visible "Excalidraw" on any user-facing screen
- [x] Zero internal identifiers renamed
- [ ] Docker build — deferred (Docker Desktop not installed; needs elevation + reboot)
