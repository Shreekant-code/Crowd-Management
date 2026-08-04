# PowerShell launcher script for Crowd Management System services
$rootDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Launching Crowd Monitoring System Services" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Launching Python AI Service (Port 8001)..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\python-service'; & '$rootDir\.venv\Scripts\python.exe' -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload" -WindowStyle Normal

Write-Host "[2/3] Launching Express Backend Service (Port 4000)..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\backend'; npm run dev" -WindowStyle Normal

Write-Host "[3/3] Launching Next.js Frontend Service (Port 3000)..." -ForegroundColor Yellow
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\frontend'; npm run dev" -WindowStyle Normal

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  All 3 services launched in separate terminals!" -ForegroundColor Green
Write-Host "  - Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "  - Backend API: http://localhost:4000" -ForegroundColor White
Write-Host "  - Python AI Service: http://localhost:8001" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Green
