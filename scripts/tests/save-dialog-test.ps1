param([int]$AppPid, [string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ExportTestWindow {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, string lParam);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@
# Restrict automation to the native dialog owned by this test's EXE.
$root = [System.Windows.Automation.AutomationElement]::RootElement
$until = [DateTime]::UtcNow.AddSeconds(40)
$diagnostic = @()
while ([DateTime]::UtcNow -lt $until) {
    foreach ($targetPid in @($AppPid)) {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $targetPid)
        $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        $diagnostic += "Windows for ${targetPid}: $($windows.Count)"
        foreach ($window in $windows) {
            $diagnostic += "Window: $($window.Current.Name)"
            $hostCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'FileNameControlHost')
            $fileHost = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $hostCondition)
            if ($null -eq $fileHost) { continue }
            $editCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')
            $edit = $fileHost.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
            if ($null -eq $edit) { continue }
            # Restrict native messages to controls discovered in this test process.
            $editHandle = [IntPtr]$edit.Current.NativeWindowHandle
            if ($editHandle -eq [IntPtr]::Zero) { throw 'Test export filename has no native handle' }
            [ExportTestWindow]::SendMessage($editHandle, 0x000C, [IntPtr]::Zero, $Destination) | Out-Null
            $saveCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1')
            $saveButton = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $saveCondition) | Where-Object { $_.Current.Name -match '^(Save|保存)' }) | Select-Object -First 1
            if ($null -eq $saveButton) { throw 'Test export Save button was not found' }
            $saveHandle = [IntPtr]$saveButton.Current.NativeWindowHandle
            if ($saveHandle -eq [IntPtr]::Zero) { throw 'Test export Save button has no native handle' }
            [ExportTestWindow]::PostMessage($saveHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            $savedUntil = [DateTime]::UtcNow.AddSeconds(8)
            while ([DateTime]::UtcNow -lt $savedUntil) {
                if (Test-Path -LiteralPath $Destination) { exit 0 }
                Start-Sleep -Milliseconds 100
            }
            throw 'Test export did not create the selected file'
        }
    }
    Start-Sleep -Milliseconds 200
}
throw ("Test export dialog did not appear: " + ($diagnostic -join " | "))
