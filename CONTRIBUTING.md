# Contributing to Mosaic

Thanks for helping. Mosaic is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw), so a lot of the code and its conventions come from there.

## Before you change anything

Read [`memory/MEMORY.md`](memory/MEMORY.md). It records the traps that will cost you an hour if you hit them cold.

## The one rule

**Never rename an internal identifier.**

The product is called Mosaic. The code is not, and that is deliberate. These keep their `excalidraw` spelling and changing any of them breaks the build or orphans user data:

- npm package names and import paths (`@excalidraw/excalidraw`, `@excalidraw/element`, …)
- `localStorage` keys (`excalidraw`, `excalidraw-state`, `excalidraw-theme`, …)
- IndexedDB store names
- build globals (`EXCALIDRAW_ASSET_PATH`, `PLACEHOLDER:EXCALIDRAW_APP_FONTS`)
- the `.excalidraw` file extension and `application/vnd.excalidraw+json`
- type names (`ExcalidrawElement`, `ExcalidrawAPI`, `ExcalidrawError`)
- CSS class names (`ExcalidrawLogo`, `excalidraw-ui-*`)
- the LICENSE files

Run this after any bulk edit:

```bash
yarn verify:brand
```

It compares the working tree against `upstream/master` and fails if an upstream identifier lost an occurrence. `REBRAND.md` is the full classification table.

## Adding user-visible text

- **Dashboard** — add the string to the `en` dictionary in `mosaic-dashboard/src/lib/i18n.ts` and use `t("your.key")`. Never hard-code copy in a component.
- **Editor** — add it to `packages/excalidraw/locales/en.json` and use the `t()` helper. The other 57 locales are managed by Crowdin; do not edit them by hand.

## Style

- TypeScript everywhere; no `any` unless there is a comment saying why.
- Dashboard styling is SCSS modules, scoped. Nothing may leak globally.
- Match the surrounding code's naming and comment density. Comments should explain _why_, not restate the code.

## Before you open a PR

```bash
yarn test:typecheck
yarn test:code        # eslint --max-warnings=0: warnings are errors
yarn test:other       # prettier --list-different
yarn test:app --watch=false
yarn test:dashboard
yarn e2e
```

Every one must be green. `yarn e2e` builds both apps first, so it takes a couple of minutes.

If you touch anything about branding, layout or routing, the e2e suite is what will catch the regression — it runs the real built bundles.

## Upstream merges

Automated daily, opened as a PR, never auto-merged. See [`UPSTREAM_SYNC.md`](UPSTREAM_SYNC.md) for the conflict policy. Do not resolve an upstream conflict by taking your side "to be safe": branded files keep Mosaic, everything else takes upstream.

## Commits

Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Small and atomic — one logical change per commit, so a revert is meaningful.

## Reporting bugs

Include the version, the browser, and the steps to reproduce. If it involves a board, mention whether the data was already saved — board data lives in IndexedDB and is not recoverable once deleted forever.
