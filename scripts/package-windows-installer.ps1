[CmdletBinding()]
param(
  [string]$Tag = "v0.1.0",
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

function New-InstallerBootstrap {
  param(
    [Parameter(Mandatory = $true)][string]$BootstrapRoot,
    [Parameter(Mandatory = $true)][string]$PayloadZipName
  )

  $SetupCmd = @"
@echo off
setlocal
title Rocky Setup
echo Rocky Setup
echo.
if defined LOCALAPPDATA (
  set "ROCKY_SETUP_LOG=%LOCALAPPDATA%\Rocky\install.log"
  if not exist "%LOCALAPPDATA%\Rocky" mkdir "%LOCALAPPDATA%\Rocky" >nul 2>nul
) else (
  set "ROCKY_SETUP_LOG=%TEMP%\Rocky-Setup-install.log"
)
echo Log: %ROCKY_SETUP_LOG%
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "ROCKY_EXIT=%ERRORLEVEL%"
echo.
if not "%ROCKY_EXIT%"=="0" (
  echo Rocky setup failed with exit code %ROCKY_EXIT%.
  echo See the log above for details.
  pause
  exit /b %ROCKY_EXIT%
)
echo Rocky setup completed. The app should open in your browser.
echo This window will close in 5 seconds.
timeout /t 5 /nobreak >nul
exit /b 0
"@
  Set-Content -Path (Join-Path $BootstrapRoot "setup.cmd") -Value $SetupCmd -Encoding ASCII

  $SetupPs1 = @"
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = `$true)]
  [string[]]`$RemainingArgs
)

`$ErrorActionPreference = "Stop"
`$PayloadZip = Join-Path `$PSScriptRoot "$PayloadZipName"
`$ExtractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Rocky-Setup-$Tag-" + [guid]::NewGuid().ToString("N"))
`$LogPath = `$env:ROCKY_SETUP_LOG
if ([string]::IsNullOrWhiteSpace(`$LogPath)) {
  if (`$env:LOCALAPPDATA) {
    `$LogPath = Join-Path `$env:LOCALAPPDATA "Rocky\install.log"
  } else {
    `$LogPath = Join-Path ([System.IO.Path]::GetTempPath()) "Rocky-Setup-install.log"
  }
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent `$LogPath) | Out-Null

`$TranscriptStarted = `$false
try {
  Start-Transcript -Path `$LogPath -Append | Out-Null
  `$TranscriptStarted = `$true
} catch {
  Write-Warning "Could not start setup transcript: `$(`$_.Exception.Message)"
}

`$ExitCode = 0

try {
  Write-Host "Extracting Rocky installer payload..."
  New-Item -ItemType Directory -Force -Path `$ExtractRoot | Out-Null
  Expand-Archive -LiteralPath `$PayloadZip -DestinationPath `$ExtractRoot -Force
  `$InstallCommand = Join-Path `$ExtractRoot "Install-Rocky-Windows.cmd"
  if (-not (Test-Path -LiteralPath `$InstallCommand)) {
    throw "Installer payload is missing Install-Rocky-Windows.cmd."
  }

  `$InstallArgs = @(
    "-SkipDependencyInstall",
    "-SkipBuild",
    "-IncludeBundledDependencies"
  )
  Write-Host "Running Rocky installer..."
  & `$InstallCommand @InstallArgs @RemainingArgs
  if (`$LASTEXITCODE -ne 0) {
    throw "Rocky installer failed with exit code `$LASTEXITCODE."
  }

  Write-Host "Rocky setup completed."
} catch {
  Write-Error `$_.Exception.Message
  `$ExitCode = 1
} finally {
  Remove-Item -LiteralPath `$ExtractRoot -Recurse -Force -ErrorAction SilentlyContinue
  if (`$TranscriptStarted) {
    Stop-Transcript | Out-Null
  }
}

exit `$ExitCode
"@
  Set-Content -Path (Join-Path $BootstrapRoot "setup.ps1") -Value $SetupPs1 -Encoding ASCII
}

function Write-IExpressSed {
  param(
    [Parameter(Mandatory = $true)][string]$SedPath,
    [Parameter(Mandatory = $true)][string]$BootstrapRoot,
    [Parameter(Mandatory = $true)][string]$InstallerPath
  )

  $BootstrapRootWithSlash = [System.IO.Path]::GetFullPath($BootstrapRoot).TrimEnd("\", "/") + "\"
  $InstallerFullPath = [System.IO.Path]::GetFullPath($InstallerPath)
  $Content = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles

[Strings]
InstallPrompt=Rocky setup will install for the current Windows user.
DisplayLicense=
FinishMessage=Rocky setup finished.
TargetName=$InstallerFullPath
FriendlyName=Rocky $Tag
AppLaunched=setup.cmd
PostInstallCmd=<None>
FILE0=setup.cmd
FILE1=setup.ps1
FILE2=rocky-payload.zip

[SourceFiles]
SourceFiles0=$BootstrapRootWithSlash

[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
"@
  Set-Content -Path $SedPath -Value $Content -Encoding ASCII
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $Root "releases\$Tag"
}

$NpmPath = Resolve-Tool -Names @("npm.cmd", "npm") -DisplayName "npm"
$IExpressPath = Resolve-Tool -Names @("iexpress.exe", "iexpress") -DisplayName "IExpress"

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
$BootstrapRoot = Join-Path $WorkRoot "bootstrap"
$PayloadZipPath = Join-Path $BootstrapRoot "rocky-payload.zip"
$SourceFreePayloadZipPath = Join-Path $OutputDirectory "rocky-$Tag-windows-app.zip"
$InstallerPath = Join-Path $OutputDirectory "Rocky-Setup-$Tag.exe"
$SedPath = Join-Path $WorkRoot "rocky-setup.sed"

Assert-ChildPath -Parent (Join-Path $Root ".tmp") -Child $WorkRoot
Assert-ChildPath -Parent (Join-Path $Root "releases") -Child $OutputDirectory

Remove-Item -LiteralPath $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $PayloadRoot | Out-Null
New-Item -ItemType Directory -Force -Path $BootstrapRoot | Out-Null
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
and bundled backend npm dependencies. It intentionally excludes TypeScript
source, tests, local agent instructions, and development configuration.
"@
Set-Content -Path (Join-Path $PayloadRoot "WINDOWS_RELEASE.txt") -Value $ReleaseNotes -Encoding ASCII

Assert-SourceFreePayload -PayloadRoot $PayloadRoot

Remove-Item -LiteralPath $PayloadZipPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $SourceFreePayloadZipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $PayloadRoot "*") -DestinationPath $PayloadZipPath -Force
Copy-Item -LiteralPath $PayloadZipPath -Destination $SourceFreePayloadZipPath -Force

New-InstallerBootstrap -BootstrapRoot $BootstrapRoot -PayloadZipName "rocky-payload.zip"
Write-IExpressSed -SedPath $SedPath -BootstrapRoot $BootstrapRoot -InstallerPath $InstallerPath

Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $OutputDirectory -Filter "~$([System.IO.Path]::GetFileNameWithoutExtension($InstallerPath))*" -ErrorAction SilentlyContinue |
  Remove-Item -Force
Invoke-Checked -FilePath $IExpressPath -Arguments @("/N", "/Q", $SedPath) -WorkingDirectory $Root

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
  throw "IExpress completed without creating $InstallerPath."
}

Get-ChildItem -LiteralPath $OutputDirectory -Filter "~$([System.IO.Path]::GetFileNameWithoutExtension($InstallerPath))*" -ErrorAction SilentlyContinue |
  Remove-Item -Force

Write-Host "Created $InstallerPath"
Write-Host "Created $SourceFreePayloadZipPath"
