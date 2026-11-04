param([int]$AppPid, [string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ExportTestWindow {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
# Restrict automation to the export helper created by this test's EXE.
$root = [System.Windows.Automation.AutomationElement]::RootElement
$until = [DateTime]::UtcNow.AddSeconds(40)
$diagnostic = @()
while ([DateTime]::UtcNow -lt $until) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$AppPid AND Name='powershell.exe'"
    $diagnostic = @("Children: $($children.ProcessId -join ",")")
    foreach ($child in $children) {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$child.ProcessId)
        $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
        $diagnostic += "Windows for $($child.ProcessId): $($windows.Count)"
        foreach ($window in $windows) {
            $diagnostic += "Window: $($window.Current.Name)"
            $hostCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'FileNameControlHost')
            $fileHost = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $hostCondition)
            if ($null -eq $fileHost) { continue }
            $editCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')
            $edit = $fileHost.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
            if ($null -eq $edit) { continue }
            # Some Windows file dialogs expose the filename as a custom control,
            # without ValuePattern. Use its standard accelerator after verifying focus.
            $handle = [IntPtr]$window.Current.NativeWindowHandle
            [ExportTestWindow]::SetForegroundWindow($handle) | Out-Null
            Start-Sleep -Milliseconds 150
            if ([ExportTestWindow]::GetForegroundWindow() -ne $handle) { throw 'Test export dialog could not be focused' }
            [System.Windows.Forms.SendKeys]::SendWait('%n')
            [System.Windows.Forms.SendKeys]::SendWait('^a')
            [System.Windows.Forms.SendKeys]::SendWait($Destination)
            [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
            exit 0
        }
    }
    Start-Sleep -Milliseconds 200
}
throw ("Test export dialog did not appear: " + ($diagnostic -join " | "))
