[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RuntimeDir = Join-Path $Root ".runtime\windows"

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

  $Taskkill = Get-Command taskkill.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($Taskkill) {
    & $Taskkill.Source /PID $ProcessId /T /F | Out-Host
  } else {
    Stop-Process -Id $ProcessId -Force
  }

  Remove-Item -LiteralPath $PidPath -Force
  Write-Host "Stopped $Name."
}

Stop-FromPidFile -Name "rocky-web"
Stop-FromPidFile -Name "rocky-api"
