@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Keep the old fast-build entrypoint, but use the fixed production Tauri build.
call "%~dp0Build.bat"
exit /b %ERRORLEVEL%
