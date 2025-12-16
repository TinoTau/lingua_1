# Configure cuDNN 9.x for CUDA 12.4
# This script copies cuDNN 9.x DLLs to CUDA directory or configures PATH

Write-Host "Configuring cuDNN 9.x for CUDA 12.4..." -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# CUDA path
$cudaPath = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4"
$cudaBin = Join-Path $cudaPath "bin"

# cuDNN 9.6 path
$cudnnPath = "C:\Program Files\NVIDIA\CUDNN\v9.6"
$cudnnBin126 = Join-Path $cudnnPath "bin\12.6"

# Check if paths exist
if (-not (Test-Path $cudaPath)) {
    Write-Host "[X] CUDA 12.4 not found at: $cudaPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $cudnnBin126)) {
    Write-Host "[X] cuDNN 9.6 not found at: $cudnnBin126" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] CUDA 12.4 found: $cudaPath" -ForegroundColor Green
Write-Host "[OK] cuDNN 9.6 found: $cudnnBin126" -ForegroundColor Green
Write-Host ""

# Check if cuDNN 9.x DLLs are already in CUDA bin
$cudnn9Dll = Join-Path $cudaBin "cudnn64_9.dll"
if (Test-Path $cudnn9Dll) {
    Write-Host "[INFO] cuDNN 9.x DLLs already exist in CUDA bin directory" -ForegroundColor Yellow
    Write-Host "       No action needed. PATH will be configured automatically." -ForegroundColor Gray
}
else {
    Write-Host "Options:" -ForegroundColor Cyan
    Write-Host "  1. Copy cuDNN 9.x DLLs to CUDA bin directory (recommended)" -ForegroundColor White
    Write-Host "  2. Only configure PATH (DLLs stay in cuDNN directory)" -ForegroundColor White
    Write-Host ""
    
    # Try to read choice, but default to 1 if in non-interactive mode
    $choice = "1"
    try {
        $input = Read-Host "Choose option (1 or 2, default: 1)"
        if (-not [string]::IsNullOrWhiteSpace($input)) {
            $choice = $input
        }
    }
    catch {
        # Non-interactive mode, use default
        Write-Host "Non-interactive mode detected, using default option 1" -ForegroundColor Gray
    }
    
    if ($choice -eq "1") {
        Write-Host ""
        Write-Host "Copying cuDNN 9.x DLLs to CUDA bin directory..." -ForegroundColor Yellow
        
        # Copy all DLLs from cuDNN 9.6 bin\12.6 to CUDA bin
        $dlls = Get-ChildItem -Path $cudnnBin126 -Filter "*.dll"
        foreach ($dll in $dlls) {
            $destPath = Join-Path $cudaBin $dll.Name
            try {
                Copy-Item -Path $dll.FullName -Destination $destPath -Force
                Write-Host "  Copied: $($dll.Name)" -ForegroundColor Gray
            }
            catch {
                Write-Host "  [X] Failed to copy $($dll.Name): $_" -ForegroundColor Red
            }
        }
        
        Write-Host ""
        Write-Host "[OK] cuDNN 9.x DLLs copied to CUDA bin directory" -ForegroundColor Green
    }
    else {
        Write-Host ""
        Write-Host "[INFO] PATH will be configured in start scripts" -ForegroundColor Yellow
        Write-Host "       Make sure to run start_node_inference.ps1 to set PATH" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "=== Configuration Summary ===" -ForegroundColor Cyan
Write-Host "CUDA Path: $cudaPath" -ForegroundColor White
Write-Host "cuDNN Path: $cudnnPath" -ForegroundColor White
Write-Host "cuDNN Bin (12.6): $cudnnBin126" -ForegroundColor White
Write-Host ""
Write-Host "The start_node_inference.ps1 script will automatically configure PATH." -ForegroundColor Gray
Write-Host ""
