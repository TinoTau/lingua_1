# 为新服务创建虚拟环境的脚本

Write-Host "正在为新服务创建虚拟环境..." -ForegroundColor Green

# Faster Whisper VAD 服务
Write-Host "`n[1/2] 设置 Faster Whisper VAD 服务虚拟环境..." -ForegroundColor Yellow
$fasterWhisperPath = Join-Path $PSScriptRoot "faster_whisper_vad"
if (Test-Path (Join-Path $fasterWhisperPath "venv")) {
    Write-Host "  ✓ 虚拟环境已存在，跳过" -ForegroundColor Gray
} else {
    Write-Host "  创建虚拟环境..." -ForegroundColor Cyan
    Push-Location $fasterWhisperPath
    python -m venv venv
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ 虚拟环境创建成功" -ForegroundColor Green
        Write-Host "  安装依赖..." -ForegroundColor Cyan
        & ".\venv\Scripts\python.exe" -m pip install --upgrade pip
        & ".\venv\Scripts\pip.exe" install -r requirements.txt
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ 依赖安装成功" -ForegroundColor Green
        } else {
            Write-Host "  ✗ 依赖安装失败" -ForegroundColor Red
        }
    } else {
        Write-Host "  ✗ 虚拟环境创建失败" -ForegroundColor Red
    }
    Pop-Location
}

# Speaker Embedding 服务
Write-Host "`n[2/2] 设置 Speaker Embedding 服务虚拟环境..." -ForegroundColor Yellow
$speakerEmbeddingPath = Join-Path $PSScriptRoot "speaker_embedding"
if (Test-Path (Join-Path $speakerEmbeddingPath "venv")) {
    Write-Host "  ✓ 虚拟环境已存在，跳过" -ForegroundColor Gray
} else {
    Write-Host "  创建虚拟环境..." -ForegroundColor Cyan
    Push-Location $speakerEmbeddingPath
    python -m venv venv
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ 虚拟环境创建成功" -ForegroundColor Green
        Write-Host "  安装依赖..." -ForegroundColor Cyan
        & ".\venv\Scripts\python.exe" -m pip install --upgrade pip
        & ".\venv\Scripts\pip.exe" install -r requirements.txt
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ 依赖安装成功" -ForegroundColor Green
        } else {
            Write-Host "  ✗ 依赖安装失败" -ForegroundColor Red
        }
    } else {
        Write-Host "  ✗ 虚拟环境创建失败" -ForegroundColor Red
    }
    Pop-Location
}

Write-Host "`n完成！" -ForegroundColor Green
Write-Host "现在可以重新启动节点客户端，新服务应该能够正常启动。" -ForegroundColor Cyan

