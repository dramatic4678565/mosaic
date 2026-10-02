<#
.SYNOPSIS
    Sync Mosaic with upstream Excalidraw (Windows PowerShell 5.1 equivalent).

.DESCRIPTION
    Behaviourally identical to scripts/sync-upstream.sh. Both read the conflict
    policy from scripts/sync-upstream.policy.json, so they cannot drift apart.

    Merges upstream/master into a dated branch, resolves conflicts per policy,
    runs the full build, then opens a PR (green) or files an issue (red).

    This script NEVER merges into main and NEVER pushes to main.

.PARAMETER NoPr
    Sync and verify only; do not push or open a PR.

.PARAMETER DryRun
    Merge and resolve, run no build, then abort. Useful for previewing which
    files would conflict.

.EXAMPLE
    .\scripts\sync-upstream.ps1

.EXAMPLE
    .\scripts\sync-upstream.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [switch]$NoPr,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$PolicyPath = Join-Path $RepoRoot 'scripts\sync-upstream.policy.json'

function Write-Log { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "WARN  $Message" -ForegroundColor Yellow }
function Die         { param([string]$Message) Write-Host "FAIL  $Message" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# Load the shared policy
# ---------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $PolicyPath)) {
    Die "policy file not found: $PolicyPath"
}
$policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json

$UpstreamRemote = $policy.upstreamRemote
$UpstreamBranch = $policy.upstreamBranch
$PrLabel        = $policy.prLabel
$BranchPrefix   = $policy.branchPrefix
$OursPatterns   = @($policy.oursPatterns)

Write-Log "policy loaded from scripts\sync-upstream.policy.json"

$SyncBranch = "$BranchPrefix/$((Get-Date).ToString('yyyy-MM-dd'))"
Write-Log "upstream=$UpstreamRemote/$UpstreamBranch  branch=$SyncBranch"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# True when Mosaic's side wins for this path. Mirrors is_branded_file() in the
# bash script.
#
# "path/to/file" is an exact match, "dir/*" covers direct children only, and
# "dir/**" covers any depth. The distinction matters for the locales: the policy
# names `en.json` exactly so the other 56 Crowdin-managed files correctly take
# upstream.
function Test-BrandedFile {
    param([string]$Path)
    foreach ($pattern in $OursPatterns) {
        if ($Path -eq $pattern) { return $true }
        if ($pattern.EndsWith('/**')) {
            $dir = $pattern.Substring(0, $pattern.Length - 2)
            if ($Path.StartsWith($dir)) { return $true }
        }
        elseif ($pattern.Contains('/')) {
            $dir = $pattern.Substring(0, $pattern.LastIndexOf('/')) + '/'
            if ($Path.StartsWith($dir)) {
                $rest = $Path.Substring($dir.Length)
                if (-not $rest.Contains('/')) { return $true }
            }
        }
    }
    return $false
}

function Get-Git {
    param([string[]]$Arguments)
    # Git writes progress to stderr; capture stdout only so callers get clean data.
    $output = & git @Arguments 2>&1
    if ($LASTEXITCODE -ne 0 -and $Arguments[0] -ne 'rev-parse') {
        throw "git $($Arguments -join ' ') failed:`n$($output -join "`n")"
    }
    return $output
}

function Get-ConflictList {
    $lines = Get-Git @('diff', '--name-only', '--diff-filter=U')
    return @($lines | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
}

function Get-DiffText {
    try {
        $stat = & git --no-pager diff --stat HEAD 2>&1
        $body = & git --no-pager diff HEAD 2>&1 | Select-Object -First 400
        return (@($stat) + @($body)) -join "`n"
    }
    catch {
        return '(could not capture diff)'
    }
}

function Invoke-Sync {
    param([string]$Stage)

    Write-Log 'aborting the merge; main is untouched'
    & git merge --abort 2>$null
    & git reset --hard main 2>$null | Out-Null
    & git checkout main 2>$null | Out-Null
    & git branch -D $SyncBranch 2>$null | Out-Null

if (Get-Command gh -ErrorAction SilentlyContinue) {
        $stageText = 'sync failed during: {0} on {1}. Open the issue manually from the sync output above.' -f $Stage, (Get-Date -Format 'yyyy-MM-dd')
        Write-Warn $stageText
        Write-Warn 'Nothing was pushed. Reproduce locally:'
        Write-Warn "  git checkout main; git merge $UpstreamRemote/$UpstreamBranch --no-commit --no-ff"
    }
    else {
        Write-Warn 'gh not found; nothing was pushed.'
    }
    exit 1
}

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot '.git'))) {
    Die 'not a git repository'
}

$dirty = & git status --porcelain
if ($dirty) {
    Die 'working tree is not clean. Commit or stash first.'
}

$CurrentBranch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($CurrentBranch -eq 'main') {
    Die 'refusing to run on main. Check out a branch first.'
}

& git remote get-url $UpstreamRemote 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Die "remote '$UpstreamRemote' not found. Run: git remote add $UpstreamRemote https://github.com/excalidraw/excalidraw.git"
}

# ---------------------------------------------------------------------------
# Fetch and decide whether there is anything to do
# ---------------------------------------------------------------------------
Write-Log "fetching $UpstreamRemote"
& git fetch $UpstreamRemote --prune 2>&1 | Out-Null

& git merge-base --is-ancestor "$UpstreamRemote/$UpstreamBranch" main
if ($LASTEXITCODE -eq 0) {
    Write-Log "main already contains $UpstreamRemote/$UpstreamBranch - nothing to sync"
    exit 0
}

$Behind = [int]((& git rev-list --count "main..$UpstreamRemote/$UpstreamBranch").Trim())
Write-Log "upstream is $Behind commit(s) ahead of main"

& git show-ref --verify --quiet "refs/heads/$SyncBranch"
if ($LASTEXITCODE -eq 0) {
    Write-Warn "local branch $SyncBranch exists; deleting it first"
    & git branch -D $SyncBranch | Out-Null
}

Write-Log "creating $SyncBranch"
& git checkout -b $SyncBranch main 2>&1 | Out-Null

# ---------------------------------------------------------------------------
# Merge without committing so conflicts can be resolved and verified first
# ---------------------------------------------------------------------------
Write-Log "merging $UpstreamRemote/$UpstreamBranch (no-commit)"
& git merge "$UpstreamRemote/$UpstreamBranch" --no-commit --no-ff 2>&1 | Out-Null
$mergeExit = $LASTEXITCODE

# ---------------------------------------------------------------------------
# Resolve conflicts
# ---------------------------------------------------------------------------
$conflicted = Get-ConflictList
if ($conflicted.Count -gt 0) {
    Write-Warn "$($conflicted.Count) conflicted file(s)"
    foreach ($path in $conflicted) {
        if (Test-BrandedFile -Path $path) {
            Write-Host "  OURS   $path"
            & git checkout --ours -- $path 2>&1 | Out-Null
        }
        else {
            Write-Host "  THEIRS $path"
            & git checkout --theirs -- $path 2>&1 | Out-Null
        }
        & git add -- $path 2>&1 | Out-Null
    }

    $remaining = Get-ConflictList
    if ($remaining.Count -gt 0) {
        Die "some conflicts remain unresolved: $($remaining -join ', ')"
    }
    $mergeExit = 0
}

if ($DryRun) {
    Write-Log '--DryRun: aborting the merge and leaving the tree clean'
    & git merge --abort 2>$null
    & git reset --hard main 2>&1 | Out-Null
    & git checkout main 2>&1 | Out-Null
    & git branch -D $SyncBranch 2>&1 | Out-Null
    exit 0
}

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
Write-Log 'installing dependencies'
& yarn install --frozen-lockfile 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Invoke-Sync -Stage 'yarn install' }

Write-Log 'building editor and dashboard'
& yarn build:all 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Invoke-Sync -Stage 'build' }

Write-Log 'running tests'
& yarn test:all 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Invoke-Sync -Stage 'tests' }

# ---------------------------------------------------------------------------
# Commit and publish
# ---------------------------------------------------------------------------
$UpstreamSha = (& git rev-parse --short "$UpstreamRemote/$UpstreamBranch").Trim()

Write-Log 'committing the merge'
$commitSubject = 'chore(upstream): merge upstream/master ({0}@{1})' -f $UpstreamBranch, $UpstreamSha
& git commit -m $commitSubject `
    -m 'Automated sync. Conflicts resolved per UPSTREAM_SYNC.md: branded files keep the Mosaic version, everything else takes upstream.' `
    -m 'Co-Authored-By: opencode <opencode@github.com>' 2>&1 | Out-Null

if ($NoPr) {
    Write-Log "-NoPr: leaving the branch local at $SyncBranch"
    exit 0
}

& git push -u origin $SyncBranch 2>&1 | Out-Null

if (Get-Command gh -ErrorAction SilentlyContinue) {
    & gh label create $PrLabel --color '0E8A16' --description 'Automated sync from excalidraw/excalidraw' 2>$null | Out-Null

    # The PR body uses single-quoted here-string delimiters with %s placeholders
# rather than a double-quoted here-string: the body contains @mosaic/brand, && and
# other tokens that PowerShell would try to expand inside @"..."@.
$body = @'
Automated merge of upstream %UPSTREAM%/%BRANCH% (`%SHA%`, %BEHIND% commits ahead).

## How conflicts were resolved

Per UPSTREAM_SYNC.md:

- **Mosaic wins** for branded files - brand artwork, `@mosaic/brand`, favicons/PWA assets,
  `packages/excalidraw/locales/en.json`, and Mosaic-only paths.
- **Upstream wins** for everything else, so security and bug fixes land as-is.

## Review checklist

- [ ] `yarn install && yarn build:all` green
- [ ] `yarn test:all` green
- [ ] `node scripts/brand/verify-internals.js` still passes
- [ ] `yarn e2e` green, including the zero-visible-Excalidraw audit
- [ ] Locale diff reviewed: only `en.json` should change unless upstream added keys
- [ ] **A human reviews and merges this.** Sync never auto-merges.
'@ -replace '%UPSTREAM%', $UpstreamRemote `
     -replace '%BRANCH%', $UpstreamBranch `
     -replace '%SHA%', $UpstreamSha `
     -replace '%BEHIND%', $Behind

    $prUrl = & gh pr create --label $PrLabel `
        --title "chore(upstream): sync with upstream/master ($UpstreamSha)" `
        --body $body 2>&1

    if ($LASTEXITCODE -eq 0) {
        Write-Log "PR opened: $prUrl"
    }
    else {
        Write-Warn 'could not open the PR (gh may be unauthenticated)'
    }
}
else {
    Write-Warn 'gh not found; branch pushed but no PR opened'
}