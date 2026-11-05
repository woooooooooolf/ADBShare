param([string]$Exe = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Exe) { $Exe = Join-Path $root 'src-tauri/target/release/adbshare.exe' }
if (-not (Test-Path -LiteralPath $Exe)) { throw "EXE not found: $Exe. Run npm run build:app first." }
$fixture = Join-Path $PSScriptRoot 'tests/fixture.mjs'
$out = Join-Path $root 'work/demo/fixture.log'
New-Item -ItemType Directory -Path (Join-Path $root 'work/demo') -Force | Out-Null
$helper = Start-Process -FilePath 'node' -ArgumentList ('"' + $fixture + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -PassThru
$previous = $env:ADB_SHARE_DATA_DIR
$previousProfile = $env:WEBVIEW2_USER_DATA_FOLDER
try {
    Start-Sleep -Seconds 1
    if ($helper.HasExited) { throw 'The virtual ADB server failed to start' }
    $env:ADB_SHARE_DATA_DIR = Join-Path $root 'work\demo'
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $root 'work/demo/webview-profile'
    $ui = Start-Process -FilePath $Exe -WorkingDirectory $root -WindowStyle Normal -PassThru
    $ui.WaitForExit()
}
finally {
    $env:ADB_SHARE_DATA_DIR = $previous
    $env:WEBVIEW2_USER_DATA_FOLDER = $previousProfile
    if (-not $helper.HasExited) { $helper.Kill(); $helper.WaitForExit() }
    $helper.Dispose()
}
