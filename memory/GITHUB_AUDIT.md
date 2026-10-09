# GitHub audit — dramatic4678565/mosaic

Read-only audit. **No repository, branch, tag, issue or release was modified.** One command was deliberately not run; see Section 3.

Repo: https://github.com/dramatic4678565/mosaic Local: `D:\custode-code-website\web\mosaic\jdjfhfhf` Date: 2026-10-05

---

## SECTION 1 — Actions workflow permission setting

```
$ gh api repos/dramatic4678565/mosaic/actions/permissions/workflow
{"default_workflow_permissions":"write","can_approve_pull_request_reviews":true}
```

`can_approve_pull_request_reviews: **true**` — **the setting is applied.** It is not "SETTING NOT APPLIED".

---

## SECTION 2 — upstream-sync run history

```
$ gh run list --workflow=upstream-sync.yml --limit 10 --json databaseId,status,conclusion,createdAt,headBranch,event
```

| run_id | date | conclusion | final `gh pr create` outcome | PR |
| --- | --- | --- | --- | --- |
| 37259905857 | 2026-10-05 | **success** | `pull request create failed: GraphQL: Resource not accessible by integration (createPullRequest)` | none |
| 37179554744 | 2026-10-04 | **success** | same 403 | none |
| 37093801396 | 2026-10-03 | **success** | same 403 | none |
| 37027540139 | 2026-10-02 | **success** | same 403 | none |
| 37000320984 | 2026-10-02 | **success** | same 403 | none |
| 36998411416 | 2026-10-02 | success | (not inspected — this is the run that produced PR #18) | #18 |
| 36995294551 | 2026-10-02 | failure | — | none |
| 36992143335 | 2026-10-02 | failure | — | none |
| 36989997418 | 2026-10-02 | success | — | none |
| 36987200452 | 2026-10-02 | failure | — | none |

Raw evidence, run 37259905857:

```
gh: Resource not accessible by integration (HTTP 403)
{"message":"Resource not accessible by integration","status":"403"}### token identity
{"message":"Resource not accessible by integration","status":"403"}(GITHUB_TOKEN cannot read /user - expected)
remote: Create a pull request for 'upstream-sync/2026-10-05' on GitHub by visiting:
pull request create failed: GraphQL: Resource not accessible by integration (createPullRequest)
WARN  gh pr create --base main --head upstream-sync/2026-10-05 --title 'chore(repo): sync with upstream/master (ed10ac7dc)'
```

### Every upstream-sync PR ever opened

```
$ gh pr list --search "head:upstream-sync" --state all --limit 10 --json number,title,state,createdAt,mergedAt
[{"createdAt":"2026-10-02T11:45:39Z","mergedAt":"2026-10-02T12:22:15Z","number":18,"state":"MERGED",
  "title":"chore(repo): sync with upstream/master (ed10ac7dc)"}]
```

**Exactly one** upstream-sync PR exists (#18, merged 2026-10-02). None since.

### What the logs prove about the token

- `git push` **succeeds** — the `upstream-sync/<date>` branch is created every run.
- `gh pr create` **always fails** with 403 on `createPullRequest`.
- `GITHUB_TOKEN cannot read /user` is printed and explicitly labelled _expected_.

So token identity cannot be confirmed from inside the run. The push working while the PR fails means `contents: write` is granted and `pull-requests: write` is not being honoured at the GraphQL layer.

---

## SECTION 3 — ⛔ SKIPPED (mutating)

**Not run.** The instruction was to dispatch a fresh run:

```
gh workflow run upstream-sync.yml --ref main
```

That is a `POST` and the workflow itself **pushes a branch and attempts to create a pull request**. Running it would have modified the repository, which the read-only header forbids and which this audit exists to measure. Rule 3 of the header applies: _"If a command would mutate state, SKIP it and note SKIPPED (mutating)"_.

### UNVERIFIED — whether the setting fix works

The newest run is **2026-10-05T03:33:27Z**. The repository setting was enabled after that run, so **no run has ever executed with the setting in place.** There is no evidence either way about the setting's effect, and I will not guess.

**The definitive test is one manual dispatch, and it is yours to run:**

- [CLI] `gh workflow run upstream-sync.yml --ref main`, then `gh run list --workflow=upstream-sync.yml --limit 1` and read the log for `Created pull request` vs `pull request create failed`.

---

## SECTION 4 — Repository hygiene

### 4a. Local branches merged into main

```
$ git branch --merged main | grep -v "^\*\|main"
  chore/rebrand-foundation
  feat/mosaic-dashboard
  fix/collab-self-hosted-room
```

3 deletable locally.

### 4b. Remote branches — 24 total

```
$ gh api repos/dramatic4678565/mosaic/branches --paginate --jq '.[] | .name'
```

| branch | PR state |
| --- | --- |
| `chore/part-1-dev-menu-collab` | MERGED |
| `chore/rebrand-foundation` | MERGED |
| `chore/self-maintaining-infra` | MERGED |
| `chore/single-command-dev-and-hide-upstream-menu` | MERGED |
| `feat/auth-and-sync` | **OPEN** (PR #23, in progress) |
| `feat/mosaic-dashboard` | MERGED |
| `feat/vercel-neon-foundation` | MERGED |
| `fix/ci-and-docker-runtime` | MERGED |
| `fix/ci-flaky-and-redundant` | MERGED |
| `fix/ci-full-history` | MERGED |
| `fix/ci-upstream-fetch` | MERGED |
| `fix/guard-merge-base` | MERGED |
| `fix/lint-ordering` | MERGED |
| `fix/pr-scopes` | MERGED |
| `fix/prettier-formatting` | MERGED |
| `fix/sync-force-push` | MERGED |
| `fix/sync-issue-creation` | MERGED |
| `fix/sync-policy-matcher` | MERGED |
| `fix/sync-pr-creation` | MERGED |
| `upstream-sync/2026-10-02` | MERGED (PR #18) |
| `upstream-sync/2026-10-03` | **no PR** |
| `upstream-sync/2026-10-04` | **no PR** |
| `upstream-sync/2026-10-05` | **no PR** |
| 8 × `upstream/*` | merged upstream refs |

**19 merged branches are still on the remote.** Note that `git branch -r --merged main` does **not** identify them, because every PR is squash-merged and a squashed branch's commits are not ancestors of `main`. PR state is the only reliable signal.

The three `upstream-sync/2026-10-03/04/05` branches are the physical evidence of the failed PR creation: the branch was pushed, the PR was not opened.

### 4c. Tags without releases

```
$ git tag --sort=-creatordate | head -20
v0.1.3  v0.1.2  v0.1.1  v0.1.0  v0.18.1  v0.18.0  v0.16.4  v0.17.6 …
$ gh release list --limit 20
Mosaic v0.1.0    Latest    v0.1.0    2026-10-01T17:03:14Z
```

- 25 tags total; 4 are Mosaic's own (`v0.1.0`–`v0.1.3`).
- **1 release exists (`v0.1.0`).**
- **`v0.1.1`, `v0.1.2`, `v0.1.3` are tagged with no release.**
- 21 inherited upstream tags (`v0.14.x`–`v0.18.x`) are upstream Excalidraw's version numbers sitting in this fork's tag namespace.

### 4d. Open PRs

```
$ gh pr list --state open
23  feat(auth): magic-link accounts, guest migration, board sharing  feat/auth-and-sync  OPEN  2026-10-04T15:19:10Z
```

**1 open PR — PR #23, which is this project's own in-flight work, not a hygiene problem.**

### 4e. Open issues

```
$ gh issue list --state open
```

Empty. No open issues. (Note: the upstream-sync workflow has an `issues: write` path for filing an issue on a red build; it has never had cause to.)

### 4f. Dependabot

```
$ ls .github/dependabot.yml
ABSENT
$ gh api repos/dramatic4678565/mosaic/vulnerability-alerts
{"message":"Vulnerability alerts are disabled.","status":"404"}
```

No Dependabot config **and** vulnerability alerts are switched off at the repo level. Nothing is watching dependencies.

### 4g. Branch protection on `main`

```
$ gh api repos/dramatic4678565/mosaic/branches/main/protection
{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","status":"403"}
```

**Not enabled — and it cannot be enabled on the current plan.** Branch protection is a paid feature for private repos. This is a plan limitation, not a misclick.

### 4h. Description / homepage

```
$ gh api repos/dramatic4678565/mosaic --jq '{description, homepage, private}'
{"description":"Mosaic — visual whiteboard (rebrand of Excalidraw, MIT) Part 1",
 "homepage":"https://jdjfhfhf.vercel.app","private":true}
```

Homepage is set and correct. **The description still says `Part 1`** — stale since Parts 2 and 3 shipped.

### 4i. Runs stuck > 24h

```
$ gh run list --limit 50 --json databaseId,status,createdAt --jq '.[] | select(.status != "completed")'
```

Empty. Nothing stuck or queued.

### 4j. Workflows that never fire

```
$ for each .github/workflows/*.yml: gh run list --workflow=<file> --limit 1
```

| workflow | last run | trigger | why |
| --- | --- | --- | --- |
| `build-docker` | **NEVER FIRED** | `push: branches: [release]` | no `release` branch exists |
| `size-limit` | **NEVER FIRED** | `pull_request: branches: [master]` | this fork's default branch is `main` |
| `test` | **NEVER FIRED** | `push: branches: master` | same |
| `cancel` | 2026-10-05 | pull_request | active |
| `ci` | 2026-10-05 | push/pull_request on `main` | active |
| `docker` | 2026-10-02 | `tags: v*` | active |
| `lint` | 2026-10-05 | pull_request | active |
| `semantic-pr-title` | 2026-10-05 | pull_request | active |
| `test-coverage-pr` | 2026-10-05 | pull_request | active |
| `upstream-sync` | 2026-10-05 | schedule + dispatch | active but PR step failing |

**All three dead workflows still reference upstream's `master` branch or a `release` branch.** They are inherited from Excalidraw and were never retargeted.

Four more are present but disabled: `autorelease-excalidraw.yml.disabled`, `locales-coverage.yml.disabled`, `publish-docker.yml.disabled`, `sentry-production.yml.disabled`.

---

## SECTION 5 — Upstream sync freshness

```
$ git fetch upstream
$ git rev-list --count main..upstream/master
2
$ git rev-list --count upstream/master..main
40
```

**BEHIND BY 2 COMMITS**

```
ed10ac7dc feat(editor): alt-drag the text being edited to duplicate it (#12219)
9ba66ed9b feat(editor): auto increment numbers/lists on duplicate (#12189)
```

`git fetch upstream` refreshes local remote-tracking refs only. It changes no branch, tag, PR or release. The repo is a `blob:none` partial clone (`remote.upstream.partialclonefilter = blob:none`), so this count is accurate.

40 commits ahead is expected and correct — those are this fork's own work.

---

## SECTION 6 — Findings

| ID | Sev | Area | Evidence | Manual action | Effort |
| --- | --- | --- | --- | --- | --- |
| 1 | **P0** | upstream-sync | `gh run view 37259905857 --log` → `pull request create failed: GraphQL: Resource not accessible by integration (createPullRequest)` on all 5 latest runs, all green | Run one dispatch and read the log. If it still 403s, `GITHUB_TOKEN` cannot open PRs on this plan and the workflow needs a PAT | 5 min to test |
| 2 | **P0** | sync correctness | `gh run view 37259905857 --log` → conclusion `success` with no PR opened; branches `upstream-sync/2026-10-03/04/05` exist with no PR | Make the PR step fail the job. A green run that opened nothing is the exact failure mode | 10 min |
| 3 | P1 | release hygiene | `git tag` → `v0.1.1 v0.1.2 v0.1.3`; `gh release list` → only `v0.1.0` | `gh release create v0.1.1 --generate-notes` (and 0.1.2, 0.1.3) | 2 min |
| 4 | P1 | supply chain | `ls .github/dependabot.yml` → ABSENT; `gh api …/vulnerability-alerts` → 404 "disabled" | Add `.github/dependabot.yml`; enable Dependabot security updates in Settings → Code security | 10 min |
| 5 | P2 | repo hygiene | 19 remote branches MERGED but present (`chore/rebrand-foundation`, `fix/*` ×14, `upstream-sync/2026-10-02`, …) | `gh api -X DELETE repos/…/git/refs/heads/<branch>` per branch; **keep `feat/auth-and-sync`** | 15 min |
| 6 | P2 | workflow coverage | `build-docker`, `size-limit`, `test` → NEVER FIRED; triggers reference `master` / `release` | Retarget `master` → `main`, or delete the files if intentionally dropped | 10 min |
| 7 | P2 | sync freshness | `git rev-list --count main..upstream/master` → 2 | None needed if 1 is fixed; otherwise retry the sync | 2 min |
| 8 | P2 | CI integrity | `gh api …/branches/main/protection` → 403 "Upgrade to GitHub Pro or make this repository public" | Make the repo public, or accept that `main` is unprotected. No free fix exists | 1 min or plan change |
| 9 | P3 | repo metadata | `gh api repos/… --jq .description` → `"… (rebrand of Excalidraw, MIT) Part 1"` | Repo → About → drop the trailing `Part 1` | 1 min |
| 10 | P3 | tag namespace | `git tag` → 21 inherited upstream tags (`v0.14.x`–`v0.18.x`) alongside Mosaic's `v0.1.x` | Optional: delete the upstream-inherited tags so versions mean something | 5 min |
| 11 | P3 | branch hygiene | 3 local merged branches: `chore/rebrand-foundation`, `feat/mosaic-dashboard`, `fix/collab-self-hosted-room` | `git branch -d <name>` | 1 min |

### Not issues

- **Section 1 passed.** `can_approve_pull_request_reviews: true`.
- PR #23 is expected open work, not a leak.
- No open issues, no stuck runs, no new env vars, homepage set.

---

## SECTION 7 — Manual actions

Everything here is yours; read-only mode prevented all of it.

- [CLI] `gh workflow run upstream-sync.yml --ref main` — the one test that answers finding 1. Then `gh run list --workflow=upstream-sync.yml --limit 1`.
- [UI] Repo → Settings → Code security → enable **Dependabot security updates**.
- [CLI] Add `.github/dependabot.yml` (npm + github-actions ecosystems).
- [CLI] `gh release create v0.1.1 --generate-notes` — repeat for `v0.1.2`, `v0.1.3`.
- [CLI] `gh api -X DELETE repos/dramatic4678565/mosaic/git/refs/heads/chore/rebrand-foundation` — repeat for the other 18 merged branches. **Do not delete `feat/auth-and-sync`.**
- [CLI] `gh api -X DELETE repos/dramatic4678565/mosaic/git/refs/heads/upstream-sync/2026-10-03` — also `2026-10-04`, `2026-10-05`, once finding 1 is fixed.
- [UI] Repo → About → edit description to `Mosaic — visual whiteboard (rebrand of Excalidraw, MIT)` (drop `Part 1`).
- [CLI] `git branch -d chore/rebrand-foundation feat/mosaic-dashboard fix/collab-self-hosted-room`
- [CLI] Edit `.github/workflows/size-limit.yml` and `test.yml`: `master` → `main`.
- [UI] Decide on `build-docker.yml`: create a `release` branch, retarget the trigger, or delete the file.
- [UI] Repo → Settings → General → decide whether to make it public (unlocks branch protection) or accept an unprotected `main`.

---

**Not committed, as instructed. Left on disk for review.**
