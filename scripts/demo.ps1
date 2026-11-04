param([string]$Exe = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Exe) { $Exe = Join-Path $root "artifacts\$version\ADBShare-$version-windows-x64.exe" }
if (-not (Test-Path -LiteralPath $Exe)) { throw "EXE 不存在：$Exe" }
$fixture = Join-Path $PSScriptRoot 'fixture.mjs'
$out = Join-Path $root 'work\demo-fixture.log'
New-Item -ItemType Directory -Path (Join-Path $root 'work') -Force | Out-Null
$helper = Start-Process -FilePath 'node' -ArgumentList ('"' + $fixture + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -PassThru
$previous = $env:ADB_SHARE_DATA_DIR
try {
    Start-Sleep -Seconds 1
    if ($helper.HasExited) { throw '虚拟设备启动失败' }
    $env:ADB_SHARE_DATA_DIR = Join-Path $root 'work\demo'
    $ui = Start-Process -FilePath $Exe -WorkingDirectory $root -WindowStyle Normal -PassThru
    $ui.WaitForExit()
}
finally {
    $env:ADB_SHARE_DATA_DIR = $previous
    if (-not $helper.HasExited) { $helper.Kill(); $helper.WaitForExit() }
    $helper.Dispose()
}
