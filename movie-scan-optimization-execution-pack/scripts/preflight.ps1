$ErrorActionPreference = "Stop"

Write-Host "=== Worktree ==="
if (Get-Command git -ErrorAction SilentlyContinue) {
  git branch --show-current
  git status --short
} else {
  Write-Warning "git not found"
}

Write-Host "`n=== Runtime ==="
if (Get-Command node -ErrorAction SilentlyContinue) { node --version } else { Write-Warning "node not found" }
if (Get-Command npm -ErrorAction SilentlyContinue) { npm --version } else { Write-Warning "npm not found" }

Write-Host "`n=== package.json scripts ==="
if (Test-Path package.json) {
  $pkg = Get-Content package.json -Raw | ConvertFrom-Json
  if ($pkg.scripts) {
    $pkg.scripts.PSObject.Properties | Sort-Object Name | ForEach-Object {
      Write-Host ("{0} = {1}" -f $_.Name, $_.Value)
    }
  }
} else {
  throw "package.json not found. Run this from the project root."
}

Write-Host "`nPreflight complete. Do not reset or clean the worktree."
