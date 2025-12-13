# 启动 M2M100 NMT 服务
Write-Host "启动 M2M100 NMT 服务..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nmtServicePath = Join-Path $projectRoot "services\nmt_m2m100"

# 检查虚拟环境
$venvPath = Join-Path $nmtServicePath "venv"
if (-not (Test-Path "$venvPath\Scripts\Activate.ps1")) {
    Write-Host "错误: 找不到虚拟环境: $venvPath" -ForegroundColor Red
    Write-Host "请先创建虚拟环境:" -ForegroundColor Yellow
    Write-Host "  cd $nmtServicePath" -ForegroundColor Yellow
    Write-Host "  python -m venv venv" -ForegroundColor Yellow
    Write-Host "  .\venv\Scripts\Activate.ps1" -ForegroundColor Yellow
    Write-Host "  pip install -r requirements.txt" -ForegroundColor Yellow
    exit 1
}

# 切换到服务目录
Set-Location $nmtServicePath

# 激活虚拟环境并启动服务
Write-Host "激活虚拟环境..." -ForegroundColor Yellow
& "$venvPath\Scripts\Activate.ps1"

Write-Host "启动 NMT 服务 (端口 5008)..." -ForegroundColor Green
Write-Host "服务地址: http://127.0.0.1:5008" -ForegroundColor Cyan
Write-Host "健康检查: http://127.0.0.1:5008/health" -ForegroundColor Cyan
Write-Host ""

# 启动服务
uvicorn nmt_service:app --host 127.0.0.1 --port 5008

