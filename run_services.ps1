# PowerShell launcher script for Crowd Management System services
$rootDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Launching Crowd Monitoring System Services" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Launching MediaMTX WebRTC Stream Gateway (Port 8889)..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\gateway'; & '$rootDir\gateway\mediamtx.exe' '$rootDir\gateway\mediamtx.yml'" -WindowStyle Normal

Write-Host "[2/4] Launching Python AI Service (Port 8001)..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\python-service'; & '$rootDir\.venv\Scripts\python.exe' -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload" -WindowStyle Normal

Write-Host "[3/4] Launching Express Backend Service (Port 4000)..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\backend'; npm run dev" -WindowStyle Normal

Write-Host "[4/4] Launching Next.js Frontend Service (Port 3000)..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\frontend'; npm run dev" -WindowStyle Normal

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  All 4 services launched in separate terminals!" -ForegroundColor Green
Write-Host "  - Frontend UI: http://localhost:3000" -ForegroundColor White
Write-Host "  - Backend API: http://localhost:4000" -ForegroundColor White
Write-Host "  - Python AI Service: http://localhost:8001" -ForegroundColor White
Write-Host "  - MediaMTX WebRTC (WHEP): http://localhost:8889" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Green
