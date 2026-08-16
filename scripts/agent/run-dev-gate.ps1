[CmdletBinding()]
param([switch]$SkipTests)

$ErrorActionPreference = "Stop"

function Invoke-NpmScript {
  param([string]$Name)
  & npm run $Name
  if ($LASTEXITCODE -ne 0) { throw "npm run $Name failed with exit code $LASTEXITCODE." }
}

Invoke-NpmScript -Name "verify:environment"
Invoke-NpmScript -Name "lint"
Invoke-NpmScript -Name "build"
if (-not $SkipTests) { Invoke-NpmScript -Name "test:node" }

Write-Host "DEV_GATE_PASS"
