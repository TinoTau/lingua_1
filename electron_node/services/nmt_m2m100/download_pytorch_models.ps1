# 下载 M2M100 PyTorch 模型到本地 models 目录
# 此脚本会下载 facebook/m2m100_418M 模型并转换为本地目录结构

$ErrorActionPreference = "Stop"

$ServiceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ModelsDir = Join-Path $ServiceDir "models"

Write-Host "=== 下载 M2M100 PyTorch 模型 ===" -ForegroundColor Cyan
Write-Host "服务目录: $ServiceDir" -ForegroundColor Gray
Write-Host "模型目录: $ModelsDir" -ForegroundColor Gray

# 确保模型目录存在
if (-not (Test-Path $ModelsDir)) {
    New-Item -ItemType Directory -Path $ModelsDir -Force | Out-Null
    Write-Host "创建模型目录: $ModelsDir" -ForegroundColor Green
}

# 检查 Python 环境
$VenvPath = Join-Path $ServiceDir "venv"
$PythonExe = Join-Path $VenvPath "Scripts\python.exe"

if (-not (Test-Path $PythonExe)) {
    Write-Host "[错误] 未找到 Python 虚拟环境: $PythonExe" -ForegroundColor Red
    Write-Host "请先创建虚拟环境并安装依赖" -ForegroundColor Yellow
    exit 1
}

Write-Host "`n使用 Python: $PythonExe" -ForegroundColor Gray

# 使用独立的 Python 脚本
$ScriptPath = Join-Path $ServiceDir "download_models.py"

Write-Host "`n开始下载模型（这可能需要几分钟）..." -ForegroundColor Yellow
Push-Location $ServiceDir
try {
    & $PythonExe $ScriptPath
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 下载脚本执行失败" -ForegroundColor Red
        exit 1
    }
} finally {
    Pop-Location
}

Write-Host "`n[完成] 模型下载完成！" -ForegroundColor Green

