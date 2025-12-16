# Manual Installation Guide for ONNX Runtime GPU
# This script helps install ONNX Runtime GPU version for ort crate

Write-Host "ONNX Runtime GPU Installation Guide" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nodeInferencePath = Join-Path $projectRoot "node-inference"

Write-Host "For ort crate to use GPU-enabled ONNX Runtime, you have two options:" -ForegroundColor Yellow
Write-Host ""

Write-Host "Option 1: Let ort crate download automatically (Recommended)" -ForegroundColor Cyan
Write-Host "------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "1. Ensure Cargo.toml has: ort = { version = \"1.16.3\", default-features = false, features = [\"download-binaries\", \"cuda\"] }" -ForegroundColor White
Write-Host "2. Set environment variable: ORT_STRATEGY=download" -ForegroundColor White
Write-Host "3. Clean and rebuild:" -ForegroundColor White
Write-Host "   cd node-inference" -ForegroundColor Gray
Write-Host "   cargo clean" -ForegroundColor Gray
Write-Host "   cargo build --release" -ForegroundColor Gray
Write-Host ""

Write-Host "Option 2: Manual installation (If automatic download doesn't work)" -ForegroundColor Cyan
Write-Host "-------------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "1. Download ONNX Runtime GPU from:" -ForegroundColor White
Write-Host "   https://github.com/microsoft/onnxruntime/releases" -ForegroundColor Yellow
Write-Host "   Look for: onnxruntime-win-x64-gpu-1.16.0.zip (or compatible version)" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Extract to a directory, e.g.: C:\onnxruntime-gpu" -ForegroundColor White
Write-Host ""
Write-Host "3. Set environment variables:" -ForegroundColor White
Write-Host "   `$env:ORT_STRATEGY = 'system'" -ForegroundColor Gray
Write-Host "   `$env:ORT_LIB_LOCATION = 'C:\onnxruntime-gpu\lib'" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Add ONNX Runtime DLLs to PATH:" -ForegroundColor White
Write-Host "   `$env:PATH = 'C:\onnxruntime-gpu\lib;' + `$env:PATH" -ForegroundColor Gray
Write-Host ""

# Check current ort configuration
Write-Host "Checking current ort crate configuration..." -ForegroundColor Yellow
$cargoToml = Join-Path $nodeInferencePath "Cargo.toml"
if (Test-Path $cargoToml) {
    $content = Get-Content $cargoToml -Raw
    if ($content -match 'ort\s*=\s*\{[^}]*\}') {
        $ortConfig = $matches[0]
        Write-Host "Current ort configuration:" -ForegroundColor Gray
        Write-Host $ortConfig -ForegroundColor DarkGray
        Write-Host ""
        
        if ($ortConfig -match 'features\s*=\s*\[([^\]]+)\]') {
            $features = $matches[1]
            if ($features -match 'cuda') {
                Write-Host "✓ CUDA feature is enabled" -ForegroundColor Green
            }
            else {
                Write-Host "✗ CUDA feature is NOT enabled" -ForegroundColor Red
            }
            if ($features -match 'download-binaries') {
                Write-Host "✓ download-binaries feature is enabled" -ForegroundColor Green
            }
            else {
                Write-Host "✗ download-binaries feature is NOT enabled" -ForegroundColor Red
            }
        }
    }
}

Write-Host ""
Write-Host "Checking for downloaded ONNX Runtime binaries..." -ForegroundColor Yellow

# Check common locations
$possibleLocations = @(
    "$env:USERPROFILE\.cargo\registry\cache",
    "$env:LOCALAPPDATA\ort",
    "$env:USERPROFILE\.cargo\registry\src",
    "node-inference\target"
)

$found = $false
foreach ($location in $possibleLocations) {
    if (Test-Path $location) {
        $onnxFiles = Get-ChildItem -Path $location -Recurse -Filter "*onnxruntime*.dll" -ErrorAction SilentlyContinue | Select-Object -First 3
        if ($onnxFiles) {
            Write-Host "Found ONNX Runtime DLLs in: $location" -ForegroundColor Green
            foreach ($file in $onnxFiles) {
                Write-Host "  - $($file.Name)" -ForegroundColor Gray
                # Check if it's GPU version by filename
                if ($file.Name -like "*gpu*") {
                    Write-Host "    ✓ Appears to be GPU version" -ForegroundColor Green
                    $found = $true
                }
                else {
                    Write-Host "    ⚠ May be CPU version" -ForegroundColor Yellow
                }
            }
        }
    }
}

if (-not $found) {
    Write-Host "No ONNX Runtime binaries found in common locations." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Recommendation: Run the rebuild script to download GPU version:" -ForegroundColor Cyan
    Write-Host "  .\scripts\rebuild_node_inference_gpu.ps1" -ForegroundColor White
}

Write-Host ""
Write-Host "To verify GPU support after installation, check the service logs for:" -ForegroundColor Cyan
Write-Host "  - 'Silero VAD: Using CUDA GPU acceleration' (success)" -ForegroundColor Green
Write-Host "  - 'CUDA execution provider is not enabled in this build' (failure)" -ForegroundColor Red
Write-Host ""
