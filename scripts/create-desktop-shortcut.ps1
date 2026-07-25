param(
  [string]$ShortcutName = "Video Manager (Dev).lnk"
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath $ShortcutName
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source

$shell = New-Object -ComObject WScript.Shell

# Remove only a prior shortcut created for this same project and command. This
# keeps retries idempotent and cleans up links made with a legacy code page.
Get-ChildItem -LiteralPath $desktopPath -Filter "*.lnk" -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $existingShortcut = $shell.CreateShortcut($_.FullName)
    if ($existingShortcut.WorkingDirectory -eq $projectRoot -and $existingShortcut.Arguments -eq "run dev:electron") {
      Remove-Item -LiteralPath $_.FullName -Force
    }
  } catch {
    # Leave unrelated or unreadable shortcuts untouched.
  }
}

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $npmCommand
$shortcut.Arguments = "run dev:electron"
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,264"
$shortcut.Description = "Start the local video manager in development mode"
$shortcut.Save()

Write-Output "Desktop shortcut created: $shortcutPath"
