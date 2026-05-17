[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SourceImagePath = Join-Path $Root "web\public\android-chrome-512x512.png"
$OutputDirectory = Join-Path $Root "assets\windows"

if (-not (Test-Path -LiteralPath $SourceImagePath)) {
  throw "Rocky icon source image was not found: $SourceImagePath"
}

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function New-IconPngBytes {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.Image]$SourceImage,
    [Parameter(Mandatory = $true)][int]$Size,
    [switch]$UninstallBadge
  )

  $Bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $Stream = New-Object System.IO.MemoryStream

  try {
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $Graphics.Clear([System.Drawing.Color]::Transparent)
    $Graphics.DrawImage($SourceImage, 0, 0, $Size, $Size)

    if ($UninstallBadge -and $Size -ge 32) {
      $BadgeSize = [int][Math]::Round($Size * 0.38)
      $Margin = [int][Math]::Max(2, [Math]::Round($Size * 0.04))
      $BadgeX = $Size - $BadgeSize - $Margin
      $BadgeY = $Size - $BadgeSize - $Margin
      $CircleRect = New-Object System.Drawing.Rectangle $BadgeX, $BadgeY, $BadgeSize, $BadgeSize
      $BadgeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, 220, 38, 38))
      $BorderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(248, 255, 255, 255)), ([single][Math]::Max(1.5, $Size * 0.025))
      $CrossPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([single][Math]::Max(2, $Size * 0.045))

      try {
        $CrossPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $CrossPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $Graphics.FillEllipse($BadgeBrush, $CircleRect)
        $Graphics.DrawEllipse($BorderPen, $CircleRect)

        $CrossInset = [int][Math]::Round($BadgeSize * 0.31)
        $Left = $BadgeX + $CrossInset
        $Top = $BadgeY + $CrossInset
        $Right = $BadgeX + $BadgeSize - $CrossInset
        $Bottom = $BadgeY + $BadgeSize - $CrossInset
        $Graphics.DrawLine($CrossPen, $Left, $Top, $Right, $Bottom)
        $Graphics.DrawLine($CrossPen, $Left, $Bottom, $Right, $Top)
      } finally {
        $CrossPen.Dispose()
        $BorderPen.Dispose()
        $BadgeBrush.Dispose()
      }
    }

    $Bitmap.Save($Stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $Bytes = $Stream.ToArray()
    return ,$Bytes
  } finally {
    $Stream.Dispose()
    $Graphics.Dispose()
    $Bitmap.Dispose()
  }
}

function Write-IcoFile {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.Image]$SourceImage,
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$UninstallBadge
  )

  $Sizes = @(16, 24, 32, 48, 64, 128, 256)
  $Images = foreach ($Size in $Sizes) {
    @{
      Size = $Size
      Bytes = [byte[]](New-IconPngBytes -SourceImage $SourceImage -Size $Size -UninstallBadge:$UninstallBadge)
    }
  }

  $Stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $Writer = New-Object System.IO.BinaryWriter $Stream

  try {
    $Writer.Write([uint16]0)
    $Writer.Write([uint16]1)
    $Writer.Write([uint16]$Images.Count)

    $Offset = 6 + (16 * $Images.Count)
    foreach ($Image in $Images) {
      $WidthByte = if ($Image.Size -eq 256) { 0 } else { $Image.Size }
      $Writer.Write([byte]$WidthByte)
      $Writer.Write([byte]$WidthByte)
      $Writer.Write([byte]0)
      $Writer.Write([byte]0)
      $Writer.Write([uint16]1)
      $Writer.Write([uint16]32)
      $Writer.Write([uint32]$Image.Bytes.Length)
      $Writer.Write([uint32]$Offset)
      $Offset += $Image.Bytes.Length
    }

    foreach ($Image in $Images) {
      $Writer.Write([byte[]]$Image.Bytes)
    }
  } finally {
    $Writer.Dispose()
    $Stream.Dispose()
  }
}

$SourceImage = [System.Drawing.Image]::FromFile($SourceImagePath)
try {
  Write-IcoFile -SourceImage $SourceImage -Path (Join-Path $OutputDirectory "rocky.ico")
  Write-IcoFile -SourceImage $SourceImage -Path (Join-Path $OutputDirectory "rocky-uninstall.ico") -UninstallBadge
} finally {
  $SourceImage.Dispose()
}

Write-Host "Generated Rocky Windows icons in $OutputDirectory"
