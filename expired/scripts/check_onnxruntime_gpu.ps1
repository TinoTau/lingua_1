# Check ONNX Runtime GPU Installation
# This script verifies that GPU-enabled ONNX Runtime is properly installed

Write-Host "Checking ONNX Runtime GPU Installation..." -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nodeInferencePath = Join-Path $projectRoot "node-inference"

# Check for ONNX Runtime GPU DLLs
$nodeInferenceTarget = Join-Path $nodeInferencePath "target\release\build"
$onnxLibPath = $null

if (Test-Path $nodeInferenceTarget) {
    $ortBuildDirs = Get-ChildItem -Path $nodeInferenceTarget -Directory -Filter "ort-*" -ErrorAction SilentlyContinue
    foreach ($ortDir in $ortBuildDirs) {
        $possiblePaths = @(
            (Join-Path $ortDir.FullName "out\onnxruntime\onnxruntime-win-x64-gpu-1.16.0\lib"),
            (Join-Path $ortDir.FullName "out\onnxruntime\onnxruntime-win-x64-gpu-1.16.3\lib")
        )
        
        # Also check for any onnxruntime-win-x64-gpu-* directory
        $onnxRoot = Join-Path $ortDir.FullName "out\onnxruntime"
        if (Test-Path $onnxRoot) {
            $gpuDirs = Get-ChildItem -Path $onnxRoot -Directory -Filter "onnxruntime-win-x64-gpu-*" -ErrorAction SilentlyContinue
            foreach ($gpuDir in $gpuDirs) {
                $libPath = Join-Path $gpuDir.FullName "lib"
                if (Test-Path $libPath) {
                    $possiblePaths += $libPath
                }
            }
        }
        
        foreach ($path in $possiblePaths) {
            if ($path -and (Test-Path $path)) {
                $cudaProviderDll = Join-Path $path "onnxruntime_providers_cuda.dll"
                if (Test-Path $cudaProviderDll) {
                    $onnxLibPath = $path
                    break
                }
            }
        }
        if ($onnxLibPath) { break }
    }
}

if ($onnxLibPath) {
    Write-Host "[OK] Found ONNX Runtime GPU installation:" -ForegroundColor Green
    Write-Host "  Path: $onnxLibPath" -ForegroundColor Gray
    Write-Host ""
    
    # List DLLs
    $dlls = Get-ChildItem -Path $onnxLibPath -Filter "*.dll" -ErrorAction SilentlyContinue
    Write-Host "  DLLs found:" -ForegroundColor Gray
    foreach ($dll in $dlls) {
        $isGpu = $dll.Name -like "*cuda*" -or $dll.Name -like "*gpu*"
        $marker = if ($isGpu) { "[GPU]" } else { "      " }
        $color = if ($isGpu) { "Green" } else { "Gray" }
        Write-Host "    $marker $($dll.Name)" -ForegroundColor $color
    }
    Write-Host ""
    
    # Check if cuDNN is available
    $cudaPaths = @(
        "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4",
        "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1",
        "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
    )
    
    $cudnnFound = $false
    foreach ($cudaPath in $cudaPaths) {
        if (Test-Path $cudaPath) {
            $cudnnDll = Join-Path $cudaPath "bin\cudnn64_8.dll"
            if (Test-Path $cudnnDll) {
                Write-Host "[OK] cuDNN found: $cudnnDll" -ForegroundColor Green
                $cudnnFound = $true
                break
            }
        }
    }
    
    if (-not $cudnnFound) {
        Write-Host "[X] cuDNN not found in CUDA directory" -ForegroundColor Red
        Write-Host "  Run: .\scripts\install_cudnn_auto.ps1" -ForegroundColor Cyan
    }
    
    Write-Host ""
    Write-Host "To use GPU acceleration, ensure these paths are in PATH:" -ForegroundColor Cyan
    Write-Host "  1. ONNX Runtime lib: $onnxLibPath" -ForegroundColor White
    if ($cudnnFound) {
        $cudaBin = Split-Path -Parent (Get-ChildItem -Path "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v*\bin\cudnn64_8.dll" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
        Write-Host "  2. CUDA bin (with cuDNN): $cudaBin" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "The start_node_inference.ps1 script should automatically add these to PATH." -ForegroundColor Gray
}
else {
    Write-Host "[X] ONNX Runtime GPU installation not found" -ForegroundColor Red
    Write-Host ""
    Write-Host "To install, run:" -ForegroundColor Cyan
    Write-Host "  .\scripts\rebuild_node_inference_gpu.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "Or ensure Cargo.toml has:" -ForegroundColor Cyan
    Write-Host "  ort = { version = \"1.16.3\", default-features = false, features = [\"download-binaries\", \"cuda\"] }" -ForegroundColor White
}
