# 启动节点推理服务
Write-Host "启动节点推理服务..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nodeInferencePath = Join-Path $projectRoot "node-inference"

# 切换到服务目录
Set-Location $nodeInferencePath

# 设置环境变量
$env:MODELS_DIR = if ($env:MODELS_DIR) { $env:MODELS_DIR } else { Join-Path $projectRoot "node-inference\models" }
$env:INFERENCE_SERVICE_PORT = if ($env:INFERENCE_SERVICE_PORT) { $env:INFERENCE_SERVICE_PORT } else { "9000" }
$env:NMT_SERVICE_URL = if ($env:NMT_SERVICE_URL) { $env:NMT_SERVICE_URL } else { "http://127.0.0.1:5008" }
$env:TTS_SERVICE_URL = if ($env:TTS_SERVICE_URL) { $env:TTS_SERVICE_URL } else { "http://127.0.0.1:5005" }

Write-Host "环境变量配置:" -ForegroundColor Yellow
Write-Host "  MODELS_DIR: $env:MODELS_DIR" -ForegroundColor Gray
Write-Host "  INFERENCE_SERVICE_PORT: $env:INFERENCE_SERVICE_PORT" -ForegroundColor Gray
Write-Host "  NMT_SERVICE_URL: $env:NMT_SERVICE_URL" -ForegroundColor Gray
Write-Host "  TTS_SERVICE_URL: $env:TTS_SERVICE_URL" -ForegroundColor Gray
Write-Host ""

# 检查模型目录
if (-not (Test-Path $env:MODELS_DIR)) {
    Write-Host "警告: 模型目录不存在: $env:MODELS_DIR" -ForegroundColor Yellow
    Write-Host "提示: 请确保模型文件已正确放置" -ForegroundColor Gray
}

Write-Host "启动节点推理服务 (端口 $env:INFERENCE_SERVICE_PORT)..." -ForegroundColor Green
Write-Host "服务地址: http://127.0.0.1:$env:INFERENCE_SERVICE_PORT" -ForegroundColor Cyan
Write-Host "健康检查: http://127.0.0.1:$env:INFERENCE_SERVICE_PORT/health" -ForegroundColor Cyan
Write-Host ""

# 启动服务
cargo run --release --bin inference-service

