# 启动 API Gateway 服务
# 用法: .\scripts\start_api_gateway.ps1

Write-Host "启动 API Gateway..." -ForegroundColor Green

$projectRoot = Split-Path -Parent $PSScriptRoot
$gatewayPath = Join-Path $projectRoot "api-gateway"

if (-not (Test-Path $gatewayPath)) {
    Write-Host "错误: API Gateway 目录不存在: $gatewayPath" -ForegroundColor Red
    exit 1
}

Set-Location $gatewayPath

Write-Host "`n正在启动 API Gateway..." -ForegroundColor Cyan
Write-Host "服务将在 http://localhost:8081 启动" -ForegroundColor Yellow
Write-Host "按 Ctrl+C 停止服务`n" -ForegroundColor Yellow

cargo run

