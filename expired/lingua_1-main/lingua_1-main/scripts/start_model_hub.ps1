# Start Model Hub Service

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Lingua Model Hub Service" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$modelHubPath = Join-Path (Join-Path $projectRoot "central_server") "model-hub"

# Check if directory exists
if (-not (Test-Path $modelHubPath)) {
    Write-Host "Error: Model Hub directory not found: $modelHubPath" -ForegroundColor Red
    exit 1
}

# Switch to model-hub directory
Push-Location $modelHubPath

try {
    # Create logs directory
    $logDir = Join-Path $modelHubPath "logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
    }

    # Check if Python is installed
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        Write-Host "Error: Python not found, please install Python 3.10+" -ForegroundColor Red
        exit 1
    }

    # Check Python version
    $pythonVersion = python --version 2>&1
    Write-Host "Python version: $pythonVersion" -ForegroundColor Gray

    # Check virtual environment
    if (-not (Test-Path "venv")) {
        Write-Host "Creating virtual environment..." -ForegroundColor Yellow
        python -m venv venv
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Virtual environment creation failed" -ForegroundColor Red
            exit 1
        }
    }

    # Activate virtual environment
    Write-Host "Activating virtual environment..." -ForegroundColor Yellow
    & .\venv\Scripts\Activate.ps1

    # Install dependencies
    if (-not (Test-Path "venv\Lib\site-packages\fastapi")) {
        Write-Host "Installing dependencies..." -ForegroundColor Yellow
        pip install -r requirements.txt
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Dependency installation failed" -ForegroundColor Red
            exit 1
        }
    }

    # Check models directory
    $modelsDir = if ($env:MODELS_DIR) { $env:MODELS_DIR } else { Join-Path $modelHubPath "models" }
    Write-Host ""
    Write-Host "Configuration:" -ForegroundColor Yellow
    Write-Host "  Models directory: $modelsDir" -ForegroundColor Gray
    Write-Host "  Service URL: http://localhost:5000" -ForegroundColor Gray
    Write-Host "  API docs: http://localhost:5000/docs" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Tip: Configure models directory via environment variable MODELS_DIR" -ForegroundColor Cyan
    Write-Host '  Example: $env:MODELS_DIR = "D:\path\to\models"' -ForegroundColor Gray
    Write-Host ""

    # Set log file path
    $logFile = Join-Path $logDir "model-hub.log"
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $logFileWithTimestamp = Join-Path $logDir "model-hub_$timestamp.log"

    Write-Host "Starting Model Hub service..." -ForegroundColor Yellow
    Write-Host "Logs will be saved to: $logFileWithTimestamp" -ForegroundColor Gray
    Write-Host "All output (including INFO) will be logged to file" -ForegroundColor Gray
    Write-Host "Output will also be displayed in this terminal" -ForegroundColor Gray
    Write-Host ""

    # Set environment variable
    $env:MODELS_DIR = $modelsDir

    # Start service with all output captured and logged
    # uvicorn outputs INFO messages to stderr, which is normal
    # Use *>&1 to redirect all streams (stdout and stderr) to stdout
    # Then add timestamp and write to both file and terminal using Tee-Object
    # This ensures all INFO, ERROR, and other messages are logged
    python src/main.py *>&1 | ForEach-Object {
        $timestampedLine = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff') $_"
        $timestampedLine
    } | Tee-Object -FilePath $logFileWithTimestamp

}
catch {
    Write-Host "Startup failed: $_" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
