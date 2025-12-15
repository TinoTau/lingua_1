# Start Node Inference Service
Write-Host "Starting Node Inference Service..." -ForegroundColor Cyan

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$nodeInferencePath = Join-Path $projectRoot "node-inference"

# Set CUDA environment variables (if CUDA is installed)
# This is required for ONNX Runtime to use GPU for VAD
$cudaPaths = @(
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.1",
    "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"
)

$cudaFound = $false
$cudaPath = $null
foreach ($path in $cudaPaths) {
    if (Test-Path $path) {
        $cudaPath = $path
        $env:CUDA_PATH = $cudaPath
        $env:CUDAToolkit_ROOT = $cudaPath
        $env:CUDA_ROOT = $cudaPath
        $env:CUDA_HOME = $cudaPath
        $cudaBin = Join-Path $cudaPath "bin"
        $cudaLibnvvp = Join-Path $cudaPath "libnvvp"
        $cudaNvcc = Join-Path $cudaBin "nvcc.exe"
        $env:CMAKE_CUDA_COMPILER = $cudaNvcc
        $env:PATH = "$cudaBin;$cudaLibnvvp;$env:PATH"
        Write-Host "CUDA environment configured: $cudaPath" -ForegroundColor Green
        $cudaFound = $true
        break
    }
}

# Configure cuDNN paths (required for ONNX Runtime CUDA support)
if ($cudaFound) {
    # Check if cuDNN is in CUDA directory
    $cudnnInCuda = $false
    $cudnnBinPath = Join-Path $cudaPath "bin\cudnn64_*.dll"
    if (Test-Path $cudnnBinPath) {
        $cudnnInCuda = $true
        Write-Host "cuDNN found in CUDA directory" -ForegroundColor Green
    }
    else {
        # Check for cuDNN 9.x in separate directory (for CUDA 12.x)
        $cudnnPaths = @(
            "C:\Program Files\NVIDIA\CUDNN\v9.6",
            "C:\Program Files\NVIDIA GPU Computing Toolkit\cuDNN",
            "C:\cudnn",
            "$env:USERPROFILE\cudnn"
        )
        
        $cudnnFound = $false
        foreach ($cudnnPath in $cudnnPaths) {
            if (Test-Path $cudnnPath) {
                # Check for cuDNN 9.x structure (bin\12.6\ or bin\11.8\)
                $cudnnBin126 = Join-Path $cudnnPath "bin\12.6"
                $cudnnBin118 = Join-Path $cudnnPath "bin\11.8"
                $cudnnBin = Join-Path $cudnnPath "bin"
                
                # Prefer 12.6 for CUDA 12.x, fallback to 11.8 or direct bin
                if (Test-Path $cudnnBin126) {
                    $cudnnDll = Join-Path $cudnnBin126 "cudnn64_9.dll"
                    if (Test-Path $cudnnDll) {
                        $env:CUDNN_PATH = $cudnnPath
                        $env:PATH = "$cudnnBin126;$env:PATH"
                        Write-Host "cuDNN 9.x found and configured (CUDA 12.x): $cudnnBin126" -ForegroundColor Green
                        $cudnnFound = $true
                        break
                    }
                }
                elseif (Test-Path $cudnnBin118) {
                    $cudnnDll = Join-Path $cudnnBin118 "cudnn64_9.dll"
                    if (Test-Path $cudnnDll) {
                        $env:CUDNN_PATH = $cudnnPath
                        $env:PATH = "$cudnnBin118;$env:PATH"
                        Write-Host "cuDNN 9.x found and configured (CUDA 11.x): $cudnnBin118" -ForegroundColor Green
                        $cudnnFound = $true
                        break
                    }
                }
                elseif (Test-Path $cudnnBin) {
                    # Check for direct bin directory (cuDNN 8.x style)
                    $cudnnDll = Join-Path $cudnnBin "cudnn64_8.dll"
                    if (Test-Path $cudnnDll) {
                        $env:CUDNN_PATH = $cudnnPath
                        $env:PATH = "$cudnnBin;$env:PATH"
                        Write-Host "cuDNN 8.x found and configured: $cudnnPath" -ForegroundColor Green
                        $cudnnFound = $true
                        break
                    }
                }
            }
        }
        
        if (-not $cudnnFound) {
            Write-Host "Warning: cuDNN not found. ONNX Runtime GPU may not work." -ForegroundColor Yellow
        }
    }
    
    Write-Host "GPU acceleration will be enabled for VAD (ONNX Runtime)" -ForegroundColor Green
    
    # Set ORT_STRATEGY to ensure ort crate downloads GPU-enabled ONNX Runtime
    $env:ORT_STRATEGY = "download"
}
else {
    Write-Host "Warning: CUDA not found, VAD will use CPU" -ForegroundColor Yellow
}

# Set default environment variables if not set
$env:MODELS_DIR = if ($env:MODELS_DIR) { $env:MODELS_DIR } else { Join-Path $projectRoot "node-inference\models" }
$env:INFERENCE_SERVICE_PORT = if ($env:INFERENCE_SERVICE_PORT) { $env:INFERENCE_SERVICE_PORT } else { "5005" }
$env:NMT_SERVICE_URL = if ($env:NMT_SERVICE_URL) { $env:NMT_SERVICE_URL } else { "http://127.0.0.1:5004" }
$env:TTS_SERVICE_URL = if ($env:TTS_SERVICE_URL) { $env:TTS_SERVICE_URL } else { "http://127.0.0.1:5006" }
Write-Host "Environment Variables:" -ForegroundColor Yellow
Write-Host "  MODELS_DIR: $env:MODELS_DIR" -ForegroundColor Gray
Write-Host "  INFERENCE_SERVICE_PORT: $env:INFERENCE_SERVICE_PORT" -ForegroundColor Gray
Write-Host "  NMT_SERVICE_URL: $env:NMT_SERVICE_URL" -ForegroundColor Gray
Write-Host "  TTS_SERVICE_URL: $env:TTS_SERVICE_URL" -ForegroundColor Gray
Write-Host ""

# Check model directory
if (-not (Test-Path $env:MODELS_DIR)) {
    Write-Host "Warning: Model directory does not exist: $env:MODELS_DIR" -ForegroundColor Yellow
    Write-Host "Tip: Please ensure model files are properly placed" -ForegroundColor Gray
}

# Check and wait for dependent services
Write-Host "Checking dependent services..." -ForegroundColor Yellow
$nmtServiceUrl = $env:NMT_SERVICE_URL -replace "/$", ""
$ttsServiceUrl = $env:TTS_SERVICE_URL -replace "/tts$", ""

# Maximum wait time in seconds (default: 60 seconds)
$maxWaitTime = if ($env:WAIT_FOR_SERVICES_TIMEOUT) { [int]$env:WAIT_FOR_SERVICES_TIMEOUT } else { 60 }
$checkInterval = 2  # Check every 2 seconds
$startTime = Get-Date

# Function to check if a service is ready
function Test-ServiceReady {
    param([string]$ServiceUrl, [string]$ServiceName)

    try {
        $response = Invoke-WebRequest -Uri "$ServiceUrl/health" -Method Get -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

# Wait for NMT Service
$nmtReady = Test-ServiceReady -ServiceUrl $nmtServiceUrl -ServiceName "NMT"
if ($nmtReady) {
    Write-Host "  ✓ NMT Service is ready ($nmtServiceUrl)" -ForegroundColor Green
}
else {
    Write-Host "  ⏳ Waiting for NMT Service ($nmtServiceUrl)..." -ForegroundColor Yellow
    $elapsed = 0
    while (-not $nmtReady -and $elapsed -lt $maxWaitTime) {
        Start-Sleep -Seconds $checkInterval
        $elapsed = ((Get-Date) - $startTime).TotalSeconds
        $nmtReady = Test-ServiceReady -ServiceUrl $nmtServiceUrl -ServiceName "NMT"
        if (-not $nmtReady) {
            Write-Host "    Still waiting... (${elapsed}s / ${maxWaitTime}s)" -ForegroundColor Gray
        }
    }

    if ($nmtReady) {
        Write-Host "  ✓ NMT Service is ready ($nmtServiceUrl)" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ NMT Service is not ready after ${maxWaitTime}s ($nmtServiceUrl)" -ForegroundColor Red
        Write-Host "    Tip: Please start M2M100 NMT service first" -ForegroundColor Gray
        Write-Host "    You can set WAIT_FOR_SERVICES_TIMEOUT environment variable to change wait time" -ForegroundColor Gray
    }
}

# Wait for TTS Service
$ttsReady = Test-ServiceReady -ServiceUrl $ttsServiceUrl -ServiceName "TTS"
if ($ttsReady) {
    Write-Host "  ✓ TTS Service is ready ($ttsServiceUrl)" -ForegroundColor Green
}
else {
    Write-Host "  ⏳ Waiting for TTS Service ($ttsServiceUrl)..." -ForegroundColor Yellow
    $elapsed = 0
    while (-not $ttsReady -and $elapsed -lt $maxWaitTime) {
        Start-Sleep -Seconds $checkInterval
        $elapsed = ((Get-Date) - $startTime).TotalSeconds
        $ttsReady = Test-ServiceReady -ServiceUrl $ttsServiceUrl -ServiceName "TTS"
        if (-not $ttsReady) {
            Write-Host "    Still waiting... (${elapsed}s / ${maxWaitTime}s)" -ForegroundColor Gray
        }
    }

    if ($ttsReady) {
        Write-Host "  ✓ TTS Service is ready ($ttsServiceUrl)" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ TTS Service is not ready after ${maxWaitTime}s ($ttsServiceUrl)" -ForegroundColor Red
        Write-Host "    Tip: Please start Piper TTS service first" -ForegroundColor Gray
        Write-Host "    You can set WAIT_FOR_SERVICES_TIMEOUT environment variable to change wait time" -ForegroundColor Gray
    }
}

# Warn if services are not ready, but continue anyway
if (-not $nmtReady -or -not $ttsReady) {
    Write-Host ""
    Write-Host "Warning: Some dependent services are not ready. The service may not work correctly." -ForegroundColor Yellow
    Write-Host "Press Ctrl+C to cancel, or wait 5 seconds to continue anyway..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}

Write-Host ""
Write-Host "Starting Node Inference Service (port $env:INFERENCE_SERVICE_PORT)..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:$env:INFERENCE_SERVICE_PORT" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:$env:INFERENCE_SERVICE_PORT/health" -ForegroundColor Cyan
Write-Host ""

# Switch to service directory and start
Push-Location $nodeInferencePath
cargo run --release --bin inference-service
Pop-Location
