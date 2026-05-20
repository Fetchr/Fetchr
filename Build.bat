@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Fetchr fast Tauri build
echo [Fetchr] Fast Tauri build without installer
echo.

set "FETCHR_UI_REDESIGN=true"
set "VITE_FETCHR_UI_REDESIGN=true"
set "FETCHR_TG_BETA_BOT=fetchr_beta_bot"
set "FETCHR_VPS_API_URL=https://fetchr.ru/api"
set "TAURI_DEV_HOST=127.0.0.1"

set "PKG=npm"
where pnpm.cmd >nul 2>nul
if not errorlevel 1 set "PKG=pnpm"

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH. Install Node.js 18+.
    goto :error
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo [ERROR] cargo not found in PATH. Install Rust.
    goto :error
)

echo Package manager: %PKG%
echo.

if not exist "node_modules\" (
    echo [1/4] Installing frontend dependencies...
    if "%PKG%"=="pnpm" (
        call pnpm install --frozen-lockfile || goto :error
    ) else (
        call npm install || goto :error
    )
) else (
    echo [1/4] Frontend dependencies found.
)

echo [2/3] Cleaning stale frontend and installer artifacts...
if exist "dist\" rmdir /s /q "dist" || goto :error
if exist "src-tauri\target\release\bundle\" rmdir /s /q "src-tauri\target\release\bundle" || goto :error

echo [3/3] Building production Tauri EXE without installer...
if "%PKG%"=="pnpm" (
    call pnpm tauri build --no-bundle --ci || goto :error
) else (
    call npx tauri build --no-bundle --ci || goto :error
)

set "EXE_PATH="
if exist "src-tauri\target\release\fetchr.exe" set "EXE_PATH=src-tauri\target\release\fetchr.exe"

if "%EXE_PATH%"=="" (
    echo [ERROR] Release EXE was not created.
    goto :error
)

echo.
echo [OK] Build finished.
echo EXE: %EXE_PATH%
echo Installer was skipped.
echo This EXE is a production Tauri build and does not need 127.0.0.1 dev server.
echo Redesign flag used: FETCHR_UI_REDESIGN=true
echo.
goto :done

:error
echo.
echo [FAILED] Build failed. Scroll up for the first error.
echo If Fetchr is running, close it and run Build.bat again.
echo.
if /i not "%CI%"=="true" pause
exit /b 1

:done
if /i not "%CI%"=="true" pause
exit /b 0
