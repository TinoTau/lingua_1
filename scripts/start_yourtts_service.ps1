# Start YourTTS Service
Write-Host "Starting YourTTS Service..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$ttsServicePath = Join-Path $projectRoot "services\your_tts"

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

# Check virtual environment
$venvPath = Join-Path $ttsServicePath "venv"
if (-not (Test-Path "$venvPath\Scripts\Activate.ps1")) {
    Write-Host "Error: Virtual environment not found: $venvPath" -ForegroundColor Red
    Write-Host "Please run setup script first:" -ForegroundColor Yellow
    Write-Host "  .\scripts\setup_yourtts_service.ps1" -ForegroundColor Yellow
    exit 1
}

# Switch to service directory
Set-Location $ttsServicePath

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& "$venvPath\Scripts\Activate.ps1"

# Get model directory
$modelDir = $env:YOURTTS_MODEL_DIR
if (-not $modelDir) {
    # Try to find models in project directories (priority: node-inference)
    $possiblePaths = @(
        (Join-Path $projectRoot "node-inference\models\tts\your_tts"),
        (Join-Path $projectRoot "model-hub\models\tts\your_tts")
    )
    
    $modelDir = $null
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $modelDir = $path
            Write-Host "Found YourTTS models in: $modelDir" -ForegroundColor Green
            break
        }
    }
}

# Determine GPU usage (always try to use GPU if CUDA is found)
$useGpu = $cudaFound
if ($useGpu) {
    Write-Host "GPU acceleration will be enabled" -ForegroundColor Green
    
    # Verify PyTorch CUDA support
    Write-Host "Checking PyTorch CUDA support..." -ForegroundColor Yellow
    $torchCheck = python -c "import torch; print('CUDA available:', torch.cuda.is_available())" 2>&1
    if ($torchCheck -match "CUDA available: True") {
        Write-Host "  ✓ PyTorch CUDA support available" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ PyTorch CUDA support not available" -ForegroundColor Yellow
        Write-Host "  Service will attempt to use GPU, but may fall back to CPU" -ForegroundColor Yellow
    }
} else {
    Write-Host "Using CPU (GPU not available)" -ForegroundColor Yellow
}

Write-Host "Starting YourTTS Service (port 5004)..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:5004" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:5004/health" -ForegroundColor Cyan
if ($modelDir) {
    Write-Host "Model Directory: $modelDir" -ForegroundColor Cyan
}
Write-Host "GPU: $useGpu" -ForegroundColor Cyan
Write-Host ""

# Build command
$cmdArgs = @("yourtts_service.py", "--host", "127.0.0.1", "--port", "5004")
if ($useGpu) {
    $cmdArgs += "--gpu"
}
if ($modelDir) {
    $cmdArgs += "--model-dir"
    $cmdArgs += $modelDir
}

# Start service
python $cmdArgs
