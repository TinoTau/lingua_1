# Start Model Hub Service
Write-Host "Starting Lingua Model Hub Service..." -ForegroundColor Green

Set-Location $PSScriptRoot\..\model-hub

# Check if Python is installed
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Python not found, please install Python 3.10+" -ForegroundColor Red
    exit 1
}

# Check virtual environment
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv venv
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& .\venv\Scripts\Activate.ps1

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt

# Start service
Write-Host "Starting Model Hub service..." -ForegroundColor Green
python src/main.py

