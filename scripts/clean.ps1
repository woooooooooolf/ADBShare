[CmdletBinding(SupportsShouldProcess)]
param([switch]$BuildCache)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$prefix = $root + [IO.Path]::DirectorySeparatorChar
$targets = @('dist', 'work/tests')
if ($BuildCache) {
    # Keep executable files and every runtime data/ directory in place.
    foreach ($buildProfile in @('debug', 'release')) {
        foreach ($cache in @('build', 'deps', '.fingerprint', 'incremental', 'examples')) {
            $targets += "src-tauri/target/$buildProfile/$cache"
        }
        $buildProfileRoot = Join-Path $root "src-tauri/target/$buildProfile"
        if (Test-Path -LiteralPath $buildProfileRoot) {
            foreach ($file in Get-ChildItem -LiteralPath $buildProfileRoot -File -Force) {
                if ($file.Extension -in @('.pdb', '.rlib', '.rmeta', '.d')) {
                    $targets += "src-tauri/target/$buildProfile/$($file.Name)"
                }
            }
        }
    }
}
foreach ($relative in $targets) {
    $target = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe cleanup path' }
    if (-not (Test-Path -LiteralPath $target)) { continue }
    $item = Get-Item -LiteralPath $target -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing to clean a linked directory: $target" }
    if ($relative -eq 'work/tests') {
        foreach ($directory in Get-ChildItem -LiteralPath $target -Force) {
            if (-not $directory.PSIsContainer -or $directory.Name -notin @('ui', 'integration', 'linux-ui') -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "Refusing to clean unrecognized content: $($directory.FullName)"
            }
            $marker = Join-Path $directory.FullName '.adbshare-test-workspace'
            if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw) -ne "ADBShare synthetic test`n") {
                throw "Refusing to clean an unrecognized test workspace: $($directory.FullName)"
            }
        }
    }
    if ($PSCmdlet.ShouldProcess($target, 'Remove generated files')) {
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-Output "Removed $relative"
    }
}
