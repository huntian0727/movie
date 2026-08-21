[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$Message,

  [switch]$SkipChecks,
  [switch]$AllowProtectedBranch,
  [switch]$SkipMainUpdate,

  [ValidatePattern("^[A-Za-z0-9._/-]+$")]
  [string]$MainBranch = "main",

  # Safe inspection mode used by maintainers and automated validation. It never stages, commits, fetches, rebases, or pushes.
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [switch]$Capture,
    [switch]$AllowFailure
  )

  if ($Capture) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $output = @(& git @Arguments 2>&1)
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorAction
    }
    if (-not $AllowFailure -and $exitCode -ne 0) {
      throw "git $($Arguments -join ' ') failed:`n$($output -join [Environment]::NewLine)"
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
  }

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $nativeOutput = @(& git @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  foreach ($line in $nativeOutput) { Write-Host ([string]$line) }
  if (-not $AllowFailure -and $exitCode -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $exitCode."
  }
  return $exitCode
}

function Get-PendingPaths {
  $paths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($arguments in @(
    @("diff", "--name-only", "--diff-filter=ACMR"),
    @("diff", "--cached", "--name-only", "--diff-filter=ACMR"),
    @("ls-files", "--others", "--exclude-standard")
  )) {
    $result = Invoke-Git -Arguments $arguments -Capture
    foreach ($line in $result.Output) {
      $value = ([string]$line).Trim()
      if ($value) { [void]$paths.Add($value) }
    }
  }
  return @($paths)
}

function Test-BlockedPath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  $normalized = $RelativePath.Replace("\", "/").TrimStart("./").ToLowerInvariant()
  $leaf = [System.IO.Path]::GetFileName($normalized)
  if ($leaf -eq ".env.example") { return $false }

  if ($leaf -eq ".env" -or $leaf.StartsWith(".env.")) { return $true }
  if ($normalized -match "(^|/)(node_modules|dist|dist-main|dist-renderer|release|coverage|logs?|media-cache|cache|\.cache|tmp|temp|test-results|playwright-report|diagnostics?|diagnostic-bundles?)(/|$)") { return $true }
  if ($leaf -match "(?i)(^|[._-])(token|secret|credentials?|private[._-]?key)([._-]|$)") { return $true }
  if ($leaf -match "(?i)\.(pem|key|p12|pfx|jks|keystore|db|sqlite|sqlite3|log|tmp|temp|bak)$") { return $true }
  if ($leaf -match "(?i)^(npm-debug|yarn-debug|yarn-error|pnpm-debug).*\.log$") { return $true }
  if ($leaf -match "(?i)^(diagnostics?|support-bundle).*(\.zip|\.tar|\.gz)$") { return $true }
  return $false
}

function Test-SensitiveContent {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  $normalized = $RelativePath.Replace("\", "/")
  if ($normalized -eq "scripts/finish-and-push.ps1") { return $false }
  $absolutePath = Join-Path $script:RepositoryRoot $RelativePath
  if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) { return $false }

  $fileInfo = Get-Item -LiteralPath $absolutePath
  if ($fileInfo.Length -gt 20MB) {
    throw "Large pending file is blocked ($([Math]::Round($fileInfo.Length / 1MB, 1)) MiB): $RelativePath"
  }
  if ($fileInfo.Length -gt 2MB) { return $false }

  $content = [System.IO.File]::ReadAllText($absolutePath)
  $highConfidencePatterns = @(
    "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "ghp_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "AKIA[0-9A-Z]{16}",
    '(?im)^\s*(api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*[''"]?[A-Za-z0-9_./+=-]{12,}'
  )
  foreach ($pattern in $highConfidencePatterns) {
    if ($content -match $pattern) { return $true }
  }
  return $false
}

function Assert-PendingFilesSafe {
  $blocked = [System.Collections.Generic.List[string]]::new()
  foreach ($relativePath in Get-PendingPaths) {
    if ((Test-BlockedPath -RelativePath $relativePath) -or (Test-SensitiveContent -RelativePath $relativePath)) {
      $blocked.Add($relativePath)
    }
  }
  if ($blocked.Count -gt 0) {
    throw "Sensitive or generated files are blocked from commit:`n - $($blocked -join "`n - ")"
  }
}

function Assert-DeliveryRecordPresent {
  $recordPattern = '^docs/ai/deliveries/\d{4}-\d{2}-\d{2}-[A-Za-z0-9._-]+\.md$'
  $records = @(Get-PendingPaths | Where-Object {
    $_.Replace("\", "/") -match $recordPattern
  })
  if ($records.Count -eq 0) {
    throw "Every delivery must add or update docs/ai/deliveries/YYYY-MM-DD-<topic>.md. Copy TEMPLATE.md and record actual changes, verification, and risks."
  }

  $requiredSections = @("## Context", "## Changes", "## Verification", "## Risks and follow-up")
  foreach ($relativePath in $records) {
    $absolutePath = Join-Path $script:RepositoryRoot $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
      throw "Delivery record is missing from the working tree: $relativePath"
    }
    $content = Get-Content -LiteralPath $absolutePath -Raw -Encoding utf8
    if ($content.Length -lt 200) {
      throw "Delivery record is too short to be useful: $relativePath"
    }
    foreach ($section in $requiredSections) {
      if (-not $content.Contains($section)) {
        throw "Delivery record '$relativePath' is missing required section '$section'."
      }
    }
  }
}

function Get-QualityScripts {
  $packagePath = Join-Path $script:RepositoryRoot "package.json"
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { return @() }
  $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
  if (-not $package.scripts) { return @() }

  $available = @{}
  foreach ($property in $package.scripts.PSObject.Properties) { $available[$property.Name] = $true }
  $orderedCandidates = @(
    "lint", "typecheck", "test", "build",
    "test:electron-smoke", "electron:smoke", "test:electron",
    "test:e2e", "e2e"
  )
  $selected = [System.Collections.Generic.List[string]]::new()
  $groups = @(
    @("lint"), @("typecheck"), @("test"), @("build"),
    @("test:electron-smoke", "electron:smoke", "test:electron"),
    @("test:e2e", "e2e")
  )
  foreach ($group in $groups) {
    foreach ($candidate in $group) {
      if ($available.ContainsKey($candidate)) {
        $selected.Add($candidate)
        break
      }
    }
  }
  return @($selected | Where-Object { $orderedCandidates -contains $_ })
}

function Invoke-QualityChecks {
  param([string[]]$Scripts)

  $npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }
  foreach ($scriptName in $Scripts) {
    Write-Host "[check] npm run $scriptName" -ForegroundColor Cyan
    & $npm run $scriptName
    if ($LASTEXITCODE -ne 0) { throw "Quality check failed: npm run $scriptName" }
  }
}

try {
  $rootResult = Invoke-Git -Arguments @("rev-parse", "--show-toplevel") -Capture
  $script:RepositoryRoot = ([string]$rootResult.Output[0]).Trim()
  Set-Location -LiteralPath $script:RepositoryRoot

  $insideWorkTree = Invoke-Git -Arguments @("rev-parse", "--is-inside-work-tree") -Capture
  if (([string]$insideWorkTree.Output[0]).Trim() -ne "true") { throw "Current directory is not a Git worktree." }

  $branchResult = Invoke-Git -Arguments @("symbolic-ref", "--quiet", "--short", "HEAD") -Capture -AllowFailure
  if ($branchResult.ExitCode -ne 0 -or $branchResult.Output.Count -eq 0) { throw "Detached HEAD is not allowed." }
  $branch = ([string]$branchResult.Output[0]).Trim()
  if (($branch -eq "main" -or $branch -eq "master") -and -not $AllowProtectedBranch) {
    throw "Protected branch '$branch' is blocked. Create an ai/<task-name> branch, or use -AllowProtectedBranch only with explicit user authorization."
  }
  if ($Message -notmatch "^(feat|fix|refactor|test|docs|chore)(\([^)]+\))?:\s+.+") {
    throw "Commit message must use feat:, fix:, refactor:, test:, docs:, or chore:."
  }

  $remoteResult = Invoke-Git -Arguments @("remote", "get-url", "origin") -Capture -AllowFailure
  if ($remoteResult.ExitCode -ne 0 -or $remoteResult.Output.Count -eq 0) { throw "Remote 'origin' is not configured." }
  $remoteUrl = ([string]$remoteResult.Output[0]).Trim()

  Write-Host "Repository: $script:RepositoryRoot"
  Write-Host "Branch: $branch"
  Write-Host "Remote: $remoteUrl"
  Write-Host "Status:"
  [void](Invoke-Git -Arguments @("status", "--short"))

  $statusResult = Invoke-Git -Arguments @("status", "--porcelain") -Capture
  if ($statusResult.Output.Count -eq 0) {
    $head = (Invoke-Git -Arguments @("rev-parse", "--short", "HEAD") -Capture).Output[0]
    Write-Host "No changes to commit. Branch=$branch Commit=$head"
    exit 0
  }

  Assert-PendingFilesSafe
  Assert-DeliveryRecordPresent
  $qualityScripts = @(Get-QualityScripts)
  Write-Host "Quality checks: $(if ($qualityScripts.Count) { $qualityScripts -join ', ' } else { 'none declared' })"

  if ($ValidateOnly) {
    Write-Host "Validation successful. No files were staged, committed, fetched, rebased, or pushed."
    exit 0
  }

  if (-not $SkipChecks) { Invoke-QualityChecks -Scripts $qualityScripts }
  else { Write-Host "Quality checks skipped by explicit -SkipChecks." -ForegroundColor Yellow }

  [void](Invoke-Git -Arguments @("diff", "--check"))
  [void](Invoke-Git -Arguments @("add", "-A"))
  Assert-PendingFilesSafe
  $stagedResult = Invoke-Git -Arguments @("diff", "--cached", "--quiet") -AllowFailure
  if ($stagedResult -eq 0) {
    Write-Host "No staged changes; no commit created."
    exit 0
  }

  [void](Invoke-Git -Arguments @("commit", "-m", $Message))

  $remoteBranch = Invoke-Git -Arguments @("ls-remote", "--exit-code", "--heads", "origin", "refs/heads/$branch") -Capture -AllowFailure
  if ($remoteBranch.ExitCode -eq 0 -and $remoteBranch.Output.Count -gt 0) {
    [void](Invoke-Git -Arguments @("fetch", "origin", $branch))
    $rebaseResult = Invoke-Git -Arguments @("rebase", "origin/$branch") -AllowFailure
    if ($rebaseResult -ne 0) {
      $conflicts = (Invoke-Git -Arguments @("diff", "--name-only", "--diff-filter=U") -Capture -AllowFailure).Output
      Write-Error "Rebase conflict. No push was attempted. Resolve these files, run 'git rebase --continue', then rerun this script:`n - $($conflicts -join "`n - ")"
      exit 2
    }
  } elseif ($remoteBranch.ExitCode -ne 2) {
    throw "Unable to query remote branch origin/$branch."
  }

  $backupTag = "not-created"
  $mainPush = "skipped"
  $oldMainCommit = $null
  if (-not $SkipMainUpdate) {
    $remoteMain = Invoke-Git -Arguments @("ls-remote", "--exit-code", "--heads", "origin", "refs/heads/$MainBranch") -Capture -AllowFailure
    if ($remoteMain.ExitCode -ne 0 -or $remoteMain.Output.Count -eq 0) {
      throw "Remote protected branch origin/$MainBranch is unavailable; no branch or tag was pushed."
    }
    [void](Invoke-Git -Arguments @("fetch", "origin", $MainBranch))
    $oldMainCommit = ([string](Invoke-Git -Arguments @("rev-parse", "origin/$MainBranch") -Capture).Output[0]).Trim()
    $containsMain = Invoke-Git -Arguments @("merge-base", "--is-ancestor", $oldMainCommit, "HEAD") -AllowFailure
    if ($containsMain -ne 0) {
      $rebaseResult = Invoke-Git -Arguments @("rebase", "origin/$MainBranch") -AllowFailure
      if ($rebaseResult -ne 0) {
        $conflicts = (Invoke-Git -Arguments @("diff", "--name-only", "--diff-filter=U") -Capture -AllowFailure).Output
        Write-Error "Main rebase conflict. Nothing was pushed. Resolve these files, run 'git rebase --continue', then rerun this script:`n - $($conflicts -join "`n - ")"
        exit 2
      }
    }
  }

  $commit = ([string](Invoke-Git -Arguments @("rev-parse", "--short", "HEAD") -Capture).Output[0]).Trim()
  if ($branch -ne $MainBranch -or $SkipMainUpdate) {
    [void](Invoke-Git -Arguments @("push", "-u", "origin", $branch))
  }

  if (-not $SkipMainUpdate) {
    $oldMainShort = ([string](Invoke-Git -Arguments @("rev-parse", "--short", $oldMainCommit) -Capture).Output[0]).Trim()
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupTag = "backup-$MainBranch-$timestamp-$oldMainShort"
    $existingTag = Invoke-Git -Arguments @("show-ref", "--verify", "--quiet", "refs/tags/$backupTag") -AllowFailure
    if ($existingTag -eq 0) { throw "Backup tag already exists locally: $backupTag" }
    [void](Invoke-Git -Arguments @("tag", "-a", $backupTag, $oldMainCommit, "-m", "Backup origin/$MainBranch before deploying $commit"))
    [void](Invoke-Git -Arguments @("push", "origin", "refs/tags/$backupTag"))

    # This is intentionally a normal push. If origin/main changed after fetch,
    # Git rejects it as non-fast-forward and the archived tag remains available.
    $mainPushArguments = if ($branch -eq $MainBranch) {
      @("push", "-u", "origin", "HEAD:refs/heads/$MainBranch")
    } else {
      @("push", "origin", "HEAD:refs/heads/$MainBranch")
    }
    [void](Invoke-Git -Arguments $mainPushArguments)
    $remoteMainAfter = Invoke-Git -Arguments @("ls-remote", "--heads", "origin", "refs/heads/$MainBranch") -Capture
    $remoteMainCommit = (([string]$remoteMainAfter.Output[0]) -split "\s+")[0]
    $localHead = ([string](Invoke-Git -Arguments @("rev-parse", "HEAD") -Capture).Output[0]).Trim()
    if ($remoteMainCommit -ne $localHead) { throw "Remote main verification failed after push." }
    $mainPush = "origin/$MainBranch"
  }

  Write-Host "RESULT Branch=$branch Commit=$commit Push=origin/$branch Main=$mainPush Backup=$backupTag Checks=$(if ($SkipChecks) { 'skipped' } else { $qualityScripts -join ',' })" -ForegroundColor Green
} catch {
  Write-Error $_
  exit 1
}
