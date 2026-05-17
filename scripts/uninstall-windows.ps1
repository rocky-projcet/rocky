[CmdletBinding()]
param(
  [switch]$RemoveState
)

$ErrorActionPreference = "Stop"
$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$MarkerPath = Join-Path $InstallRoot ".rocky-install"

if (-not (Test-Path -LiteralPath $MarkerPath)) {
  throw "This folder does not look like an installed Rocky app. Missing $MarkerPath."
}

function Remove-StartMenuShortcuts {
  if (-not $env:APPDATA) {
    return
  }

  $StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Rocky"
  if (Test-Path -LiteralPath $StartMenuDir) {
    try {
      Remove-Item -LiteralPath $StartMenuDir -Recurse -Force
      Write-Host "Removed Start Menu shortcuts."
    } catch {
      Write-Warning "Could not remove Start Menu shortcuts: $($_.Exception.Message)"
    }
  }
}

function Remove-UninstallRegistryEntry {
  $RegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Rocky"
  if (Test-Path $RegistryPath) {
    try {
      Remove-Item -Path $RegistryPath -Recurse -Force
      Write-Host "Removed uninstall registry entry."
    } catch {
      Write-Warning "Could not remove uninstall registry entry: $($_.Exception.Message)"
    }
  }
}

& (Join-Path $InstallRoot "scripts\stop-rocky-windows.ps1")
Remove-StartMenuShortcuts
Remove-UninstallRegistryEntry

if ($RemoveState) {
  $StateRoot = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "Rocky\state"
  } else {
    Join-Path $InstallRoot ".runtime\state"
  }

  if (Test-Path -LiteralPath $StateRoot) {
    Remove-Item -LiteralPath $StateRoot -Recurse -Force
    Write-Host "Removed state root: $StateRoot"
  }
}

$Parent = Split-Path -Parent $InstallRoot
$InstallName = Split-Path -Leaf $InstallRoot
Set-Location $Parent
Remove-Item -LiteralPath $InstallRoot -Recurse -Force

Write-Host "Uninstalled Rocky from $Parent\$InstallName"
