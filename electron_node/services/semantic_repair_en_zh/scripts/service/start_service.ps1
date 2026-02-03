# 启动统一语义修复服务（优先使用本目录下 venv 的 Python，保证在虚拟环境中运行）

Write-Host "Starting Unified Semantic Repair Service..." -ForegroundColor Green

# 服务根目录 = 脚本所在目录的上两级（scripts/service -> 服务根）
$ServiceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ServiceDir

$pythonExe = "python"
if (Test-Path "venv\Scripts\python.exe") {
    $pythonExe = "venv\Scripts\python.exe"
    Write-Host "Using venv Python: $pythonExe" -ForegroundColor Yellow
} else {
    Write-Host "Warning: venv not found, using system Python." -ForegroundColor Yellow
}

Write-Host "Starting service on port 5015..." -ForegroundColor Green
& $pythonExe service.py
