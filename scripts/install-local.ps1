# Build and install Harness Studio in place, then refresh shortcuts.
#
#   npm run install:local            # build + install (normal upgrade)
#   npm run install:local -SkipBuild # re-deploy without rebuilding
#
# User data lives in %APPDATA%\Harness Studio and survives upgrades.
# dist\win-unpacked is deleted after deploying, so the repo never accumulates
# a second 325 MB copy of the app.
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
} else {
  # Nothing to deploy if a previous run already cleaned the staging copy.
  if (-not (Test-Path (Join-Path $unpacked $exeName))) {
    if (Test-Path (Join-Path $installDir $exeName)) {
      Write-Host '==> Nothing to deploy; installed copy is already current.' -ForegroundColor Yellow
      Write-Host "    $installDir"
      exit 0
    }
    throw "Missing $unpacked\$exeName. Run without -SkipBuild first."
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

# win-unpacked was only a staging copy; the installed tree is authoritative now.
# Removing it keeps the repo from growing by ~325 MB on every build.
$freed = 0
if (Test-Path $unpacked) {
  $freed = (Get-ChildItem $unpacked -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  Remove-Item $unpacked -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '==> Done' -ForegroundColor Green
Write-Host "    install dir : $installDir"
Write-Host ("    size        : {0:N1} MB" -f ($size / 1MB))
Write-Host "    user data   : $env:APPDATA\Harness Studio (kept across upgrades)"
Write-Host '    Desktop shortcut created.'
if ($freed -gt 0) {
  Write-Host ("    cleaned     : removed dist\win-unpacked ({0:N1} MB)" -f ($freed / 1MB)) -ForegroundColor DarkGray
}
