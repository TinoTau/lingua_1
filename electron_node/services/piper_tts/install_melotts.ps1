# 安装 MeloTTS 中文 TTS 模型

Write-Host "=== 安装 MeloTTS ===" -ForegroundColor Cyan

$venvPython = "venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "[错误] 虚拟环境不存在，请先创建虚拟环境" -ForegroundColor Red
    exit 1
}

Write-Host "`n1. 安装 MeloTTS 包..." -ForegroundColor Yellow
& $venvPython -m pip install melotts

Write-Host "`n2. 测试 MeloTTS 安装..." -ForegroundColor Yellow
$testScript = @"
try:
    from melotts import MeloTTS
    print('[OK] MeloTTS imported successfully')
    print('MeloTTS will download models automatically on first use')
except ImportError as e:
    print(f'[ERROR] Failed to import MeloTTS: {e}')
"@

$testScript | & $venvPython

Write-Host "`n=== 安装完成 ===" -ForegroundColor Green
Write-Host "`n注意: MeloTTS 模型会在首次使用时自动下载到 ~/.cache/melotts/" -ForegroundColor Yellow
Write-Host "如果需要手动指定模型路径，请设置环境变量 MELOTTS_MODEL_DIR" -ForegroundColor Yellow

