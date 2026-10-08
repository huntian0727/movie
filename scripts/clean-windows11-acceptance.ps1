[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ArtifactDirectory,
  [switch]$DisposableMachineAcknowledged
)
$ErrorActionPreference='Stop'
if (-not $DisposableMachineAcknowledged) { throw 'Run only on a disposable, clean Windows 11 x64 VM; explicit acknowledgement is required.' }
if ([Environment]::Is64BitOperatingSystem -ne $true) { throw 'Windows x64 is required.' }
$taskOs = Get-CimInstance Win32_OperatingSystem
if ($taskOs.Caption -notmatch 'Windows 11') { throw 'Windows 11 is required.' }
foreach ($taskTool in @('node.exe','npm.cmd','git.exe')) {
  if (Get-Command $taskTool -ErrorAction SilentlyContinue) { throw 'Development tools are present; this is not the required no-Node acceptance machine.' }
}
Import-Module "$env:WINDIR/System32/WindowsPowerShell/v1.0/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1" -ErrorAction Stop
$taskArtifacts=(Resolve-Path -LiteralPath $ArtifactDirectory).Path
$taskMeta=Get-Content -LiteralPath (Join-Path $taskArtifacts 'build-metadata.json') -Raw | ConvertFrom-Json
$taskFlavor=Get-Content -LiteralPath (Join-Path $taskArtifacts 'build-flavor.json') -Raw | ConvertFrom-Json
if ($taskFlavor.releaseClass -ne 'unsigned-test-build' -or $taskFlavor.appId -ne 'com.local.video.manager.unsignedtest' -or
    $taskFlavor.nsisGuid -ne 'ec02b3c5-6e7a-4e3d-9f2a-1c6854cc8072' -or
    $taskFlavor.executableName -ne '拉面影视-unsigned-test-build' -or $taskMeta.signed -ne $false) {
  throw 'Only the isolated unsigned acceptance identity is permitted.'
}
if ($taskFlavor.artifactName -notmatch '^拉面影视-[0-9]+\.[0-9]+\.[0-9]+-x64-unsigned-test-build-Setup\.exe$') { throw 'Unexpected installer name.' }
$taskInstaller=Join-Path $taskArtifacts $taskFlavor.artifactName
$taskCandidate=@($taskMeta.installers | Where-Object name -eq $taskFlavor.artifactName)
if ($taskCandidate.Count -ne 1 -or (Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskCandidate[0].sha256) { throw 'Installer integrity mismatch.' }
if ((Get-AuthenticodeSignature -LiteralPath $taskInstaller).Status -ne 'NotSigned') { throw 'Unexpected test signature.' }
$taskGuid=$taskFlavor.nsisGuid
if ((Test-Path "HKCU:/Software/$taskGuid") -or (Test-Path "HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/$taskGuid")) { throw 'Test identity is already installed.' }
$taskRoot=Join-Path ([IO.Path]::GetTempPath()) ('movie-clean-win11-'+[guid]::NewGuid())
$taskInstall=Join-Path $taskRoot 'installed-app'
$taskUserData=Join-Path $taskRoot 'synthetic-user-data'
New-Item -ItemType Directory -Path $taskUserData -Force | Out-Null
function Invoke-Candidate([string]$file,[string]$arguments) {
  $taskProcess=Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $taskProcess.WaitForExit(120000)) { throw 'Acceptance process timed out; preserve evidence and inspect the disposable VM.' }
  if ($taskProcess.ExitCode -ne 0) { throw 'Acceptance process failed.' }
}
Invoke-Candidate $taskInstaller "/S /currentuser /D=$taskInstall"
$taskExe=Join-Path $taskInstall ($taskFlavor.executableName+'.exe')
if ((Get-FileHash -LiteralPath $taskExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskMeta.application.sha256) { throw 'Installed executable hash mismatch.' }
$env:VIDEO_MANAGER_PACKAGED_SMOKE_USER_DATA=$taskUserData
try {
  foreach ($taskPhase in @('create','verify')) {
    $env:VIDEO_MANAGER_PACKAGED_SMOKE_PHASE=$taskPhase
    $env:VIDEO_MANAGER_PACKAGED_SMOKE_RESULT=Join-Path $taskRoot ($taskPhase+'.json')
    Invoke-Candidate $taskExe '--disable-gpu'
    $taskResult=Get-Content -LiteralPath $env:VIDEO_MANAGER_PACKAGED_SMOKE_RESULT -Raw | ConvertFrom-Json
    if ($taskResult.ok -ne $true) { throw 'Packaged acceptance checks failed.' }
  }
} finally {
  Remove-Item Env:VIDEO_MANAGER_PACKAGED_SMOKE_USER_DATA -ErrorAction SilentlyContinue
  Remove-Item Env:VIDEO_MANAGER_PACKAGED_SMOKE_PHASE -ErrorAction SilentlyContinue
  Remove-Item Env:VIDEO_MANAGER_PACKAGED_SMOKE_RESULT -ErrorAction SilentlyContinue
}
$taskVideo=Join-Path $taskInstall 'synthetic-user-video.mp4'
$taskProbe=Join-Path $taskInstall 'resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe'
Invoke-Candidate $taskProbe "-hide_banner -loglevel error -f lavfi -i color=c=blue:s=16x16:r=1 -t 1 -c:v mpeg4 `"$taskVideo`""
$taskDatabase=Join-Path $taskUserData 'library.sqlite'
$taskCopy=Join-Path $taskInstall 'synthetic-user-library.sqlite'
Copy-Item -LiteralPath $taskDatabase -Destination $taskCopy
$taskSentinels=@($taskVideo,$taskDatabase,$taskCopy)
$taskHashes=@($taskSentinels | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash })
function Assert-Sentinels {
  for ($taskIndex=0;$taskIndex -lt $taskSentinels.Count;$taskIndex++) {
    if ((Get-FileHash -LiteralPath $taskSentinels[$taskIndex] -Algorithm SHA256).Hash -ne $taskHashes[$taskIndex]) { throw 'A synthetic user sentinel was modified.' }
  }
}
Invoke-Candidate $taskInstaller "/S /currentuser /D=$taskInstall"
Assert-Sentinels
$taskUninstallers=@(Get-ChildItem -LiteralPath $taskInstall -Filter 'Uninstall*.exe')
if ($taskUninstallers.Count -ne 1) { throw 'Unexpected isolated uninstaller count.' }
Invoke-Candidate $taskUninstallers[0].FullName "/S _?=$taskInstall"
Assert-Sentinels
if (Test-Path -LiteralPath $taskExe) { throw 'Known application executable remains installed.' }
@{ schemaVersion=1; automated='PASS'; manualUi='NOT_RUN'; historicalSignedUpgrade='NOT_RUN';
  os=$taskOs.Caption; build=$taskOs.BuildNumber; x64=$true; developmentToolsDetected=$false;
  installerSha256=$taskCandidate[0].sha256; completedAt=[DateTime]::UtcNow.ToString('o');
  checks=@('install','packaged-create-verify','synthetic-media','repair','uninstall','SQLite-video-preservation')
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskRoot 'clean-windows11-evidence.json') -Encoding UTF8
Write-Host "Automated acceptance PASS. Evidence retained at $taskRoot. Manual UI and historical signed upgrade remain NOT_RUN."
