param([int]$AppPid, [int]$ClientWidth, [int]$ClientHeight)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ResizeTestWindow {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
"@
[ResizeTestWindow]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
$handle = (Get-Process -Id $AppPid).MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw 'Test window not found' }
$outer = [ResizeTestWindow+Rect]::new()
$client = [ResizeTestWindow+Rect]::new()
if (-not [ResizeTestWindow]::GetWindowRect($handle, [ref]$outer)) { throw 'Could not read test window bounds' }
if (-not [ResizeTestWindow]::GetClientRect($handle, [ref]$client)) { throw 'Could not read test client bounds' }
$width = $ClientWidth + ($outer.Right - $outer.Left) - ($client.Right - $client.Left)
$height = $ClientHeight + ($outer.Bottom - $outer.Top) - ($client.Bottom - $client.Top)
$screen = [System.Windows.Forms.Screen]::FromHandle($handle).WorkingArea
$x = $screen.X + [Math]::Max(0, [int](($screen.Width - $width) / 2))
$y = $screen.Y + [Math]::Max(0, [int](($screen.Height - $height) / 2))
# Only the test-created EXE is targeted. Resize without activating or changing Z order.
if (-not [ResizeTestWindow]::SetWindowPos($handle, [IntPtr]::Zero, $x, $y, $width, $height, 0x14)) {
    throw 'Could not resize test window'
}
