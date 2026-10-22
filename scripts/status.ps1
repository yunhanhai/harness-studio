# Report the current footprint of Harness Studio and flag duplicates.
# Read-only: this script never deletes anything.

$ErrorActionPreference = 'Stop'

function Get-DirSize([string]$Path) {
  if (-not (Test-Path $Path)) { return 0 }
  $sum = (Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return 0 }
  return $sum
}

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Harness Studio'
$userData = Join-Path $env:APPDATA 'Harness Studio'
$repo = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repo 'dist'

Write-Host ''
Write-Host 'Harness Studio - disk footprint' -ForegroundColor Cyan
Write-Host ('=' * 62)

$rows = @(
  @{ Label = 'Program (replaced on upgrade)'; Path = $installDir; Keep = 'replaced' },
  @{ Label = 'User data (kept on upgrade)'; Path = $userData; Keep = 'kept' },
  @{ Label = 'Installers in dist'; Path = $distDir; Keep = 'deletable' }
)

$total = 0
foreach ($row in $rows) {
  $size = Get-DirSize $row.Path
  $total += $size
  $status = if (Test-Path $row.Path) { '' } else { '  [missing]' }
  Write-Host ''
  Write-Host ("  {0}{1}" -f $row.Label, $status) -ForegroundColor White
  Write-Host ("    {0}" -f $row.Path) -ForegroundColor DarkGray
  Write-Host ("    {0,8:N1} MB   ({1})" -f ($size / 1MB), $row.Keep)
}

Write-Host ''
Write-Host ('-' * 62)
Write-Host ("  Total: {0:N1} MB (excluding node_modules)" -f ($total / 1MB))
Write-Host ''

# Duplicate detection: there should be exactly one program folder and two links.
$programCopies = @(Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '*Harness*' })
$links = @(
  Get-ChildItem ([Environment]::GetFolderPath('Desktop')) -Filter '*Harness*.lnk' -ErrorAction SilentlyContinue
  Get-ChildItem ([Environment]::GetFolderPath('Programs')) -Filter '*Harness*.lnk' -ErrorAction SilentlyContinue
)

Write-Host 'Duplicate check' -ForegroundColor Cyan
if ($programCopies.Count -eq 1) {
  Write-Host '  [ok] exactly one program folder' -ForegroundColor Green
} else {
  Write-Host ("  [warn] found {0} program folders:" -f $programCopies.Count) -ForegroundColor Yellow
  $programCopies | ForEach-Object { Write-Host "         $($_.FullName)" }
}

if ($links.Count -eq 2) {
  Write-Host '  [ok] 2 shortcuts (Desktop + Start Menu)' -ForegroundColor Green
} elseif ($links.Count -eq 0) {
  Write-Host '  [warn] no shortcuts; run npm run install:local' -ForegroundColor Yellow
} else {
  Write-Host ("  [warn] found {0} shortcuts:" -f $links.Count) -ForegroundColor Yellow
  $links | ForEach-Object { Write-Host "         $($_.FullName)" }
}

$exe = Join-Path $installDir 'Harness Studio.exe'
if (Test-Path $exe) {
  $version = (Get-Item $exe).VersionInfo.ProductVersion
  Write-Host ("  [ok] installed exe present (version {0})" -f $version) -ForegroundColor Green
} else {
  Write-Host '  [warn] installed exe missing; run npm run install:local' -ForegroundColor Yellow
}

# Stale staging copies are the main source of surprise disk usage.
$unpacked = Join-Path $distDir 'win-unpacked'
if (Test-Path $unpacked) {
  $size = Get-DirSize $unpacked
  Write-Host ("  [warn] dist\win-unpacked still present ({0:N1} MB); npm run clean:dist" -f ($size / 1MB)) -ForegroundColor Yellow
} else {
  Write-Host '  [ok] no staging copy left behind' -ForegroundColor Green
}

Write-Host ''
