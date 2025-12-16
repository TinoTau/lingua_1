# Environment Check Script
# Check if all required environments are installed for starting services

Write-Host "Checking Lingua System Environment..." -ForegroundColor Green
Write-Host ""

$ErrorActionPreference = "Continue"
$allOk = $true

# 1. Check Rust/Cargo
Write-Host "1. Checking Rust/Cargo..." -ForegroundColor Yellow
if (Get-Command cargo -ErrorAction SilentlyContinue) {
    $cargoVersion = cargo --version
    Write-Host "   ✓ Rust/Cargo installed: $cargoVersion" -ForegroundColor Green
    
    # Check Rust version (requires 1.70+)
    $rustcVersion = rustc --version
    Write-Host "   ✓ Rust compiler: $rustcVersion" -ForegroundColor Green
}
else {
    Write-Host "   ✗ Rust/Cargo not installed" -ForegroundColor Red
    Write-Host "     Download: https://www.rust-lang.org/tools/install" -ForegroundColor Gray
    $allOk = $false
}

Write-Host ""

# 2. Check Node.js/npm
Write-Host "2. Checking Node.js/npm..." -ForegroundColor Yellow
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node --version
    Write-Host "   ✓ Node.js installed: $nodeVersion" -ForegroundColor Green
    
    # Check version (requires 18+)
    $nodeMajorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($nodeMajorVersion -ge 18) {
        Write-Host "   ✓ Node.js version meets requirement (>= 18)" -ForegroundColor Green
    }
    else {
        Write-Host "   ⚠ Node.js version too low (requires >= 18)" -ForegroundColor Yellow
    }
    
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        $npmVersion = npm --version
        Write-Host "   ✓ npm installed: v$npmVersion" -ForegroundColor Green
    }
    else {
        Write-Host "   ✗ npm not installed" -ForegroundColor Red
        $allOk = $false
    }
}
else {
    Write-Host "   ✗ Node.js not installed" -ForegroundColor Red
    Write-Host "     Download: https://nodejs.org/" -ForegroundColor Gray
    $allOk = $false
}

Write-Host ""

# 3. Check Python
Write-Host "3. Checking Python..." -ForegroundColor Yellow
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonVersion = python --version
    Write-Host "   ✓ Python installed: $pythonVersion" -ForegroundColor Green
    
    # Check version (requires 3.10+)
    $pythonVersionStr = python --version 2>&1
    if ($pythonVersionStr -match 'Python (\d+)\.(\d+)') {
        $major = [int]$matches[1]
        $minor = [int]$matches[2]
        if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 10)) {
            Write-Host "   ✓ Python version meets requirement (>= 3.10)" -ForegroundColor Green
        }
        else {
            Write-Host "   ⚠ Python version too low (requires >= 3.10)" -ForegroundColor Yellow
        }
    }
    
    # Check pip
    if (Get-Command pip -ErrorAction SilentlyContinue) {
        $pipVersion = pip --version
        Write-Host "   ✓ pip installed" -ForegroundColor Green
    }
    else {
        Write-Host "   ⚠ pip not found (may need to install)" -ForegroundColor Yellow
    }
}
else {
    Write-Host "   ✗ Python not installed" -ForegroundColor Red
    Write-Host "     Download: https://www.python.org/downloads/" -ForegroundColor Gray
    $allOk = $false
}

Write-Host ""

# 4. Check CUDA (optional, for GPU acceleration)
Write-Host "4. Checking CUDA (optional, for GPU acceleration)..." -ForegroundColor Yellow
if (Get-Command nvcc -ErrorAction SilentlyContinue) {
    $cudaVersion = nvcc --version
    Write-Host "   ✓ CUDA installed" -ForegroundColor Green
    Write-Host "     $cudaVersion" -ForegroundColor Gray
}
else {
    Write-Host "   ⚠ CUDA not installed (optional, for GPU acceleration)" -ForegroundColor Yellow
    Write-Host "     Download: https://developer.nvidia.com/cuda-downloads" -ForegroundColor Gray
}

Write-Host ""

# 5. Check project dependencies
Write-Host "5. Checking project dependencies..." -ForegroundColor Yellow

# Check Web client dependencies
$webClientPath = Join-Path $PSScriptRoot "..\web-client"
if (Test-Path $webClientPath) {
    if (Test-Path (Join-Path $webClientPath "node_modules")) {
        Write-Host "   ✓ Web client dependencies installed" -ForegroundColor Green
    }
    else {
        Write-Host "   ⚠ Web client dependencies not installed" -ForegroundColor Yellow
        Write-Host "     Run: cd web-client; npm install" -ForegroundColor Gray
    }
}
else {
    Write-Host "   ⚠ Web client directory does not exist" -ForegroundColor Yellow
}

# Check Python service dependencies
$nmtServicePath = Join-Path $PSScriptRoot "..\services\nmt_m2m100"
if (Test-Path $nmtServicePath) {
    if (Test-Path (Join-Path $nmtServicePath "venv")) {
        Write-Host "   ✓ NMT service virtual environment created" -ForegroundColor Green
    }
    else {
        Write-Host "   ⚠ NMT service virtual environment not created" -ForegroundColor Yellow
        Write-Host "     Run: cd services\nmt_m2m100; python -m venv venv" -ForegroundColor Gray
    }
}

$ttsServicePath = Join-Path $PSScriptRoot "..\services\piper_tts"
if (Test-Path $ttsServicePath) {
    Write-Host "   ℹ TTS service dependencies need manual installation" -ForegroundColor Cyan
    Write-Host "     Run: cd services\piper_tts; pip install -r requirements.txt" -ForegroundColor Gray
}

Write-Host ""

# 6. Check model files (optional)
Write-Host "6. Checking model files (optional)..." -ForegroundColor Yellow
$modelsPath = Join-Path $PSScriptRoot "..\node-inference\models"
if (Test-Path $modelsPath) {
    $modelFiles = Get-ChildItem -Path $modelsPath -Recurse -File -ErrorAction SilentlyContinue
    if ($modelFiles.Count -gt 0) {
        Write-Host "   ✓ Model directory exists, contains $($modelFiles.Count) files" -ForegroundColor Green
    }
    else {
        Write-Host "   ⚠ Model directory exists but is empty" -ForegroundColor Yellow
    }
}
else {
    Write-Host "   ⚠ Model directory does not exist: $modelsPath" -ForegroundColor Yellow
    Write-Host "     Tip: Model files need to be downloaded and placed separately" -ForegroundColor Gray
}

Write-Host ""

# 7. Check port usage (optional)
Write-Host "7. Checking port usage..." -ForegroundColor Yellow
$ports = @(5000, 5004, 5006, 5008, 5009, 5010, 8081, 9001)
$occupiedPorts = @()

foreach ($port in $ports) {
    $connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($connection) {
        $occupiedPorts += $port
        Write-Host "   ⚠ Port $port is occupied" -ForegroundColor Yellow
    }
    else {
        Write-Host "   ✓ Port $port is available" -ForegroundColor Green
    }
}

if ($occupiedPorts.Count -gt 0) {
    Write-Host "   Tip: Occupied ports may need to stop related services or modify configuration" -ForegroundColor Gray
}

Write-Host ""

# Summary
Write-Host ("=" * 60) -ForegroundColor Gray
if ($allOk) {
    Write-Host "✓ Basic environment check passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Install project dependencies (if not installed)" -ForegroundColor White
    Write-Host "  2. Download and place model files (if needed)" -ForegroundColor White
    Write-Host "  3. Start services in order" -ForegroundColor White
    Write-Host ""
    Write-Host "Reference: scripts\README_STARTUP.md" -ForegroundColor Gray
}
else {
    Write-Host "✗ Environment check failed, please install missing environments first" -ForegroundColor Red
    Write-Host ""
    Write-Host "Required environments:" -ForegroundColor Yellow
    Write-Host "  - Rust/Cargo (Scheduler server, Node inference service)" -ForegroundColor White
    Write-Host "  - Node.js 18+ (Web client)" -ForegroundColor White
    Write-Host "  - Python 3.10+ (NMT service, TTS service)" -ForegroundColor White
    Write-Host ""
    Write-Host "Optional environments:" -ForegroundColor Yellow
    Write-Host "  - CUDA 12.1+ (GPU acceleration)" -ForegroundColor White
}
Write-Host ("=" * 60) -ForegroundColor Gray

if (-not $allOk) {
    exit 1
}

