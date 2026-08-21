[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$JsonPath,
  [int]$ExitCode = 0
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $JsonPath -PathType Leaf)) { throw "Test result not found: $JsonPath" }
$result = Get-Content -Raw -Encoding UTF8 -LiteralPath $JsonPath | ConvertFrom-Json
$suites = if ($null -ne $result.testResults) { @($result.testResults).Count } elseif ($null -ne $result.numTotalTestSuites) { [int]$result.numTotalTestSuites } else { 0 }
$tests = if ($null -ne $result.numTotalTests) { [int]$result.numTotalTests } else { 0 }
$failed = if ($null -ne $result.numFailedTests) { [int]$result.numFailedTests } else { 0 }
$start = if ($null -ne $result.startTime) { [double]$result.startTime } else { 0 }
$ends = @($result.testResults | ForEach-Object { if ($null -ne $_.endTime) { [double]$_.endTime } })
$latestEnd = if ($ends.Count -gt 0) { [double](($ends | Measure-Object -Maximum).Maximum) } else { 0 }
$duration = if ($start -gt 0 -and $latestEnd -gt 0) { [Math]::Max([double]0, [Math]::Round(($latestEnd - $start) / 1000, 2)) } else { 0 }
$reportedSuccess = if ($null -eq $result.success) { $true } else { [bool]$result.success }
$status = if ($ExitCode -eq 0 -and $failed -eq 0 -and $reportedSuccess) { "PASS" } else { "FAIL" }
Write-Output "TEST=$status SUITES=$suites TESTS=$tests FAILED=$failed DURATION=${duration}s"
if ($status -eq "FAIL") { exit 1 }
