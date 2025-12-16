# Start API Gateway Service
# Usage: .\scripts\start_api_gateway.ps1

Write-Host "Starting API Gateway..." -ForegroundColor Green

$projectRoot = Split-Path -Parent $PSScriptRoot
$gatewayPath = Join-Path $projectRoot "api-gateway"

if (-not (Test-Path $gatewayPath)) {
    Write-Host "Error: API Gateway directory does not exist: $gatewayPath" -ForegroundColor Red
    exit 1
}

Set-Location $gatewayPath

Write-Host "`nStarting API Gateway..." -ForegroundColor Cyan
Write-Host "Service will start at http://localhost:8081" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the service`n" -ForegroundColor Yellow

cargo run

