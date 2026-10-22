param(
  [int]$X,
  [int]$Y,
  [int]$DelayMs = 600
)

# Send a real mouse click at screen coordinates, so we can drive the installed
# app the way a user would when CDP is unavailable.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Clicker {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP   = 0x0004;
}
"@

Add-Type -AssemblyName System.Windows.Forms
$proc = Get-Process 'Harness Studio' -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw 'Harness Studio window not found' }
[void][Clicker]::SetForegroundWindow($proc.MainWindowHandle)
Start-Sleep -Milliseconds 400

[void][Clicker]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 200
[Clicker]::mouse_event([Clicker]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Clicker]::mouse_event([Clicker]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds $DelayMs
Write-Output "CLICKED $X,$Y"
