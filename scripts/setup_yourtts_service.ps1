# Setup YourTTS Service Environment
Write-Host "Setting up YourTTS Service environment..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$ttsServicePath = Join-Path $projectRoot "services\your_tts"

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
pip install -r requirements.txt

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to install dependencies" -ForegroundColor Red
    exit 1
}

Write-Host "Dependencies installed successfully" -ForegroundColor Green

# Check PyTorch CUDA support
Write-Host "Checking PyTorch installation..." -ForegroundColor Yellow
$torchCheck = python -c "import torch; print('PyTorch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available()); print('CUDA version:', torch.version.cuda if torch.cuda.is_available() else 'N/A')" 2>&1
Write-Host $torchCheck -ForegroundColor Cyan

if ($torchCheck -match "CUDA available: True") {
    Write-Host "PyTorch with CUDA support is available" -ForegroundColor Green
}
else {
    Write-Host "Warning: PyTorch CUDA support not found" -ForegroundColor Yellow
    Write-Host "To enable GPU acceleration, install PyTorch with CUDA:" -ForegroundColor Yellow
    Write-Host "  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Ensure YourTTS models are in: node-inference\models\tts\your_tts" -ForegroundColor White
Write-Host "  2. Run: .\scripts\start_yourtts_service.ps1" -ForegroundColor White
Write-Host ""

# Install PyTorch with CUDA support (if CUDA is found)
if ($cudaFound) {
    Write-Host "Installing PyTorch with CUDA 12.1 support..." -ForegroundColor Yellow
    Write-Host "Note: This is compatible with CUDA 12.4" -ForegroundColor Gray
    pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
} else {
    Write-Host "Installing PyTorch (CPU version)..." -ForegroundColor Yellow
    pip install torch torchaudio
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to install dependencies" -ForegroundColor Red
    exit 1
}

Write-Host "Dependencies installed successfully" -ForegroundColor Green

# Check PyTorch CUDA support
Write-Host "Checking PyTorch installation..." -ForegroundColor Yellow
$torchCheck = python -c "import torch; print('PyTorch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available()); print('CUDA version:', torch.version.cuda if torch.cuda.is_available() else 'N/A')" 2>&1
Write-Host $torchCheck -ForegroundColor Cyan

if ($torchCheck -match "CUDA available: True") {
    Write-Host "PyTorch with CUDA support is available" -ForegroundColor Green
} else {
    Write-Host "Warning: PyTorch CUDA support not found" -ForegroundColor Yellow
    Write-Host "To enable GPU acceleration, install PyTorch with CUDA:" -ForegroundColor Yellow
    Write-Host "  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Ensure YourTTS models are in: node-inference\models\tts\your_tts" -ForegroundColor White
Write-Host "  2. Run: .\scripts\start_yourtts_service.ps1" -ForegroundColor White
Write-Host ""
