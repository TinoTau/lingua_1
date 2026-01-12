# Check and start Redis for Scheduler Phase2

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Redis Setup for Scheduler Phase2" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Method 1: Check Docker
Write-Host "Checking Docker..." -ForegroundColor Yellow
$dockerRunning = $false
try {
    $dockerCheck = docker ps 2>&1
    if ($LASTEXITCODE -eq 0) {
        $dockerRunning = $true
        Write-Host "  Docker is running" -ForegroundColor Green
    }
}
catch {
    # Docker not running
}

if (-not $dockerRunning) {
    Write-Host "  Docker Desktop is not running" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please start Docker Desktop first:" -ForegroundColor Yellow
    Write-Host "  1. Open Docker Desktop application" -ForegroundColor Gray
    Write-Host "  2. Wait for it to fully start (system tray icon should be steady)" -ForegroundColor Gray
    Write-Host "  3. Then run this script again" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Or install Redis locally:" -ForegroundColor Yellow
    Write-Host "  - Download from: https://github.com/microsoftarchive/redis/releases" -ForegroundColor Gray
    Write-Host "  - Or use WSL: wsl redis-server" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

# Method 2: Check if Redis container exists
Write-Host "Checking Redis container..." -ForegroundColor Yellow
$existingContainer = docker ps -a --filter "name=redis-lingua" --format "{{.Names}}" 2>&1 | Where-Object { $_ -eq "redis-lingua" }

if ($existingContainer) {
    $runningContainer = docker ps --filter "name=redis-lingua" --format "{{.Names}}" 2>&1 | Where-Object { $_ -eq "redis-lingua" }
    if ($runningContainer) {
        Write-Host "  Redis container is already running" -ForegroundColor Green
    }
    else {
        Write-Host "  Starting existing Redis container..." -ForegroundColor Yellow
        docker start redis-lingua
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Redis container started successfully" -ForegroundColor Green
        }
        else {
            Write-Host "  Failed to start Redis container" -ForegroundColor Red
            exit 1
        }
    }
}
else {
    Write-Host "  Creating new Redis container..." -ForegroundColor Yellow
    docker run -d --name redis-lingua -p 6379:6379 redis:latest
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Redis container created and started" -ForegroundColor Green
    }
    else {
        Write-Host "  Failed to create Redis container" -ForegroundColor Red
        exit 1
    }
}

# Wait for Redis to be ready
Write-Host ""
Write-Host "Waiting for Redis to be ready..." -ForegroundColor Yellow
$maxAttempts = 15
$attempt = 0
$redisReady = $false

while ($attempt -lt $maxAttempts -and -not $redisReady) {
    Start-Sleep -Seconds 1
    try {
        $result = docker exec redis-lingua redis-cli ping 2>&1
        if ($result -match "PONG") {
            $redisReady = $true
        }
    }
    catch {
        # Continue waiting
    }
    $attempt++
    Write-Host "  Attempt $attempt/$maxAttempts..." -ForegroundColor Gray
}

Write-Host ""
if ($redisReady) {
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Redis is ready!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "Redis URL: redis://127.0.0.1:6379" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "You can now start the Scheduler server:" -ForegroundColor Yellow
    Write-Host "  .\scripts\start_scheduler.ps1" -ForegroundColor Gray
    Write-Host ""
}
else {
    Write-Host "Warning: Redis may not be fully ready yet" -ForegroundColor Yellow
    Write-Host "Please wait a few more seconds and verify:" -ForegroundColor Yellow
    Write-Host "  docker exec redis-lingua redis-cli ping" -ForegroundColor Gray
    Write-Host ""
}

