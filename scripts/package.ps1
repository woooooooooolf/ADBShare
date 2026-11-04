param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
& node (Join-Path $PSScriptRoot 'version.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Version validation failed' }
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$exe = Join-Path $root 'src-tauri/target/release/adbshare.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Run npm run build:app first' }
$binaryVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
if ($binaryVersion -ne $version) { throw "EXE version $binaryVersion does not match $version; rebuild first" }
if (-not $OutputDirectory) { $OutputDirectory = "artifacts/$version" }
$dir = if ([IO.Path]::IsPathRooted($OutputDirectory)) { [IO.Path]::GetFullPath($OutputDirectory) } else { [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory)) }
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$name = "ADBShare-$version-windows-x64.exe"
Copy-Item -LiteralPath $exe -Destination (Join-Path $dir $name) -Force
foreach ($file in @('LICENSE','THIRD_PARTY_NOTICES.txt')) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $dir $file) -Force
}
$readme = @"
# ADBShare $version

Run $name from a writable folder. Windows x64 and WebView2 Runtime are required.
Android Platform Tools (adb) are not bundled.

1. Connect devices to the local ADB Server and allow USB debugging.
2. Create a group, select devices, a LAN adapter, a port and allowed source IPs.
3. Save and share. Approve firewall elevation when requested.
4. Run the displayed adb -H / -P commands on the remote computer.

Stopping a group keeps its firewall rule. Removing a rule first stops the group.
Deleting a group or closing the app stops sharing and cleans up its rules.
Configuration is stored in data/ beside the EXE. Sharing is not resumed on launch.
Activity history is kept in memory, with bounded data previews and manual export.

Use only on a trusted LAN: no authentication or encryption is provided.
Cross-host forward/reverse, IDE and screen-mirroring compatibility are not supported.
Real devices, two-computer LAN access and actual UAC rule changes still need validation.

Source and release: https://github.com/woooooooooolf/ADBShare
License: GPL-3.0-only. Third-party notices are included and embedded in the EXE.
"@
[IO.File]::WriteAllText((Join-Path $dir 'README.md'), $readme + "`n")
$portable = "ADBShare-$version-windows-x64.zip"
$portableFiles = @($name,'LICENSE','THIRD_PARTY_NOTICES.txt','README.md') | ForEach-Object { Join-Path $dir $_ }
Compress-Archive -LiteralPath $portableFiles -DestinationPath (Join-Path $dir $portable) -Force
& (Join-Path $PSScriptRoot 'package-source.ps1') -OutputDirectory $dir
$sums = @($name,$portable,"ADBShare-$version-source.zip") | ForEach-Object {
    $hash = (Get-FileHash -LiteralPath (Join-Path $dir $_) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $_"
}
[IO.File]::WriteAllText((Join-Path $dir 'SHA256SUMS'), ($sums -join "`n") + "`n")
Write-Output (Join-Path $dir $name)
Write-Output ($sums[0])
