# Install and Configure cuDNN for ONNX Runtime CUDA Support
# This script helps set up cuDNN for GPU acceleration with ONNX Runtime

Write-Host "cuDNN Installation and Configuration Guide" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Check for CUDA installation
$cudaPaths = @(
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
)

$cudaPath = $null
$cudaVersion = $null

foreach ($path in $cudaPaths) {
    if (Test-Path $path) {
        $cudaPath = $path
        if ($path -match "v(\d+\.\d+)") {
            $cudaVersion = $matches[1]
        }
        break
    }
}

if (-not $cudaPath) {
    Write-Host "Error: CUDA not found. Please install CUDA first." -ForegroundColor Red
    Write-Host "Download: https://developer.nvidia.com/cuda-downloads" -ForegroundColor Yellow
    exit 1
}

Write-Host "Found CUDA installation: $cudaPath (Version: $cudaVersion)" -ForegroundColor Green
Write-Host ""

# Check if cuDNN is already installed
$cudnnBinPath = Join-Path $cudaPath "bin\cudnn64_*.dll"
$cudnnLibPath = Join-Path $cudaPath "lib\x64\cudnn*.lib"
$cudnnIncludePath = Join-Path $cudaPath "include\cudnn.h"

$cudnnInstalled = $false
if ((Test-Path $cudnnBinPath) -or (Test-Path $cudnnLibPath) -or (Test-Path $cudnnIncludePath)) {
    Write-Host "cuDNN appears to be already installed in CUDA directory" -ForegroundColor Green
    $cudnnInstalled = $true
}

# Check for cuDNN in separate directory
$cudnnPaths = @(
    "C:\Program Files\NVIDIA GPU Computing Toolkit\cuDNN",
    "C:\cudnn",
    "$env:USERPROFILE\cudnn"
)

$cudnnPath = $null
foreach ($path in $cudnnPaths) {
    if (Test-Path $path) {
        $binPath = Join-Path $path "bin"
        $libPath = Join-Path $path "lib"
        $includePath = Join-Path $path "include"
        if ((Test-Path $binPath) -and (Test-Path $libPath) -and (Test-Path $includePath)) {
            $cudnnPath = $path
            Write-Host "Found cuDNN installation: $cudnnPath" -ForegroundColor Green
            $cudnnInstalled = $true
            break
        }
    }
}

if (-not $cudnnInstalled) {
    Write-Host "cuDNN is not installed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To install cuDNN:" -ForegroundColor Cyan
    Write-Host "1. Download cuDNN from: https://developer.nvidia.com/cudnn" -ForegroundColor White
    Write-Host "   (Requires NVIDIA Developer account - free to register)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. For CUDA $cudaVersion, download the compatible cuDNN version:" -ForegroundColor White
    if ($cudaVersion -eq "12.4" -or $cudaVersion -eq "12.1") {
        Write-Host "   - cuDNN 8.9.x for CUDA 12.x" -ForegroundColor Yellow
    }
    elseif ($cudaVersion -eq "11.8") {
        Write-Host "   - cuDNN 8.7.x or 8.9.x for CUDA 11.8" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "3. Extract the cuDNN archive and copy files to CUDA directory:" -ForegroundColor White
    Write-Host "   - Copy bin\*.dll to: $cudaPath\bin" -ForegroundColor Gray
    Write-Host "   - Copy lib\x64\*.lib to: $cudaPath\lib\x64" -ForegroundColor Gray
    Write-Host "   - Copy include\*.h to: $cudaPath\include" -ForegroundColor Gray
    Write-Host ""
    Write-Host "   OR extract to a separate directory and set CUDNN_PATH environment variable" -ForegroundColor Gray
    Write-Host ""
    Write-Host "4. After installation, run this script again to verify" -ForegroundColor White
    Write-Host ""
    Write-Host "Alternative: If you prefer manual installation, you can:" -ForegroundColor Cyan
    Write-Host "  - Extract cuDNN to: C:\cudnn" -ForegroundColor White
    Write-Host "  - This script will detect it and configure paths automatically" -ForegroundColor Gray
    Write-Host ""
    
    # Try to prompt user, but continue automatically if in non-interactive mode
    try {
        $response = Read-Host "Do you want to continue and check again after manual installation? (Y/N)"
        if ($response -ne "Y" -and $response -ne "y") {
            exit 0
        }
    }
    catch {
        Write-Host "Non-interactive mode: Exiting..." -ForegroundColor Cyan
    }
    
    Write-Host ""
    Write-Host "Please install cuDNN manually and run this script again." -ForegroundColor Yellow
    exit 0
}

# Configure cuDNN paths
Write-Host ""
Write-Host "Configuring cuDNN paths..." -ForegroundColor Yellow

if ($cudnnPath) {
    # cuDNN in separate directory
    $cudnnBin = Join-Path $cudnnPath "bin"
    $cudnnLib = Join-Path $cudnnPath "lib\x64"
    
    # Add to PATH
    if ($env:PATH -notlike "*$cudnnBin*") {
        $env:PATH = "$cudnnBin;$env:PATH"
        Write-Host "  Added cuDNN bin to PATH: $cudnnBin" -ForegroundColor Green
    }
    
    # Set CUDNN_PATH
    $env:CUDNN_PATH = $cudnnPath
    Write-Host "  Set CUDNN_PATH: $cudnnPath" -ForegroundColor Green
}
else {
    # cuDNN in CUDA directory
    $cudnnBin = Join-Path $cudaPath "bin"
    $cudnnLib = Join-Path $cudaPath "lib\x64"
    
    # CUDA bin should already be in PATH
    Write-Host "  cuDNN is in CUDA directory, using CUDA paths" -ForegroundColor Green
    Write-Host "  CUDA bin: $cudnnBin" -ForegroundColor Gray
    Write-Host "  CUDA lib: $cudnnLib" -ForegroundColor Gray
}

# Verify cuDNN DLLs
Write-Host ""
Write-Host "Verifying cuDNN installation..." -ForegroundColor Yellow

$cudnnDlls = @(
    "cudnn64_8.dll",
    "cudnn_ops_infer64_8.dll",
    "cudnn_cnn_infer64_8.dll"
)

$allFound = $true
foreach ($dll in $cudnnDlls) {
    $dllPath = Join-Path $cudnnBin $dll
    if (Test-Path $dllPath) {
        Write-Host "  ✓ Found: $dll" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ Missing: $dll" -ForegroundColor Red
        $allFound = $false
    }
}

if ($allFound) {
    Write-Host ""
    Write-Host "cuDNN is properly installed and configured!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Note: These environment variables are set for this session only." -ForegroundColor Yellow
    Write-Host "To make them permanent, add to system PATH or set in startup scripts." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The start_node_inference.ps1 script will automatically configure cuDNN paths." -ForegroundColor Cyan
}
else {
    Write-Host ""
    Write-Host "Warning: Some cuDNN DLLs are missing. ONNX Runtime CUDA may not work correctly." -ForegroundColor Yellow
    Write-Host "Please ensure all cuDNN files are properly installed." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Configuration Summary:" -ForegroundColor Cyan
Write-Host "  CUDA Path: $cudaPath" -ForegroundColor Gray
if ($cudnnPath) {
    Write-Host "  cuDNN Path: $cudnnPath" -ForegroundColor Gray
}
else {
    Write-Host "  cuDNN Path: $cudaPath (integrated)" -ForegroundColor Gray
}
Write-Host "  cuDNN Bin: $cudnnBin" -ForegroundColor Gray
Write-Host "  cuDNN Lib: $cudnnLib" -ForegroundColor Gray
Write-Host ""
