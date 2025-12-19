# Start All Services with Separate Terminals
# This script starts Redis (if not running), Scheduler, and Model Hub each in its own terminal window

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting Lingua Central Server Services" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# ============================================
# Step 1: Check and Start Redis (if needed)
# ============================================

Write-Host "Checking Redis status..." -ForegroundColor Yellow

$redisRunning = $false
try {
    $result = redis-cli ping 2>&1
    if ($result -eq "PONG") {
        $redisRunning = $true
        Write-Host "  Redis is already running" -ForegroundColor Green
    }
}
catch {
    # redis-cli not found or Redis not running
}

if (-not $redisRunning) {
    Write-Host "  Redis is not running. Attempting to start..." -ForegroundColor Yellow
    
    # Try Docker first (most common case)
    $dockerAvailable = $false
    try {
        docker --version | Out-Null
        $dockerAvailable = $true
    }
    catch {
        # Docker not available
    }
    
    if ($dockerAvailable) {
        Write-Host "  Checking for existing Redis container..." -ForegroundColor Gray
        $existingContainer = docker ps -a --filter "name=redis-lingua" --format "{{.Names}}" 2>&1 | Where-Object { $_ -eq "redis-lingua" }
        if ($existingContainer) {
            # Check if already running
            $runningContainer = docker ps --filter "name=redis-lingua" --format "{{.Names}}" 2>&1 | Where-Object { $_ -eq "redis-lingua" }
            if ($runningContainer) {
                Write-Host "  Redis container is already running" -ForegroundColor Green
            }
            else {
                Write-Host "  Starting existing Redis container..." -ForegroundColor Yellow
                docker start redis-lingua 2>&1 | Out-Null
            }
        }
        else {
            Write-Host "  Creating and starting Redis container in Docker..." -ForegroundColor Yellow
            docker run -d --name redis-lingua -p 6379:6379 redis:latest 2>&1 | Out-Null
        }
        
        Start-Sleep -Seconds 2
        
        # Wait for Redis to be ready
        $maxAttempts = 10
        $attempt = 0
        $redisReady = $false
        while ($attempt -lt $maxAttempts -and -not $redisReady) {
            Start-Sleep -Seconds 1
            try {
                $result = redis-cli ping 2>&1
                if ($result -eq "PONG") {
                    $redisReady = $true
                    Write-Host "  Redis is now running (Docker)" -ForegroundColor Green
                }
            }
            catch {
                # Still not ready
            }
            $attempt++
        }
        
        if ($redisReady) {
            # Success
        }
        else {
            Write-Host "  Warning: Redis Docker container started but may not be ready yet" -ForegroundColor Yellow
        }
    }
    else {
        # Try to find redis-server executable
        $redisServer = $null
        $possiblePaths = @(
            "redis-server",
            "C:\Program Files\Redis\redis-server.exe",
            "C:\redis\redis-server.exe",
            "$env:ProgramFiles\Redis\redis-server.exe"
        )
        
        foreach ($path in $possiblePaths) {
            if (Get-Command $path -ErrorAction SilentlyContinue) {
                $redisServer = $path
                break
            }
        }
        
        if ($redisServer) {
            Write-Host "  Starting Redis server in new window..." -ForegroundColor Yellow
            $redisCommand = "Write-Host 'Redis Server (Port 6379)' -ForegroundColor Cyan; Write-Host '========================================' -ForegroundColor Cyan; Write-Host ''; & '$redisServer'; Write-Host ''; Write-Host 'Redis server stopped. Press any key to close...' -ForegroundColor Yellow; `$null = `$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')"
            Start-Process powershell -ArgumentList "-NoExit", "-Command", $redisCommand
            Start-Sleep -Seconds 3
            
            # Wait for Redis to be ready
            $maxAttempts = 10
            $attempt = 0
            $redisReady = $false
            while ($attempt -lt $maxAttempts -and -not $redisReady) {
                Start-Sleep -Seconds 1
                try {
                    $result = redis-cli ping 2>&1
                    if ($result -eq "PONG") {
                        $redisReady = $true
                        Write-Host "  Redis is now running" -ForegroundColor Green
                    }
                }
                catch {
                    # Still not ready
                }
                $attempt++
            }
            
            if (-not $redisReady) {
                Write-Host "  Warning: Redis may not be ready yet, but continuing..." -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "  Warning: Redis not found. Please start Redis manually:" -ForegroundColor Yellow
            Write-Host "    - Install Redis: https://redis.io/download" -ForegroundColor Gray
            Write-Host "    - Or use Docker: docker run -d --name redis-lingua -p 6379:6379 redis:latest" -ForegroundColor Gray
            Write-Host "  Continuing without Redis (Phase2 will not work if enabled)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""

# ============================================
# Step 2: Start Model Hub in New Terminal
# ============================================

Write-Host "Starting Model Hub in new terminal..." -ForegroundColor Yellow

$modelHubScript = Join-Path $scriptDir "start_model_hub.ps1"
if (Test-Path $modelHubScript) {
    $modelHubCommand = "Write-Host 'Model Hub Service (Port 5000)' -ForegroundColor Cyan; Write-Host '========================================' -ForegroundColor Cyan; Write-Host ''; cd '$projectRoot'; & '$modelHubScript'; Write-Host ''; Write-Host 'Model Hub stopped. Press any key to close...' -ForegroundColor Yellow; `$null = `$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $modelHubCommand
    
    Write-Host "  Model Hub terminal opened" -ForegroundColor Green
    Start-Sleep -Seconds 2
}
else {
    Write-Host "  Error: Model Hub startup script not found: $modelHubScript" -ForegroundColor Red
}

Write-Host ""

# ============================================
# Step 3: Start Scheduler in New Terminal
# ============================================

Write-Host "Starting Scheduler in new terminal..." -ForegroundColor Yellow

$schedulerScript = Join-Path $scriptDir "start_scheduler.ps1"
if (Test-Path $schedulerScript) {
    $schedulerCommand = "Write-Host 'Scheduler Service (Port 5010)' -ForegroundColor Cyan; Write-Host '========================================' -ForegroundColor Cyan; Write-Host ''; cd '$projectRoot'; & '$schedulerScript'; Write-Host ''; Write-Host 'Scheduler stopped. Press any key to close...' -ForegroundColor Yellow; `$null = `$Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $schedulerCommand
    
    Write-Host "  Scheduler terminal opened" -ForegroundColor Green
    Start-Sleep -Seconds 2
}
else {
    Write-Host "  Error: Scheduler startup script not found: $schedulerScript" -ForegroundColor Red
}

Write-Host ""

# ============================================
# Summary
# ============================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Service Startup Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Services started in separate terminal windows:" -ForegroundColor Yellow
Write-Host "  - Redis:       redis://127.0.0.1:6379" -ForegroundColor Gray
Write-Host "  - Model Hub:   http://localhost:5000" -ForegroundColor Gray
Write-Host "  - Scheduler:   http://localhost:5010" -ForegroundColor Gray
Write-Host ""
Write-Host "Tips:" -ForegroundColor Cyan
Write-Host "  - Each service runs in its own terminal window" -ForegroundColor Gray
Write-Host "  - Close the terminal windows to stop the services" -ForegroundColor Gray
Write-Host "  - Check service health:" -ForegroundColor Gray
Write-Host "      curl http://localhost:5000/health  # Model Hub" -ForegroundColor DarkGray
Write-Host "      curl http://localhost:5010/health  # Scheduler" -ForegroundColor DarkGray
Write-Host "      redis-cli ping                     # Redis" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Press any key to exit this script (services will continue running)..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')

