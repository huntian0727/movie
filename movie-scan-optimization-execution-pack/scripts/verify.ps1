$ErrorActionPreference = "Stop"

if (-not (Test-Path package.json)) {
  throw "package.json not found. Run this from the project root."
}

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$scripts = @{}
if ($pkg.scripts) {
  $pkg.scripts.PSObject.Properties | ForEach-Object { $scripts[$_.Name] = $_.Value }
}

function Invoke-NpmScriptIfPresent([string]$name) {
  if ($scripts.ContainsKey($name)) {
    Write-Host "`n=== npm run $name ==="
    npm run $name
  } else {
    Write-Host "`n--- skipped: npm script '$name' not present ---"
  }
}

Write-Host "=== Verification started ==="

Invoke-NpmScriptIfPresent "lint"
Invoke-NpmScriptIfPresent "typecheck"

if ($scripts.ContainsKey("test")) {
  Invoke-NpmScriptIfPresent "test"
} elseif ($scripts.ContainsKey("test:unit")) {
  Invoke-NpmScriptIfPresent "test:unit"
}

Invoke-NpmScriptIfPresent "build"
Invoke-NpmScriptIfPresent "test:electron-smoke"
Invoke-NpmScriptIfPresent "electron:smoke"
Invoke-NpmScriptIfPresent "test:e2e"
Invoke-NpmScriptIfPresent "e2e"
Invoke-NpmScriptIfPresent "benchmark:scan"
Invoke-NpmScriptIfPresent "test:scan-benchmark"

Write-Host "`n=== Worktree after verification ==="
if (Get-Command git -ErrorAction SilentlyContinue) {
  git status --short
}

Write-Host "`nVerification commands completed successfully."
