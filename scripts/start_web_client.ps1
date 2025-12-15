# Start Web Client
Write-Host "Starting Lingua Web Client..." -ForegroundColor Green

$ErrorActionPreference = "Stop"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$webClientPath = Join-Path $projectRoot "web-client"

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

# Check scheduler URL (can be configured via environment variable)
# Scheduler Service uses port 5010 (see start_scheduler.ps1 and README_STARTUP.md)
$schedulerUrl = if ($env:SCHEDULER_URL) { 
    $env:SCHEDULER_URL 
}
else { 
    "ws://localhost:5010/ws/session" 
}

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Scheduler URL: $schedulerUrl" -ForegroundColor Gray
Write-Host "  Dev Server: http://localhost:9001" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: If scheduler URL is different, set environment variable SCHEDULER_URL" -ForegroundColor Cyan
Write-Host '  Example: $env:SCHEDULER_URL = "ws://192.168.1.100:5010/ws/session"' -ForegroundColor Gray
Write-Host ""

# Check if port 9001 is already in use (before starting the service)
$requestedPort = 9001
$portInUse = Get-NetTCPConnection -LocalPort $requestedPort -ErrorAction SilentlyContinue

if ($portInUse) {
    $processId = $portInUse.OwningProcess
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        $processName = $process.ProcessName
        $processPath = $process.Path
        
        # Check if it's a Node.js process (likely the dev server)
        if ($processName -match "node" -or $processPath -match "nodejs|node\.exe") {
            Write-Host "Warning: Port $requestedPort is in use by Node.js process $processId" -ForegroundColor Yellow
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
            Write-Host "This port is required for the Web Client development server" -ForegroundColor Yellow
            Write-Host "Please stop the process using this port" -ForegroundColor Yellow
            Write-Host "  Process ID: $processId" -ForegroundColor Gray
            Write-Host "  Process Name: $processName" -ForegroundColor Gray
            if ($processPath) {
                Write-Host "  Process Path: $processPath" -ForegroundColor Gray
            }
            exit 1
        }
    }
}

Write-Host ""
Write-Host "Starting Web Client development server..." -ForegroundColor Green
Write-Host "Logs will be saved to: $logDir\web-client.log" -ForegroundColor Gray
Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
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
    } catch {
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

# 5MB 轮转
Rotate-LogFile -Path $logFile -MaxBytes 5242880

# 启动并为每行添加时间戳
if ($logFileLocked) {
    npm run dev 2>&1 | ForEach-Object { "$(Get-Date -Format o) $_" } | Tee-Object -FilePath $logFile
} else {
    npm run dev 2>&1 | ForEach-Object { "$(Get-Date -Format o) $_" } | Tee-Object -FilePath $logFile -Append
}

