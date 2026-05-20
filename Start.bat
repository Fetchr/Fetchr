@echo off
setlocal
cd /d "%~dp0"
title Stream Cutter (dev)
echo [Stream Cutter] Launching dev build...
echo.
set TAURI_DEV_HOST=127.0.0.1
where npm >nul 2>nul
if errorlevel 1 (
    echo npm not found in PATH. Install Node.js 18+.
    pause
    exit /b 1
)
npm run tauri:dev
if errorlevel 1 (
    echo.
    echo [!] Stream Cutter dev launch failed.
    echo     If you see "Port 1420 is already in use", close the old dev window
    echo     or stop the node.exe process using that port, then run Start.bat again.
    echo.
    pause
    exit /b 1
)
endlocal
