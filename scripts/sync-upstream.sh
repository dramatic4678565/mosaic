#!/usr/bin/env bash
#
# Sync Mosaic with upstream Excalidraw.
#
# Merges upstream/master into a dated branch, resolves conflicts per the policy in
# scripts/sync-upstream.policy.json, runs the full build, and then either opens a
# PR (green) or files an issue (red).
#
# This script NEVER merges into main and NEVER pushes to main. The only remote
# write is a feature branch plus a PR (or an issue). That is a hard product rule,
# not an oversight — see UPSTREAM_SYNC.md.
#
# Usage:
#   scripts/sync-upstream.sh              # full sync, open PR on success
#   scripts/sync-upstream.sh --no-pr      # sync and verify only, do not push
#   scripts/sync-upstream.sh --dry-run    # merge + resolve, then abort
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

POLICY="scripts/sync-upstream.policy.json"
OPEN_PR=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --no-pr)   OPEN_PR=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mFAIL\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Helpers that reference functions defined further down. Bash resolves function
# calls at call time, so declaration order does not matter.
# ---------------------------------------------------------------------------

# Files where Mosaic's version wins, per the shared policy.
#
# Pattern shapes and what they mean:
#   "path/to/file"   exact match only
#   "dir/*"          direct children of dir/ only
#   "dir/**"         anything under dir/, at any depth
#
# The one-level vs many-level distinction is NOT cosmetic. The locales case is
# why: the policy lists `packages/excalidraw/locales/en.json` by exact name
# precisely so `de-DE.json`, `zh-CN.json` and the other 56 Crowdin-managed
# locales do not match and correctly take upstream. Treating `dir/*` as
# "recursive" would let one broad pattern quietly hand every translation
# upstream and discard the rebrand of them.
is_branded_file() {
  local path="$1" pattern dir rest
  for pattern in "${OURS_PATTERNS[@]}"; do
    if [[ "$path" == "$pattern" ]]; then
      return 0
    fi
    if [[ "$pattern" == *"/**" ]]; then
      dir="${pattern%/**}/"
      if [[ "$path" == "$dir"* ]]; then
        return 0
      fi
    elif [[ "$pattern" == *"/*" ]]; then
      dir="${pattern%/*}/"
      if [[ "$path" == "$dir"* ]]; then
        rest="${path#"$dir"}"
        # Direct child only: a slash in the remainder means it is nested deeper.
        if [[ "$rest" != */* ]]; then
          return 0
        fi
      fi
    fi
  done
  return 1
}

# Where the diff to paste into the issue comes from.
failure_diff() {
  git --no-pager diff --stat HEAD 2>/dev/null || true
  git --no-pager diff HEAD -- 2>/dev/null | head -n 400 || true
}

# On failure: abort the merge, leave main untouched, and file an issue.
# Never pushes. See UPSTREAM_SYNC.md.
failure_report() {
  local stage="$1" _unused="$2"
  local diff
  diff="$(failure_diff)"

  log "aborting the merge; main is untouched"
  git merge --abort 2>/dev/null || true
  git reset --hard main >/dev/null 2>&1 || true
  git checkout main >/dev/null 2>&1 || true
  git branch -D "$SYNC_BRANCH" >/dev/null 2>&1 || true

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    local body_file
    body_file="$(mktemp)"
    failure_issue_body "$stage" "$diff" > "$body_file"

    # Create the label first, then the issue *without* --label, then apply the
    # label. `gh issue create --label x` fails outright when x does not exist,
    # and this is the failure path — the worst possible moment to swallow an
    # error silently, because the issue is the only record that the sync failed.
    gh label create "$PR_LABEL" --color "0E8A16" \
      --description "Automated sync from excalidraw/excalidraw" >/dev/null 2>&1 || true

    local issue_url
    if issue_url="$(gh issue create \
          --title "Upstream sync failed at ${stage} ($(date +%F))" \
          --body-file "$body_file" 2>&1)"; then
      gh issue edit "$issue_url" --add-label "$PR_LABEL" >/dev/null 2>&1 || true
      warn "issue opened: $issue_url"
    else
      warn "could not open the issue. gh said:"
      printf '%s\n' "$issue_url" | sed 's/^/    /' >&2
    fi
    rm -f "$body_file"
  else
    warn "not pushing anything. Inspect the failure locally:"
    warn "  git checkout main && git merge $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  fi

  exit 1
}

failure_issue_body() {
  local stage="$1" diff="$2"
  cat <<EOF
The automated upstream sync merged **$BEHIND** upstream commit(s) but **$stage failed**.

Per \`UPSTREAM_SYNC.md\` nothing was pushed. Reproduce locally with:

\`\`\`bash
git checkout main
git merge $UPSTREAM_REMOTE/$UPSTREAM_BRANCH --no-commit --no-ff
# resolve conflicts per the policy, then:
yarn install && yarn build:all && yarn test:all
\`\`\`

Conflict resolutions applied before the failure:

\`\`\`
$(git --no-pager diff --name-only --diff-filter=U 2>/dev/null | while read -r f; do
  if is_branded_file "$f"; then echo "OURS   $f"; else echo "THEIRS $f"; fi
done)
\`\`\`

## Diff at point of failure

\`\`\`diff
$diff
\`\`\`
EOF
}

sync_pr_body() {
  local ref="$1" behind="$2" sha
  sha="$(git rev-parse --short "$ref")"
  cat <<EOF
Automated merge of upstream \`$UPSTREAM_REMOTE/$UPSTREAM_BRANCH\` (\`$sha\`, $behind commits ahead).

## How conflicts were resolved

Per [UPSTREAM_SYNC.md](../blob/main/UPSTREAM_SYNC.md):

- **Mosaic wins** for branded files — brand artwork, \`@mosaic/brand\`, favicons/PWA assets,
  \`packages/excalidraw/locales/en.json\`, and Mosaic-only paths.
- **Upstream wins** for everything else, so security and bug fixes land as-is.

## Review checklist

- [ ] \`yarn install && yarn build:all\` green
- [ ] \`yarn test:all\` green
- [ ] \`node scripts/brand/verify-internals.js\` still passes (no internal identifier renamed)
- [ ] \`yarn e2e\` green, including the zero-visible-\"Excalidraw\" audit
- [ ] Locale diff reviewed: only \`en.json\` should change unless upstream added keys
- [ ] **A human reviews and merges this.** Sync never auto-merges.
EOF
}

# ---------------------------------------------------------------------------
# Read the shared policy so this script and the PowerShell one cannot drift.
# ---------------------------------------------------------------------------
[[ -f "$POLICY" ]] || die "policy file not found: $POLICY"

read_policy() {
  # $1 = json key (string value or array)
  node -e '
    const fs = require("fs");
    const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const key = process.argv[2];
    const v = p[key];
    if (Array.isArray(v)) { console.log(v.join("\n")); }
    else { console.log(v); }
  ' "$POLICY" "$1"
}

UPSTREAM_REMOTE="$(read_policy upstreamRemote)"
UPSTREAM_BRANCH="$(read_policy upstreamBranch)"
PR_LABEL="$(read_policy prLabel)"
BRANCH_PREFIX="$(read_policy branchPrefix)"
mapfile -t OURS_PATTERNS < <(read_policy oursPatterns)

log "policy loaded from $POLICY"
log "upstream=$UPSTREAM_REMOTE/$UPSTREAM_BRANCH  branch=${BRANCH_PREFIX}/$(date +%F)"

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
[[ -d .git ]] || die "not a git repository"

if [[ -n "$(git status --porcelain)" ]]; then
  die "working tree is not clean. Commit or stash first."
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$CURRENT_BRANCH" != "main" ]] || die "refusing to run on main. Check out a branch first."

git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1 \
  || die "remote '$UPSTREAM_REMOTE' not found. Run: git remote add $UPSTREAM_REMOTE https://github.com/excalidraw/excalidraw.git"

command -v gh >/dev/null 2>&1 || warn "'gh' not found; PR creation will be skipped"

# ---------------------------------------------------------------------------
# Fetch and decide whether there is anything to do
# ---------------------------------------------------------------------------
log "fetching $UPSTREAM_REMOTE"
git fetch "$UPSTREAM_REMOTE" --prune

if git merge-base --is-ancestor "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" main; then
  log "main already contains $UPSTREAM_REMOTE/$UPSTREAM_BRANCH — nothing to sync"
  exit 0
fi

BEHIND="$(git rev-list --count main.."$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")"
log "upstream is $BEHIND commit(s) ahead of main"

SYNC_BRANCH="${BRANCH_PREFIX}/$(date +%F)"

# A re-run on the same day reuses the branch rather than colliding with the
# remote branch name.
if git show-ref --verify --quiet "refs/heads/$SYNC_BRANCH"; then
  warn "local branch $SYNC_BRANCH exists; deleting it first"
  git branch -D "$SYNC_BRANCH" >/dev/null
fi

log "creating $SYNC_BRANCH"
git checkout -b "$SYNC_BRANCH" main >/dev/null

# ---------------------------------------------------------------------------
# Merge without committing, so we can resolve and verify before anything is
# written to the remote.
# ---------------------------------------------------------------------------
log "merging $UPSTREAM_REMOTE/$UPSTREAM_BRANCH (no-commit)"
set +e
git merge "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" --no-commit --no-ff
MERGE_EXIT=$?
set -e

# ---------------------------------------------------------------------------
# Resolve conflicts
# ---------------------------------------------------------------------------
mapfile -t CONFLICTED < <(git diff --name-only --diff-filter=U)

if [[ ${#CONFLICTED[@]} -gt 0 ]]; then
  warn "${#CONFLICTED[@]} conflicted file(s)"

  # `printf | while` runs the loop in a subshell, which is fine here because we
  # only call git and echo from inside it — no variable needs to escape.
  printf '%s\n' "${CONFLICTED[@]}" | while IFS= read -r path; do
    if is_branded_file "$path"; then
      echo "  OURS   $path"
      git checkout --ours -- "$path"
    else
      echo "  THEIRS $path"
      git checkout --theirs -- "$path"
    fi
    git add -- "$path"
  done

  if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
    die "some conflicts remain unresolved"
  fi
  MERGE_EXIT=0
fi

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
log "installing dependencies"
yarn install --frozen-lockfile

log "building editor and dashboard"
if ! yarn build:all; then
  warn "build failed"
  failure_report "build" ""
  exit 1
fi

log "running tests"
if ! yarn test:all; then
  warn "tests failed"
  failure_report "tests" ""
  exit 1
fi

if [[ "$DRY_RUN" == "1" ]]; then
  log "--dry-run: aborting the merge and leaving the tree clean"
  git merge --abort 2>/dev/null || git reset --hard main
  git checkout main >/dev/null
  git branch -D "$SYNC_BRANCH" >/dev/null 2>&1 || true
  exit 0
fi

# ---------------------------------------------------------------------------
# Commit and publish
# ---------------------------------------------------------------------------
log "committing the merge"
git commit -m "chore(upstream): merge upstream/master ($UPSTREAM_BRANCH@$(git rev-parse --short "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"))" \
  -m "Automated sync. Conflicts resolved per UPSTREAM_SYNC.md:
branded files keep the Mosaic version, everything else takes upstream." \
  -m "Co-Authored-By: opencode <opencode@github.com>"

if [[ "$OPEN_PR" == "0" ]]; then
  log "--no-pr: leaving the branch local at $SYNC_BRANCH"
  exit 0
fi

# Force-with-lease, and why it is safe here.
#
# A re-run on the same day (manual dispatch, or the cron firing after a previous
# run) recreates `upstream-sync/<date>` with different history, so a plain push
# is rejected as non-fast-forward. That left the branch pushed by the first run
# and the second run reporting a push failure with no PR and no sync.
#
# This branch is bot-owned, dated, and never hand-edited, so rewriting it is the
# correct action — and `--force-with-lease` (not `--force`) refuses to do it if
# anyone else has moved the branch since the last fetch, which is the only
# scenario where clobbering would lose someone else's work.
log "pushing $SYNC_BRANCH"
if ! git push --force-with-lease -u origin "$SYNC_BRANCH"; then
  die "could not push $SYNC_BRANCH (non-fast-forward and no matching lease). If a previous run pushed this branch, fetch and inspect before retrying."
fi

# ---------------------------------------------------------------------------
# Open the PR
#
# Ordering matters: the PR is created first and the label applied afterwards.
# `gh pr create --label x` fails outright when label x does not exist, so
# creating the label first and *silencing* its failure left a run that merged,
# built, pushed — and then reported "could not open the PR" with no reason.
# Two independent steps, each with its own diagnostic, cannot mask each other.
# ---------------------------------------------------------------------------
if ! command -v gh >/dev/null 2>&1; then
  warn "'gh' not found; branch pushed to $SYNC_BRANCH but no PR opened"
  exit 0
fi

PR_BODY_FILE="$(mktemp)"
trap 'rm -f "$PR_BODY_FILE"' EXIT
sync_pr_body "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" "$BEHIND" > "$PR_BODY_FILE"

PR_TITLE="chore(upstream): sync with upstream/master ($(git rev-parse --short "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"))"

if PR_URL="$(gh pr create --title "$PR_TITLE" --body-file "$PR_BODY_FILE" 2>&1)"; then
  log "PR opened: $PR_URL"

  # Label last, and tolerantly: a missing label must never look like a failed
  # sync.
  gh label create "$PR_LABEL" --color "0E8A16" \
    --description "Automated sync from excalidraw/excalidraw" >/dev/null 2>&1 || true
  if ! gh pr edit "$PR_URL" --add-label "$PR_LABEL" >/dev/null 2>&1; then
    warn "PR opened but label '$PR_LABEL' could not be applied"
  fi
else
  warn "could not open the PR. gh said:"
  printf '%s\n' "$PR_URL" | sed 's/^/    /' >&2
  warn "branch $SYNC_BRANCH was pushed; open the PR manually:"
  warn "  gh pr create --base main --head $SYNC_BRANCH --title '$PR_TITLE'"
fi