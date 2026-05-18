[CmdletBinding()]
param(
  [string]$Tag = "v0.1.0",
  [string]$ReleaseDirectory
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path

if ([string]::IsNullOrWhiteSpace($ReleaseDirectory)) {
  $ReleaseDirectory = Join-Path $Root "releases\$Tag"
}

if (-not (Test-Path -LiteralPath $ReleaseDirectory -PathType Container)) {
  throw "Missing release directory: $ReleaseDirectory"
}

$InstallerPath = Join-Path $ReleaseDirectory "Rocky-Setup-$Tag.exe"
$AppZipPath = Join-Path $ReleaseDirectory "rocky-$Tag-windows-app.zip"
$ChecksumPath = Join-Path $ReleaseDirectory "SHA256SUMS.txt"

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
  throw "Missing installer: $InstallerPath"
}
if (-not (Test-Path -LiteralPath $AppZipPath -PathType Leaf)) {
  throw "Missing app payload zip: $AppZipPath"
}

$Entries = tar -tf $AppZipPath
if ($LASTEXITCODE -ne 0) {
  throw "Could not list app payload zip: $AppZipPath"
}

$ForbiddenPatterns = @(
  '^src/',
  '^test/',
  '^web/src/',
  '^web/tests/',
  '^\.agents/',
  '^\.claude/',
  '^\.git/',
  '^AGENTS\.md$',
  '^tsconfig\.json$',
  '^web/tsconfig\.json$',
  '^web/vite\.config\.ts$'
)

$Forbidden = $Entries | Where-Object {
  $Entry = $_
  $ForbiddenPatterns | Where-Object { $Entry -match $_ }
}

if ($Forbidden) {
  $Forbidden | ForEach-Object { Write-Error "Forbidden release payload path: $_" }
  throw "Release payload contains source or development-only paths."
}

$Assets = @($InstallerPath, $AppZipPath)
$Lines = foreach ($Asset in $Assets) {
  $Hash = Get-FileHash -LiteralPath $Asset -Algorithm SHA256
  "$($Hash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($Asset))"
}

Set-Content -Path $ChecksumPath -Value $Lines -Encoding ASCII

Write-Host "Wrote $ChecksumPath"
Write-Host "Source-free payload check OK"
