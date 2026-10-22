# Génère les icônes PNG de l'extension sans dépendance externe.
# Usage : npm run icons
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

$master = New-Object System.Drawing.Bitmap(512, 512)
$g = [System.Drawing.Graphics]::FromImage($master)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$bg = New-RoundRectPath 16 16 480 480 112
$brushBg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(512, 512)),
    [System.Drawing.Color]::FromArgb(255, 15, 23, 42),
    [System.Drawing.Color]::FromArgb(255, 30, 41, 59))
$g.FillPath($brushBg, $bg)
$penBorder = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 51, 65, 85), 8)
$g.DrawPath($penBorder, $bg)

$arrowTop = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 56, 189, 248), 34)
$arrowTop.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrowTop.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($arrowTop, 120, 180, 330, 180)
$headTop = @(
    (New-Object System.Drawing.Point(316, 118)),
    (New-Object System.Drawing.Point(316, 242)),
    (New-Object System.Drawing.Point(420, 180))
)
$g.FillPolygon((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 56, 189, 248))), $headTop)

$arrowBottom = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 163, 230, 53), 34)
$arrowBottom.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrowBottom.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLine($arrowBottom, 392, 332, 182, 332)
$headBottom = @(
    (New-Object System.Drawing.Point(196, 270)),
    (New-Object System.Drawing.Point(196, 394)),
    (New-Object System.Drawing.Point(92, 332))
)
$g.FillPolygon((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 163, 230, 53))), $headBottom)

$g.Dispose()

foreach ($size in 16, 32, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $ctx = [System.Drawing.Graphics]::FromImage($bmp)
    $ctx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $ctx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $ctx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $ctx.Clear([System.Drawing.Color]::Transparent)
    $ctx.DrawImage($master, 0, 0, $size, $size)
    $ctx.Dispose()
    $path = Join-Path $outDir ("icon{0}.png" -f $size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "written $path"
}

$master.Dispose()
