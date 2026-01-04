# Quick test script to see startup errors
# 快速测试脚本查看启动错误

$ErrorActionPreference = "Continue"

Write-Host "Testing service startup..." -ForegroundColor Yellow
Write-Host ""

# 设置环境变量
$env:PORT = "5013"
$env:HOST = "127.0.0.1"
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONIOENCODING = "utf-8"

# 切换到服务目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "Current directory: $(Get-Location)" -ForegroundColor Cyan
Write-Host "Python version: $(python --version 2>&1)" -ForegroundColor Cyan
Write-Host ""

# 尝试启动服务并捕获错误
Write-Host "Starting service (will timeout after 10 seconds)..." -ForegroundColor Yellow
Write-Host ""

try {
    $process = Start-Process -FilePath "python" -ArgumentList "semantic_repair_zh_service.py" -NoNewWindow -PassThru -RedirectStandardOutput "test_output.txt" -RedirectStandardError "test_error.txt"
    
    Write-Host "Process started with PID: $($process.Id)" -ForegroundColor Green
    Write-Host "Waiting 10 seconds for initial output..." -ForegroundColor Yellow
    
    Start-Sleep -Seconds 10
    
    # 检查进程是否还在运行
    if (-not $process.HasExited) {
        Write-Host "Process is still running" -ForegroundColor Green
    } else {
        Write-Host "Process exited with code: $($process.ExitCode)" -ForegroundColor Yellow
    }
    
    # 显示输出
    Write-Host ""
    Write-Host "=== Standard Output ===" -ForegroundColor Cyan
    if (Test-Path "test_output.txt") {
        Get-Content "test_output.txt" -Tail 50
    } else {
        Write-Host "No output file found" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "=== Standard Error ===" -ForegroundColor Cyan
    if (Test-Path "test_error.txt") {
        Get-Content "test_error.txt" -Tail 50
    } else {
        Write-Host "No error file found" -ForegroundColor Yellow
    }
    
    # 清理
    if (-not $process.HasExited) {
        Write-Host ""
        Write-Host "Stopping process..." -ForegroundColor Yellow
        $process.Kill()
        $process.WaitForExit(3000)
    }
    
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor Red
}
