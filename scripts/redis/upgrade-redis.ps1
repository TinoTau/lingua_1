# Redis Upgrade Script - Docker Solution
# Purpose: Replace old Redis 3.0.504 with Docker Redis 7
# Time: < 5 minutes

Write-Host "=== Redis Upgrade to 7.x (Docker Solution) ===" -ForegroundColor Green
Write-Host ""

# Step 1: Stop old Redis
Write-Host "Step 1/5: Stopping old Redis service..." -ForegroundColor Yellow
try {
    Stop-Service Redis -ErrorAction SilentlyContinue
    Write-Host "OK Old Redis service stopped" -ForegroundColor Green
} catch {
    Write-Host "WARN Old Redis service not running or not found" -ForegroundColor Yellow
}

# Step 2: Backup data (optional but recommended)
Write-Host ""
Write-Host "Step 2/5: Backing up existing Redis data..." -ForegroundColor Yellow
$backupDir = "C:\Backup\Redis"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}
$backupFile = "$backupDir\dump.rdb.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"

$redisPaths = @(
    "C:\Program Files\Redis\dump.rdb",
    "C:\Redis\dump.rdb",
    "$env:ProgramData\Redis\dump.rdb"
)

$backed = $false
foreach ($path in $redisPaths) {
    if (Test-Path $path) {
        Copy-Item $path $backupFile
        Write-Host "OK Backed up: $path -> $backupFile" -ForegroundColor Green
        $backed = $true
        break
    }
}

if (-not $backed) {
    Write-Host "WARN No dump.rdb found, skipping backup" -ForegroundColor Yellow
}

# Step 3: Clean up old Docker Redis containers
Write-Host ""
Write-Host "Step 3/5: Cleaning up old Docker Redis containers..." -ForegroundColor Yellow
docker stop lingua-redis 2>$null
docker rm lingua-redis 2>$null
Write-Host "OK Old containers cleaned" -ForegroundColor Green

# Step 4: Start new Redis 7 container
Write-Host ""
Write-Host "Step 4/5: Starting Redis 7 Docker container..." -ForegroundColor Yellow
docker run -d `
    --name lingua-redis `
    -p 6379:6379 `
    --restart unless-stopped `
    -v redis-data:/data `
    redis:7-alpine redis-server --appendonly yes

Write-Host "OK Redis 7 container started" -ForegroundColor Green

# Step 5: Verify
Write-Host ""
Write-Host "Step 5/5: Verifying Redis version and Streams support..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Verify version
$version = redis-cli INFO server 2>$null | Select-String "redis_version"
Write-Host "  Redis version: $version" -ForegroundColor Cyan

# Verify Streams support
Write-Host "  Testing Streams commands..." -ForegroundColor Cyan
$testId = redis-cli XADD test-stream "*" field value 2>$null
if ($testId) {
    Write-Host "  OK XADD command works" -ForegroundColor Green
    redis-cli DEL test-stream | Out-Null
} else {
    Write-Host "  ERROR XADD command failed" -ForegroundColor Red
    exit 1
}

# Test connection
$ping = redis-cli ping 2>$null
if ($ping -eq "PONG") {
    Write-Host "  OK Redis connection works" -ForegroundColor Green
} else {
    Write-Host "  ERROR Redis connection failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== OK Redis upgrade completed! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Phase2 is already enabled in config.toml" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Restart scheduler server:" -ForegroundColor Cyan
Write-Host "   cd D:\Programs\github\lingua_1" -ForegroundColor White
Write-Host "   .\scripts\start_scheduler.ps1" -ForegroundColor White
Write-Host ""
Write-Host "3. Check logs, you should see:" -ForegroundColor Cyan
Write-Host "   OK INFO Phase2 enabled" -ForegroundColor Green
Write-Host "   OK INFO Phase2 consumer group created" -ForegroundColor Green
Write-Host ""
