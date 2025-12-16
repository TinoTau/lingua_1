# Test script to run inference-service.exe and capture errors
$ErrorActionPreference = "Continue"

Write-Host "Testing inference-service.exe startup..." -ForegroundColor Cyan

# Set working directory
$workingDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $workingDir

# Set environment variables
$env:MODELS_DIR = Join-Path $workingDir "models"
$env:INFERENCE_SERVICE_PORT = "5009"
$env:RUST_LOG = "info"

Write-Host "Working directory: $workingDir" -ForegroundColor Gray
Write-Host "MODELS_DIR: $env:MODELS_DIR" -ForegroundColor Gray
Write-Host "INFERENCE_SERVICE_PORT: $env:INFERENCE_SERVICE_PORT" -ForegroundColor Gray

# Check if executable exists
$exePath = Join-Path $workingDir "target\release\inference-service.exe"
if (-not (Test-Path $exePath)) {
    Write-Host "ERROR: Executable not found: $exePath" -ForegroundColor Red
    exit 1
}

Write-Host "Executable found: $exePath" -ForegroundColor Green

# Create logs directory if it doesn't exist
$logsDir = Join-Path $workingDir "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    Write-Host "Created logs directory: $logsDir" -ForegroundColor Gray
}

# Run the executable and capture output
Write-Host "`nStarting inference-service.exe..." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Gray

try {
    $process = Start-Process -FilePath $exePath -WorkingDirectory $workingDir -NoNewWindow -PassThru -RedirectStandardOutput "test_output.txt" -RedirectStandardError "test_error.txt"
    
    Write-Host "Process started with PID: $($process.Id)" -ForegroundColor Green
    
    # Wait a bit to see if it crashes immediately
    Start-Sleep -Seconds 2
    
    if ($process.HasExited) {
        Write-Host "`nERROR: Process exited immediately with code: $($process.ExitCode)" -ForegroundColor Red
        Write-Host "`nStandard Output:" -ForegroundColor Yellow
        if (Test-Path "test_output.txt") {
            Get-Content "test_output.txt"
        }
        else {
            Write-Host "(no output file)"
        }
        Write-Host "`nStandard Error:" -ForegroundColor Yellow
        if (Test-Path "test_error.txt") {
            Get-Content "test_error.txt"
        }
        else {
            Write-Host "(no error file)"
        }
        exit 1
    }
    else {
        Write-Host "Process is running. Waiting 5 seconds..." -ForegroundColor Green
        Start-Sleep -Seconds 5
        
        if ($process.HasExited) {
            Write-Host "`nProcess exited with code: $($process.ExitCode)" -ForegroundColor Yellow
        }
        else {
            Write-Host "Process is still running. Stopping..." -ForegroundColor Green
            Stop-Process -Id $process.Id -Force
        }
        
        Write-Host "`nStandard Output:" -ForegroundColor Yellow
        if (Test-Path "test_output.txt") {
            Get-Content "test_output.txt"
        }
        Write-Host "`nStandard Error:" -ForegroundColor Yellow
        if (Test-Path "test_error.txt") {
            Get-Content "test_error.txt"
        }
    }
}
catch {
    Write-Host "`nERROR: Failed to start process: $_" -ForegroundColor Red
    exit 1
}
