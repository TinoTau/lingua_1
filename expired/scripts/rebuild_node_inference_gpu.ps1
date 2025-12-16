# Rebuild Node Inference Service with GPU-enabled ONNX Runtime
# This script ensures ort crate downloads and uses GPU version of ONNX Runtime

Write-Host "Rebuilding Node Inference Service with GPU Support..." -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nodeInferencePath = Join-Path $projectRoot "node-inference"

# Set CUDA environment variables
$cudaPaths = @(
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
)

$cudaPath = $null
foreach ($path in $cudaPaths) {
    if (Test-Path $path) {
        $cudaPath = $path
        $env:CUDA_PATH = $cudaPath
        $env:CUDAToolkit_ROOT = $cudaPath
        $env:CUDA_ROOT = $cudaPath
        $env:CUDA_HOME = $cudaPath
        $cudaBin = Join-Path $cudaPath "bin"
        $env:PATH = "$cudaBin;$env:PATH"
        Write-Host "CUDA environment configured: $cudaPath" -ForegroundColor Green
        break
    }
}

if (-not $cudaPath) {
    Write-Host "Warning: CUDA not found. GPU support may not work." -ForegroundColor Yellow
}

# Set ORT_STRATEGY to download GPU-enabled ONNX Runtime
$env:ORT_STRATEGY = "download"
Write-Host "ORT_STRATEGY set to: download" -ForegroundColor Green
Write-Host ""

# Switch to node-inference directory
Set-Location $nodeInferencePath

# Clean previous build
Write-Host "Cleaning previous build..." -ForegroundColor Yellow
cargo clean
Write-Host ""

# Build with release profile
Write-Host "Building with GPU support (this may take several minutes)..." -ForegroundColor Yellow
Write-Host "The ort crate will download GPU-enabled ONNX Runtime binaries..." -ForegroundColor Gray
Write-Host ""

cargo build --release

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ Build completed successfully!" -ForegroundColor Green
    Write-Host "ONNX Runtime GPU version should now be available." -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now start the service with:" -ForegroundColor Cyan
    Write-Host "  .\scripts\start_node_inference.ps1" -ForegroundColor White
}
else {
    Write-Host ""
    Write-Host "✗ Build failed. Please check the error messages above." -ForegroundColor Red
    exit 1
}
