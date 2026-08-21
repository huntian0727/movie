[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("TEXT", "BUG", "FEATURE", "UI", "ARCHITECTURE", "RELEASE")]
  [string]$ChangeType,
  [string[]]$RiskAreas = @()
)

$ErrorActionPreference = "Stop"
$risks = @($RiskAreas | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim().ToUpperInvariant() } | Where-Object { $_ } | Select-Object -Unique)
$fullRisks = @("DATA_LOSS", "FILESYSTEM_BATCH", "IRREVERSIBLE", "MIGRATION_LARGE", "PLAYBACK_ARCHITECTURE", "CLOUDDRIVE_CORE", "MAJOR_UI", "INSTALLER", "RELEASE", "SECURITY")
$standardRisks = @("PLAYBACK", "CROSS_LAYER", "CONCURRENCY", "SCHEMA", "FILESYSTEM", "CLOUDDRIVE", "UI_BEHAVIOR")
$fullMatches = @($risks | Where-Object { $fullRisks -contains $_ })
$standardMatches = @($risks | Where-Object { $standardRisks -contains $_ })

$workflow = if ($ChangeType -eq "RELEASE" -or $fullMatches.Count -gt 0) {
  "FULL"
} elseif ($ChangeType -in @("BUG", "FEATURE", "ARCHITECTURE") -or $standardMatches.Count -gt 0 -or $risks.Count -gt 0) {
  "STANDARD"
} else {
  "LITE"
}

$qaRequired = $workflow -ne "LITE"
$uiRequired = $risks -contains "MAJOR_UI"
$webRequired = $ChangeType -eq "ARCHITECTURE" -or $risks -contains "MAJOR_UI"
$webConsider = $risks -contains "IRREVERSIBLE" -or $risks -contains "DATA_LOSS"
$roles = @("Developer")
if ($qaRequired) { $roles += "QA" }
if ($uiRequired) { $roles += "UI" }
if ($webRequired) { $roles += "WebAdvisor" }
$reason = if ($workflow -eq "LITE") { "localized reversible change with no elevated risk" } elseif ($workflow -eq "STANDARD") { "targeted regression risk requires independent QA" } else { "high-impact or irreversible risk requires full gates" }

[pscustomobject]@{
  Workflow = $workflow
  RiskAreas = $risks
  QARequired = $qaRequired
  UIRequired = $uiRequired
  WebAdvisorRequired = $webRequired
  WebAdvisorConsider = $webConsider
  Roles = $roles
  Reason = $reason
} | ConvertTo-Json -Compress
