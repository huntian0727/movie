[CmdletBinding()]
param(
  [switch]$RequireClean,
  [switch]$RequireFeatureBranch
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([string[]]$GitArguments, [switch]$AllowFailure)
  $output = & git @GitArguments 2>&1
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
    throw "git $($GitArguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  return @($output)
}

$root = [string]((Invoke-Git -GitArguments @("rev-parse", "--show-toplevel")) | Select-Object -First 1)
$branch = [string]((Invoke-Git -GitArguments @("branch", "--show-current")) | Select-Object -First 1)
$head = [string]((Invoke-Git -GitArguments @("rev-parse", "HEAD")) | Select-Object -First 1)
$root = $root.Trim()
$branch = $branch.Trim()
$head = $head.Trim()
$status = @(Invoke-Git -GitArguments @("status", "--porcelain=v1"))
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$upstreamResult = @(& git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>$null)
$upstreamExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
$upstream = if ($upstreamExitCode -eq 0 -and $upstreamResult.Count -gt 0) { ([string]($upstreamResult | Select-Object -First 1)).Trim() } else { $null }
$uncommitted = @($status | Where-Object { $_ -notmatch "^\?\?" }).Count
$untracked = @($status | Where-Object { $_ -match "^\?\?" }).Count

if ($RequireClean -and $status.Count -gt 0) {
  throw "Worktree is not clean ($($status.Count) entries)."
}
if ($RequireFeatureBranch -and ($branch -eq "main" -or $branch -eq "master" -or [string]::IsNullOrWhiteSpace($branch))) {
  throw "A non-protected feature branch is required; current branch is '$branch'."
}

[pscustomobject]@{
  Repository = $root
  Branch = $branch
  HEAD = $head
  Upstream = $upstream
  StatusEntries = $status.Count
  Uncommitted = $uncommitted
  Untracked = $untracked
} | ConvertTo-Json
