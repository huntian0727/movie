[CmdletBinding()]
param([ValidateSet("Check")][string]$Action="Check")
$ErrorActionPreference = "Stop"
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
if (-not (Test-Path -LiteralPath (Join-Path $repository ".git"))) { throw "This script must live inside the movie Git repository." }
Set-Location -LiteralPath $repository
node scripts/check-local-storage.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
