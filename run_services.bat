@echo off
title Launch Crowd Management Platform
echo ========================================================
echo   Launching Crowd Monitoring System Services
echo ========================================================
echo.

set ROOT_DIR=%~dp0

echo [1/3] Launching Python AI Service (Port 8001)...
start "Python AI Service [Port 8001]" cmd /k "cd /d "%ROOT_DIR%python-service" && "%ROOT_DIR%.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload"

echo [2/3] Launching Express Backend Service (Port 4000)...
start "Express Backend Service [Port 4000]" cmd /k "cd /d "%ROOT_DIR%backend" && npm run dev"

echo [3/3] Launching Next.js Frontend Service (Port 3000)...
start "Next.js Frontend Service [Port 3000]" cmd /k "cd /d "%ROOT_DIR%frontend" && npm run dev"

echo.
echo ========================================================
echo   All 3 services started in separate terminals!
echo   - Frontend: http://localhost:3000
echo   - Backend API: http://localhost:4000
echo   - Python Service: http://localhost:8001
echo ========================================================
echo.
pause
