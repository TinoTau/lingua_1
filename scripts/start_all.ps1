# Start All Services
Write-Host "Starting Lingua Distributed Speech Translation System..." -ForegroundColor Green
Write-Host ""

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Start Model Hub service (background)
Write-Host "Starting Model Hub service..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_model_hub.ps1" -WindowStyle Minimized

# Wait for Model Hub service to start
Start-Sleep -Seconds 3

# Start M2M100 NMT service (background)
Write-Host "Starting M2M100 NMT service..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_nmt_service.ps1" -WindowStyle Minimized

# Wait for NMT service to start
Start-Sleep -Seconds 5

# Start Piper TTS service (background)
Write-Host "Starting Piper TTS service..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_tts_service.ps1" -WindowStyle Minimized

# Wait for TTS service to start
Start-Sleep -Seconds 3

# Start Node Inference service (background)
Write-Host "Starting Node Inference service..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_node_inference.ps1" -WindowStyle Minimized

# Wait for Node Inference service to start
Start-Sleep -Seconds 5

# Start Scheduler server (background)
Write-Host "Starting Scheduler server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_scheduler.ps1" -WindowStyle Minimized

# Wait for Scheduler server to start
Start-Sleep -Seconds 3

# Start API Gateway (background, optional)
Write-Host "Starting API Gateway..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_api_gateway.ps1" -WindowStyle Minimized

Write-Host ""
Write-Host "All services started" -ForegroundColor Green
Write-Host ""
Write-Host "Service URLs:" -ForegroundColor Cyan
Write-Host "  Model Hub: http://localhost:5000" -ForegroundColor White
Write-Host "  M2M100 NMT Service: http://127.0.0.1:5008" -ForegroundColor White
Write-Host "  Piper TTS Service: http://127.0.0.1:5006" -ForegroundColor White
Write-Host "  Node Inference Service: http://127.0.0.1:5009" -ForegroundColor White
Write-Host "  Scheduler Server: http://localhost:5010" -ForegroundColor White
Write-Host "  API Gateway: http://localhost:8081" -ForegroundColor White
Write-Host ""
Write-Host "Tip: All services are running in background, close the corresponding PowerShell windows to stop services" -ForegroundColor Gray
Write-Host ""
Write-Host "Next: Start Electron Node client to register nodes to the scheduler server" -ForegroundColor Yellow

