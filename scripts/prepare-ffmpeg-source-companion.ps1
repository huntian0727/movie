# Creates a single end-user-readable source companion ZIP from the pinned private QA archive.
# This does not authorize public distribution. Runs locally; no network or GitHub writes.
param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = Split-Path -Parent $PSScriptRoot
$pinned = '6ed202c4e30627624e2678a2a62e7c9c6e347be4a57d9b6af248fd45571b15d4'
$allInputNames = @(
  'ffmpeg-8.1.2.tar.xz',
  'ffmpeg-lgpl-buildscripts-v8.1.2-27.tar.gz',
  'GCC-RUNTIME-LIBRARY-EXCEPTION-3.1.txt',
  'LGPL_COMPLIANCE_CHECKLIST.md',
  'mingw-w64-gcc-16.1.0-5.src.tar.zst',
  'mingw-w64-libvpl-2.17.0-1.src.tar.zst',
  'mingw-w64-openh264-2.6.0-1.src.tar.zst',
  'mingw-w64-winpthreads-14.0.0.r179.g24aaa6147-1.src.tar.zst',
  'MSYS2-EXACT-PACKAGE-EVIDENCE.json',
  'MSYS2-EXACT-SOURCE-EVIDENCE.json',
  'README_SOURCE.txt',
  'SHA256SUMS.txt',
  'SOURCE_OFFER.md',
  'THIRD_PARTY_RELEASE_NOTICES.md'
)
$keepInputNames = @(
  'ffmpeg-8.1.2.tar.xz',
  'ffmpeg-lgpl-buildscripts-v8.1.2-27.tar.gz',
  'GCC-RUNTIME-LIBRARY-EXCEPTION-3.1.txt',
  'mingw-w64-gcc-16.1.0-5.src.tar.zst',
  'mingw-w64-libvpl-2.17.0-1.src.tar.zst',
  'mingw-w64-openh264-2.6.0-1.src.tar.zst',
  'mingw-w64-winpthreads-14.0.0.r179.g24aaa6147-1.src.tar.zst',
  'MSYS2-EXACT-PACKAGE-EVIDENCE.json',
  'MSYS2-EXACT-SOURCE-EVIDENCE.json',
  'THIRD_PARTY_RELEASE_NOTICES.md'
)
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw 'Pinned source ZIP not found.' }
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pinned) {
  throw 'Private FFmpeg source input failed pinned SHA-256.'
}
if (Test-Path -LiteralPath $Destination) { throw 'Refusing to overwrite any existing destination directory.' }
$license = Join-Path $repo '.tmp\native-media-lite-tools\COPYING.LGPLv2.1'
if (-not (Test-Path -LiteralPath $license -PathType Leaf)) { throw 'Pinned FFmpeg LGPL license file not staged.' }
$lock = Get-Content -Raw -LiteralPath (Join-Path $repo 'scripts\native-media-lite.lock.json') | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $license -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.files.'COPYING.LGPLv2.1') {
  throw 'Pinned LGPL license file SHA-256 mismatch.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$inputZip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $actual = @($inputZip.Entries | ForEach-Object FullName | Sort-Object)
  $expected = @($allInputNames | Sort-Object)
  if (@(Compare-Object -ReferenceObject $expected -DifferenceObject $actual).Count -ne 0) {
    throw 'Private source ZIP has unexpected entries.'
  }
  $manifestEntry = $inputZip.GetEntry('SHA256SUMS.txt')
  $reader = [IO.StreamReader]::new($manifestEntry.Open(), [Text.Encoding]::UTF8)
  try { $originalManifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $originalHashes = @{}
  foreach ($line in $originalManifest.Split("`n")) {
    if ($line -match '^([a-fA-F0-9]{64})  ([^\r\n]+)\r?$') { $originalHashes[$matches[2]] = $matches[1].ToLowerInvariant() }
  }
  if ($originalHashes.Count -ne 13) { throw 'Original per-file SHA manifest is incomplete.' }
  [IO.Directory]::CreateDirectory($Destination) | Out-Null
  $stage = Join-Path $Destination 'source-files'
  [IO.Directory]::CreateDirectory($stage) | Out-Null
  foreach ($name in $keepInputNames) {
    if ($name -match '[/\\]' -or -not $originalHashes.ContainsKey($name)) { throw ('Unsafe/unlisted input: ' + $name) }
    $target = Join-Path $stage $name
    [IO.Compression.ZipFileExtensions]::ExtractToFile($inputZip.GetEntry($name), $target, $false)
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $originalHashes[$name]) {
      throw ('Extracted source entry failed original SHA: ' + $name)
    }
  }
} finally {
  $inputZip.Dispose()
}
Copy-Item -LiteralPath $license -Destination (Join-Path $stage 'COPYING.LGPLv2.1')
Copy-Item -LiteralPath (Join-Path $repo 'docs\legal\FFMPEG_BUILD_INFO.md') -Destination (Join-Path $stage 'FFMPEG_BUILD_INFO.md')
Copy-Item -LiteralPath (Join-Path $repo 'docs\legal\NATIVE_COMPONENTS.md') -Destination (Join-Path $stage 'NATIVE_COMPONENTS.md')
$readme = @'
FFmpeg Lite 8.1.2 for Windows x64 - corresponding-source COMPANION CANDIDATE

For the personal non-commercial Movie / 拉面影视 desktop app.
This file is a local candidate, NOT a completed public distribution or legal certification.

Contents:
* Original FFmpeg v8.1.2 source archive; pinned Windows build scripts
* Four exact MSYS2 source packages corresponding to the shipped native runtime
* Upstream/license notices and GCC runtime library exception
* FFmpeg actual build flags, component versions and binary SHA-256 evidence
* SHA256SUMS.txt, hashes of all files inside this companion ZIP

This bundle does not include an installer or FFmpeg executable.
The FFmpeg static CLI licensing/relinking question must be resolved before final distribution.
When publishing, place the actual installer and these exact corresponding sources together
on the SAME GitHub Release, with visible license notice and verified SHA256 hashes.
If the executable or its native dependencies change, rebuild this companion bundle.

FFmpeg upstream: https://ffmpeg.org
Legal guidance: https://ffmpeg.org/legal.html
LGPL 2.1: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
'@
[IO.File]::WriteAllText((Join-Path $stage 'README_SOURCE.txt'), $readme, [Text.UTF8Encoding]::new($false))
$hashLines = @()
foreach ($item in @(Get-ChildItem -LiteralPath $stage -File | Sort-Object Name)) {
  if ($item.Name -eq 'SHA256SUMS.txt') { continue }
  $hashLines += '{0}  {1}' -f ((Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()), $item.Name
}
[IO.File]::WriteAllText((Join-Path $stage 'SHA256SUMS.txt'), ($hashLines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
$bundle = Join-Path $Destination 'FFmpeg-Lite-8.1.2-Windows-x64-SOURCES-CANDIDATE.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $bundle -CompressionLevel Optimal
$z = [IO.Compression.ZipFile]::OpenRead($bundle)
try {
  $files = @(Get-ChildItem -LiteralPath $stage -File)
  if ($z.Entries.Count -ne $files.Count) { throw 'Final source ZIP entry count mismatch.' }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    foreach ($item in $files) {
      $entry = $z.GetEntry($item.Name)
      if (-not $entry -or $entry.Length -ne $item.Length) { throw ('Missing or altered source archive entry: ' + $item.Name) }
      $stream = $entry.Open()
      try { $entryHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
      finally { $stream.Dispose() }
      $expectedHash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($entryHash -ne $expectedHash) { throw ('Final ZIP integrity failure: ' + $item.Name) }
    }
  } finally { $sha.Dispose() }
} finally { $z.Dispose() }
$bundleHash = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
$sumLine = '{0}  {1}' -f $bundleHash, (Split-Path $bundle -Leaf)
[IO.File]::WriteAllText((Join-Path $Destination 'SHA256SUMS-SOURCE.txt'), $sumLine + "`n", [Text.UTF8Encoding]::new($false))
$record = [ordered]@{
  status = 'INTEGRITY_PASS_NOT_PUBLICLY_APPROVED'
  installerIncluded = $false
  publicReleaseApproved = $false
  sourceInputSha256 = $pinned
  archive = (Split-Path $bundle -Leaf)
  archiveSha256 = $bundleHash
  archiveBytes = (Get-Item -LiteralPath $bundle).Length
  verifiedArchiveEntries = $files.Count
  note = 'Run source/legal release checks and attach alongside exact installer before public distribution.'
}
[IO.File]::WriteAllText((Join-Path $Destination 'SOURCE-BUNDLE-VERIFICATION.json'), (($record | ConvertTo-Json -Depth 4) + "`n"), [Text.UTF8Encoding]::new($false))
Write-Output ('SOURCE_BUNDLE=' + $bundle)
Write-Output ('SOURCE_BUNDLE_SHA256=' + $bundleHash)
Write-Output ('ENTRIES_VERIFIED=' + $files.Count)
Write-Output 'PUBLIC_APPROVAL=false'
