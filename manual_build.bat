@echo off
cd /d "%~dp0"

echo [1/3] Installing frontend dependencies...
cd frontend
call npm.cmd ci
if %errorlevel% neq 0 exit /b %errorlevel%

echo [2/3] Building frontend...
call npm.cmd run build
if %errorlevel% neq 0 exit /b %errorlevel%

cd ..

echo [3/3] Building desktop package...
cargo tauri build
if %errorlevel% neq 0 exit /b %errorlevel%

echo.
echo Copying setup exe to batch file directory...
for /r "target\release\bundle\nsis" %%f in (*_x64-setup.exe) do (
    copy "%%f" "%~dp0" >nul
    echo Copied: %%~nxf
)

echo.
echo Done! Setup exe is ready next to this batch file.
pause
