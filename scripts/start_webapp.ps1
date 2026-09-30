# Start Web App (Web Client)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Lingua Web Client" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$webClientPath = Join-Path (Join-Path $projectRoot "webapp") "web-client"

# Check if directory exists
if (-not (Test-Path $webClientPath)) {
    Write-Host "Error: Web client directory not found: $webClientPath" -ForegroundColor Red
    exit 1
}

# Switch to web client directory
Set-Location $webClientPath

# Create logs directory
$logDir = Join-Path $webClientPath "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Write-Host "Created logs directory: $logDir" -ForegroundColor Gray
}

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

# Web Client production path: Browser → API Gateway /v1/session → Scheduler
$gatewaySessionUrl = if ($env:VITE_GATEWAY_SESSION_URL) {
    $env:VITE_GATEWAY_SESSION_URL
}
else {
    "ws://127.0.0.1:8081/v1/session"
}

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Gateway Session URL: $gatewaySessionUrl" -ForegroundColor Gray
Write-Host "  Dev Server: http://localhost:9001" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: Override with VITE_GATEWAY_SESSION_URL (not direct Scheduler WS)" -ForegroundColor Cyan
Write-Host '  Example: $env:VITE_GATEWAY_SESSION_URL = "ws://192.168.1.100:8081/v1/session"' -ForegroundColor Gray
Write-Host '  Auth: $env:VITE_API_KEY = "<gateway api key>"' -ForegroundColor Gray
Write-Host ""

# Start dev server and redirect output to log file, but keep errors in console
$logFile = Join-Path $logDir "web-client.log"

# Check if log file is locked by another process
# If locked, create a new log file with timestamp
$logFileLocked = $false
if (Test-Path $logFile) {
    try {
        # Try to open the file for writing to check if it's locked
        $fileStream = [System.IO.File]::Open($logFile, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $fileStream.Close()
        $fileStream.Dispose()
    }
    catch {
        # File is locked by another process
        $logFileLocked = $true
        Write-Host "Warning: Log file is locked by another process, creating new log file with timestamp..." -ForegroundColor Yellow
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $logFile = Join-Path $logDir "web-client_$timestamp.log"
        Write-Host "Using log file: $logFile" -ForegroundColor Gray
        Write-Host ""
    }
}

# Start the dev server with logging
# Use append mode if using the default log file, otherwise create new file
function Rotate-LogFile {
    param([string]$Path, [int]$MaxBytes)
    if (Test-Path $Path) {
        $size = (Get-Item $Path).Length
        if ($size -ge $MaxBytes) {
            $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
            $newPath = "$Path.$timestamp"
            Move-Item -Path $Path -Destination $newPath -Force
        }
    }
}

# 5MB rotation
Rotate-LogFile -Path $logFile -MaxBytes 5242880

Write-Host ""
Write-Host "Starting Web Client development server..." -ForegroundColor Green
Write-Host "Logs will be saved to: $logFile" -ForegroundColor Gray
Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
Write-Host ""

# Set environment variable for Vite (Gateway-only product path)
$env:VITE_GATEWAY_SESSION_URL = $gatewaySessionUrl

# Start server and add timestamp to each line
if ($logFileLocked) {
    npm run dev 2>&1 | ForEach-Object { "$(Get-Date -Format 'o') $_" } | Tee-Object -FilePath $logFile
}
else {
    npm run dev 2>&1 | ForEach-Object { "$(Get-Date -Format 'o') $_" } | Tee-Object -FilePath $logFile -Append
}
