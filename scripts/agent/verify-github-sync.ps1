[CmdletBinding()]
param(
  [string]$Branch = "",
  [string]$Remote = "origin"
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([string[]]$GitArguments)
  $output = & git @GitArguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($GitArguments -join ' ') failed: $($output -join [Environment]::NewLine)"
  }
  return @($output)
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
  $Branch = ([string]((Invoke-Git -GitArguments @("branch", "--show-current")) | Select-Object -First 1)).Trim()
}
if ([string]::IsNullOrWhiteSpace($Branch)) { throw "Detached HEAD is not supported." }

[void](Invoke-Git -GitArguments @("fetch", "--quiet", "--prune", $Remote))
$head = ([string]((Invoke-Git -GitArguments @("rev-parse", "HEAD")) | Select-Object -First 1)).Trim()
$remoteRef = "$Remote/$Branch"
$remoteHead = ([string]((Invoke-Git -GitArguments @("rev-parse", $remoteRef)) | Select-Object -First 1)).Trim()
$countLine = ([string]((Invoke-Git -GitArguments @("rev-list", "--left-right", "--count", "$remoteRef...HEAD")) | Select-Object -First 1)).Trim()
$counts = ($countLine -split "\s+")
$lsRemoteLine = ([string]((Invoke-Git -GitArguments @("ls-remote", $Remote, "refs/heads/$Branch")) | Select-Object -First 1)).Trim()
$publishedHead = ($lsRemoteLine -split "\s+")[0]

if ($counts.Count -ne 2) { throw "Unable to parse ahead/behind counts for $remoteRef." }
if ([int]$counts[0] -ne 0 -or [int]$counts[1] -ne 0 -or $head -ne $remoteHead -or $head -ne $publishedHead) {
  throw "Branch is not synchronized: HEAD=$head $remoteRef=$remoteHead published=$publishedHead behind=$($counts[0]) ahead=$($counts[1])."
}

[pscustomobject]@{
  Branch = $Branch
  HEAD = $head
  RemoteRef = $remoteRef
  RemoteHEAD = $remoteHead
  Behind = [int]$counts[0]
  Ahead = [int]$counts[1]
  Synchronized = $true
} | ConvertTo-Json
