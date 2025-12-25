# Start Redis service for Scheduler Phase2 cluster monitoring

Write-Host "Starting Redis..." -ForegroundColor Yellow

# Check if Docker is available
$dockerAvailable = $false
try {
    docker --version | Out-Null
    $dockerAvailable = $true
}
catch {
    Write-Host "Docker is not installed or not running" -ForegroundColor Red
    Write-Host "Please start Docker Desktop first" -ForegroundColor Yellow
    exit 1
}

# Check if Redis is already running
try {
    $result = docker exec redis-lingua redis-cli ping 2>&1
    if ($result -match "PONG") {
        Write-Host "Redis is already running" -ForegroundColor Green
        exit 0
    }
}
catch {
    # Redis not running, continue to start
}

# Check if Redis container exists
$existingContainer = docker ps -a --filter "name=redis-lingua" --format "{{.Names}}" 2>&1 | Where-Object { $_ -eq "redis-lingua" }

if ($existingContainer) {
    # Check if container is running
    $runningContainer = docker ps --filter "name=redis-lingua" --format "{{.Names}}" 2>&1 | Where-Object { $_ -eq "redis-lingua" }
    if ($runningContainer) {
        Write-Host "Redis container is already running" -ForegroundColor Green
    }
    else {
        Write-Host "Starting existing Redis container..." -ForegroundColor Yellow
        docker start redis-lingua
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Redis container started" -ForegroundColor Green
        }
        else {
            Write-Host "Failed to start Redis container" -ForegroundColor Red
            exit 1
        }
    }
}
else {
    Write-Host "Creating and starting new Redis container..." -ForegroundColor Yellow
    docker run -d --name redis-lingua -p 127.0.0.1:6379:6379 redis:latest
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Redis container created and started" -ForegroundColor Green
    }
    else {
        Write-Host "Failed to create Redis container" -ForegroundColor Red
        exit 1
    }
}

# Wait for Redis to be ready
Write-Host "Waiting for Redis to be ready..." -ForegroundColor Yellow
$maxAttempts = 10
$attempt = 0
$redisReady = $false

while ($attempt -lt $maxAttempts -and -not $redisReady) {
    Start-Sleep -Seconds 1
    try {
        $result = docker exec redis-lingua redis-cli ping 2>&1
        if ($result -match "PONG") {
            $redisReady = $true
            Write-Host "Redis is ready!" -ForegroundColor Green
        }
    }
    catch {
        # Continue waiting
    }
    $attempt++
}

if (-not $redisReady) {
    Write-Host "Warning: Redis may not be fully ready yet, but container is started" -ForegroundColor Yellow
    Write-Host "Please wait a few seconds and try again" -ForegroundColor Yellow
}
else {
    Write-Host "Redis is running at: redis://127.0.0.1:6379" -ForegroundColor Green
}
