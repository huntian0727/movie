[CmdletBinding()]
param(
  [string]$Branch = "",
  [string]$HandoffPath = "",
  [switch]$SkipQaGate
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

& (Join-Path $scriptRoot "verify-worktree.ps1") -RequireClean
if ($LASTEXITCODE -ne 0) { throw "Worktree gate failed." }
& (Join-Path $scriptRoot "verify-github-sync.ps1") -Branch $Branch
if ($LASTEXITCODE -ne 0) { throw "GitHub sync gate failed." }
if (-not $SkipQaGate) {
  & (Join-Path $scriptRoot "run-qa-gate.ps1")
  if ($LASTEXITCODE -ne 0) { throw "QA gate failed." }
}
if (-not [string]::IsNullOrWhiteSpace($HandoffPath)) {
  & (Join-Path $scriptRoot "verify-handoff.ps1") -Path $HandoffPath
  if ($LASTEXITCODE -ne 0) { throw "Web handoff gate failed." }
}

Write-Host "RELEASE_READY_LOCAL_GATES_PASS"
