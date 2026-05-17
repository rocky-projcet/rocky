[CmdletBinding()]
param(
  [int]$ApiPort = 3000,
  [int]$WebPort = 4173,
  [string]$StateRoot,
  [switch]$NoBrowser,
  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $Root ".runtime\windows"
$ManagedEnvironmentPath = Join-Path $Root ".rocky-env.ps1"
if (Test-Path -LiteralPath $ManagedEnvironmentPath) {
  . $ManagedEnvironmentPath
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

  throw "$DisplayName is required. Run scripts\install-windows.ps1 first."
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

function Get-LiveProcessFromPidFile {
  param([Parameter(Mandatory = $true)][string]$PidPath)

  if (-not (Test-Path $PidPath)) {
    return $null
  }

  $ProcessIdText = (Get-Content $PidPath -TotalCount 1).Trim()
  $ParsedProcessId = 0
  if (-not [int]::TryParse($ProcessIdText, [ref]$ParsedProcessId)) {
    return $null
  }

  return Get-Process -Id $ParsedProcessId -ErrorAction SilentlyContinue
}

function Start-LoggedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory
  )

  $PidPath = Join-Path $RuntimeDir "$Name.pid"
  $Existing = Get-LiveProcessFromPidFile -PidPath $PidPath
  if ($Existing) {
    Write-Host "$Name is already running with PID $($Existing.Id)."
    return
  }

  $OutPath = Join-Path $RuntimeDir "$Name.out.log"
  $ErrPath = Join-Path $RuntimeDir "$Name.err.log"
  $ArgumentLine = ($Arguments | ForEach-Object { ConvertTo-CommandLineArgument $_ }) -join " "

  $Process = Start-Process `
    -FilePath $FilePath `
    -ArgumentList $ArgumentLine `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $OutPath `
    -RedirectStandardError $ErrPath `
    -WindowStyle Hidden `
    -PassThru

  Set-Content -Path $PidPath -Value $Process.Id -Encoding ASCII
  Write-Host "Started $Name with PID $($Process.Id). Logs: $OutPath, $ErrPath"
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

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$StateRoot = Resolve-StateRootPath -RequestedStateRoot $StateRoot

$NodePath = Resolve-Tool -Names @("node.exe", "node") -DisplayName "Node.js"
$NpmPath = Resolve-Tool -Names @("npm.cmd", "npm") -DisplayName "npm"

$CliPath = Join-Path $Root "dist\src\cli.js"
$WebIndexPath = Join-Path $Root "web\dist\index.html"

if ($Rebuild -or -not (Test-Path $CliPath)) {
  Invoke-Checked -FilePath $NpmPath -Arguments @("run", "build", "--silent") -WorkingDirectory $Root
}

if ($Rebuild -or -not (Test-Path $WebIndexPath)) {
  Invoke-Checked -FilePath $NpmPath -Arguments @("--prefix", "web", "run", "build", "--silent") -WorkingDirectory $Root
}

Start-LoggedProcess `
  -Name "rocky-api" `
  -FilePath $NodePath `
  -Arguments @(
    $CliPath,
    "serve",
    "--host",
    "127.0.0.1",
    "--port",
    [string]$ApiPort,
    "--state-root",
    $StateRoot
  ) `
  -WorkingDirectory $Root

$PreviousProxyTarget = $env:AGENT_ENGINE_PROXY_TARGET
$env:AGENT_ENGINE_PROXY_TARGET = "http://127.0.0.1:$ApiPort"
try {
  Start-LoggedProcess `
    -Name "rocky-web" `
    -FilePath $NpmPath `
    -Arguments @(
      "--prefix",
      "web",
      "run",
      "preview",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      [string]$WebPort
    ) `
    -WorkingDirectory $Root
} finally {
  if ($null -eq $PreviousProxyTarget) {
    Remove-Item Env:\AGENT_ENGINE_PROXY_TARGET -ErrorAction SilentlyContinue
  } else {
    $env:AGENT_ENGINE_PROXY_TARGET = $PreviousProxyTarget
  }
}

$Url = "http://127.0.0.1:$WebPort"
Write-Host "Rocky API: http://127.0.0.1:$ApiPort"
Write-Host "Rocky WEB: $Url"

if (-not $NoBrowser) {
  Start-Process $Url
}
