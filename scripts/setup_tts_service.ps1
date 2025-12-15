# Setup Piper TTS Service Environment
Write-Host "Setting up Piper TTS Service environment..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$ttsServicePath = Join-Path $projectRoot "services\piper_tts"

# Check virtual environment
$venvPath = Join-Path $ttsServicePath "venv"
if (-not (Test-Path "$venvPath\Scripts\Activate.ps1")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    Set-Location $ttsServicePath
    python -m venv venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to create virtual environment" -ForegroundColor Red
        exit 1
    }
    Write-Host "Virtual environment created" -ForegroundColor Green
}
else {
    Write-Host "Virtual environment already exists" -ForegroundColor Green
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
Set-Location $ttsServicePath
& "$venvPath\Scripts\Activate.ps1"

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
Write-Host "This may take several minutes..." -ForegroundColor Yellow
python -m pip install --upgrade pip

# Install dependencies from requirements.txt (but skip onnxruntime, we'll install GPU version)
Write-Host "Installing base dependencies..." -ForegroundColor Yellow
pip install fastapi uvicorn[standard] pydantic piper-tts

# Install onnxruntime-gpu for GPU acceleration (replace onnxruntime)
Write-Host "Installing ONNX Runtime with GPU support..." -ForegroundColor Yellow
pip uninstall -y onnxruntime 2>$null
pip install onnxruntime-gpu

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to install dependencies" -ForegroundColor Red
    exit 1
}

Write-Host "Dependencies installed successfully" -ForegroundColor Green

# Check if ONNX Runtime with GPU support is needed
Write-Host "Checking ONNX Runtime installation..." -ForegroundColor Yellow
$onnxCheck = python -c "import onnxruntime as ort; providers = ort.get_available_providers(); print('Available providers:', providers)" 2>&1
Write-Host $onnxCheck -ForegroundColor Cyan

if ($onnxCheck -match "CUDAExecutionProvider") {
    Write-Host "ONNX Runtime with CUDA support is available" -ForegroundColor Green
}
else {
    Write-Host "Warning: ONNX Runtime CUDA support not found" -ForegroundColor Yellow
    Write-Host "To enable GPU acceleration, install: pip install onnxruntime-gpu" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Download Piper models (if not already downloaded)" -ForegroundColor White
Write-Host "  2. Run: .\scripts\start_tts_service.ps1" -ForegroundColor White
Write-Host ""
