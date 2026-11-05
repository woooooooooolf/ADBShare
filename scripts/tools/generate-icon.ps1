$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dir = Join-Path $root 'src-tauri\icons'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$bitmap = [Drawing.Bitmap]::new(256, 256)
$g = [Drawing.Graphics]::FromImage($bitmap)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([Drawing.Color]::FromArgb(20, 61, 52))
$pen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(137, 219, 184), 12)
$g.DrawRectangle($pen, 94, 32, 68, 116)
$g.DrawLine($pen, 128, 150, 128, 183)
$g.DrawLine($pen, 48, 183, 208, 183)
$g.DrawLine($pen, 48, 183, 48, 220)
$g.DrawLine($pen, 208, 183, 208, 220)
$g.FillEllipse($pen.Brush, 120, 121, 16, 16)
$stream = [IO.MemoryStream]::new()
$bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
$png = $stream.ToArray()
[IO.File]::WriteAllBytes((Join-Path $dir 'icon.png'), $png)
$ico = [IO.MemoryStream]::new()
$writer = [IO.BinaryWriter]::new($ico)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
[IO.File]::WriteAllBytes((Join-Path $dir 'icon.ico'), $ico.ToArray())
$writer.Dispose(); $ico.Dispose(); $stream.Dispose(); $pen.Dispose(); $g.Dispose(); $bitmap.Dispose()
