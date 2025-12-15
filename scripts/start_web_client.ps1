# Start Web Client
Write-Host "Starting Lingua Web Client..." -ForegroundColor Green

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$webClientPath = Join-Path $projectRoot "web-client"

# Switch to web client directory
Set-Location $webClientPath

# Check if Node.js is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Node.js not found, please install Node.js 18+" -ForegroundColor Red
    exit 1
}

# Check if npm is installed
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Error: npm not found, please install npm" -ForegroundColor Red
    exit 1
}

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "Dependencies not installed, installing..." -ForegroundColor Yellow
    npm install
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Dependency installation failed" -ForegroundColor Red
        exit 1
    }
}

# Check scheduler URL (can be configured via environment variable)
$schedulerUrl = if ($env:SCHEDULER_URL) { 
    $env:SCHEDULER_URL 
} else { 
    "ws://localhost:5010/ws/session" 
}

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Scheduler URL: $schedulerUrl" -ForegroundColor Gray
  Write-Host "  Dev Server: http://localhost:9001" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: If scheduler URL is different, set environment variable SCHEDULER_URL" -ForegroundColor Cyan
  Write-Host "  Example: `$env:SCHEDULER_URL='ws://192.168.1.100:5010/ws/session'`" -ForegroundColor Gray
Write-Host ""

# Start development server
Write-Host "Starting Web Client development server..." -ForegroundColor Green
npm run dev

