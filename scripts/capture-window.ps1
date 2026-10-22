param(
  [string]$Output = "$env:TEMP\harness-window.png"
)

# Capture the Harness Studio window with Win32 PrintWindow, so we can verify the
# UI actually rendered (a live process alone does not prove that).
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process 'Harness Studio' -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw 'Harness Studio window not found' }

$h = $proc.MainWindowHandle
[void][WinCap]::ShowWindow($h, 9)   # SW_RESTORE
[void][WinCap]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 1200

$rect = New-Object WinCap+RECT
[void][WinCap]::GetWindowRect($h, [ref]$rect)
$w = $rect.Right - $rect.Left
$ht = $rect.Bottom - $rect.Top
if ($w -le 0 -or $ht -le 0) { throw "bad window size ${w}x${ht}" }

$bmp = New-Object System.Drawing.Bitmap $w, $ht
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $gfx.GetHdc()
[void][WinCap]::PrintWindow($h, $hdc, 2)   # PW_RENDERFULLCONTENT
$gfx.ReleaseHdc($hdc)
$gfx.Dispose()
$bmp.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output "CAPTURED $Output ${w}x${ht}"
