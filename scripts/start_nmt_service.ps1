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

# Set Hugging Face token (read from config file)
$hfTokenFile = Join-Path $nmtServicePath "hf_token.txt"
if (Test-Path $hfTokenFile) {
    try {
        $hfToken = Get-Content $hfTokenFile -Raw -ErrorAction Stop | ForEach-Object { $_.Trim() }
        if ($hfToken) {
            $env:HF_TOKEN = $hfToken
            Write-Host "Hugging Face token loaded from config file" -ForegroundColor Green
        }
        else {
            Write-Host "Warning: hf_token.txt is empty, HF_TOKEN not set" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "Warning: Failed to read hf_token.txt: $_" -ForegroundColor Yellow
        Write-Host "HF_TOKEN will not be set" -ForegroundColor Yellow
    }
}
else {
    Write-Host "Warning: hf_token.txt not found at $hfTokenFile" -ForegroundColor Yellow
    Write-Host "HF_TOKEN will not be set (models may require authentication)" -ForegroundColor Yellow
}

# Force local files only - models must be downloaded from model hub
$env:HF_LOCAL_FILES_ONLY = "true"
Write-Host "Local files only mode enabled (models must be from model hub)" -ForegroundColor Green

# Ensure Python stdout/stderr use UTF-8 to avoid GBK encoding errors
$env:PYTHONIOENCODING = "utf-8"

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

# Create logs directory
$logDir = Join-Path $nmtServicePath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& "$venvPath\Scripts\Activate.ps1"

# Verify CUDA availability in Python
Write-Host "Checking CUDA availability..." -ForegroundColor Yellow
$cudaCheck = python -c "import torch; print('CUDA available:', torch.cuda.is_available()); print('CUDA version:', torch.version.cuda if torch.cuda.is_available() else 'N/A'); print('GPU name:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A')" 2>&1
Write-Host $cudaCheck -ForegroundColor Cyan

Write-Host ""
Write-Host "Starting NMT Service (port 5008)..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:5008" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:5008/health" -ForegroundColor Cyan
Write-Host "Logs will be saved to: $logDir\nmt-service.log" -ForegroundColor Gray
Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
Write-Host ""

# Start service with logging
$logFile = Join-Path $logDir "nmt-service.log"

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
        $logFile = Join-Path $logDir "nmt-service_$timestamp.log"
        Write-Host "Using log file: $logFile" -ForegroundColor Gray
        Write-Host ""
    }
}

# Start the service with logging
# Use append mode if using the default log file, otherwise create new file
$uvicornCmd = "uvicorn nmt_service:app --host 127.0.0.1 --port 5008"
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
    cmd /c "$uvicornCmd 2>&1" | ForEach-Object { "$(Get-Date -Format o) $_" } | Tee-Object -FilePath $logFile
}
else {
    cmd /c "$uvicornCmd 2>&1" | ForEach-Object { "$(Get-Date -Format o) $_" } | Tee-Object -FilePath $logFile -Append
}















