# Capture Startup Logs for Semantic Repair ZH Service
# 捕获中文语义修复服务的启动日志

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Semantic Repair ZH - Startup Log Capture" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 获取脚本所在目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceDir = $scriptDir
$logDir = Join-Path $serviceDir "logs"
$logFile = Join-Path $logDir "startup_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

# 创建日志目录
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Write-Host "[Log Capture] Created log directory: $logDir" -ForegroundColor Green
}

Write-Host "[Log Capture] Log file: $logFile" -ForegroundColor Yellow
Write-Host ""

# 设置环境变量
$env:PORT = 5013
$env:HOST = "127.0.0.1"
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONIOENCODING = "utf-8"

# 切换到服务目录
Set-Location $serviceDir

# 启动服务并捕获输出
Write-Host "[Log Capture] Starting service and capturing logs..." -ForegroundColor Yellow
Write-Host "[Log Capture] Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

try {
    # 启动 Python 服务，将输出重定向到日志文件和控制台
    $process = Start-Process -FilePath "python" -ArgumentList "semantic_repair_zh_service.py" -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $logFile
    
    Write-Host "[Log Capture] Service started with PID: $($process.Id)" -ForegroundColor Green
    Write-Host "[Log Capture] Logs are being written to: $logFile" -ForegroundColor Green
    Write-Host ""
    
    # 等待进程结束或用户中断
    $process.WaitForExit()
    
    Write-Host ""
    Write-Host "[Log Capture] Service exited with code: $($process.ExitCode)" -ForegroundColor $(if ($process.ExitCode -eq 0) { "Green" } else { "Red" })
} catch {
    Write-Host ""
    Write-Host "[Log Capture] Error: $_" -ForegroundColor Red
    exit 1
} finally {
    Write-Host ""
    Write-Host "[Log Capture] Log file saved: $logFile" -ForegroundColor Cyan
    if (Test-Path $logFile) {
        $logSize = (Get-Item $logFile).Length
        Write-Host "[Log Capture] Log file size: $([math]::Round($logSize / 1KB, 2)) KB" -ForegroundColor Cyan
    }
}
