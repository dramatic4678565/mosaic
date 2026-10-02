#!/usr/bin/env bash
#
# Tests the sync conflict-policy matcher.
#
# This exists because the matcher had a bug that silently mis-resolved every
# directory pattern: `memory/*` and `scripts/brand/*` matched nothing, and the
# first "fix" that made them match also made them match *recursively*, which would
# have handed all 56 Crowdin-managed locale files to upstream and discarded the
# rebrand of them. Neither failure produced an error — it just quietly resolved
# conflicts the wrong way.
#
# A matcher that decides "keep our branding or take theirs" has no business
# being untested, however small it looks.
#
# Run: bash scripts/test-sync-policy.sh
set -uo pipefail

# Patterns duplicated from scripts/sync-upstream.policy.json on purpose: if the
# policy file changes, this test must be updated to match, and that edit is the
# prompt to re-check the matcher.
OURS_PATTERNS=(
  "mosaic-brand/**"
  "packages/mosaic-brand/**"
  "excalidraw-app/public/**"
  "packages/excalidraw/locales/en.json"
  "scripts/brand/**"
  "memory/**"
  "REBRAND.md"
  "UPSTREAM_SYNC.md"
  "NOTICE"
  "mosaic-dashboard/**"
)

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
        if [[ "$rest" != */* ]]; then
          return 0
        fi
      fi
    fi
  done
  return 1
}

failures=0

expect() {
  local expected="$1" path="$2" actual
  if is_branded_file "$path"; then
    actual="ours"
  else
    actual="theirs"
  fi
  if [[ "$actual" == "$expected" ]]; then
    printf 'ok    %-7s %s\n' "$expected" "$path"
  else
    printf 'FAIL  %s: expected %s, got %s\n' "$path" "$expected" "$actual"
    failures=$((failures + 1))
  fi
}

echo "=== branded: Mosaic keeps these (--ours) ==="
expect ours "mosaic-brand/mosaic.svg"
expect ours "packages/mosaic-brand/src/index.ts"
expect ours "excalidraw-app/public/favicon.svg"
expect ours "packages/excalidraw/locales/en.json"
expect ours "scripts/brand/verify-internals.js"
expect ours "scripts/brand/generate-assets.ps1"
expect ours "memory/MEMORY.md"
expect ours "memory/REFERENCE.md"
expect ours "REBRAND.md"
expect ours "NOTICE"
expect ours "mosaic-dashboard/src/App.tsx"
# recursive patterns must reach any depth
expect ours "mosaic-dashboard/src/deep/nested/Thing.tsx"
expect ours "packages/mosaic-brand/a/b/c/d.ts"

echo
echo "=== not branded: upstream wins these (--theirs) ==="
# The critical one: only en.json is branded. The other 56 are Crowdin-managed and
# a matcher that grabbed them would discard the rebrand of every translation.
expect theirs "packages/excalidraw/locales/de-DE.json"
expect theirs "packages/excalidraw/locales/zh-CN.json"
expect theirs "packages/excalidraw/locales/ar-SA.json"
expect theirs "packages/excalidraw/App.tsx"
expect theirs "excalidraw-app/App.tsx"
expect theirs "packages/element/src/shape.ts"
expect theirs "packages/common/src/constants.ts"
# Mosaic tooling that is NOT branded must still take upstream
expect theirs "scripts/build-e2e.mjs"
expect theirs "scripts/sync-upstream.sh"
expect theirs "docker/nginx.conf"
expect theirs "docker-compose.yml"
expect theirs "README.md"

echo
if [[ $failures -eq 0 ]]; then
  echo "ALL PASS"
else
  echo "$failures FAILED"
fi
exit $failures
