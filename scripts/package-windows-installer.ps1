[CmdletBinding()]
param(
  [string]$Tag = "v0.1.2",
  [string]$OutputDirectory,
  [string]$InnoCompilerPath,
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

function Resolve-InnoCompiler {
  param([string]$RequestedPath)

  $Candidates = [System.Collections.Generic.List[string]]::new()
  function Add-Candidate {
    param([string]$Candidate)

    if (-not [string]::IsNullOrWhiteSpace($Candidate)) {
      [void]$Candidates.Add($Candidate)
    }
  }

  Add-Candidate $RequestedPath
  Add-Candidate $env:INNO_SETUP_ISCC

  $Command = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($Command) {
    Add-Candidate $Command.Source
  }

  if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
    Add-Candidate (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
  }
  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    Add-Candidate (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
  }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    Add-Candidate (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe")
  }
  Add-Candidate (Join-Path $Root ".tools\inno-setup\ISCC.exe")
  Add-Candidate (Join-Path $Root ".tools\Inno Setup 6\ISCC.exe")

  $LocalToolRoot = Join-Path $Root ".tools"
  if (Test-Path -LiteralPath $LocalToolRoot -PathType Container) {
    Get-ChildItem -LiteralPath $LocalToolRoot -Filter "ISCC.exe" -Recurse -ErrorAction SilentlyContinue |
      Sort-Object FullName |
      ForEach-Object { Add-Candidate $_.FullName }
  }

  foreach ($Candidate in ($Candidates | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
      return (Resolve-Path $Candidate).Path
    }
  }

  throw @"
Inno Setup compiler (ISCC.exe) is required to build the Windows installer.
Install Inno Setup 6 from https://jrsoftware.org/isinfo.php, or pass:
  npm run release:windows:installer -- -InnoCompilerPath "C:\Path\To\ISCC.exe"
"@
}

function ConvertTo-CommandLineArgument {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  Write-Host ">> $FilePath $($Arguments -join ' ')"
  $ArgumentLine = ($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " "
  $Process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $ArgumentLine `
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

function Copy-RequiredDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$TargetRoot
  )

  $Source = Join-Path $Root $RelativePath
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Missing required directory: $Source"
  }

  $Target = Join-Path $TargetRoot $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Target -Recurse -Force
}

function Copy-RequiredFile {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$TargetRoot
  )

  $Source = Join-Path $Root $RelativePath
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Missing required file: $Source"
  }

  $Target = Join-Path $TargetRoot $RelativePath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Target -Force
}

function Write-MinimalPackageJson {
  param([Parameter(Mandatory = $true)][string]$TargetRoot)

  $Package = Get-Content -Path (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  $Version = if ($Package.version) { $Package.version } else { $Tag.TrimStart("v") }
  $Content = @"
{
  "name": "rocky-project",
  "private": true,
  "version": "$Version",
  "type": "module",
  "bin": {
    "rocky-project": "./dist/src/cli.js"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
"@
  Set-Content -Path (Join-Path $TargetRoot "package.json") -Value $Content -Encoding ASCII
}

function Assert-SourceFreePayload {
  param([Parameter(Mandatory = $true)][string]$PayloadRoot)

  $ForbiddenPaths = @(
    "src",
    "test",
    "web\src",
    "web\tests",
    ".agents",
    ".claude",
    ".git",
    ".mcp.json",
    "AGENTS.md",
    "tsconfig.json",
    "web\tsconfig.json",
    "web\vite.config.ts"
  )

  foreach ($RelativePath in $ForbiddenPaths) {
    $Candidate = Join-Path $PayloadRoot $RelativePath
    if (Test-Path -LiteralPath $Candidate) {
      throw "Installer payload includes source/dev path: $RelativePath"
    }
  }
}

function Get-AppVersion {
  param([string]$ReleaseTag)

  $Version = $ReleaseTag.TrimStart("v")
  if ($Version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') {
    return "0.0.0"
  }

  return $Version
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $Root "releases\$Tag"
}

$NpmPath = Resolve-Tool -Names @("npm.cmd", "npm") -DisplayName "npm"
$InnoPath = Resolve-InnoCompiler -RequestedPath $InnoCompilerPath
$InstallerScript = Join-Path $Root "installer\rocky.iss"

if (-not (Test-Path -LiteralPath $InstallerScript -PathType Leaf)) {
  throw "Missing Inno Setup script: $InstallerScript"
}

if (-not $SkipBuild) {
  Invoke-Checked -FilePath $NpmPath -Arguments @("run", "build", "--silent") -WorkingDirectory $Root
  Invoke-Checked -FilePath $NpmPath -Arguments @("--prefix", "web", "run", "build", "--silent") -WorkingDirectory $Root
}

$IconScript = Join-Path $Root "scripts\generate-windows-icons.ps1"
if (Test-Path -LiteralPath $IconScript) {
  & $IconScript
}

$WorkRoot = Join-Path $Root ".tmp\windows-installer\$Tag"
$PayloadRoot = Join-Path $WorkRoot "payload"
$SourceFreePayloadZipPath = Join-Path $OutputDirectory "rocky-$Tag-windows-app.zip"
$InstallerPath = Join-Path $OutputDirectory "Rocky-Setup-$Tag.exe"

Assert-ChildPath -Parent (Join-Path $Root ".tmp") -Child $WorkRoot
Assert-ChildPath -Parent (Join-Path $Root "releases") -Child $OutputDirectory

Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $PayloadRoot | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

Copy-RequiredDirectory -RelativePath "dist\src" -TargetRoot $PayloadRoot
Copy-RequiredDirectory -RelativePath "web\dist" -TargetRoot $PayloadRoot
Copy-RequiredDirectory -RelativePath "node_modules" -TargetRoot $PayloadRoot
Copy-RequiredDirectory -RelativePath "assets\windows" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "scripts\install-windows.ps1" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "scripts\start-rocky-windows.ps1" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "scripts\stop-rocky-windows.ps1" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "scripts\uninstall-windows.ps1" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "scripts\serve-web-dist.mjs" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "Install-Rocky-Windows.cmd" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "Start-Rocky-Windows.cmd" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "Stop-Rocky-Windows.cmd" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "Uninstall-Rocky-Windows.cmd" -TargetRoot $PayloadRoot
Copy-RequiredFile -RelativePath "docs\windows-install.md" -TargetRoot $PayloadRoot
Write-MinimalPackageJson -TargetRoot $PayloadRoot

$ReleaseNotes = @"
Rocky Windows app installer payload: $Tag

This payload is intended for Rocky-Setup-$Tag.exe.
It contains compiled backend JavaScript, built web assets, Windows launchers,
and bundled backend npm dependencies. Running this payload over an existing
Rocky install updates the app/runtime files while preserving .runtime, .codex,
.tools, .env files, and the default per-user state root. It intentionally excludes
TypeScript source, tests, local agent instructions, and development configuration.
"@
Set-Content -Path (Join-Path $PayloadRoot "WINDOWS_RELEASE.txt") -Value $ReleaseNotes -Encoding ASCII

Assert-SourceFreePayload -PayloadRoot $PayloadRoot

Remove-Item -LiteralPath $SourceFreePayloadZipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $PayloadRoot "*") -DestinationPath $SourceFreePayloadZipPath -Force

Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue
$env:ROCKY_RELEASE_TAG = $Tag
$env:ROCKY_APP_VERSION = Get-AppVersion -ReleaseTag $Tag
$env:ROCKY_PAYLOAD_ROOT = $PayloadRoot
$env:ROCKY_OUTPUT_DIR = $OutputDirectory
$env:ROCKY_REPO_ROOT = $Root

Invoke-Checked -FilePath $InnoPath -Arguments @($InstallerScript) -WorkingDirectory $Root

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
  throw "Inno Setup completed without creating $InstallerPath."
}

Write-Host "Created $InstallerPath"
Write-Host "Created $SourceFreePayloadZipPath"
