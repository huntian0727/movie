[CmdletBinding()]
param([switch]$IncludeElectronSmoke)

$ErrorActionPreference = "Stop"

if ($IncludeElectronSmoke) {
  throw "-IncludeElectronSmoke is unsafe in the Node ABI checkout. Run Electron smoke only in a separate Electron ABI checkout through the desktop delivery gate."
}

& npm run test:release-gate
if ($LASTEXITCODE -ne 0) { throw "npm run test:release-gate failed with exit code $LASTEXITCODE." }

Write-Host "QA_GATE_PASS NodeReleaseGate=PASS ElectronSmoke=NOT_RUN_SEPARATE_ABI_REQUIRED"
