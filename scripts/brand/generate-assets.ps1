Add-Type -AssemblyName System.Drawing

# Mosaic mark geometry (viewBox 0 0 110 110), scaled to target size.
$tiles = @(
  @{ x = 8;  y = 8;  fill = "#3977df" },
  @{ x = 60; y = 8;  fill = "#91b2f6" },
  @{ x = 8;  y = 60; fill = "#759dec" },
  @{ x = 60; y = 60; fill = "#d4e1fc" }
)

function New-MosaicBitmap([int]$size, [double]$scale, [int]$pad, [string]$bg) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($bg))
  foreach ($t in $tiles) {
    $x = [float]($pad + $t.x * $scale)
    $y = [float]($pad + $t.y * $scale)
    $w = [float](42 * $scale)
    $r = [float](11 * $scale)
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($t.fill))
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $w - $r, $r, $r, 0, 90)
    $path.AddArc($x, $y + $w - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $path.Dispose(); $brush.Dispose()
  }
  $g.Dispose()
  return $bmp
}

$public = Join-Path $PSScriptRoot "..\..\public"

# scale = size/110 ; pad=0
$targets = @(
  @{ name = "favicon-16x16.png";            size = 16;  pad = 0; bg = "#ffffff" },
  @{ name = "favicon-32x32.png";            size = 32;  pad = 0; bg = "#ffffff" },
  @{ name = "android-chrome-192x192.png";   size = 192; pad = 0; bg = "#ffffff" },
  @{ name = "android-chrome-512x512.png";   size = 512; pad = 0; bg = "#ffffff" },
  @{ name = "apple-touch-icon.png";         size = 180; pad = 0; bg = "#ffffff" },
  # maskable icons need 20% safe padding on all sides
  @{ name = "maskable_icon_x192.png";       size = 192; pad = 26; bg = "#3977df" },
  @{ name = "maskable_icon_x512.png";       size = 512; pad = 69; bg = "#3977df" }
)

foreach ($t in $targets) {
  $scale = ($t.size - 2 * $t.pad) / 110.0
  $bmp = New-MosaicBitmap $t.size $scale $t.pad $t.bg
  $out = Join-Path $public $t.name
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $name"
}

# OG image 1200x630
$og = New-Object System.Drawing.Bitmap(1200, 630)
$g = [System.Drawing.Graphics]::FromImage($og)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.ColorTranslator]::FromHtml("#ffffff"))
$scale = 2.2
$pad = 120
foreach ($t in $tiles) {
  $x = [float]($pad + $t.x * $scale)
  $y = [float](210 + $t.y * $scale)
  $w = [float](42 * $scale)
  $r = [float](11 * $scale)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($t.fill))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($x, $y, $r, $r, 180, 90)
  $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
  $path.AddArc($x + $w - $r, $y + $w - $r, $r, $r, 0, 90)
  $path.AddArc($x, $y + $w - $r, $r, $r, 90, 90)
  $path.CloseFigure()
  $g.FillPath($brush, $path)
  $path.Dispose(); $brush.Dispose()
}
$font = New-Object System.Drawing.Font("Segoe UI", 92, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel))
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#253144"))
$g.DrawString("Mosaic", $font, $textBrush, 440, 250)
$sub = New-Object System.Drawing.Font("Segoe UI", 26, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel))
$subBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#8390a0"))
$g.DrawString("Visual whiteboard", $sub, $subBrush, 448, 370)
$g.Dispose()
$og.Save((Join-Path $public "og-image-3.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$og.Dispose()
Write-Output "wrote og-image-3.png"