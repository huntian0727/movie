[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Task,
  [Parameter(Mandatory = $true)][string]$ReasonForReview,
  [Parameter(Mandatory = $true)][string]$Questions,
  [string]$Branch = "",
  [string]$OutputPath = "docs/ai/web-handoff/LATEST.md"
)

$ErrorActionPreference = "Stop"

$repoRootOutput = @(& git rev-parse --show-toplevel 2>&1)
if ($LASTEXITCODE -ne 0 -or $repoRootOutput.Count -eq 0) { throw "Unable to resolve the repository root." }
$repoRoot = [IO.Path]::GetFullPath(([string]($repoRootOutput | Select-Object -First 1)).Trim())
$allowedOutputDirectory = [IO.Path]::GetFullPath((Join-Path $repoRoot "docs/ai/web-handoff"))
$outputCandidate = if ([IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $repoRoot $OutputPath }
$resolvedOutputPath = [IO.Path]::GetFullPath($outputCandidate)
$resolvedOutputDirectory = [IO.Path]::GetDirectoryName($resolvedOutputPath)

if (-not [string]::Equals([IO.Path]::GetExtension($resolvedOutputPath), ".md", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Web Advisor handoff output must be a .md file."
}
if (-not [string]::Equals($resolvedOutputDirectory, $allowedOutputDirectory, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Web Advisor handoff output must be a direct child of $allowedOutputDirectory."
}
if (Test-Path -LiteralPath $allowedOutputDirectory) {
  $allowedDirectoryItem = Get-Item -LiteralPath $allowedOutputDirectory -Force
  if (($allowedDirectoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Web Advisor handoff directory must not be a reparse point."
  }
}
if (Test-Path -LiteralPath $resolvedOutputPath) {
  $outputItem = Get-Item -LiteralPath $resolvedOutputPath -Force
  if (-not $outputItem.PSIsContainer -and ($outputItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Web Advisor handoff output must not be a reparse point."
  }
  if ($outputItem.PSIsContainer) { throw "Web Advisor handoff output must be a file path." }
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = (& git branch --show-current).Trim()
}
$sha = (& git rev-parse HEAD).Trim()
$remoteLine = & git ls-remote origin "refs/heads/$Branch" 2>&1
if ($LASTEXITCODE -ne 0 -or @($remoteLine).Count -eq 0) { throw "Push $Branch before generating a Web Advisor handoff." }
$remoteSha = ((@($remoteLine)[0] -split "\s+")[0]).Trim()
if ($sha -ne $remoteSha) { throw "Local HEAD is not the pushed origin/$Branch commit." }

$changedFiles = (& git diff --name-only "origin/main...HEAD") -join [Environment]::NewLine
if ([string]::IsNullOrWhiteSpace($changedFiles)) { $changedFiles = "No code difference from origin/main; review management or milestone evidence only." }
if (-not (Test-Path -LiteralPath $allowedOutputDirectory)) {
  [void](New-Item -ItemType Directory -Path $allowedOutputDirectory)
}

$handoff = @"
# Web Advisor Handoff

Task: $Task
Reason for Review: $ReasonForReview
Current Status: LOCAL_ACCEPTED; awaiting independent Web Advisor review
Current GitHub SHA: $sha
PR / Branch: $Branch
What Changed: See changed files and delivery record for this task.
Key Product Decision: Review required; no final product decision is encoded by this handoff.
Key Architecture Decision: Review required; local implementation facts remain authoritative.
Changed Files: $changedFiles
Important Documents: docs/ai/CURRENT_STATE.md; .agent/state/PROJECT_STATE.md; task delivery record
QA Result: Copy the independent local QA verdict and evidence here before validation.
Local Validation: Copy exact commands and manual evidence here before validation.
Open Risks: Copy known risks and NOT RUN checks here before validation.
Questions for Web Advisor: $Questions
Recommended Local Next Step: Pause decision-dependent work; continue only safe independent validation.
"@

Set-Content -LiteralPath $resolvedOutputPath -Value $handoff -Encoding UTF8
Write-Host "Generated $resolvedOutputPath for origin/$Branch at $sha. Complete evidence fields, then run verify-handoff.ps1."
