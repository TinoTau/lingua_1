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

# Ensure Python stdout/stderr use UTF-8 to avoid GBK encoding errors
$env:PYTHONIOENCODING = "utf-8"

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

# Create logs directory
$logDir = Join-Path $ttsServicePath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Starting Piper TTS Service (port 5006)..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:5006" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:5006/health" -ForegroundColor Cyan
Write-Host "Model Directory: $modelDir" -ForegroundColor Cyan
Write-Host "GPU Acceleration: $env:PIPER_USE_GPU" -ForegroundColor Cyan
Write-Host "Logs will be saved to: $logDir\tts-service.log" -ForegroundColor Gray
Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
Write-Host ""

# Set environment variable
$env:PIPER_MODEL_DIR = $modelDir

# Start service with logging
$logFile = Join-Path $logDir "tts-service.log"

# Check if log file is locked by another process
# If locked, create a new log file with timestamp
$logFileLocked = $false
if (Test-Path $logFile) {
    try {
        # Try to open the file for writing to check if it's locked
        $fileStream = [System.IO.File]::Open($logFile, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $fileStream.Close()
        $fileStream.Dispose()
    }
    catch {
        # File is locked by another process
        $logFileLocked = $true
        Write-Host "Warning: Log file is locked by another process, creating new log file with timestamp..." -ForegroundColor Yellow
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $logFile = Join-Path $logDir "tts-service_$timestamp.log"
        Write-Host "Using log file: $logFile" -ForegroundColor Gray
        Write-Host ""
    }
}

# Start the service with logging
# Use append mode if using the default log file, otherwise create new file
$pythonCmd = "python piper_http_server.py --host 127.0.0.1 --port 5006 --model-dir `"$modelDir`""

function Rotate-LogFile {
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

# 5MB 轮转
Rotate-LogFile -Path $logFile -MaxBytes 5242880

# 启动并为每行添加时间戳
if ($logFileLocked) {
    cmd /c "$pythonCmd 2>&1" | ForEach-Object { "$(Get-Date -Format o) $_" } | Tee-Object -FilePath $logFile
}
else {
    cmd /c "$pythonCmd 2>&1" | ForEach-Object { "$(Get-Date -Format o) $_" } | Tee-Object -FilePath $logFile -Append
}
