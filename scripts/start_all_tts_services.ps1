# Start All TTS Services (Piper TTS + YourTTS)
# This script starts both TTS services simultaneously:
# - Piper TTS on port 5006 (for Chinese/regular TTS)
# - YourTTS on port 5004 (for zero-shot voice cloning)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Starting All TTS Services" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Function to start a service in background
function Start-ServiceInBackground {
    param(
        [string]$ScriptPath,
        [string]$ServiceName,
        [string]$Port
    )
    
    Write-Host "Starting $ServiceName (port $Port)..." -ForegroundColor Yellow
    
    # Start the service in a new PowerShell window
    $process = Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "cd '$projectRoot'; .\scripts\$ScriptPath"
    ) -PassThru
    
    Write-Host "  $ServiceName started in new window (PID: $($process.Id))" -ForegroundColor Green
    Write-Host "  Service URL: http://127.0.0.1:$Port" -ForegroundColor Cyan
    Write-Host ""
    
    return $process
}

# Start Piper TTS service (port 5006)
$piperProcess = Start-ServiceInBackground -ScriptPath "start_tts_service.ps1" -ServiceName "Piper TTS" -Port "5006"

# Wait a bit before starting the next service
Start-Sleep -Seconds 3

# Start YourTTS service (port 5004)
$yourttsProcess = Start-ServiceInBackground -ScriptPath "start_yourtts_service.ps1" -ServiceName "YourTTS" -Port "5004"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  All TTS Services Started" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service Status:" -ForegroundColor Cyan
Write-Host "  - Piper TTS:  http://127.0.0.1:5006 (PID: $($piperProcess.Id))" -ForegroundColor White
Write-Host "  - YourTTS:    http://127.0.0.1:5004 (PID: $($yourttsProcess.Id))" -ForegroundColor White
Write-Host ""
Write-Host "Health Checks:" -ForegroundColor Cyan
Write-Host "  - Piper TTS:  http://127.0.0.1:5006/health" -ForegroundColor Gray
Write-Host "  - YourTTS:    http://127.0.0.1:5004/health" -ForegroundColor Gray
Write-Host ""
Write-Host "Note: Services are running in separate windows." -ForegroundColor Yellow
Write-Host "      Close those windows to stop the services." -ForegroundColor Yellow
Write-Host ""
