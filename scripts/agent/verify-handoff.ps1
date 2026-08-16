[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Handoff file not found: $Path" }
$content = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path
$required = @(
  "Task", "Reason for Review", "Current Status", "Current GitHub SHA", "PR / Branch",
  "What Changed", "Key Product Decision", "Key Architecture Decision", "Changed Files",
  "Important Documents", "QA Result", "Local Validation", "Open Risks",
  "Questions for Web Advisor", "Recommended Local Next Step"
)

foreach ($field in $required) {
  if ($content -notmatch "(?m)^$([regex]::Escape($field)):\s*\S") {
    throw "Required handoff field is missing or empty: $field"
  }
}
if ($content -match "<[^>]+>" -or $content -match "(?i)\bTODO\b") {
  throw "Handoff still contains placeholder text."
}

$sha = [regex]::Match($content, "(?m)^Current GitHub SHA:\s*`?([0-9a-f]{40})`?\s*$").Groups[1].Value
$branch = [regex]::Match($content, "(?m)^PR / Branch:\s*`?([^`\r\n]+)`?\s*$").Groups[1].Value.Trim()
if ([string]::IsNullOrWhiteSpace($sha)) { throw "Current GitHub SHA must be a full 40-character commit." }
if ([string]::IsNullOrWhiteSpace($branch)) { throw "PR / Branch must identify a pushed branch." }

$remoteLine = & git ls-remote origin "refs/heads/$branch" 2>&1
if ($LASTEXITCODE -ne 0 -or @($remoteLine).Count -eq 0) { throw "Unable to find pushed branch origin/$branch." }
$remoteSha = ((@($remoteLine)[0] -split "\s+")[0]).Trim()
[void](& git fetch --quiet origin $branch 2>&1)
if ($LASTEXITCODE -ne 0) { throw "Unable to fetch origin/$branch for handoff validation." }
[void](& git cat-file -e "$sha^{commit}" 2>&1)
if ($LASTEXITCODE -ne 0) { throw "Handoff SHA $sha is not a commit available from GitHub." }
[void](& git merge-base --is-ancestor $sha "origin/$branch" 2>&1)
if ($LASTEXITCODE -ne 0) { throw "Handoff SHA $sha is not contained in origin/$branch ($remoteSha)." }

Write-Host "WEB_HANDOFF_PASS Branch=$branch ReviewedSHA=$sha RemoteTip=$remoteSha"
