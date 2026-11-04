param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version' }
if (-not $OutputDirectory) { $OutputDirectory = "artifacts/$version" }
$dir = if ([IO.Path]::IsPathRooted($OutputDirectory)) { [IO.Path]::GetFullPath($OutputDirectory) } else { [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory)) }
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$stage = Join-Path $root ('work/source-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
try {
    # Explicit build-input list: exclude local data, caches, outputs and Git metadata.
    $items = @('LICENSE','THIRD_PARTY_NOTICES.txt','README.md','CHANGELOG.md',
        'package.json','package-lock.json','rust-toolchain.toml','.node-version','.github',
        'tsconfig.json','index.html','.npmrc','.gitignore','.gitattributes','src','scripts','licenses','docs',
        'src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/build.rs','src-tauri/tauri.conf.json',
        'src-tauri/capabilities','src-tauri/icons','src-tauri/src','src-tauri/tests')
    foreach ($item in $items) {
        $destination = Join-Path $stage $item
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $root $item) -Destination $destination -Recurse -Force
    }
    $zip = Join-Path $dir "ADBShare-$version-source.zip"
    Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $stage -Force).FullName -DestinationPath $zip -Force
    Write-Output $zip
}
finally {
    $resolved = [IO.Path]::GetFullPath($stage)
    $workRoot = [IO.Path]::GetFullPath((Join-Path $root 'work')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($workRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging cleanup path' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
