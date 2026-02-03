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

# Check if Phase2 is enabled (requires Redis)
$phase2Enabled = $false
if (Test-Path "config.toml") {
    $configContent = Get-Content "config.toml" -Raw
    if ($configContent -match '\[scheduler\.phase2\][\s\S]*?enabled\s*=\s*(true|false)') {
        $phase2Value = $matches[1]
        $phase2Enabled = ($phase2Value -eq "true")
    }
}

# If Phase2 is enabled, check Redis connection
if ($phase2Enabled) {
    Write-Host ""
    Write-Host "Phase2 is enabled - checking Redis connection..." -ForegroundColor Yellow
    
    # Read Redis URL from config
    $redisUrl = "redis://127.0.0.1:6379"  # Default
    if (Test-Path "config.toml") {
        $configContent = Get-Content "config.toml" -Raw
        if ($configContent -match '\[scheduler\.phase2\.redis\][\s\S]*?url\s*=\s*"([^"]+)"') {
            $redisUrl = $matches[1]
        }
    }
    
    # Parse Redis URL
    $redisHost = "127.0.0.1"
    $redisPort = 6379
    if ($redisUrl -match 'redis://([^:]+):(\d+)') {
        $redisHost = $matches[1]
        $redisPort = [int]$matches[2]
    }
    elseif ($redisUrl -match 'redis://([^:]+)') {
        $redisHost = $matches[1]
    }
    
    # Check if Redis is already accessible
    $redisAccessible = $false
    $redisMethod = ""
    
    # Method 1: Try redis-cli (if installed locally)
    try {
        $result = redis-cli -h $redisHost -p $redisPort ping 2>&1
        if ($result -match "PONG") {
            $redisAccessible = $true
            $redisMethod = "local"
            Write-Host "  Redis is accessible via redis-cli" -ForegroundColor Green
        }
    }
    catch {
        # redis-cli not available or Redis not responding
    }
    
    # Method 2: Try Docker (only for localhost)
    if (-not $redisAccessible -and $redisHost -eq "127.0.0.1" -or $redisHost -eq "localhost") {
        $dockerAvailable = $false
        try {
            docker ps 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $dockerAvailable = $true
            }
        }
        catch {
            # Docker not available
        }
        
        if ($dockerAvailable) {
            # Check if Redis container exists and is running
            try {
                $result = docker exec redis-lingua redis-cli ping 2>&1
                if ($result -match "PONG") {
                    $redisAccessible = $true
                    $redisMethod = "docker"
                    Write-Host "  Redis is running in Docker container" -ForegroundColor Green
                }
            }
            catch {
                # Container not running or doesn't exist
            }
            
            # If not accessible, try to start Redis container
            if (-not $redisAccessible) {
                Write-Host "  Redis is not running, attempting to start via Docker..." -ForegroundColor Yellow
                
                # Check if Redis container exists
                $existingContainer = docker ps -a --filter "name=redis-lingua" --format "{{.Names}}" 2>&1 | Where-Object { $_ -eq "redis-lingua" }
                
                if ($existingContainer) {
                    # Check if container is running
                    $runningContainer = docker ps --filter "name=redis-lingua" --format "{{.Names}}" 2>&1 | Where-Object { $_ -eq "redis-lingua" }
                    if ($runningContainer) {
                        Write-Host "  Redis container is already running" -ForegroundColor Green
                    }
                    else {
                        Write-Host "  Starting existing Redis container..." -ForegroundColor Yellow
                        docker start redis-lingua 2>&1 | Out-Null
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "  Redis container started" -ForegroundColor Green
                        }
                        else {
                            Write-Host "  Failed to start Redis container" -ForegroundColor Yellow
                            Write-Host "  Will continue and let Scheduler handle connection errors" -ForegroundColor Yellow
                        }
                    }
                }
                else {
                    Write-Host "  Creating new Redis container..." -ForegroundColor Yellow
                    docker run -d --name redis-lingua -p 127.0.0.1:6379:6379 redis:latest 2>&1 | Out-Null
                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "  Redis container created and started" -ForegroundColor Green
                    }
                    else {
                        Write-Host "  Failed to create Redis container" -ForegroundColor Yellow
                        Write-Host "  Will continue and let Scheduler handle connection errors" -ForegroundColor Yellow
                    }
                }
                
                # Wait for Redis to be ready
                Write-Host "  Waiting for Redis to be ready..." -ForegroundColor Yellow
                $maxAttempts = 20
                $attempt = 0
                $redisReady = $false
                
                while ($attempt -lt $maxAttempts -and -not $redisReady) {
                    Start-Sleep -Seconds 1
                    try {
                        $result = docker exec redis-lingua redis-cli ping 2>&1
                        if ($result -match "PONG") {
                            $redisReady = $true
                            $redisAccessible = $true
                            $redisMethod = "docker"
                        }
                    }
                    catch {
                        # Continue waiting
                    }
                    $attempt++
                    if ($attempt % 3 -eq 0) {
                        Write-Host "    Attempt $attempt/$maxAttempts..." -ForegroundColor Gray
                    }
                }
                
                if ($redisReady) {
                    Write-Host "  Redis is ready!" -ForegroundColor Green
                }
                else {
                    Write-Host "  Error: Redis failed to become ready after $maxAttempts attempts" -ForegroundColor Red
                    Write-Host "  Please check Redis container logs: docker logs redis-lingua" -ForegroundColor Yellow
                    Write-Host "  Exiting to prevent Scheduler startup failure" -ForegroundColor Red
                    exit 1
                }
            }
        }
    }
    
    # Method 3: Remote Redis (cloud platform)
    if (-not $redisAccessible -and ($redisHost -ne "127.0.0.1" -and $redisHost -ne "localhost")) {
        Write-Host "  Detected remote Redis server: $redisUrl" -ForegroundColor Cyan
        Write-Host "  Assuming Redis is managed externally (cloud platform)" -ForegroundColor Gray
        Write-Host "  Scheduler will connect to: $redisUrl" -ForegroundColor Gray
        $redisAccessible = $true  # Assume accessible, let Scheduler handle connection
        $redisMethod = "remote"
    }
    
    # Final check: Ensure Redis is accessible before starting Scheduler
    if (-not $redisAccessible) {
        if ($redisHost -eq "127.0.0.1" -or $redisHost -eq "localhost") {
            Write-Host "  Error: Cannot verify Redis connection" -ForegroundColor Red
            Write-Host "  Redis URL: $redisUrl" -ForegroundColor Gray
            Write-Host "  Please ensure Redis is running:" -ForegroundColor Yellow
            Write-Host "    1. Check Docker: docker ps | findstr redis" -ForegroundColor Gray
            Write-Host "    2. Test connection: docker exec redis-lingua redis-cli ping" -ForegroundColor Gray
            Write-Host "    3. Or start Redis: .\scripts\start_redis.ps1" -ForegroundColor Gray
            Write-Host ""
            Write-Host "  Exiting to prevent Scheduler startup failure" -ForegroundColor Red
            exit 1
        }
        else {
            Write-Host "  Warning: Cannot verify remote Redis connection" -ForegroundColor Yellow
            Write-Host "  Redis URL: $redisUrl" -ForegroundColor Gray
            Write-Host "  Assuming Redis is managed externally (cloud platform)" -ForegroundColor Gray
            Write-Host "  Scheduler will attempt to connect on startup" -ForegroundColor Gray
            Write-Host ""
        }
    }
    else {
        Write-Host "  Redis connection verified ($redisMethod mode)" -ForegroundColor Green
        Write-Host "  Redis URL: $redisUrl" -ForegroundColor Gray
        Write-Host ""
    }
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

# Parse server.port from config.toml
$port = 5010
$configPath = Join-Path $schedulerPath "config.toml"
if (Test-Path $configPath) {
    $inServer = $false
    foreach ($line in (Get-Content $configPath -ErrorAction SilentlyContinue)) {
        if ($line -match '^\s*\[server\]\s*$') { $inServer = $true }
        elseif ($inServer -and $line -match '^\s*port\s*=\s*(\d+)') {
            $port = [int]$matches[1]
            break
        }
        elseif ($line -match '^\s*\[') { $inServer = $false }
    }
}

# Startup cleanup: kill orphaned processes on expected port
$netstatLines = netstat -ano 2>$null | Select-String ":$port\s+.*LISTENING"
if ($netstatLines) {
    foreach ($line in $netstatLines) {
        $parts = $line.Line.Trim() -split '\s+'
        $pidVal = [int]$parts[-1]
        if ($pidVal -gt 0) {
            Write-Host "Killing orphaned process on port $port (PID $pidVal)..." -ForegroundColor Yellow
            taskkill /F /T /PID $pidVal 2>$null | Out-Null
        }
    }
    Start-Sleep -Seconds 1
}

# Stop existing scheduler process
$existing = Get-Process -Name "scheduler" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Stopping existing scheduler (pid $($existing.Id -join ', '))..." -ForegroundColor Yellow
    $existing | Stop-Process -Force
    Start-Sleep -Seconds 2
}

# Build and run
Write-Host "Building and starting scheduler server..." -ForegroundColor Yellow
Write-Host "Logs will be saved to: $logFile" -ForegroundColor Gray
Write-Host "Errors will be displayed in this terminal" -ForegroundColor Gray
Write-Host ""

try {
    cargo run --release
    
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
