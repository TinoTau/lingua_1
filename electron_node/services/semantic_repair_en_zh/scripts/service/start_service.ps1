# 启动统一语义修复服务

Write-Host "Starting Unified Semantic Repair Service..." -ForegroundColor Green

# 切换到服务目录
$ServiceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ServiceDir

# 检查虚拟环境
if (Test-Path "venv\Scripts\Activate.ps1") {
    Write-Host "Activating virtual environment..." -ForegroundColor Yellow
    & "venv\Scripts\Activate.ps1"
} else {
    Write-Host "Warning: Virtual environment not found. Using global Python." -ForegroundColor Yellow
}

# 启动服务
Write-Host "Starting service on port 5015..." -ForegroundColor Green
python service.py
