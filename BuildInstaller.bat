@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Fetchr installer build
echo [Fetchr] NSIS installer build
echo.

set "FETCHR_UI_REDESIGN=true"
set "VITE_FETCHR_UI_REDESIGN=true"
set "FETCHR_TG_BETA_BOT=fetchr_beta_bot"
set "FETCHR_VPS_API_URL=https://fetchr.fun/api"
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

echo [0/5] Bumping Fetchr build version...
set "APP_VERSION=0.0.0"
for /f "usebackq delims=" %%V in (`node scripts/bump-build-version.mjs`) do set "APP_VERSION=%%V"
if "%APP_VERSION%"=="0.0.0" (
    echo [ERROR] Could not bump application version.
    goto :error
)
set "FETCHR_INSTALLER_NAME=Fetchr-Setup-v%APP_VERSION%.exe"
set "FETCHR_INSTALLER_DIR=dist\installer"
set "FETCHR_INSTALLER_PATH=%FETCHR_INSTALLER_DIR%\%FETCHR_INSTALLER_NAME%"

echo Package manager: %PKG%
echo Version: %APP_VERSION%
echo Output installer: %FETCHR_INSTALLER_PATH%
echo.

if not exist "node_modules\" (
    echo [1/5] Installing frontend dependencies...
    if "%PKG%"=="pnpm" (
        call pnpm install --frozen-lockfile || goto :error
    ) else (
        call npm install || goto :error
    )
) else (
    echo [1/5] Frontend dependencies found.
)

echo [2/5] Cleaning old Fetchr installer artifacts...
if exist "dist\" rmdir /s /q "dist" || goto :error
if exist "src-tauri\target\release\bundle\" rmdir /s /q "src-tauri\target\release\bundle" || goto :error

echo [3/5] Building Fetchr NSIS installer...
if "%PKG%"=="pnpm" (
    call pnpm tauri build --ci || goto :error
) else (
    call npx tauri build --ci || goto :error
)

echo [4/5] Preparing clean Fetchr installer file...
set "TAURI_INSTALLER_PATH="
for /f "delims=" %%F in ('dir /b /s "src-tauri\target\release\bundle\nsis\*.exe" 2^>nul') do set "TAURI_INSTALLER_PATH=%%F"

if "%TAURI_INSTALLER_PATH%"=="" (
    echo [ERROR] NSIS installer was not created.
    echo Expected folder: src-tauri\target\release\bundle\nsis
    goto :error
)

if not exist "%FETCHR_INSTALLER_DIR%\" mkdir "%FETCHR_INSTALLER_DIR%" || goto :error
copy /y "%TAURI_INSTALLER_PATH%" "%FETCHR_INSTALLER_PATH%" >nul || goto :error

echo [5/5] Publishing installer alias for the website...
copy /y "%FETCHR_INSTALLER_PATH%" "Fetchr-Setup-v%APP_VERSION%.exe" >nul || goto :error
copy /y "%FETCHR_INSTALLER_PATH%" "Fetchr-Setup-latest.exe" >nul || goto :error
for /f "usebackq delims=" %%H in (`node scripts/write-latest-update-manifest.mjs "%APP_VERSION%" "%FETCHR_INSTALLER_PATH%"`) do set "FETCHR_INSTALLER_SHA256=%%H"

echo.
echo [OK] Fetchr installer build finished.
echo Installer: %FETCHR_INSTALLER_PATH%
echo Latest alias: Fetchr-Setup-latest.exe
echo SHA256: %FETCHR_INSTALLER_SHA256%
echo Source: %TAURI_INSTALLER_PATH%
echo.
goto :done

:error
echo.
echo [FAILED] Fetchr installer build failed. Scroll up for the first error.
echo If Fetchr is running, close it and run BuildInstaller.bat again.
echo.
if /i not "%CI%"=="true" pause
exit /b 1

:done
if /i not "%CI%"=="true" pause
exit /b 0
