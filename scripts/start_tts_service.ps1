# 启动 Piper TTS 服务
Write-Host "启动 Piper TTS 服务..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$ttsServicePath = Join-Path $projectRoot "services\piper_tts"

# 检查虚拟环境（可选，如果使用 piper Python API）
$venvPath = Join-Path $ttsServicePath "venv"
$useVenv = Test-Path "$venvPath\Scripts\Activate.ps1"

# 切换到服务目录
Set-Location $ttsServicePath

# 如果存在虚拟环境，激活它
if ($useVenv) {
    Write-Host "激活虚拟环境..." -ForegroundColor Yellow
    & "$venvPath\Scripts\Activate.ps1"
}

# 获取模型目录（从环境变量或使用默认值）
$modelDir = $env:PIPER_MODEL_DIR
if (-not $modelDir) {
    $modelDir = "$env:USERPROFILE\piper_models"
    Write-Host "使用默认模型目录: $modelDir" -ForegroundColor Yellow
    Write-Host "提示: 可以通过设置环境变量 PIPER_MODEL_DIR 来指定模型目录" -ForegroundColor Gray
}

Write-Host "启动 TTS 服务 (端口 5005)..." -ForegroundColor Green
Write-Host "服务地址: http://127.0.0.1:5005" -ForegroundColor Cyan
Write-Host "健康检查: http://127.0.0.1:5005/health" -ForegroundColor Cyan
Write-Host "模型目录: $modelDir" -ForegroundColor Cyan
Write-Host ""

# 设置环境变量
$env:PIPER_MODEL_DIR = $modelDir

# 启动服务
python piper_http_server.py --host 127.0.0.1 --port 5005 --model-dir $modelDir

