# 模型迁移脚本
# 将模型从 node-inference/models/ 迁移到各自的服务目录

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "模型迁移脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 获取脚本目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$servicesDir = $scriptDir
$nodeInferenceDir = Join-Path $servicesDir "node-inference"
$modelsDir = Join-Path $nodeInferenceDir "models"

# 检查源目录是否存在
if (-not (Test-Path $modelsDir)) {
    Write-Host "错误: 模型目录不存在: $modelsDir" -ForegroundColor Red
    exit 1
}

Write-Host "源模型目录: $modelsDir" -ForegroundColor Gray
Write-Host ""

# 1. 迁移 TTS 模型到 piper_tts/models/
Write-Host "[1/3] 迁移 TTS 模型到 piper_tts/models/..." -ForegroundColor Yellow
$piperTtsDir = Join-Path $servicesDir "piper_tts"
$piperTtsModelsDir = Join-Path $piperTtsDir "models"
$sourceTtsDir = Join-Path $modelsDir "tts"

if (Test-Path $sourceTtsDir) {
    if (-not (Test-Path $piperTtsModelsDir)) {
        New-Item -ItemType Directory -Path $piperTtsModelsDir -Force | Out-Null
        Write-Host "  创建目录: $piperTtsModelsDir" -ForegroundColor Gray
    }
    
    # 迁移 vits_en 和 vits-zh-aishell3（Piper TTS 使用的模型）
    $piperModels = @("vits_en", "vits-zh-aishell3")
    foreach ($model in $piperModels) {
        $sourceModel = Join-Path $sourceTtsDir $model
        $targetModel = Join-Path $piperTtsModelsDir $model
        if (Test-Path $sourceModel) {
            if (Test-Path $targetModel) {
                Write-Host "  ⚠️  目标已存在，跳过: $model" -ForegroundColor Yellow
            } else {
                Write-Host "  迁移: $model -> $targetModel" -ForegroundColor Gray
                Copy-Item -Path $sourceModel -Destination $targetModel -Recurse -Force
                Write-Host "  ✓ 已迁移: $model" -ForegroundColor Green
            }
        }
    }
} else {
    Write-Host "  ⚠️  源 TTS 模型目录不存在: $sourceTtsDir" -ForegroundColor Yellow
}

Write-Host ""

# 2. 迁移 YourTTS 模型到 your_tts/models/
Write-Host "[2/3] 迁移 YourTTS 模型到 your_tts/models/..." -ForegroundColor Yellow
$yourTtsDir = Join-Path $servicesDir "your_tts"
$yourTtsModelsDir = Join-Path $yourTtsDir "models"
$sourceYourTts = Join-Path $sourceTtsDir "your_tts"

if (Test-Path $sourceYourTts) {
    if (-not (Test-Path $yourTtsModelsDir)) {
        New-Item -ItemType Directory -Path $yourTtsModelsDir -Force | Out-Null
        Write-Host "  创建目录: $yourTtsModelsDir" -ForegroundColor Gray
    }
    
    $targetYourTts = Join-Path $yourTtsModelsDir "your_tts"
    if (Test-Path $targetYourTts) {
        Write-Host "  ⚠️  目标已存在，跳过: your_tts" -ForegroundColor Yellow
    } else {
        Write-Host "  迁移: your_tts -> $targetYourTts" -ForegroundColor Gray
        Copy-Item -Path $sourceYourTts -Destination $targetYourTts -Recurse -Force
        Write-Host "  ✓ 已迁移: your_tts" -ForegroundColor Green
    }
} else {
    Write-Host "  ⚠️  源 YourTTS 模型目录不存在: $sourceYourTts" -ForegroundColor Yellow
}

Write-Host ""

# 3. 迁移 NMT 模型到 nmt_m2m100/models/
Write-Host "[3/3] 迁移 NMT 模型到 nmt_m2m100/models/..." -ForegroundColor Yellow
$nmtDir = Join-Path $servicesDir "nmt_m2m100"
$nmtModelsDir = Join-Path $nmtDir "models"
$sourceNmtDir = Join-Path $modelsDir "nmt"

if (Test-Path $sourceNmtDir) {
    if (-not (Test-Path $nmtModelsDir)) {
        New-Item -ItemType Directory -Path $nmtModelsDir -Force | Out-Null
        Write-Host "  创建目录: $nmtModelsDir" -ForegroundColor Gray
    }
    
    # 迁移所有 NMT 模型
    $nmtModels = Get-ChildItem -Path $sourceNmtDir -Directory
    foreach ($model in $nmtModels) {
        $targetModel = Join-Path $nmtModelsDir $model.Name
        if (Test-Path $targetModel) {
            Write-Host "  ⚠️  目标已存在，跳过: $($model.Name)" -ForegroundColor Yellow
        } else {
            Write-Host "  迁移: $($model.Name) -> $targetModel" -ForegroundColor Gray
            Copy-Item -Path $model.FullName -Destination $targetModel -Recurse -Force
            Write-Host "  ✓ 已迁移: $($model.Name)" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  ⚠️  源 NMT 模型目录不存在: $sourceNmtDir" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✓ 模型迁移完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "注意: 迁移完成后，请更新配置文件以使用新的模型路径" -ForegroundColor Yellow
Write-Host ""

