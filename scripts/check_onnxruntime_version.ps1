# Check ONNX Runtime Version and Compatibility
# This script checks the current ONNX Runtime version and provides recommendations

Write-Host "Checking ONNX Runtime Version and CUDA Compatibility..." -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nodeInferencePath = Join-Path $projectRoot "node-inference"

# Check current CUDA version
$cudaPath = $null
$cudaPaths = @(
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
)

foreach ($path in $cudaPaths) {
    if (Test-Path $path) {
        $cudaPath = $path
        $cudaVersion = Split-Path -Leaf $path
        Write-Host "[OK] Found CUDA: $cudaVersion" -ForegroundColor Green
        break
    }
}

if (-not $cudaPath) {
    Write-Host "[X] CUDA not found" -ForegroundColor Red
    exit 1
}

# Check cuDNN version
$cudnnDll = Join-Path $cudaPath "bin\cudnn64_8.dll"
if (Test-Path $cudnnDll) {
    Write-Host "[OK] Found cuDNN 8.x in CUDA directory" -ForegroundColor Green
    $cudnnVersion = "8.x"
}
else {
    Write-Host "[X] cuDNN not found" -ForegroundColor Red
    exit 1
}

# Check current ONNX Runtime version
$onnxRuntimePath = Get-ChildItem -Path "$nodeInferencePath\target\release\build\ort-*\out\onnxruntime\onnxruntime-win-x64-gpu-*" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1

if ($onnxRuntimePath) {
    $onnxVersion = $onnxRuntimePath.Name -replace "onnxruntime-win-x64-gpu-", ""
    Write-Host "[INFO] Current ONNX Runtime version: $onnxVersion" -ForegroundColor Yellow
}
else {
    Write-Host "[X] ONNX Runtime not found in build directory" -ForegroundColor Red
    Write-Host "    Run: .\scripts\rebuild_node_inference_gpu.ps1" -ForegroundColor Cyan
    exit 1
}

# Check ort crate version
$cargoToml = Join-Path $nodeInferencePath "Cargo.toml"
if (Test-Path $cargoToml) {
    $ortLine = Select-String -Path $cargoToml -Pattern 'ort = \{' -Context 0, 1
    if ($ortLine) {
        $ortVersion = ($ortLine.Line -split '"')[1]
        Write-Host "[INFO] Current ort crate version: $ortVersion" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== Compatibility Analysis ===" -ForegroundColor Cyan
Write-Host ""

# ONNX Runtime 1.16 compatibility
if ($onnxVersion -like "1.16.*") {
    Write-Host "[X] ONNX Runtime 1.16.x does NOT support CUDA 12.4" -ForegroundColor Red
    Write-Host "    Supported CUDA versions: 11.6 - 11.8" -ForegroundColor Gray
    Write-Host ""
    Write-Host "=== Recommendation ===" -ForegroundColor Yellow
    Write-Host "Upgrade to ort crate 1.17.0 or higher for CUDA 12.x support" -ForegroundColor Green
    Write-Host ""
    Write-Host "For cuDNN 8.x (your current setup):" -ForegroundColor Cyan
    Write-Host "  - ort 1.17.0 → ONNX Runtime 1.17.x (CUDA 12.x, cuDNN 8.x)" -ForegroundColor White
    Write-Host "  - ort 1.18.0 → ONNX Runtime 1.18.0 (CUDA 12.x, cuDNN 8.x)" -ForegroundColor White
    Write-Host ""
    Write-Host "For cuDNN 9.x (if you upgrade cuDNN):" -ForegroundColor Cyan
    Write-Host "  - ort 1.18.1+ → ONNX Runtime 1.18.1+ (CUDA 12.x, cuDNN 9.x)" -ForegroundColor White
    Write-Host "  - ort 1.19+ → ONNX Runtime 1.19+ (CUDA 12.x, cuDNN 9.x)" -ForegroundColor White
    Write-Host ""
    Write-Host "To upgrade, edit node-inference/Cargo.toml:" -ForegroundColor Cyan
    Write-Host '  Change: ort = { version = "1.16.3", ... }' -ForegroundColor Gray
    Write-Host '  To:     ort = { version = "1.17.0", default-features = false, features = ["download-binaries", "cuda"] }' -ForegroundColor Green
    Write-Host ""
    Write-Host "Then rebuild:" -ForegroundColor Cyan
    Write-Host "  .\scripts\rebuild_node_inference_gpu.ps1" -ForegroundColor White
}
elseif ($onnxVersion -like "1.17.*" -or $onnxVersion -like "1.18.0") {
    Write-Host "[OK] ONNX Runtime $onnxVersion supports CUDA 12.x with cuDNN 8.x" -ForegroundColor Green
    Write-Host "    Your setup should work correctly!" -ForegroundColor Green
}
elseif ($onnxVersion -like "1.18.1*" -or $onnxVersion -like "1.19.*") {
    Write-Host "[WARN] ONNX Runtime $onnxVersion requires cuDNN 9.x" -ForegroundColor Yellow
    Write-Host "    You have cuDNN 8.x installed" -ForegroundColor Yellow
    Write-Host "    Consider upgrading cuDNN to 9.x or downgrading to ONNX Runtime 1.18.0" -ForegroundColor Yellow
}
else {
    Write-Host "[INFO] ONNX Runtime $onnxVersion detected" -ForegroundColor Yellow
    Write-Host "    Please verify CUDA 12.4 compatibility" -ForegroundColor Yellow
}
