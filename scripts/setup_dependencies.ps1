# Install Project Dependencies Script
Write-Host "Installing Lingua Project Dependencies..." -ForegroundColor Green
Write-Host ""

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# 1. Install Web client dependencies
Write-Host "1. Checking Web client dependencies..." -ForegroundColor Yellow
$webClientPath = Join-Path $projectRoot "web-client"
if (Test-Path $webClientPath) {
    if (-not (Test-Path (Join-Path $webClientPath "node_modules"))) {
        Write-Host "   Installing Web client dependencies..." -ForegroundColor Cyan
        Set-Location $webClientPath
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   ✗ Web client dependency installation failed" -ForegroundColor Red
            exit 1
        }
        Write-Host "   ✓ Web client dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "   ✓ Web client dependencies already installed" -ForegroundColor Green
    }
} else {
    Write-Host "   ⚠ Web client directory does not exist" -ForegroundColor Yellow
}

Write-Host ""

# 2. Create and install NMT service dependencies
Write-Host "2. Checking NMT service dependencies..." -ForegroundColor Yellow
$nmtServicePath = Join-Path $projectRoot "services\nmt_m2m100"
if (Test-Path $nmtServicePath) {
    $venvPath = Join-Path $nmtServicePath "venv"
    if (-not (Test-Path $venvPath)) {
        Write-Host "   Creating NMT service virtual environment..." -ForegroundColor Cyan
        Set-Location $nmtServicePath
        python -m venv venv
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   ✗ Virtual environment creation failed" -ForegroundColor Red
            exit 1
        }
        Write-Host "   ✓ Virtual environment created" -ForegroundColor Green
    } else {
        Write-Host "   ✓ NMT service virtual environment already exists" -ForegroundColor Green
    }
    
    Write-Host "   Installing NMT service dependencies..." -ForegroundColor Cyan
    $activateScript = Join-Path $venvPath "Scripts\Activate.ps1"
    if (Test-Path $activateScript) {
        & $activateScript
        pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) {
            Write-Host "   ✗ NMT service dependency installation failed" -ForegroundColor Red
            exit 1
        }
        Write-Host "   ✓ NMT service dependencies installed" -ForegroundColor Green
    } else {
        Write-Host "   ⚠ Virtual environment activation script does not exist" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ⚠ NMT service directory does not exist" -ForegroundColor Yellow
}

Write-Host ""

# 3. Check TTS service dependencies
Write-Host "3. Checking TTS service dependencies..." -ForegroundColor Yellow
$ttsServicePath = Join-Path $projectRoot "services\piper_tts"
if (Test-Path $ttsServicePath) {
    Write-Host "   ℹ TTS service dependencies need manual installation" -ForegroundColor Cyan
    Write-Host "     Run: cd services\piper_tts; pip install -r requirements.txt" -ForegroundColor Gray
} else {
    Write-Host "   ⚠ TTS service directory does not exist" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Dependency installation completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Install TTS service dependencies (if needed)" -ForegroundColor White
Write-Host "  2. Ensure model files are properly placed" -ForegroundColor White
Write-Host "  3. Start services in order" -ForegroundColor White
Write-Host ""
Write-Host "Reference: scripts\README_STARTUP.md" -ForegroundColor Gray

