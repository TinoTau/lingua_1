# 重启调度服务器脚本

Write-Host "正在停止调度服务器..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -eq "scheduler" } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "等待进程结束..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

Write-Host "清理 Redis 数据..." -ForegroundColor Yellow
redis-cli -n 0 FLUSHDB

Write-Host "等待 Redis 清理完成..." -ForegroundColor Yellow
Start-Sleep -Seconds 1

Write-Host "启动调度服务器..." -ForegroundColor Green
Set-Location "d:\Programs\github\lingua_1\central_server\scheduler"
cargo run
