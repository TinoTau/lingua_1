# Start Scheduler Server
Write-Host "Starting Lingua Scheduler Server..." -ForegroundColor Green

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$schedulerPath = Join-Path $projectRoot "scheduler"

# Switch to scheduler directory
Set-Location $schedulerPath

# Create logs directory
$logDir = Join-Path $schedulerPath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
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
Write-Host "  Log Format: $env:LOG_FORMAT" -ForegroundColor Gray
Write-Host "  Service URL: http://localhost:5010" -ForegroundColor Gray
Write-Host "  WebSocket: ws://localhost:5010/ws/session" -ForegroundColor Gray
Write-Host "  Node Connection: ws://localhost:5010/ws/node" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: Set environment variable LOG_FORMAT=json to use JSON log format" -ForegroundColor Cyan
Write-Host ""

# Build and run
Write-Host "Building scheduler server..." -ForegroundColor Yellow
cargo build --release

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed" -ForegroundColor Red
    exit 1
}

Write-Host "Starting scheduler server..." -ForegroundColor Green
Write-Host "Logs will be saved to: $logDir\scheduler.log" -ForegroundColor Gray
Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
Write-Host ""
cargo run --release
