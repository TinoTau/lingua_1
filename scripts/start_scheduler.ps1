# Start Scheduler Server
Write-Host "Starting Lingua Scheduler Server..." -ForegroundColor Green

$ErrorActionPreference = "Stop"

# Get script directory - handle both direct execution and background job
$scriptPath = $MyInvocation.MyCommand.Path
if (-not $scriptPath) {
    # If running in background job, try alternative methods
    $scriptPath = $PSCommandPath
    if (-not $scriptPath) {
        # Last resort: use current location and search for script
        $scriptPath = Get-ChildItem -Path (Get-Location) -Filter "start_scheduler.ps1" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    }
}

if ($scriptPath) {
    $scriptDir = Split-Path -Parent $scriptPath
    $projectRoot = Split-Path -Parent $scriptDir
}
else {
    # Fallback: try to find project root from current location
    $currentPath = Get-Location
    $projectRoot = $currentPath.Path
    while ($projectRoot -and -not (Test-Path (Join-Path $projectRoot "central_server"))) {
        $parent = Split-Path -Parent $projectRoot
        if ($parent -eq $projectRoot) { break }  # Reached root
        $projectRoot = $parent
    }
}

if (-not $projectRoot -or -not (Test-Path (Join-Path $projectRoot "central_server"))) {
    Write-Host "Error: Cannot find project root directory" -ForegroundColor Red
    Write-Host "Current location: $(Get-Location)" -ForegroundColor Yellow
    exit 1
}

$schedulerPath = Join-Path (Join-Path $projectRoot "central_server") "scheduler"

if (-not (Test-Path $schedulerPath)) {
    Write-Host "Error: Scheduler directory not found: $schedulerPath" -ForegroundColor Red
    exit 1
}

# Switch to scheduler directory
Set-Location $schedulerPath | Out-Null

# Create logs directory
$logDir = Join-Path $schedulerPath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
}

# Ensure log file exists
$logFile = Join-Path $logDir "scheduler.log"
if (-not (Test-Path $logFile)) {
    New-Item -ItemType File -Path $logFile -Force | Out-Null
}

# Check if Rust is installed
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Rust/Cargo not found, please install Rust first" -ForegroundColor Red
    exit 1
}

# Check config file
if (-not (Test-Path "config.toml")) {
    Write-Host "Warning: config.toml not found, using default configuration" -ForegroundColor Yellow
}

# Set log format (pretty format for development)
$env:LOG_FORMAT = if ($env:LOG_FORMAT) { $env:LOG_FORMAT } else { "pretty" }

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Working Directory: $schedulerPath" -ForegroundColor Gray
Write-Host "  Log Format: $env:LOG_FORMAT" -ForegroundColor Gray
Write-Host "  Service URL: http://localhost:5010" -ForegroundColor Gray
Write-Host "  WebSocket: ws://localhost:5010/ws/session" -ForegroundColor Gray
Write-Host "  Node Connection: ws://localhost:5010/ws/node" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: Set environment variable LOG_FORMAT=json to use JSON log format" -ForegroundColor Cyan
Write-Host ""

# Build and run
Write-Host "Building scheduler server..." -ForegroundColor Yellow

try {
    cargo build --release
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed (exit code: $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Starting scheduler server..." -ForegroundColor Green
    Write-Host "Logs will be saved to: $logFile" -ForegroundColor Gray
    Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
    Write-Host ""
    
    cargo run --release
    
    # Check exit code
    # 0 = success
    # 0xc000013a (3221225786) = STATUS_CONTROL_C_EXIT (Ctrl+C interrupt, normal exit)
    # Other non-zero codes = actual errors
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and $exitCode -ne 3221225786) {
        Write-Host "Scheduler server failed (exit code: $exitCode)" -ForegroundColor Red
        exit 1
    }
    elseif ($exitCode -eq 3221225786) {
        Write-Host "Scheduler server stopped by user (Ctrl+C)" -ForegroundColor Yellow
        exit 0
    }
}
catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "Stack trace: $($_.ScriptStackTrace)" -ForegroundColor Yellow
    exit 1
}
