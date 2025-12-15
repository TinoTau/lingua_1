# Start M2M100 NMT Service
Write-Host "Starting M2M100 NMT Service..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nmtServicePath = Join-Path $projectRoot "services\nmt_m2m100"

# Set CUDA environment variables (if CUDA is installed)
# Reference project uses CUDA 12.4
$cudaPath = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4"
if (Test-Path $cudaPath) {
    $env:CUDA_PATH = $cudaPath
    $env:CUDAToolkit_ROOT = $cudaPath
    $env:CUDA_ROOT = $cudaPath
    $env:CUDA_HOME = $cudaPath
    $cudaBin = Join-Path $cudaPath "bin"
    $cudaLibnvvp = Join-Path $cudaPath "libnvvp"
    $cudaNvcc = Join-Path $cudaBin "nvcc.exe"
    $env:CMAKE_CUDA_COMPILER = $cudaNvcc
    $env:PATH = "$cudaBin;$cudaLibnvvp;$env:PATH"
    Write-Host "CUDA environment configured: $cudaPath" -ForegroundColor Green
}
else {
    Write-Host "Warning: CUDA 12.4 not found at $cudaPath" -ForegroundColor Yellow
    Write-Host "GPU may not be available" -ForegroundColor Yellow
}

# Set Hugging Face token (for model validation only, not for downloading)
$env:HF_TOKEN = "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"

# Force local files only - models must be downloaded from model hub
$env:HF_LOCAL_FILES_ONLY = "true"
Write-Host "Local files only mode enabled (models must be from model hub)" -ForegroundColor Green

# Check virtual environment
$venvPath = Join-Path $nmtServicePath "venv"
if (-not (Test-Path "$venvPath\Scripts\Activate.ps1")) {
    Write-Host "Error: Virtual environment not found: $venvPath" -ForegroundColor Red
    Write-Host "Please create virtual environment first:" -ForegroundColor Yellow
    Write-Host "  cd $nmtServicePath" -ForegroundColor Yellow
    Write-Host "  python -m venv venv" -ForegroundColor Yellow
    Write-Host "  .\venv\Scripts\Activate.ps1" -ForegroundColor Yellow
    Write-Host "  pip install -r requirements.txt" -ForegroundColor Yellow
    exit 1
}

# Switch to service directory
Set-Location $nmtServicePath

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& "$venvPath\Scripts\Activate.ps1"

# Verify CUDA availability in Python
Write-Host "Checking CUDA availability..." -ForegroundColor Yellow
$cudaCheck = python -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('CUDA version:', torch.version.cuda if torch.cuda.is_available() else 'N/A'); print('GPU name:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A')" 2>&1
Write-Host $cudaCheck -ForegroundColor Cyan

Write-Host "Starting NMT Service (port 5008)..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:5008" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:5008/health" -ForegroundColor Cyan
Write-Host ""

# Start service
uvicorn nmt_service:app --host 127.0.0.1 --port 5008




