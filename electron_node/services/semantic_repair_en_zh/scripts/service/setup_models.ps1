# 模型安装脚本 - 使用硬链接（推荐）
# 节省磁盘空间且不需要管理员权限

$servicePath = Split-Path -Parent $PSScriptRoot
$targetService = $PSScriptRoot

Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "Setting up models for Unified Semantic Repair Service" -ForegroundColor Green
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

# 创建 models 目录
Write-Host "[1/4] Creating models directory..." -ForegroundColor Yellow
New-Item -Path "$targetService\models" -ItemType Directory -Force | Out-Null

# 中文模型
Write-Host "[2/4] Setting up Chinese model..." -ForegroundColor Yellow
$zhModelDir = "$targetService\models\qwen2.5-3b-instruct-zh-gguf"
New-Item -Path $zhModelDir -ItemType Directory -Force | Out-Null

$zhSource = Get-ChildItem -Path "$servicePath\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf\*.gguf" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($zhSource) {
    try {
        New-Item -ItemType HardLink `
                 -Path "$zhModelDir\$($zhSource.Name)" `
                 -Target $zhSource.FullName -Force -ErrorAction Stop | Out-Null
        Write-Host "  ✓ Chinese model linked: $($zhSource.Name)" -ForegroundColor Green
    } catch {
        Write-Host "  ! Hard link failed, copying instead..." -ForegroundColor Yellow
        Copy-Item -Path $zhSource.FullName -Destination "$zhModelDir\$($zhSource.Name)" -Force
        Write-Host "  ✓ Chinese model copied: $($zhSource.Name)" -ForegroundColor Green
    }
} else {
    Write-Host "  ✗ Chinese model not found in old service" -ForegroundColor Red
    Write-Host "    Please manually copy model to: $zhModelDir" -ForegroundColor Yellow
}

# 英文模型
Write-Host "[3/4] Setting up English model..." -ForegroundColor Yellow
$enModelDir = "$targetService\models\qwen2.5-3b-instruct-en-gguf"
New-Item -Path $enModelDir -ItemType Directory -Force | Out-Null

$enSource = Get-ChildItem -Path "$servicePath\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf\*.gguf" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($enSource) {
    try {
        New-Item -ItemType HardLink `
                 -Path "$enModelDir\$($enSource.Name)" `
                 -Target $enSource.FullName -Force -ErrorAction Stop | Out-Null
        Write-Host "  ✓ English model linked: $($enSource.Name)" -ForegroundColor Green
    } catch {
        Write-Host "  ! Hard link failed, copying instead..." -ForegroundColor Yellow
        Copy-Item -Path $enSource.FullName -Destination "$enModelDir\$($enSource.Name)" -Force
        Write-Host "  ✓ English model copied: $($enSource.Name)" -ForegroundColor Green
    }
} else {
    Write-Host "  ✗ English model not found in old service" -ForegroundColor Red
    Write-Host "    Please manually copy model to: $enModelDir" -ForegroundColor Yellow
}

# 验证
Write-Host "[4/4] Verifying installation..." -ForegroundColor Yellow
$zhExists = Test-Path "$zhModelDir\*.gguf"
$enExists = Test-Path "$enModelDir\*.gguf"

Write-Host ""
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "Installation Summary" -ForegroundColor Green
Write-Host "=" * 80 -ForegroundColor Cyan

if ($zhExists) {
    Write-Host "✓ Chinese model: OK" -ForegroundColor Green
} else {
    Write-Host "✗ Chinese model: NOT FOUND" -ForegroundColor Red
}

if ($enExists) {
    Write-Host "✓ English model: OK" -ForegroundColor Green
} else {
    Write-Host "✗ English model: NOT FOUND" -ForegroundColor Red
}

Write-Host ""
if ($zhExists -and $enExists) {
    Write-Host "✓ All models ready! You can now run:" -ForegroundColor Green
    Write-Host "  python service.py" -ForegroundColor Cyan
} else {
    Write-Host "⚠ Some models are missing. Please check the error messages above." -ForegroundColor Yellow
    Write-Host "  See MODELS_SETUP_GUIDE.md for manual installation instructions." -ForegroundColor Yellow
}
Write-Host ""
