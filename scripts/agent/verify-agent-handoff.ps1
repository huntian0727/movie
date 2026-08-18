[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [ValidateSet("Developer", "QA", "UI")][string]$Role,
  [string]$DeveloperHandoffPath = ""
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Handoff file not found: $Path" }
$handoff = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
foreach ($field in @("task_id", "role", "status", "commit", "next")) {
  if ([string]::IsNullOrWhiteSpace([string]$handoff.$field)) { throw "Required handoff field is missing: $field" }
}
if ($handoff.role -ne $Role) { throw "Role mismatch: expected $Role, got $($handoff.role)." }
if ([string]$handoff.commit -notmatch "^[0-9a-f]{40}$") { throw "commit must be a full lowercase 40-character SHA." }
$requiredByRole = @{
  Developer = @("changed_files", "tests", "risks")
  QA = @("tests", "risks")
  UI = @("evidence", "findings")
}
foreach ($field in $requiredByRole[$Role]) {
  if ($handoff.PSObject.Properties.Name -notcontains $field) { throw "Required $Role handoff field is missing: $field" }
}
$allowedStatus = @{
  Developer = @("DEV_COMPLETE", "DEV_FAILED", "SCOPE_ESCALATION_REQUIRED")
  QA = @("PASS", "PASS_WITH_KNOWN_RISKS", "FAIL")
  UI = @("UI_REVIEW_PASS", "UI_REVIEW_FAILED")
}
if ($allowedStatus[$Role] -notcontains [string]$handoff.status) { throw "Invalid $Role status: $($handoff.status)" }
if ([string]$handoff.status -match "FAIL|ESCALATION") {
  foreach ($field in @("findings", "reproduction", "impact", "retest_scope")) {
    if ($handoff.PSObject.Properties.Name -notcontains $field) { throw "Failure handoff must include: $field" }
  }
}
$suffix = @{ Developer = "-dev.json"; QA = "-qa.json"; UI = "-ui.json" }[$Role]
if (-not ([System.IO.Path]::GetFileName($Path).EndsWith($suffix, [System.StringComparison]::OrdinalIgnoreCase))) { throw "Handoff filename must end with $suffix." }
if (-not [string]::IsNullOrWhiteSpace($DeveloperHandoffPath)) {
  if ($Role -ne "QA") { throw "Developer commit comparison is only valid for QA handoffs." }
  $developer = Get-Content -Raw -Encoding UTF8 -LiteralPath $DeveloperHandoffPath | ConvertFrom-Json
  if ($developer.task_id -ne $handoff.task_id) { throw "Task mismatch between QA and Developer handoffs." }
  if ($developer.commit -ne $handoff.commit) { throw "QA commit does not equal Developer commit." }
}
Write-Output "HANDOFF=PASS ROLE=$Role TASK=$($handoff.task_id) COMMIT=$($handoff.commit)"
