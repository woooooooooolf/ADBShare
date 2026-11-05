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
$legacy = Join-Path $dir 'SHA256SUMS'
if (Test-Path -LiteralPath $legacy) {
    $oldManifest = (Get-Content -LiteralPath $legacy -Raw).Trim()
    if ($oldManifest -notmatch ('^[a-fA-F0-9]{64}  ' + [regex]::Escape($name) + '$')) {
        throw 'The output directory contains a different legacy manifest. Choose a fresh output directory.'
    }
}
Copy-Item -LiteralPath $exe -Destination (Join-Path $dir $name) -Force
$hash = (Get-FileHash -LiteralPath (Join-Path $dir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
$sum = "$hash  $name"
[IO.File]::WriteAllText((Join-Path $dir "$name.sha256"), $sum + "`n")
if (Test-Path -LiteralPath $legacy) { Remove-Item -LiteralPath $legacy }
Write-Output (Join-Path $dir $name)
Write-Output $sum
