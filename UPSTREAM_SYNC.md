# Upstream Sync Policy

How Mosaic tracks [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) without losing the rebrand.

Run `yarn sync-upstream` (or `./scripts/sync-upstream.sh` / `.\scripts\sync-upstream.ps1`). A scheduled GitHub Action does the same thing daily and opens a PR.

---

## The one rule that matters

**When a merge conflict occurs, Mosaic's version wins for branded files, and upstream's version wins for everything else.**

This is not arbitrary in either direction:

- **Mosaic wins on branding** because our entire product identity lives in a handful of files. Taking upstream there would silently rename the product back to Excalidraw, which is the single worst outcome this fork could have.
- **Upstream wins everywhere else** because it is, by definition, the maintained upstream. Taking our side of an unrelated conflict would freeze us on a stale version of code that other people are actively fixing — security patches above all.

Where a file is _entirely_ ours (no upstream counterpart), there is no conflict and nothing to decide.

---

## Branded file patterns (Mosaic wins)

These are matched as globs against the repository root. A file matching **any** of them resolves to `--ours` on conflict.

| Pattern | What it is | Why Mosaic wins |
| --- | --- | --- |
| `mosaic-brand/*` | brand directions + the vendored logo SVGs | source artwork; upstream has no equivalent |
| `packages/mosaic-brand/*` | `@mosaic/brand` — the brand constants package | Mosaic-only package |
| `excalidraw-app/public/*` | favicons, PWA icons, OG image | regenerated Mosaic artwork |
| `packages/excalidraw/locales/en.json` | English strings | contains the rebranded product name |
| `scripts/brand/*` | rebrand + verification tooling | Mosaic-only |
| `memory/*` | project memory notes | Mosaic-only |
| `REBRAND.md`, `UPSTREAM_SYNC.md`, `NOTICE` | Mosaic docs | Mosaic-only |

`*.locale/en.json` in the original spec maps to `packages/excalidraw/locales/en.json` in this repo — there is no `*.locale/` directory here. **Only the English file is branded.** The other 57 locales are managed by Crowdin and must take upstream, or a sync would clobber translated copy that upstream has since fixed.

## Everything else (upstream wins)

All other conflicts resolve to `--theirs` (upstream). This includes editor source, package internals, build config, CI and the other locales.

---

## What the sync actually does

1. Refuse to run unless the working tree is clean and you are not on `main`.
2. `git fetch upstream`
3. If `upstream/master` is already an ancestor of `main`, stop — nothing to sync (and do not open an empty PR).
4. Create branch `upstream-sync/YYYY-MM-DD`
5. `git merge upstream/master --no-commit --no-ff`
6. Resolve conflicts per the policy above.
7. `yarn install && yarn build && yarn test`
8. **Green** → commit, push, open a PR labelled `upstream-sync`. **Red** → `git merge --abort`, open an **issue** with the conflict diff, do not push.

The `--no-commit --no-ff` in step 5 is deliberate: it lets the script resolve conflicts and run the full build _before_ anything is committed, so a broken sync never reaches the remote.

---

## Reviewing a sync PR

The PR is a normal PR and is never auto-merged — see the hard rule below. Before approving, check:

- `git diff origin/main...origin/upstream-sync/YYYY-MM-DD -- '*.json'` for locale churn: a sync should not touch the 57 Crowdin locales unless upstream changed the _keys_, in which case `en.json` will show them too.
- `yarn test:all` locally. The editor suite is ~2400 tests and takes a few minutes; the dashboard suite is 52 and takes seconds.
- `node scripts/brand/verify-internals.js` — it should pass unchanged. A sync that renamed an internal identifier would show up here.
- The rebrand audit e2e: `yarn e2e`, which asserts no visible "Excalidraw" anywhere in the UI.

---

## Hard rules

- **Sync never auto-merges into `main`.** Not in the script, not in the Action. The Action may create a PR; a human merges it. This is enforced by the sync script refusing to push to `main` at all.
- **Mosaic branding is sacred.** See the policy table above.
- **Everything runs on the free GitHub Actions tier** — no self-hosted runners, no paid runners, no required secrets beyond the built-in `GITHUB_TOKEN`.
