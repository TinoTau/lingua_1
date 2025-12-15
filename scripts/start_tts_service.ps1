# Start Piper TTS Service (Port 5006)
# Note: This is different from YourTTS service (port 5004)
# Both services can run simultaneously

Write-Host "Starting Piper TTS Service..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

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

# Enable GPU for Piper TTS (if CUDA is available)
if ($cudaFound) {
    $env:PIPER_USE_GPU = "true"
    Write-Host "GPU acceleration enabled for Piper TTS" -ForegroundColor Green
}
else {
    Write-Host "Warning: CUDA not found, GPU acceleration disabled" -ForegroundColor Yellow
    $env:PIPER_USE_GPU = "false"
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

# Get model directory (from environment variable or use project models)
$modelDir = $env:PIPER_MODEL_DIR
if (-not $modelDir) {
    # Priority: node-inference\models\tts (node local model directory)
    $defaultModelDir = Join-Path $projectRoot "node-inference\models\tts"
    
    # Check if default directory exists
    if (Test-Path $defaultModelDir) {
        $modelDir = $defaultModelDir
        Write-Host "Using project model directory: $modelDir" -ForegroundColor Green
        
        # Check for .onnx files
        $onnxFiles = Get-ChildItem -Path $modelDir -Recurse -Filter "*.onnx" -ErrorAction SilentlyContinue | Where-Object {
            # Filter out piper package internal models (tashkeel)
            $_.FullName -notmatch "venv|site-packages|tashkeel"
        }
        
        if ($onnxFiles.Count -gt 0) {
            Write-Host "  Found $($onnxFiles.Count) model file(s):" -ForegroundColor Gray
            foreach ($file in $onnxFiles) {
                $relativePath = $file.FullName.Replace($projectRoot + "\", "")
                Write-Host "    - $relativePath" -ForegroundColor Gray
            }
        }
        else {
            Write-Host "  Piper models should be placed in: $modelDir" -ForegroundColor Yellow
        }
    }
    else {
        # Fallback to user home directory
        $modelDir = "$env:USERPROFILE\piper_models"
    }
}

Write-Host "Starting Piper TTS Service (port 5006)..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:5006" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:5006/health" -ForegroundColor Cyan
Write-Host "Model Directory: $modelDir" -ForegroundColor Cyan
Write-Host "GPU Acceleration: $env:PIPER_USE_GPU" -ForegroundColor Cyan
Write-Host ""

# Set environment variable
$env:PIPER_MODEL_DIR = $modelDir

# Start service
python piper_http_server.py --host 127.0.0.1 --port 5006 --model-dir $modelDir
