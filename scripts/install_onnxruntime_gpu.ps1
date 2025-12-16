# Install ONNX Runtime GPU support for Piper TTS
Write-Host "Installing ONNX Runtime with GPU support..." -ForegroundColor Cyan

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$ttsServicePath = Join-Path $projectRoot "services\piper_tts"

# Set CUDA environment variables (if CUDA is installed)
$cudaPaths = @(
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
)

$cudaFound = $false
foreach ($cudaPath in $cudaPaths) {
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
        $cudaFound = $true
        break
    }
}

if (-not $cudaFound) {
    Write-Host "Warning: CUDA not found. GPU support may not work." -ForegroundColor Yellow
}

# Check virtual environment
$venvPath = Join-Path $ttsServicePath "venv"
if (-not (Test-Path "$venvPath\Scripts\Activate.ps1")) {
    Write-Host "Error: Virtual environment not found: $venvPath" -ForegroundColor Red
    Write-Host "Please run setup script first:" -ForegroundColor Yellow
    Write-Host "  .\scripts\setup_tts_service.ps1" -ForegroundColor Yellow
    exit 1
}

# Switch to service directory
Set-Location $ttsServicePath

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& "$venvPath\Scripts\Activate.ps1"

# Check current ONNX Runtime installation
Write-Host "Checking current ONNX Runtime installation..." -ForegroundColor Yellow
try {
    $currentCheck = python -c "import onnxruntime as ort; print('Version:', ort.__version__); providers = ort.get_available_providers(); print('Providers:', ','.join(providers))" 2>&1
    Write-Host $currentCheck -ForegroundColor Cyan
} catch {
    Write-Host "  No existing ONNX Runtime installation found" -ForegroundColor Gray
}

# Uninstall CPU-only version (ignore errors if not installed)
Write-Host ""
Write-Host "Uninstalling CPU-only ONNX Runtime..." -ForegroundColor Yellow
$uninstallResult = pip uninstall -y onnxruntime 2>&1
if ($LASTEXITCODE -ne 0 -and $uninstallResult -notmatch "WARNING: Skipping") {
    Write-Host "  Note: onnxruntime may not be installed, continuing..." -ForegroundColor Gray
}

# Install GPU version
Write-Host ""
Write-Host "Installing ONNX Runtime with GPU support..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray
$installResult = pip install onnxruntime-gpu 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to install onnxruntime-gpu" -ForegroundColor Red
    Write-Host $installResult -ForegroundColor Red
    Write-Host ""
    Write-Host "Please check:" -ForegroundColor Yellow
    Write-Host "  1. CUDA toolkit is installed" -ForegroundColor White
    Write-Host "  2. Internet connection is available" -ForegroundColor White
    Write-Host "  3. pip is up to date (run: python -m pip install --upgrade pip)" -ForegroundColor White
    exit 1
}

# Verify installation
Write-Host ""
Write-Host "Verifying ONNX Runtime installation..." -ForegroundColor Yellow
try {
    $onnxCheck = python -c "import onnxruntime as ort; print('Version:', ort.__version__); providers = ort.get_available_providers(); print('Available providers:', ','.join(providers))" 2>&1
    Write-Host $onnxCheck -ForegroundColor Cyan
    
    if ($onnxCheck -match "CUDAExecutionProvider") {
        Write-Host ""
        Write-Host "✓ ONNX Runtime with CUDA support installed successfully!" -ForegroundColor Green
        Write-Host "  GPU acceleration is now available for Piper TTS" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "⚠ Warning: CUDA Execution Provider not found" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Possible reasons:" -ForegroundColor Yellow
        Write-Host "  1. CUDA toolkit not properly installed" -ForegroundColor White
        Write-Host "  2. CUDA libraries not in PATH" -ForegroundColor White
        Write-Host "  3. ONNX Runtime GPU package version mismatch with CUDA version" -ForegroundColor White
        Write-Host ""
        Write-Host "To troubleshoot:" -ForegroundColor Yellow
        Write-Host "  1. Verify CUDA installation: nvcc --version" -ForegroundColor White
        Write-Host "  2. Check CUDA path: echo `$env:CUDA_PATH" -ForegroundColor White
        Write-Host "  3. Try reinstalling: pip uninstall onnxruntime-gpu && pip install onnxruntime-gpu" -ForegroundColor White
    }
} catch {
    Write-Host "Error verifying installation: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "Installation completed!" -ForegroundColor Green
