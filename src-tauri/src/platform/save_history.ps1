$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object Windows.Forms.Form
$owner.TopMost = $true
$dialog = New-Object Windows.Forms.SaveFileDialog
$dialog.Filter = 'Text files (*.txt)|*.txt'
$dialog.FileName = 'ADBShare-history.txt'
try {
    if ($dialog.ShowDialog($owner) -eq 'OK') { [Console]::Write($dialog.FileName) }
}
finally {
    $dialog.Dispose()
    $owner.Dispose()
}
