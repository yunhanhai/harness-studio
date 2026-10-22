# Build and install Harness Studio in place, then refresh shortcuts.
#
#   npm run install:local            # build + install
#   npm run install:local -SkipBuild # reuse dist\win-unpacked
#
# User data lives in %APPDATA%\Harness Studio and survives upgrades.
# All messages are ASCII so Windows PowerShell 5 parses this file reliably.

param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$unpacked = Join-Path $root 'dist\win-unpacked'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Harness Studio'
$exeName = 'Harness Studio.exe'

if (-not $SkipBuild) {
  Write-Host '==> Building app...' -ForegroundColor Cyan
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  Push-Location $root
  try {
    & npm run dist:dir
    if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path (Join-Path $unpacked $exeName))) {
  throw "Missing $unpacked\$exeName. Run 'npm run dist:dir' first."
}

# Kill a running instance, otherwise files stay locked.
Get-Process -Name 'Harness Studio' -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "==> Stopping running instance (pid $($_.Id))" -ForegroundColor Yellow
  $_ | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800

Write-Host "==> Deploying to $installDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Force $installDir | Out-Null

# Replace in place: clear first so removed files do not pile up across versions.
Get-ChildItem $installDir -Force | Where-Object { $_.Name -ne 'HarnessStudioData' } | Remove-Item -Recurse -Force
Copy-Item (Join-Path $unpacked '*') $installDir -Recurse -Force

$exePath = Join-Path $installDir $exeName
if (-not (Test-Path $exePath)) { throw "Deploy failed: $exePath not found" }

# Shortcuts always point at the same target, so upgrades reuse one icon.
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Harness Studio.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Harness Studio.lnk')
)
foreach ($lnk in $targets) {
  $shortcut = $shell.CreateShortcut($lnk)
  $shortcut.TargetPath = $exePath
  $shortcut.WorkingDirectory = $installDir
  $shortcut.IconLocation = "$exePath,0"
  $shortcut.Description = 'Harness Studio - DeepSeek Harness desktop workspace'
  $shortcut.Save()
  Write-Host "    shortcut: $lnk" -ForegroundColor DarkGray
}

$size = (Get-ChildItem $installDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host ''
Write-Host '==> Done' -ForegroundColor Green
Write-Host "    install dir : $installDir"
Write-Host ("    size        : {0:N1} MB" -f ($size / 1MB))
Write-Host "    user data   : $env:APPDATA\Harness Studio (kept across upgrades)"
Write-Host '    Desktop shortcut created.'
