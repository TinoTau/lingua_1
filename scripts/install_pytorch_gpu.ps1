# Install PyTorch with CUDA support
Write-Host "Installing PyTorch with CUDA support..." -ForegroundColor Cyan

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nmtServicePath = Join-Path $projectRoot "services\nmt_m2m100"

# Check virtual environment
$venvPath = Join-Path $nmtServicePath "venv"
if (-not (Test-Path "$venvPath\Scripts\Activate.ps1")) {
    Write-Host "Error: Virtual environment not found: $venvPath" -ForegroundColor Red
    Write-Host "Please create virtual environment first:" -ForegroundColor Yellow
    Write-Host "  cd $nmtServicePath" -ForegroundColor Yellow
    Write-Host "  python -m venv venv" -ForegroundColor Yellow
    exit 1
}

# Switch to service directory
Set-Location $nmtServicePath

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& "$venvPath\Scripts\Activate.ps1"

# Check current PyTorch installation
Write-Host "Checking current PyTorch installation..." -ForegroundColor Yellow
$torchInstalled = $false
try {
    $currentTorch = python -c "import torch; print('PyTorch version:', torch.__version__); print('CUDA available:', torch.cuda.is_available())" 2>&1
    if ($LASTEXITCODE -eq 0 -and $currentTorch -notmatch "Traceback|Error|ModuleNotFoundError") {
        Write-Host $currentTorch -ForegroundColor Cyan
        $torchInstalled = $true
    }
    else {
        Write-Host "PyTorch not installed or error checking installation" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "PyTorch not installed or error checking installation" -ForegroundColor Yellow
}

# Uninstall existing PyTorch (if any)
if ($torchInstalled) {
    Write-Host "Uninstalling existing PyTorch..." -ForegroundColor Yellow
    pip uninstall torch torchvision torchaudio -y 2>&1 | Out-Null
}
else {
    Write-Host "No existing PyTorch installation found, proceeding with fresh install..." -ForegroundColor Yellow
}

# Install PyTorch with CUDA 12.1 support
# Note: CUDA 12.1 PyTorch is compatible with CUDA 12.4 (as used in reference project)
Write-Host "Installing PyTorch with CUDA 12.1 support..." -ForegroundColor Green
Write-Host "Note: This is compatible with CUDA 12.4 (as used in reference project)" -ForegroundColor Yellow
Write-Host "This may take several minutes..." -ForegroundColor Yellow

$ErrorActionPreference = "Stop"
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Verify installation
Write-Host "Verifying PyTorch installation..." -ForegroundColor Yellow
$verifyScript = @"
import torch
print('PyTorch version:', torch.__version__)
print('CUDA available:', torch.cuda.is_available())
if torch.cuda.is_available():
    print('CUDA version:', torch.version.cuda)
    print('GPU name:', torch.cuda.get_device_name(0))
"@
$verifyTorch = python -c $verifyScript 2>&1
Write-Host $verifyTorch -ForegroundColor Cyan

if ($verifyTorch -match "CUDA available: True") {
    Write-Host "Successfully installed PyTorch with CUDA support!" -ForegroundColor Green
}
else {
    Write-Host "Warning: PyTorch installed but CUDA is not available" -ForegroundColor Yellow
    Write-Host "Please check:" -ForegroundColor Yellow
    Write-Host "  1. CUDA toolkit is installed" -ForegroundColor Yellow
    Write-Host "  2. NVIDIA drivers are up to date" -ForegroundColor Yellow
    Write-Host "  3. CUDA version matches PyTorch CUDA version" -ForegroundColor Yellow
}
