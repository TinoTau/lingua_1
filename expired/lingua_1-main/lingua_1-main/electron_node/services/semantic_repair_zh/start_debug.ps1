# Semantic Repair ZH Service - Debug Startup Script
# 中文语义修复服务 - 调试启动脚本

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Semantic Repair ZH Service - Debug Mode" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 获取脚本所在目录
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceDir = $scriptDir

Write-Host "[Debug] Service directory: $serviceDir" -ForegroundColor Yellow
Write-Host ""

# 检查 Python 环境
Write-Host "[Debug] Checking Python environment..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[Debug] Python version: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "[Debug] ❌ Python not found in PATH" -ForegroundColor Red
    exit 1
}

# 检查必要的 Python 包
Write-Host "[Debug] Checking required packages..." -ForegroundColor Yellow
$requiredPackages = @("torch", "transformers", "fastapi", "uvicorn", "psutil")
foreach ($package in $requiredPackages) {
    try {
        $result = python -c "import $package; print('OK')" 2>&1
        if ($result -match "OK") {
            Write-Host "[Debug] ✓ $package is installed" -ForegroundColor Green
        } else {
            Write-Host "[Debug] ✗ $package is NOT installed" -ForegroundColor Red
        }
    } catch {
        Write-Host "[Debug] ✗ $package is NOT installed" -ForegroundColor Red
    }
}
Write-Host ""

# 检查 CUDA 可用性
Write-Host "[Debug] Checking CUDA availability..." -ForegroundColor Yellow
try {
    $cudaCheck = python -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('CUDA version:', torch.version.cuda if torch.cuda.is_available() else 'N/A')" 2>&1
    Write-Host "[Debug] $cudaCheck" -ForegroundColor $(if ($cudaCheck -match "True") { "Green" } else { "Yellow" })
} catch {
    Write-Host "[Debug] ⚠️  Could not check CUDA: $_" -ForegroundColor Yellow
}
Write-Host ""

# 检查模型目录
Write-Host "[Debug] Checking model directory..." -ForegroundColor Yellow
$modelsDir = Join-Path $serviceDir "models"
$modelPath = Join-Path $modelsDir "qwen2.5-3b-instruct-zh"

if (Test-Path $modelsDir) {
    Write-Host "[Debug] ✓ Models directory exists: $modelsDir" -ForegroundColor Green
    if (Test-Path $modelPath) {
        Write-Host "[Debug] ✓ Model directory exists: $modelPath" -ForegroundColor Green
        
        # 检查必需文件
        $requiredFiles = @("config.json", "tokenizer.json", "tokenizer_config.json")
        $modelFiles = @("model.safetensors", "pytorch_model.bin")
        
        $hasRequired = $true
        foreach ($file in $requiredFiles) {
            $filePath = Join-Path $modelPath $file
            if (Test-Path $filePath) {
                Write-Host "[Debug]   ✓ $file exists" -ForegroundColor Green
            } else {
                Write-Host "[Debug]   ✗ $file is missing" -ForegroundColor Red
                $hasRequired = $false
            }
        }
        
        $hasModelFile = $false
        foreach ($file in $modelFiles) {
            $filePath = Join-Path $modelPath $file
            if (Test-Path $filePath) {
                Write-Host "[Debug]   ✓ $file exists" -ForegroundColor Green
                $hasModelFile = $true
            }
        }
        
        if (-not $hasModelFile) {
            Write-Host "[Debug]   ✗ No model weight file found (model.safetensors or pytorch_model.bin)" -ForegroundColor Red
            $hasRequired = $false
        }
        
        if (-not $hasRequired) {
            Write-Host "[Debug] ⚠️  Model directory is incomplete" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[Debug] ✗ Model directory not found: $modelPath" -ForegroundColor Red
    }
} else {
    Write-Host "[Debug] ✗ Models directory not found: $modelsDir" -ForegroundColor Red
}
Write-Host ""

# 检查端口
Write-Host "[Debug] Checking port 5013..." -ForegroundColor Yellow
$port = 5013
$portInUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Host "[Debug] ⚠️  Port $port is already in use" -ForegroundColor Yellow
    Write-Host "[Debug]   Process: $($portInUse.OwningProcess)" -ForegroundColor Yellow
} else {
    Write-Host "[Debug] ✓ Port $port is available" -ForegroundColor Green
}
Write-Host ""

# 设置环境变量
$env:PORT = $port
$env:HOST = "127.0.0.1"
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONIOENCODING = "utf-8"

Write-Host "[Debug] Environment variables set:" -ForegroundColor Yellow
Write-Host "[Debug]   PORT=$env:PORT" -ForegroundColor Cyan
Write-Host "[Debug]   HOST=$env:HOST" -ForegroundColor Cyan
Write-Host "[Debug]   PYTHONUNBUFFERED=$env:PYTHONUNBUFFERED" -ForegroundColor Cyan
Write-Host ""

# 切换到服务目录
Set-Location $serviceDir

# 启动服务
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Semantic Repair ZH Service..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the service" -ForegroundColor Yellow
Write-Host ""

try {
    # 直接运行 Python 脚本（不使用 uvicorn 命令行，以便捕获所有输出）
    python semantic_repair_zh_service.py
} catch {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Service exited with error" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    exit 1
}
