# Quick test - just start and show first errors
# 快速测试 - 启动并显示前几个错误

$ErrorActionPreference = "Continue"

Write-Host "Quick startup test..." -ForegroundColor Yellow
Write-Host ""

$env:PORT = "5013"
$env:HOST = "127.0.0.1"
$env:PYTHONUNBUFFERED = "1"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# 直接运行并捕获前几行输出
Write-Host "Starting service (showing first 30 lines of output)..." -ForegroundColor Cyan
Write-Host ""

$job = Start-Job -ScriptBlock {
    Set-Location $using:scriptDir
    $env:PORT = "5013"
    $env:HOST = "127.0.0.1"
    $env:PYTHONUNBUFFERED = "1"
    python semantic_repair_zh_service.py 2>&1
}

Start-Sleep -Seconds 5

$output = Receive-Job -Job $job
$output | Select-Object -First 30 | ForEach-Object { Write-Host $_ }

Stop-Job -Job $job
Remove-Job -Job $job

Write-Host ""
Write-Host "Test completed. Check output above for errors." -ForegroundColor Yellow
