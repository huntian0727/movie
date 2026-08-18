[CmdletBinding()]
param(
  [string]$TaskPath = "",
  [switch]$RefreshRemote,
  [string[]]$Gate = @()
)

$ErrorActionPreference = "Stop"
function Invoke-Git([string[]]$Arguments, [switch]$AllowFailure) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = @(& git @Arguments 2>&1)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if (-not $AllowFailure -and $code -ne 0) { throw "git $($Arguments -join ' ') failed: $($output -join [Environment]::NewLine)" }
  return [pscustomobject]@{ Code = $code; Lines = $output }
}

$root = ([string](Invoke-Git @("rev-parse", "--show-toplevel")).Lines[0]).Trim()
Set-Location -LiteralPath $root
$branch = ([string](Invoke-Git @("branch", "--show-current")).Lines[0]).Trim()
if (-not $branch) { throw "Detached HEAD is not supported." }
if ($RefreshRemote) { [void](Invoke-Git @("fetch", "--quiet", "--prune", "origin")) }
$head = ([string](Invoke-Git @("rev-parse", "HEAD")).Lines[0]).Trim()
$remote = Invoke-Git @("rev-parse", "origin/$branch") -AllowFailure
$remoteHead = if ($remote.Code -eq 0) { ([string]$remote.Lines[0]).Trim() } else { $null }
$ahead = 0; $behind = 0
if ($remoteHead) {
  $counts = (([string](Invoke-Git @("rev-list", "--left-right", "--count", "origin/$branch...HEAD")).Lines[0]).Trim() -split "\s+")
  $behind = [int]$counts[0]; $ahead = [int]$counts[1]
}
$status = @((Invoke-Git @("status", "--porcelain=v1")).Lines | Where-Object { $_ })
$modified = @($status | Where-Object { -not $_.StartsWith("??") -and $_.Substring(0, 2) -notmatch "[AD]" }).Count
$new = @($status | Where-Object { $_.StartsWith("??") -or $_.Substring(0, 2) -match "A" }).Count
$deleted = @($status | Where-Object { $_.Substring(0, 2) -match "D" }).Count
$taskId = $null; $workflow = $null; $taskStatus = $null
if ($TaskPath) {
  $task = Get-Content -Raw -Encoding UTF8 -LiteralPath $TaskPath
  $taskId = [regex]::Match($task, "(?m)^- Task ID:\s*(.+)$").Groups[1].Value.Trim()
  $workflow = [regex]::Match($task, "(?m)^- Workflow:\s*(\w+)").Groups[1].Value.Trim()
  $taskStatus = [regex]::Match($task, "(?m)^- Status:\s*(.+)$").Groups[1].Value.Trim()
}
$gates = [ordered]@{}
foreach ($item in $Gate) {
  $parts = $item -split "=", 2
  if ($parts.Count -ne 2) { throw "Gate must use NAME=RESULT: $item" }
  $gates[$parts[0]] = $parts[1]
}
$state = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  git = [ordered]@{ branch = $branch; head = $head; remote_head = $remoteHead; ahead = $ahead; behind = $behind; clean = $status.Count -eq 0; modified = $modified; new = $new; deleted = $deleted }
  task = [ordered]@{ id = $taskId; workflow = $workflow; status = $taskStatus }
  gates = $gates
}
$absoluteOutput = Join-Path $root ".agent/state/machine-state.json"
$parent = Split-Path -Parent $absoluteOutput
if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
$state | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath $absoluteOutput
Write-Output "STATE=UPDATED BRANCH=$branch HEAD=$head CLEAN=$($status.Count -eq 0) AHEAD=$ahead BEHIND=$behind MODIFIED=$modified NEW=$new DELETED=$deleted"
