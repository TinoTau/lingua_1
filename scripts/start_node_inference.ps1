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

# Read port configurations from other service startup scripts to ensure consistency
# Note: Port 5005 was previously used by Piper TTS, but now Piper TTS uses port 5006
# - NMT Service uses port 5008 (see start_nmt_service.ps1 line 82-88)
# - TTS Service (Piper) uses port 5006 (see start_tts_service.ps1 line 99-110)
# - Node Inference Service uses port 5009 (see README_STARTUP.md line 76 and node-inference/src/main.rs line 75)

# Node Inference Service default port: 5009 (not 5005!)
# If environment variable is set to 5005 (old/incorrect value), override it
if ($env:INFERENCE_SERVICE_PORT -eq "5005") {
    Write-Host "Warning: INFERENCE_SERVICE_PORT is set to 5005 (old/incorrect value)" -ForegroundColor Yellow
    Write-Host "  Port 5005 was previously used by Piper TTS, but now Piper TTS uses port 5006" -ForegroundColor Gray
    Write-Host "  Node Inference Service should use port 5009. Overriding to 5009..." -ForegroundColor Yellow
    $env:INFERENCE_SERVICE_PORT = "5009"
}
elseif (-not $env:INFERENCE_SERVICE_PORT) {
    $env:INFERENCE_SERVICE_PORT = "5009"
}

# NMT Service default port: 5008
# If environment variable points to wrong port (e.g., 5004), override it
if ($env:NMT_SERVICE_URL -match ":5004") {
    Write-Host "Warning: NMT_SERVICE_URL points to port 5004 (YourTTS service port)" -ForegroundColor Yellow
    Write-Host "  NMT Service should use port 5008. Overriding to 5008..." -ForegroundColor Yellow
    $env:NMT_SERVICE_URL = "http://127.0.0.1:5008"
}
elseif (-not $env:NMT_SERVICE_URL) {
    $env:NMT_SERVICE_URL = "http://127.0.0.1:5008"
}

# TTS Service (Piper) default port: 5006
# If environment variable points to wrong port (e.g., 5005), override it
if ($env:TTS_SERVICE_URL -match ":5005") {
    Write-Host "Warning: TTS_SERVICE_URL points to port 5005 (old Piper TTS port)" -ForegroundColor Yellow
    Write-Host "  Piper TTS now uses port 5006. Overriding to 5006..." -ForegroundColor Yellow
    $env:TTS_SERVICE_URL = "http://127.0.0.1:5006"
}
elseif (-not $env:TTS_SERVICE_URL) {
    $env:TTS_SERVICE_URL = "http://127.0.0.1:5006"
}
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

# Create logs directory
$logDir = Join-Path $nodeInferencePath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
}

Write-Host "Logs will be saved to: $logDir\node-inference.log" -ForegroundColor Gray
Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
Write-Host ""

# Check if port is already in use (before starting the service)
$requestedPort = [int]$env:INFERENCE_SERVICE_PORT
$portInUse = Get-NetTCPConnection -LocalPort $requestedPort -ErrorAction SilentlyContinue

if ($portInUse) {
    $processId = $portInUse.OwningProcess
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        $processName = $process.ProcessName
        $processPath = $process.Path
        
        # Only try to terminate if it's our inference service
        if ($processName -match "inference-service" -or $processPath -match "inference-service|target\\release") {
            Write-Host "Warning: Port $requestedPort is in use by inference service process $processId" -ForegroundColor Yellow
            Write-Host "Attempting to terminate the process..." -ForegroundColor Yellow
            try {
                Stop-Process -Id $processId -Force -ErrorAction Stop
                Start-Sleep -Seconds 2
                $portStillInUse = Get-NetTCPConnection -LocalPort $requestedPort -ErrorAction SilentlyContinue
                if ($portStillInUse) {
                    Write-Host "Error: Port $requestedPort is still in use after terminating process" -ForegroundColor Red
                    Write-Host "Please manually terminate the process or wait a few seconds and try again" -ForegroundColor Yellow
                    exit 1
                } else {
                    Write-Host "Process terminated, port $requestedPort is now available" -ForegroundColor Green
                }
            } catch {
                Write-Host "Error: Failed to terminate process: $_" -ForegroundColor Red
                Write-Host "Please manually terminate the process using port $requestedPort" -ForegroundColor Yellow
                Write-Host "  Process ID: $processId" -ForegroundColor Gray
                Write-Host "  Process Name: $processName" -ForegroundColor Gray
                exit 1
            }
        } else {
            Write-Host "Error: Port $requestedPort is in use by process $processId ($processName)" -ForegroundColor Red
            Write-Host "This port is required for the Node Inference Service" -ForegroundColor Yellow
            Write-Host "Please stop the process using this port or change INFERENCE_SERVICE_PORT environment variable" -ForegroundColor Yellow
            Write-Host "  Process ID: $processId" -ForegroundColor Gray
            Write-Host "  Process Name: $processName" -ForegroundColor Gray
            if ($processPath) {
                Write-Host "  Process Path: $processPath" -ForegroundColor Gray
            }
            exit 1
        }
    } else {
        Write-Host "Error: Port $requestedPort is in use, but cannot identify the process" -ForegroundColor Red
        Write-Host "Please check what is using this port and stop it" -ForegroundColor Yellow
        Write-Host "You can use: Get-NetTCPConnection -LocalPort $requestedPort | Select-Object OwningProcess" -ForegroundColor Gray
        exit 1
    }
}

Write-Host "Service URL: http://127.0.0.1:$env:INFERENCE_SERVICE_PORT" -ForegroundColor Cyan
Write-Host "Health Check: http://127.0.0.1:$env:INFERENCE_SERVICE_PORT/health" -ForegroundColor Cyan
Write-Host ""

# Switch to service directory and start
Push-Location $nodeInferencePath
cargo run --release --bin inference-service
Pop-Location
