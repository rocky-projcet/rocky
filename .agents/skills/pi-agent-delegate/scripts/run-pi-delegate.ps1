param(
  [Parameter(Mandatory = $true)]
  [string]$PromptFile,

  [string]$Cwd = (Get-Location).Path,

  [string]$PiCommand,

  [string[]]$ExtraArgs = @(),

  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$resolvedCwd = (Resolve-Path -LiteralPath $Cwd).Path
$resolvedPromptFile = (Resolve-Path -LiteralPath $PromptFile).Path

function Resolve-PiCommand {
  param([string]$WorkingDirectory, [string]$RequestedCommand)

  if ($RequestedCommand) {
    return (Resolve-Path -LiteralPath $RequestedCommand).Path
  }

  $localCodex = Join-Path $WorkingDirectory "pi-codex.cmd"
  if (Test-Path -LiteralPath $localCodex) {
    return $localCodex
  }

  $localPi = Join-Path $WorkingDirectory "pi.cmd"
  if (Test-Path -LiteralPath $localPi) {
    return $localPi
  }

  $found = Get-Command pi -ErrorAction SilentlyContinue
  if ($found) {
    return $found.Source
  }

  throw "Could not find pi-codex.cmd, pi.cmd, or pi on PATH."
}

$pi = Resolve-PiCommand -WorkingDirectory $resolvedCwd -RequestedCommand $PiCommand
$isCodexWrapper = [System.IO.Path]::GetFileName($pi).Equals("pi-codex.cmd", [System.StringComparison]::OrdinalIgnoreCase)

$arguments = @()
if (-not $isCodexWrapper) {
  $arguments += "--provider"
  $arguments += "openai-codex"
}
$arguments += "--print"
$arguments += "@$resolvedPromptFile"
$arguments += $ExtraArgs

if ($DryRun) {
  [pscustomobject]@{
    pi = $pi
    cwd = $resolvedCwd
    args = $arguments
  } | ConvertTo-Json -Depth 4
  exit 0
}

Push-Location -LiteralPath $resolvedCwd
try {
  & $pi @arguments
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
