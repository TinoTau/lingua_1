<# Clean, single-copy startup script for YourTTS service #>
# Start YourTTS Service
Write-Host "Starting YourTTS Service..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$ttsServicePath = Join-Path $projectRoot "services\your_tts"

# CUDA (if installed)
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

# Logs
$logDir = Join-Path $ttsServicePath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
}
$logFile = Join-Path $logDir "yourtts-service.log"

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& "$venvPath\Scripts\Activate.ps1"

# Force UTF-8
$env:PYTHONIOENCODING = "utf-8"

# Locate models
$modelDir = $env:YOURTTS_MODEL_DIR
if (-not $modelDir) {
    $possiblePaths = @(
        (Join-Path $projectRoot "model-hub\models\tts\your_tts")
        (Join-Path $projectRoot "node-inference\models\tts\your_tts")
    )
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $modelDir = $path
            Write-Host "Found YourTTS models in: $modelDir" -ForegroundColor Green
            break
        }
    }
}

# GPU usage
$useGpu = $cudaFound
if ($useGpu) {
    Write-Host "GPU acceleration will be enabled" -ForegroundColor Green
}
else {
    Write-Host "Using CPU (GPU not available)" -ForegroundColor Yellow
}

Write-Host "Starting YourTTS Service (port 5004)..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:5004" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:5004/health" -ForegroundColor Cyan
if ($modelDir) { Write-Host "Model Directory: $modelDir" -ForegroundColor Cyan }
Write-Host "GPU: $useGpu" -ForegroundColor Cyan
Write-Host "Logs will be saved to: $logDir\yourtts-service.log" -ForegroundColor Gray
Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
Write-Host ""

# Build command
$cmdArgs = @("yourtts_service.py", "--host", "127.0.0.1", "--port", "5004")
if ($useGpu) { $cmdArgs += "--gpu" }
if ($modelDir) {
    $cmdArgs += "--model-dir"
    $cmdArgs += $modelDir
}

# Log rotation 5MB
function Set-LogRotation {
    param([string]$Path, [int]$MaxBytes)
    if (Test-Path $Path) {
        $size = (Get-Item $Path).Length
        if ($size -ge $MaxBytes) {
            $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
            $newPath = "$Path.$timestamp"
            Move-Item -Path $Path -Destination $newPath -Force
        }
    }
}
Set-LogRotation -Path $logFile -MaxBytes 5242880

# Build command string for cmd /c
$quotedArgs = $cmdArgs | ForEach-Object { '"{0}"' -f $_ }
$pythonCmd = "python " + ($quotedArgs -join ' ')

cmd /c "$pythonCmd 2>&1" |
ForEach-Object { "$(Get-Date -Format o) $_" } |
Tee-Object -FilePath $logFile -Append
