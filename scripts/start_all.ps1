# 一键启动所有服务
Write-Host "启动 Lingua 分布式语音翻译系统..." -ForegroundColor Green
Write-Host ""

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# 启动模型库服务（后台）
Write-Host "启动模型库服务..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_model_hub.ps1" -WindowStyle Minimized

# 等待模型库服务启动
Start-Sleep -Seconds 3

# 启动 M2M100 NMT 服务（后台）
Write-Host "启动 M2M100 NMT 服务..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_nmt_service.ps1" -WindowStyle Minimized

# 等待 NMT 服务启动
Start-Sleep -Seconds 5

# 启动 Piper TTS 服务（后台）
Write-Host "启动 Piper TTS 服务..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_tts_service.ps1" -WindowStyle Minimized

# 等待 TTS 服务启动
Start-Sleep -Seconds 3

# 启动节点推理服务（后台）
Write-Host "启动节点推理服务..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_node_inference.ps1" -WindowStyle Minimized

# 等待节点推理服务启动
Start-Sleep -Seconds 5

# 启动调度服务器（后台）
Write-Host "启动调度服务器..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_scheduler.ps1" -WindowStyle Minimized

# 等待调度服务器启动
Start-Sleep -Seconds 3

# 启动 API Gateway（后台，可选）
Write-Host "启动 API Gateway..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_api_gateway.ps1" -WindowStyle Minimized

Write-Host ""
Write-Host "所有服务已启动" -ForegroundColor Green
Write-Host ""
Write-Host "服务地址:" -ForegroundColor Cyan
Write-Host "  模型库服务: http://localhost:5000" -ForegroundColor White
Write-Host "  M2M100 NMT 服务: http://127.0.0.1:5008" -ForegroundColor White
Write-Host "  Piper TTS 服务: http://127.0.0.1:5005" -ForegroundColor White
Write-Host "  节点推理服务: http://127.0.0.1:9000" -ForegroundColor White
Write-Host "  调度服务器: http://localhost:8080" -ForegroundColor White
Write-Host "  API Gateway: http://localhost:8081" -ForegroundColor White
Write-Host ""
Write-Host "提示: 所有服务都在后台运行，关闭对应的 PowerShell 窗口即可停止服务" -ForegroundColor Gray
Write-Host ""
Write-Host "下一步: 启动 Electron Node 客户端以注册节点到调度服务器" -ForegroundColor Yellow

