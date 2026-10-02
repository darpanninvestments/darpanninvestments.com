# Darpann CRM – start API (FastAPI :8000) + Web (Next.js :3000) from one PowerShell terminal.
#   pwsh ./start.ps1          development (hot reload)
#   pwsh ./start.ps1 -Prod    production build + start
param([switch]$Prod)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$isWin = $IsWindows -or ($env:OS -eq "Windows_NT")
$venvBin = if ($isWin) { Join-Path $root "backend/.venv/Scripts" } else { Join-Path $root "backend/.venv/bin" }
$python = Join-Path $venvBin ($(if ($isWin) { "python.exe" } else { "python" }))

# First run: create the venv, install deps, seed
if (-not (Test-Path $python)) {
  Write-Host "Setting up Python environment…" -ForegroundColor Cyan
  Push-Location (Join-Path $root "backend")
  & ($(if ($isWin) { "py" } else { "python3" })) -m venv .venv
  & $python -m pip install -q -r requirements.txt
  & $python seed.py
  Pop-Location
}
if (-not (Test-Path (Join-Path $root "frontend/node_modules"))) {
  Write-Host "Installing frontend packages…" -ForegroundColor Cyan
  Push-Location (Join-Path $root "frontend"); npm install; Pop-Location
}

# Free the ports if a previous run is still alive
foreach ($port in 8000, 3000) {
  if ($isWin) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  } else {
    $pids = (& lsof -ti "tcp:$port" 2>$null)
    if ($pids) { $pids | ForEach-Object { Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue } }
  }
}

$apiArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000")
if (-not $Prod) { $apiArgs += @("--reload", "--reload-dir", "app") }
$api = Start-Process -FilePath $python -ArgumentList $apiArgs -WorkingDirectory (Join-Path $root "backend") -PassThru -NoNewWindow
Write-Host "API  → http://127.0.0.1:8000/api/docs  (pid $($api.Id))" -ForegroundColor Green

try {
  Push-Location (Join-Path $root "frontend")
  Write-Host "Web  → http://localhost:3000" -ForegroundColor Green
  if ($Prod) { npm run build; npm run start } else { npm run dev }
}
finally {
  Pop-Location
  Write-Host "Stopping API…" -ForegroundColor Yellow
  Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
}
