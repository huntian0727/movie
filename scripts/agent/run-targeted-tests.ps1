[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$TestPath
)

$ErrorActionPreference = "Stop"
$root = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw "Run this script inside the repository." }
$testsRoot = [System.IO.Path]::GetFullPath((Join-Path $root "tests")) + [System.IO.Path]::DirectorySeparatorChar
$paths = @($TestPath | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($paths.Count -eq 0) { throw "At least one test path is required." }
foreach ($path in $paths) {
  $resolved = [System.IO.Path]::GetFullPath((Join-Path $root $path))
  if (-not $resolved.StartsWith($testsRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "Targeted tests must be existing files under tests/: $path"
  }
}
$resultPath = Join-Path ([System.IO.Path]::GetTempPath()) ("movie-vitest-{0}.json" -f [guid]::NewGuid().ToString("N"))
try {
  & npm exec -- vitest run @paths --reporter=json --outputFile=$resultPath
  $exitCode = $LASTEXITCODE
  & (Join-Path $PSScriptRoot "summarize-test-result.ps1") -JsonPath $resultPath -ExitCode $exitCode
  if ($LASTEXITCODE -ne 0 -or $exitCode -ne 0) { exit 1 }
} finally {
  if (Test-Path -LiteralPath $resultPath) { Remove-Item -LiteralPath $resultPath -Force }
}
