[CmdletBinding()]
param(
  [string]$Tag = "v0.1.2",
  [string]$OutputDirectory,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Resolve-Tool {
  param(
    [Parameter(Mandatory = $true)][string[]]$Names,
    [Parameter(Mandatory = $true)][string]$DisplayName
  )

  foreach ($Name in $Names) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Command) {
      return $Command.Source
    }
  }

  throw "$DisplayName is required."
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  Write-Host ">> $FilePath $($Arguments -join ' ')"
  $Process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -NoNewWindow `
    -Wait `
    -PassThru

  if ($Process.ExitCode -ne 0) {
    throw "$FilePath failed with exit code $($Process.ExitCode)."
  }
}

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )

  $ParentFull = [System.IO.Path]::GetFullPath($Parent)
  $ChildFull = [System.IO.Path]::GetFullPath($Child)
  if (-not $ChildFull.StartsWith($ParentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside $ParentFull."
  }
}

function Test-ReleasePayloadPath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  $Normalized = $RelativePath -replace "/", "\"
  $Parts = $Normalized.Split("\", [System.StringSplitOptions]::RemoveEmptyEntries)
  if ($Parts.Count -eq 0) {
    return $false
  }

  $FirstPart = $Parts[0]
  if ($FirstPart.StartsWith("-")) {
    return $false
  }

  $SkippedTopLevel = @(
    ".agents",
    ".claude",
    ".git",
    ".runtime",
    ".tmp",
    ".tools",
    "dist",
    "node_modules",
    "releases",
    "test"
  )

  if ($SkippedTopLevel -contains $FirstPart) {
    return $false
  }

  if ($Normalized -eq ".mcp.json" -or $Normalized -eq "AGENTS.md" -or $Normalized -eq "pnpm-lock.yaml") {
    return $false
  }

  if ($Normalized.StartsWith("docs\plans\", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }

  if ($Normalized.StartsWith("web\tests\", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $false
  }

  return $true
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $Root "releases\$Tag"
}

$NpmPath = Resolve-Tool -Names @("npm.cmd", "npm") -DisplayName "npm"
$GitPath = Resolve-Tool -Names @("git.exe", "git") -DisplayName "git"

if (-not $SkipBuild) {
  Invoke-Checked -FilePath $NpmPath -Arguments @("run", "build", "--silent") -WorkingDirectory $Root
  Invoke-Checked -FilePath $NpmPath -Arguments @("--prefix", "web", "run", "build", "--silent") -WorkingDirectory $Root
}

$IconScript = Join-Path $Root "scripts\generate-windows-icons.ps1"
if (Test-Path -LiteralPath $IconScript) {
  & $IconScript
}

$StageRoot = Join-Path $Root ".tmp\windows-release\$Tag"
$ZipPath = Join-Path $OutputDirectory "rocky-$Tag-windows.zip"

Assert-ChildPath -Parent (Join-Path $Root ".tmp") -Child $StageRoot
Assert-ChildPath -Parent (Join-Path $Root "releases") -Child $OutputDirectory

Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$Files = & $GitPath -C $Root ls-files --cached --others --exclude-standard
if ($LASTEXITCODE -ne 0) {
  throw "git ls-files failed."
}

foreach ($File in $Files) {
  if (-not (Test-ReleasePayloadPath -RelativePath $File)) {
    continue
  }

  $Source = Join-Path $Root $File
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    continue
  }

  $Target = Join-Path $StageRoot $File
  $TargetDirectory = Split-Path -Parent $Target
  New-Item -ItemType Directory -Force -Path $TargetDirectory | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Target -Force
}

foreach ($GeneratedDirectory in @("dist", "web\dist")) {
  $Source = Join-Path $Root $GeneratedDirectory
  if (Test-Path -LiteralPath $Source) {
    $Target = Join-Path $StageRoot $GeneratedDirectory
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Target -Recurse -Force
    if ($GeneratedDirectory -eq "dist") {
      Remove-Item -LiteralPath (Join-Path $Target "test") -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath (Join-Path $Target "web") -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

$ReleaseNotes = @"
Rocky Windows release: $Tag

Install and run:
  Install-Rocky-Windows.cmd

Run after install:
  Start-Rocky-Windows.cmd
  Rocky.lnk

Stop:
  Stop-Rocky-Windows.cmd

Uninstall:
  Uninstall-Rocky-Windows.cmd
  Uninstall Rocky.lnk
"@
Set-Content -Path (Join-Path $StageRoot "WINDOWS_RELEASE.txt") -Value $ReleaseNotes -Encoding ASCII

Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $StageRoot "*") -DestinationPath $ZipPath -Force

Write-Host "Created $ZipPath"
