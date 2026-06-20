[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $Root ".runtime\windows"

function Stop-ProcessTree {
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $Taskkill = Get-Command taskkill.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($Taskkill) {
    & $Taskkill.Source /PID $ProcessId /T /F | Out-Host
  } else {
    Stop-Process -Id $ProcessId -Force
  }

  Write-Host "Stopped $Name."
}

function Stop-ElectronApp {
  $ElectronExePath = Join-Path $Root "electron\Rocky.exe"
  if (-not (Test-Path -LiteralPath $ElectronExePath -PathType Leaf)) {
    return
  }

  $ElectronExeFullPath = (Resolve-Path $ElectronExePath).Path
  $Processes = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and [string]::Equals($_.Path, $ElectronExeFullPath, [System.StringComparison]::OrdinalIgnoreCase) }

  foreach ($Process in $Processes) {
    Stop-ProcessTree -ProcessId $Process.Id -Name "Rocky desktop"
  }
}

function Stop-FromPidFile {
  param([Parameter(Mandatory = $true)][string]$Name)

  $PidPath = Join-Path $RuntimeDir "$Name.pid"
  if (-not (Test-Path $PidPath)) {
    Write-Host "$Name is not running."
    return
  }

  $ProcessIdText = (Get-Content $PidPath -TotalCount 1).Trim()
  $ProcessId = 0
  if (-not [int]::TryParse($ProcessIdText, [ref]$ProcessId)) {
    Remove-Item -LiteralPath $PidPath -Force
    Write-Host "$Name had an invalid PID file."
    return
  }

  $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $Process) {
    Remove-Item -LiteralPath $PidPath -Force
    Write-Host "$Name was not running."
    return
  }

  Stop-ProcessTree -ProcessId $ProcessId -Name $Name
  Remove-Item -LiteralPath $PidPath -Force
}

Stop-ElectronApp
Stop-FromPidFile -Name "rocky-web"
Stop-FromPidFile -Name "rocky-api"
