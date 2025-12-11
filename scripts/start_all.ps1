# 一键启动所有服务
Write-Host "启动 Lingua 分布式语音翻译系统..." -ForegroundColor Green

# 启动模型库服务（后台）
Write-Host "启动模型库服务..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_model_hub.ps1" -WindowStyle Minimized

# 等待模型库服务启动
Start-Sleep -Seconds 3

# 启动调度服务器（后台）
Write-Host "启动调度服务器..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-File", "$PSScriptRoot\start_scheduler.ps1" -WindowStyle Minimized

Write-Host "所有服务已启动" -ForegroundColor Green
Write-Host "调度服务器: http://localhost:8080" -ForegroundColor Cyan
Write-Host "模型库服务: http://localhost:5000" -ForegroundColor Cyan

