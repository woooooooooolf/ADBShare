$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root ('work\source-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
# Explicit source/build-input list: never include user data, caches or Git metadata.
$items = @('LICENSE','THIRD_PARTY_NOTICES.txt','README.md','package.json','package-lock.json',
    'tsconfig.json','index.html','.npmrc','.gitignore','.gitattributes','src','scripts','licenses','docs',
    'src-tauri\Cargo.toml','src-tauri\Cargo.lock','src-tauri\build.rs','src-tauri\tauri.conf.json',
    'src-tauri\capabilities','src-tauri\icons','src-tauri\src','src-tauri\tests')
foreach ($item in $items) {
    $destination = Join-Path $stage $item
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $root $item) -Destination $destination -Recurse -Force
}
$zip = Join-Path $root 'artifacts\ADBShare-0.1.0-source.zip'
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $stage -Force).FullName -DestinationPath $zip -Force
Write-Output $zip
