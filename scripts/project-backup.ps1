[CmdletBinding()]
param(
  [ValidateSet("Create", "List", "Verify", "Restore", "RollbackCode")]
  [string]$Action = "Create",
  [string]$Label = "manual",
  [string]$Snapshot,
  [string]$BackupRoot = (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "映匣备份"),
  [string]$UserDataPath = (Join-Path $env:APPDATA "local-video-manager"),
  [switch]$AllowDirty,
  [switch]$LocalOnly,
  [switch]$IncludeInstaller,
  [switch]$InstallSnapshot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repository = (& git rev-parse --show-toplevel 2>$null).Trim()
if (-not $repository) { throw "This command must run inside the movie Git repository." }
Set-Location $repository

function Invoke-BackupNode {
  param([string[]]$Arguments)
  $resultFile = [System.IO.Path]::GetTempFileName()
  try {
    $nodeExecutable = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    if (-not $nodeExecutable) { throw "node.exe is required for project backup operations." }
    & $nodeExecutable --no-warnings=ExperimentalWarning scripts/project-backup.mjs @Arguments "--result-file=$resultFile"
    if ($LASTEXITCODE -ne 0) { throw "Project backup command failed with exit code $LASTEXITCODE." }
    if (-not (Test-Path -LiteralPath $resultFile) -or (Get-Item -LiteralPath $resultFile).Length -eq 0) {
      throw "Project backup command did not produce a result file."
    }
    return Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
  } finally {
    if (Test-Path -LiteralPath $resultFile) { Remove-Item -LiteralPath $resultFile -Force }
  }
}

function Assert-ApplicationClosed {
  $renamedExecutable = (-join @([char]0x62C9, [char]0x9762, [char]0x5F71, [char]0x89C6)) + ".exe"
  $running = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("Local Video Manager.exe", $renamedExecutable) })
  if ($running.Count -gt 0) {
    $details = ($running | ForEach-Object { "PID $($_.ProcessId): $($_.ExecutablePath)" }) -join [Environment]::NewLine
    throw "Restore refused because the video manager is still running. Close it first.`n$details"
  }
}

function Get-SafeName([string]$Value) {
  $safe = ($Value -replace '[^A-Za-z0-9._-]', '-').Trim('-')
  if (-not $safe) { return "manual" }
  return $safe.Substring(0, [Math]::Min(50, $safe.Length))
}

if ($Action -eq "List") {
  $items = Invoke-BackupNode @("--action=list", "--backup-root=$BackupRoot")
  $items | ForEach-Object {
    [pscustomobject]@{
      Id = $_.manifest.id
      CreatedAt = $_.manifest.createdAt
      Kind = $_.manifest.kind
      Label = $_.manifest.label
      Commit = $_.manifest.git.commit
      Schema = $_.manifest.database.schemaVersion
      DatabaseGB = [Math]::Round($_.manifest.files.database.sizeBytes / 1GB, 2)
      Installer = [bool]$_.manifest.files.installer
    }
  } | Format-Table -AutoSize
  exit 0
}

if ($Action -eq "Verify") {
  if (-not $Snapshot) { throw "-Snapshot is required for Verify." }
  $result = Invoke-BackupNode @("--action=verify", "--backup-root=$BackupRoot", "--snapshot=$Snapshot")
  Write-Host "Backup verified: $($result.manifest.id)" -ForegroundColor Green
  Write-Host "SQLite quick_check: $($result.databaseInfo.quickCheck); schema: $($result.databaseInfo.schemaVersion); videos: $($result.databaseInfo.videoCount)"
  exit 0
}

if ($Action -eq "Restore") {
  if (-not $Snapshot) { throw "-Snapshot is required for Restore." }
  Assert-ApplicationClosed
  $branch = (& git branch --show-current).Trim()
  $commit = (& git rev-parse HEAD).Trim()
  $arguments = @(
    "--action=restore", "--backup-root=$BackupRoot", "--user-data=$UserDataPath", "--snapshot=$Snapshot",
    "--confirm-application-closed", "--label=before-restore-$Snapshot", "--kind=pre-restore",
    "--git-branch=$branch", "--git-commit=$commit", "--git-repository=$repository"
  )
  $result = Invoke-BackupNode $arguments
  Write-Host "Data restored from: $($result.restoredSnapshotId)" -ForegroundColor Green
  Write-Host "Automatic pre-restore backup: $($result.preRestoreSnapshotId)"
  if ($InstallSnapshot) {
    $manifestPath = Join-Path (Join-Path $BackupRoot $Snapshot) "manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $manifest.files.installer) { throw "This snapshot does not contain an installer." }
    $installerPath = Join-Path (Join-Path $BackupRoot $Snapshot) $manifest.files.installer.name
    $installer = Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
    if ($installer.ExitCode -ne 0) { throw "Snapshot installer failed with exit code $($installer.ExitCode)." }
    Write-Host "Snapshot application installer completed." -ForegroundColor Green
  }
  exit 0
}

if ($Action -eq "RollbackCode") {
  if (-not $Snapshot) { throw "-Snapshot is required for RollbackCode." }
  $status = @(& git status --porcelain)
  if ($status.Count -gt 0) { throw "RollbackCode requires a clean worktree. No files were changed." }
  $manifestPath = Join-Path (Join-Path $BackupRoot $Snapshot) "manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $manifest.git.tag) { throw "Snapshot does not contain a Git checkpoint tag." }
  & git rev-parse --verify "$($manifest.git.tag)^{commit}" *> $null
  if ($LASTEXITCODE -ne 0) { throw "Git checkpoint tag is not available locally: $($manifest.git.tag)" }
  $branchName = "rollback/$(Get-Date -Format 'yyyyMMdd-HHmmss')-$(Get-SafeName $manifest.label)"
  & git switch -c $branchName $manifest.git.tag
  if ($LASTEXITCODE -ne 0) { throw "Unable to create rollback branch." }
  Write-Host "Created safe rollback branch $branchName from $($manifest.git.tag). main was not moved." -ForegroundColor Green
  exit 0
}

$status = @(& git status --porcelain)
$isDirty = $status.Count -gt 0
if ($isDirty -and -not $AllowDirty) {
  throw "Development checkpoint requires a clean worktree. Commit or preserve the existing changes first; no backup was created."
}
$branch = (& git branch --show-current).Trim()
$commit = (& git rev-parse HEAD).Trim()
$shortCommit = (& git rev-parse --short HEAD).Trim()
$appVersion = (Get-Content -LiteralPath "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json).version
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tag = "checkpoint-$timestamp-$shortCommit-$(Get-SafeName $Label)"
& git tag -a $tag HEAD -m "Development checkpoint before: $Label"
if ($LASTEXITCODE -ne 0) { throw "Unable to create Git checkpoint tag." }
$tagPush = "local-only"
if (-not $LocalOnly) {
  & git push origin "refs/tags/$tag"
  if ($LASTEXITCODE -eq 0) { $tagPush = "pushed" }
  else {
    $tagPush = "push-failed"
    Write-Warning "The checkpoint tag is available locally, but pushing it to origin failed. Data backup will continue."
  }
}

$temporaryBundle = Join-Path ([System.IO.Path]::GetTempPath()) "movie-$timestamp-$shortCommit.bundle"
if (Test-Path -LiteralPath $temporaryBundle) { Remove-Item -LiteralPath $temporaryBundle -Force }
try {
  & git bundle create $temporaryBundle HEAD $tag
  if ($LASTEXITCODE -ne 0) { throw "Unable to create the source bundle." }
  $arguments = @(
    "--action=create", "--backup-root=$BackupRoot", "--user-data=$UserDataPath", "--label=$Label", "--kind=development",
    "--git-branch=$branch", "--git-commit=$commit", "--git-tag=$tag", "--git-tag-push=$tagPush",
    "--git-repository=$repository", "--app-version=$appVersion", "--source-bundle=$temporaryBundle"
  )
  if ($isDirty) { $arguments += "--git-dirty" }
  if ($IncludeInstaller) {
    $installer = Get-ChildItem -LiteralPath (Join-Path $repository "release") -Filter "*-Setup.exe" -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $installer) { throw "-IncludeInstaller was requested, but no setup executable exists in release/." }
    $arguments += "--installer=$($installer.FullName)"
  }
  $result = Invoke-BackupNode $arguments
  Write-Host "Development checkpoint created." -ForegroundColor Green
  Write-Host "Snapshot: $($result.manifest.id)"
  Write-Host "Location: $($result.snapshotDirectory)"
  Write-Host "Git tag: $tag ($tagPush)"
  Write-Host "Database: $([Math]::Round($result.manifest.files.database.sizeBytes / 1GB, 2)) GB; videos: $($result.manifest.database.videoCount); quick_check: $($result.manifest.database.quickCheck)"
} finally {
  if (Test-Path -LiteralPath $temporaryBundle) { Remove-Item -LiteralPath $temporaryBundle -Force }
}
