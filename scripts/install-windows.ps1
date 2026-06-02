[CmdletBinding()]
param(
  [switch]$SkipDependencyInstall,
  [switch]$SkipBuild,
  [switch]$NoStart,
  [int]$ApiPort = 3000,
  [int]$WebPort = 4173,
  [string]$StateRoot,
  [string]$InstallDir,
  [string]$NodeVersion = "22.20.0",
  [string]$CodexVersion = "latest",
  [switch]$SkipNodeInstall,
  [switch]$SkipCodexInstall,
  [switch]$InPlace,
  [switch]$IncludeBundledDependencies,
  [switch]$SkipWindowsShellRegistration
)

$ErrorActionPreference = "Stop"
$ReleaseTag = "v0.1.3"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$MarkerPath = Join-Path $Root ".rocky-install"
$ToolsRoot = Join-Path $Root ".tools"
$InstallLogRoot = Join-Path $Root ".rocky-update-logs"
$InstallLogPath = Join-Path $InstallLogRoot ("install-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-InstallLog {
  param([Parameter(Mandatory = $true)][string]$Message)

  try {
    New-Item -ItemType Directory -Force -Path $InstallLogRoot | Out-Null
    Add-Content -Path $InstallLogPath -Value ("[{0}] {1}" -f (Get-Date -Format "o"), $Message) -Encoding UTF8
  } catch {
    # Best-effort logging must not block installation or update recovery.
  }
}

function Write-InstallStatus {
  param([Parameter(Mandatory = $true)][string]$Message)

  Write-Host $Message
  Write-InstallLog -Message $Message
}

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

  throw "$DisplayName is required. Install $DisplayName and run this installer again."
}

function Find-Tool {
  param([Parameter(Mandatory = $true)][string[]]$Names)

  foreach ($Name in $Names) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Command) {
      return $Command.Source
    }
  }

  return $null
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

  Write-InstallStatus ">> $FilePath $($Arguments -join ' ')"
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

function Assert-NodeVersion {
  param([Parameter(Mandatory = $true)][string]$NodePath)

  $VersionText = (& $NodePath --version).Trim()
  $Major = [int]($VersionText.TrimStart("v").Split(".")[0])
  if ($Major -lt 22) {
    throw "Node.js 22 or newer is required. Found $VersionText."
  }
  Write-InstallStatus "Node.js $VersionText"
}

function Get-NodeMajorVersion {
  param([Parameter(Mandatory = $true)][string]$NodePath)

  $VersionText = (& $NodePath --version).Trim()
  return [int]($VersionText.TrimStart("v").Split(".")[0])
}

function Get-NodeWindowsArchitecture {
  $Architecture = $env:PROCESSOR_ARCHITECTURE
  if ($env:PROCESSOR_ARCHITEW6432) {
    $Architecture = $env:PROCESSOR_ARCHITEW6432
  }

  switch -Regex ($Architecture) {
    "ARM64" { return "arm64" }
    "AMD64" { return "x64" }
    default {
      throw "Unsupported Windows architecture for bundled Node.js: $Architecture"
    }
  }
}

function Invoke-DownloadFile {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
  Write-Host "Downloading $Uri"
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
}

function Install-PortableNode {
  param([Parameter(Mandatory = $true)][string]$Version)

  $Architecture = Get-NodeWindowsArchitecture
  $FileName = "node-v$Version-win-$Architecture.zip"
  $DownloadRoot = Join-Path $ToolsRoot "downloads"
  $ArchivePath = Join-Path $DownloadRoot $FileName
  $ShasumsPath = Join-Path $DownloadRoot "node-v$Version-SHASUMS256.txt"
  $InstallRoot = Join-Path $ToolsRoot "node\v$Version"
  $ExtractedRoot = Join-Path $InstallRoot "node-v$Version-win-$Architecture"
  $NodePath = Join-Path $ExtractedRoot "node.exe"
  $NpmPath = Join-Path $ExtractedRoot "npm.cmd"

  if ((Test-Path -LiteralPath $NodePath) -and (Test-Path -LiteralPath $NpmPath)) {
    Write-InstallStatus "Using bundled Node.js from $ExtractedRoot"
    return @{
      NodePath = $NodePath
      NpmPath = $NpmPath
      NodeHome = $ExtractedRoot
    }
  }

  $BaseUri = "https://nodejs.org/dist/v$Version"
  Invoke-DownloadFile -Uri "$BaseUri/$FileName" -OutFile $ArchivePath
  Invoke-DownloadFile -Uri "$BaseUri/SHASUMS256.txt" -OutFile $ShasumsPath

  $ExpectedLine = Get-Content -Path $ShasumsPath | Where-Object { $_ -match "\s+$([regex]::Escape($FileName))$" } | Select-Object -First 1
  if (-not $ExpectedLine) {
    throw "Could not find checksum for $FileName in SHASUMS256.txt."
  }

  $ExpectedHash = ($ExpectedLine -split "\s+")[0].ToUpperInvariant()
  $ActualHash = (Get-FileHash -Algorithm SHA256 -Path $ArchivePath).Hash.ToUpperInvariant()
  if ($ActualHash -ne $ExpectedHash) {
    throw "Checksum mismatch for $FileName. Expected $ExpectedHash, got $ActualHash."
  }

  Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $InstallRoot -Force

  if (-not ((Test-Path -LiteralPath $NodePath) -and (Test-Path -LiteralPath $NpmPath))) {
    throw "Portable Node.js install did not create expected executables under $ExtractedRoot."
  }

  Write-InstallStatus "Installed portable Node.js v$Version to $ExtractedRoot"
  return @{
    NodePath = $NodePath
    NpmPath = $NpmPath
    NodeHome = $ExtractedRoot
  }
}

function Resolve-NodeToolchain {
  $ExistingNode = Find-Tool -Names @("node.exe", "node")
  if ($ExistingNode) {
    try {
      $Major = Get-NodeMajorVersion -NodePath $ExistingNode
      if ($Major -ge 22) {
        $ExistingNpm = Resolve-Tool -Names @("npm.cmd", "npm") -DisplayName "npm"
        return @{
          NodePath = $ExistingNode
          NpmPath = $ExistingNpm
          NodeHome = Split-Path -Parent $ExistingNode
        }
      }
      Write-Warning "Found Node.js below v22 at $ExistingNode. Rocky will install a local Node.js runtime."
    } catch {
      Write-Warning "Could not inspect existing Node.js at $ExistingNode. Rocky will install a local Node.js runtime."
    }
  }

  if ($SkipNodeInstall) {
    throw "Node.js 22 or newer is required, and -SkipNodeInstall was set."
  }

  return Install-PortableNode -Version $NodeVersion
}

function Resolve-CodexCommandPath {
  param([Parameter(Mandatory = $true)][string]$Prefix)

  $Candidates = @(
    (Join-Path $Prefix "codex.cmd"),
    (Join-Path $Prefix "node_modules\.bin\codex.cmd")
  )

  foreach ($Candidate in $Candidates) {
    if (Test-Path -LiteralPath $Candidate) {
      return $Candidate
    }
  }

  return $null
}

function Install-CodexCli {
  param([Parameter(Mandatory = $true)][string]$NpmPath)

  $Prefix = Join-Path $ToolsRoot "npm-global"
  New-Item -ItemType Directory -Force -Path $Prefix | Out-Null

  if ($SkipCodexInstall) {
    $ExistingCodex = Resolve-CodexCommandPath -Prefix $Prefix
    if ($ExistingCodex) {
      return @{
        CodexPath = $ExistingCodex
        CodexPrefix = $Prefix
      }
    }

    return @{
      CodexPath = $null
      CodexPrefix = $Prefix
    }
  }

  $PackageSpec = if ($CodexVersion -eq "latest") {
    "@openai/codex@latest"
  } else {
    "@openai/codex@$CodexVersion"
  }

  Invoke-Checked -FilePath $NpmPath -Arguments @("install", "--global", "--prefix", $Prefix, $PackageSpec) -WorkingDirectory $Root
  $CodexPath = Resolve-CodexCommandPath -Prefix $Prefix
  if (-not $CodexPath) {
    throw "Codex CLI install completed but codex.cmd was not found under $Prefix."
  }

  $CodexVersionText = (& $CodexPath --version).Trim()
  Write-InstallStatus "Codex CLI $CodexVersionText"
  return @{
    CodexPath = $CodexPath
    CodexPrefix = $Prefix
  }
}

function Quote-PowerShellSingleString {
  param([Parameter(Mandatory = $true)][string]$Value)

  return "'" + ($Value -replace "'", "''") + "'"
}

function Write-ManagedEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$NodeHome,
    [Parameter(Mandatory = $true)][string]$CodexPrefix
  )

  $EnvPath = Join-Path $Root ".rocky-env.ps1"
  $PathParts = @($NodeHome, $CodexPrefix) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $PathPrefix = $PathParts -join ";"
  $Content = @"
`$env:ROCKY_NODE_HOME = $(Quote-PowerShellSingleString -Value $NodeHome)
`$env:ROCKY_CODEX_PREFIX = $(Quote-PowerShellSingleString -Value $CodexPrefix)
`$env:PATH = $(Quote-PowerShellSingleString -Value $PathPrefix) + ';' + `$env:PATH
"@
  Set-Content -Path $EnvPath -Value $Content -Encoding ASCII
}

function Resolve-StateRootPath {
  param([string]$RequestedStateRoot)

  if (-not [string]::IsNullOrWhiteSpace($RequestedStateRoot)) {
    New-Item -ItemType Directory -Force -Path $RequestedStateRoot | Out-Null
    return (Resolve-Path $RequestedStateRoot).Path
  }

  $Candidates = @()
  if ($env:LOCALAPPDATA) {
    $Candidates += (Join-Path $env:LOCALAPPDATA "Rocky\state")
  }
  $Candidates += (Join-Path $Root ".runtime\state")

  foreach ($Candidate in $Candidates) {
    try {
      New-Item -ItemType Directory -Force -Path $Candidate | Out-Null
      return (Resolve-Path $Candidate).Path
    } catch {
      Write-Warning "Cannot use state root $Candidate. Trying next location."
    }
  }

  throw "Could not create a Rocky state root."
}

function Resolve-InstallDirPath {
  param([string]$RequestedInstallDir)

  if (-not [string]::IsNullOrWhiteSpace($RequestedInstallDir)) {
    $Parent = Split-Path -Parent $RequestedInstallDir
    New-Item -ItemType Directory -Force -Path $Parent | Out-Null
    return [System.IO.Path]::GetFullPath($RequestedInstallDir)
  }

  $Candidates = @()
  if ($env:LOCALAPPDATA) {
    $Candidates += (Join-Path $env:LOCALAPPDATA "Programs\Rocky")
  }
  $Candidates += (Join-Path $Root ".runtime\installed-app")

  foreach ($Candidate in $Candidates) {
    try {
      $Parent = Split-Path -Parent $Candidate
      New-Item -ItemType Directory -Force -Path $Parent | Out-Null
      return [System.IO.Path]::GetFullPath($Candidate)
    } catch {
      Write-Warning "Cannot use install directory $Candidate. Trying next location."
    }
  }

  throw "Could not resolve a Rocky install directory."
}

function Test-SamePath {
  param(
    [Parameter(Mandatory = $true)][string]$Left,
    [Parameter(Mandatory = $true)][string]$Right
  )

  $LeftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd("\", "/")
  $RightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd("\", "/")
  return [string]::Equals($LeftFull, $RightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-BundledAppPayload {
  param([Parameter(Mandatory = $true)][string]$PayloadRoot)

  return (
    (Test-Path -LiteralPath (Join-Path $PayloadRoot "dist\src\cli.js") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $PayloadRoot "web\dist\index.html") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $PayloadRoot "node_modules") -PathType Container) -and
    (-not (Test-Path -LiteralPath (Join-Path $PayloadRoot "src"))) -and
    (-not (Test-Path -LiteralPath (Join-Path $PayloadRoot "web\package.json")))
  )
}

function Test-SkippedPayloadPath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  $Normalized = $RelativePath -replace "/", "\"
  $Parts = $Normalized.Split("\", [System.StringSplitOptions]::RemoveEmptyEntries)
  $SkippedDirectoryNames = @(
    ".git",
    ".runtime",
    ".tmp",
    ".codex",
    ".venv",
    "releases",
    ".tools"
  )

  foreach ($Part in $Parts) {
    if ($SkippedDirectoryNames -contains $Part) {
      return $true
    }

    if ($Part -eq "node_modules" -and -not $IncludeBundledDependencies) {
      return $true
    }
  }

  $Leaf = Split-Path -Leaf $Normalized
  return $Leaf -in @(".env", ".env.local")
}

function Copy-PayloadDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Base
  )

  New-Item -ItemType Directory -Force -Path $Target | Out-Null

  foreach ($Item in Get-ChildItem -LiteralPath $Source -Force) {
    $BaseFull = [System.IO.Path]::GetFullPath($Base).TrimEnd("\", "/")
    $ItemFull = [System.IO.Path]::GetFullPath($Item.FullName)
    $RelativePath = $ItemFull.Substring($BaseFull.Length).TrimStart("\", "/")
    if (Test-SkippedPayloadPath -RelativePath $RelativePath) {
      continue
    }

    $TargetPath = Join-Path $Target $Item.Name
    if ($Item.PSIsContainer) {
      Copy-PayloadDirectory -Source $Item.FullName -Target $TargetPath -Base $Base
    } else {
      Copy-Item -LiteralPath $Item.FullName -Destination $TargetPath -Force
    }
  }
}

function Get-UpdateBackupPath {
  param([Parameter(Mandatory = $true)][string]$TargetRoot)

  $Parent = Split-Path -Parent $TargetRoot
  $Leaf = Split-Path -Leaf $TargetRoot
  $Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  return Join-Path $Parent (".{0}-update-backup-{1}" -f $Leaf, $Timestamp)
}

function Restore-PreservedInstallPaths {
  param(
    [Parameter(Mandatory = $true)][string]$BackupRoot,
    [Parameter(Mandatory = $true)][string]$TargetRoot
  )

  $PreservedNames = @(".runtime", ".codex", ".tools", ".rocky-env.ps1", ".env", ".env.local")
  foreach ($Name in $PreservedNames) {
    $BackupPath = Join-Path $BackupRoot $Name
    if (-not (Test-Path -LiteralPath $BackupPath)) {
      continue
    }

    $TargetPath = Join-Path $TargetRoot $Name
    Remove-Item -LiteralPath $TargetPath -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $BackupPath -Destination $TargetPath -Force
    Write-InstallStatus "Preserved existing install data: $Name"
  }
}

function Install-PayloadToDirectory {
  param([Parameter(Mandatory = $true)][string]$TargetRoot)

  if (Test-SamePath -Left $Root -Right $TargetRoot) {
    return
  }

  $UpdateMode = $false
  $BackupRoot = $null

  if (Test-Path -LiteralPath $TargetRoot) {
    $TargetMarker = Join-Path $TargetRoot ".rocky-install"
    $ExistingItems = Get-ChildItem -LiteralPath $TargetRoot -Force -ErrorAction SilentlyContinue
    if ($ExistingItems -and -not (Test-Path -LiteralPath $TargetMarker)) {
      throw "Install directory is not empty and is not a Rocky install: $TargetRoot"
    }

    $UpdateMode = $true
    Write-InstallStatus "Existing Rocky install detected. Updating payload while preserving state and local settings."

    $ExistingStopScript = Join-Path $TargetRoot "scripts\stop-rocky-windows.ps1"
    if (Test-Path -LiteralPath $ExistingStopScript) {
      try {
        & $ExistingStopScript
      } catch {
        Write-Warning "Could not stop existing Rocky processes before update: $($_.Exception.Message)"
        Write-InstallLog -Message "Could not stop existing Rocky processes before update: $($_.Exception.Message)"
      }
    }

    $BackupRoot = Get-UpdateBackupPath -TargetRoot $TargetRoot
    Move-Item -LiteralPath $TargetRoot -Destination $BackupRoot
    Write-InstallStatus "Backed up previous Rocky install to $BackupRoot"
  }

  try {
    New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
    Copy-PayloadDirectory -Source $Root -Target $TargetRoot -Base $Root

    if ($UpdateMode) {
      Restore-PreservedInstallPaths -BackupRoot $BackupRoot -TargetRoot $TargetRoot
    }

    Set-Content -Path (Join-Path $TargetRoot ".rocky-install") -Value $ReleaseTag -Encoding ASCII

    if ($UpdateMode) {
      Remove-Item -LiteralPath $BackupRoot -Recurse -Force -ErrorAction SilentlyContinue
      Write-InstallStatus "Rocky payload update completed. Preserved state roots and local settings."
    }
  } catch {
    Write-InstallLog -Message "Install/update failed: $($_.Exception.Message)"
    if ($UpdateMode -and $BackupRoot -and (Test-Path -LiteralPath $BackupRoot)) {
      Remove-Item -LiteralPath $TargetRoot -Recurse -Force -ErrorAction SilentlyContinue
      Move-Item -LiteralPath $BackupRoot -Destination $TargetRoot
      Write-InstallLog -Message "Restored previous Rocky install from $BackupRoot after failed update."
    }
    throw
  }
}

function Invoke-NpmInstall {
  param([Parameter(Mandatory = $true)][string]$WorkingDirectory)

  $LockFile = Join-Path $WorkingDirectory "package-lock.json"
  if (Test-Path $LockFile) {
    Invoke-Checked -FilePath $NpmPath -Arguments @("ci") -WorkingDirectory $WorkingDirectory
    return
  }

  Invoke-Checked -FilePath $NpmPath -Arguments @("install") -WorkingDirectory $WorkingDirectory
}

function Write-CmdLauncher {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ScriptPath
  )

  $LauncherPath = Join-Path $Root $Name
  $Content = @"
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0$ScriptPath" %*
"@
  Set-Content -Path $LauncherPath -Value $Content -Encoding ASCII
}

function New-WindowsShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$ShortcutPath,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [string]$WorkingDirectory = $Root,
    [string]$IconLocation
  )

  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ShortcutPath) | Out-Null
    $Shell = New-Object -ComObject WScript.Shell
    $Shortcut = $Shell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $TargetPath
    $Shortcut.WorkingDirectory = $WorkingDirectory
    if (-not [string]::IsNullOrWhiteSpace($IconLocation) -and (Test-Path -LiteralPath $IconLocation)) {
      $Shortcut.IconLocation = "$IconLocation,0"
    }
    $Shortcut.Save()
  } catch {
    Write-Warning "Could not create shortcut '$ShortcutPath': $($_.Exception.Message)"
  }
}

function New-InstallShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [string]$WorkingDirectory = $Root,
    [string]$IconLocation
  )

  New-WindowsShortcut `
    -ShortcutPath (Join-Path $Root "$Name.lnk") `
    -TargetPath $TargetPath `
    -WorkingDirectory $WorkingDirectory `
    -IconLocation $IconLocation
}

function New-StartMenuShortcut {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [string]$WorkingDirectory = $Root,
    [string]$IconLocation
  )

  if (-not $env:APPDATA) {
    return
  }

  $StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Rocky"
  New-WindowsShortcut `
    -ShortcutPath (Join-Path $StartMenuDir "$Name.lnk") `
    -TargetPath $TargetPath `
    -WorkingDirectory $WorkingDirectory `
    -IconLocation $IconLocation
}

function Register-UninstallEntry {
  param([string]$DisplayIconPath)

  try {
    $RegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Rocky"
    New-Item -Path $RegistryPath -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name "DisplayName" -Value "Rocky" -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name "DisplayVersion" -Value $ReleaseTag -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name "InstallLocation" -Value $Root -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name "Publisher" -Value "Rocky" -PropertyType String -Force | Out-Null
    if (-not [string]::IsNullOrWhiteSpace($DisplayIconPath) -and (Test-Path -LiteralPath $DisplayIconPath)) {
      New-ItemProperty -Path $RegistryPath -Name "DisplayIcon" -Value "$DisplayIconPath,0" -PropertyType String -Force | Out-Null
    }
    New-ItemProperty -Path $RegistryPath -Name "UninstallString" -Value "`"$(Join-Path $Root "Uninstall-Rocky-Windows.cmd")`"" -PropertyType String -Force | Out-Null
  } catch {
    Write-Warning "Could not register Windows uninstall entry: $($_.Exception.Message)"
  }
}

function Remove-LegacyUninstallEntry {
  param([Parameter(Mandatory = $true)][string]$ExpectedInstallLocation)

  try {
    $RegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Rocky"
    $Entry = Get-ItemProperty -Path $RegistryPath -ErrorAction SilentlyContinue
    if (-not $Entry) {
      return
    }

    $InstallLocation = [string]$Entry.InstallLocation
    if ([string]::IsNullOrWhiteSpace($InstallLocation) -or (Test-SamePath -Left $InstallLocation -Right $ExpectedInstallLocation)) {
      Remove-Item -Path $RegistryPath -Recurse -Force -ErrorAction Stop
      Write-InstallStatus "Removed legacy Rocky script uninstall entry; Inno Setup owns uninstall metadata."
    }
  } catch {
    Write-Warning "Could not remove legacy Rocky uninstall entry: $($_.Exception.Message)"
  }
}

$UsesBundledAppPayload = Test-BundledAppPayload -PayloadRoot $Root
if ($UsesBundledAppPayload) {
  $IncludeBundledDependencies = $true
  $SkipDependencyInstall = $true
  $SkipBuild = $true
}

$ResolvedInstallDir = Resolve-InstallDirPath -RequestedInstallDir $InstallDir
if (-not $InPlace -and -not (Test-SamePath -Left $Root -Right $ResolvedInstallDir)) {
  $InstallMode = if (Test-Path -LiteralPath (Join-Path $ResolvedInstallDir ".rocky-install")) { "Updating" } else { "Installing" }
  Write-InstallStatus "$InstallMode Rocky $ReleaseTag to $ResolvedInstallDir"
  Install-PayloadToDirectory -TargetRoot $ResolvedInstallDir

  $InstalledScript = Join-Path $ResolvedInstallDir "scripts\install-windows.ps1"
  $InstallArgs = @{
    InPlace = $true
    SkipDependencyInstall = $SkipDependencyInstall
    SkipBuild = $SkipBuild
    NoStart = $NoStart
    ApiPort = $ApiPort
    WebPort = $WebPort
    InstallDir = $ResolvedInstallDir
    NodeVersion = $NodeVersion
    CodexVersion = $CodexVersion
    SkipNodeInstall = $SkipNodeInstall
    SkipCodexInstall = $SkipCodexInstall
    IncludeBundledDependencies = $IncludeBundledDependencies
    SkipWindowsShellRegistration = $SkipWindowsShellRegistration
  }
  if (-not [string]::IsNullOrWhiteSpace($StateRoot)) {
    $InstallArgs.StateRoot = $StateRoot
  }

  & $InstalledScript @InstallArgs
  return
}

Set-Content -Path $MarkerPath -Value $ReleaseTag -Encoding ASCII
$StateRoot = Resolve-StateRootPath -RequestedStateRoot $StateRoot

Set-Location $Root

$Toolchain = Resolve-NodeToolchain
$NodePath = $Toolchain.NodePath
$NpmPath = $Toolchain.NpmPath
$NodeHome = $Toolchain.NodeHome
$env:PATH = "$NodeHome;$env:PATH"
Assert-NodeVersion -NodePath $NodePath
$CodexInstall = Install-CodexCli -NpmPath $NpmPath
$CodexPrefix = $CodexInstall.CodexPrefix
$env:PATH = "$CodexPrefix;$env:PATH"
Write-ManagedEnvironment -NodeHome $NodeHome -CodexPrefix $CodexPrefix

Write-InstallStatus "Preparing Rocky $ReleaseTag in $Root"

if (-not $SkipDependencyInstall) {
  Invoke-NpmInstall -WorkingDirectory $Root
  Invoke-NpmInstall -WorkingDirectory (Join-Path $Root "web")
}

if (-not $SkipBuild) {
  Invoke-Checked -FilePath $NpmPath -Arguments @("run", "build", "--silent") -WorkingDirectory $Root
  Invoke-Checked -FilePath $NpmPath -Arguments @("--prefix", "web", "run", "build", "--silent") -WorkingDirectory $Root
}

Write-CmdLauncher -Name "Start-Rocky-Windows.cmd" -ScriptPath "scripts\start-rocky-windows.ps1"
Write-CmdLauncher -Name "Stop-Rocky-Windows.cmd" -ScriptPath "scripts\stop-rocky-windows.ps1"
Write-CmdLauncher -Name "Uninstall-Rocky-Windows.cmd" -ScriptPath "scripts\uninstall-windows.ps1"

$AppIconPath = Join-Path $Root "assets\windows\rocky.ico"
$UninstallIconPath = Join-Path $Root "assets\windows\rocky-uninstall.ico"

if (-not $SkipWindowsShellRegistration) {
  New-InstallShortcut -Name "Rocky" -TargetPath (Join-Path $Root "Start-Rocky-Windows.cmd") -IconLocation $AppIconPath
  New-InstallShortcut -Name "Uninstall Rocky" -TargetPath (Join-Path $Root "Uninstall-Rocky-Windows.cmd") -IconLocation $UninstallIconPath
  New-StartMenuShortcut -Name "Rocky" -TargetPath (Join-Path $Root "Start-Rocky-Windows.cmd") -IconLocation $AppIconPath
  New-StartMenuShortcut -Name "Stop Rocky" -TargetPath (Join-Path $Root "Stop-Rocky-Windows.cmd") -IconLocation $AppIconPath
  New-StartMenuShortcut -Name "Uninstall Rocky" -TargetPath (Join-Path $Root "Uninstall-Rocky-Windows.cmd") -IconLocation $UninstallIconPath
  Register-UninstallEntry -DisplayIconPath $AppIconPath
} else {
  Remove-LegacyUninstallEntry -ExpectedInstallLocation $Root
}

Write-InstallStatus "Rocky $ReleaseTag is installed or updated."
Write-InstallStatus "Install directory: $Root"
Write-InstallStatus "State root: $StateRoot"
Write-InstallStatus "Installer log: $InstallLogPath"

if (-not $NoStart) {
  & (Join-Path $Root "scripts\start-rocky-windows.ps1") `
    -ApiPort $ApiPort `
    -WebPort $WebPort `
    -StateRoot $StateRoot
}
