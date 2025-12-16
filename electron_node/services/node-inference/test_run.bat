@echo off
cd /d "%~dp0"
echo Testing inference-service.exe startup...
echo.

set MODELS_DIR=%~dp0models
set INFERENCE_SERVICE_PORT=5009
set RUST_LOG=info

echo Working directory: %CD%
echo MODELS_DIR: %MODELS_DIR%
echo INFERENCE_SERVICE_PORT: %INFERENCE_SERVICE_PORT%
echo.

if not exist "target\release\inference-service.exe" (
    echo ERROR: Executable not found: target\release\inference-service.exe
    pause
    exit /b 1
)

echo Executable found.
echo.

if not exist "logs" mkdir logs

echo Starting inference-service.exe...
echo Press Ctrl+C to stop
echo.

target\release\inference-service.exe

echo.
echo Process exited with code: %ERRORLEVEL%
pause
