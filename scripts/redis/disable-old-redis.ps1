# Disable old Redis service script
# Must run as Administrator

Write-Host "=== Disabling old Redis 3.0.504 service ===" -ForegroundColor Yellow
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Error: This script requires Administrator privileges" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run PowerShell as Administrator, then execute:" -ForegroundColor Yellow
    Write-Host "  cd D:\Programs\github\lingua_1" -ForegroundColor Cyan
    Write-Host "  .\disable-old-redis.ps1" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

Write-Host "Administrator privileges detected OK" -ForegroundColor Green
Write-Host ""

# 1. Stop Redis service
Write-Host "Step 1/3: Stopping Redis service..." -ForegroundColor Yellow
try {
    Stop-Service Redis -Force -ErrorAction Stop
    Write-Host "OK Redis service stopped" -ForegroundColor Green
} catch {
    Write-Host "WARN Redis service not running or does not exist: $_" -ForegroundColor Yellow
}

# 2. Disable Redis service
Write-Host ""
Write-Host "Step 2/3: Disabling Redis service auto-start..." -ForegroundColor Yellow
try {
    Set-Service Redis -StartupType Disabled -ErrorAction Stop
    Write-Host "OK Redis service set to disabled" -ForegroundColor Green
} catch {
    Write-Host "WARN Cannot disable Redis service: $_" -ForegroundColor Yellow
}

# 3. Stop all redis-server processes
Write-Host ""
Write-Host "Step 3/3: Stopping all redis-server processes..." -ForegroundColor Yellow
$processes = Get-Process -Name "redis-server" -ErrorAction SilentlyContinue
if ($processes) {
    foreach ($proc in $processes) {
        Write-Host "  Stopping process PID $($proc.Id)..." -ForegroundColor Gray
        try {
            Stop-Process -Id $proc.Id -Force -ErrorAction Stop
            Write-Host "    OK Process stopped" -ForegroundColor Green
        } catch {
            Write-Host "    WARN Cannot stop process: $_" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  No redis-server processes found" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Complete ===" -ForegroundColor Green
Write-Host ""

# Verify
Write-Host "Verification:" -ForegroundColor Yellow
$service = Get-Service Redis -ErrorAction SilentlyContinue
if ($service) {
    Write-Host "  Redis service status: $($service.Status)" -ForegroundColor Cyan
    Write-Host "  Startup type: $($service.StartType)" -ForegroundColor Cyan
} else {
    Write-Host "  Redis service: Does not exist" -ForegroundColor Green
}

$processes = Get-Process -Name "redis-server" -ErrorAction SilentlyContinue
if ($processes) {
    Write-Host "  redis-server process: Still running (PID: $($processes.Id -join ', '))" -ForegroundColor Yellow
} else {
    Write-Host "  redis-server process: Stopped" -ForegroundColor Green
}

# Check port
Write-Host ""
Write-Host "Checking port 6379..." -ForegroundColor Yellow
$port6379 = Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue
if ($port6379) {
    Write-Host "  Port 6379: Still occupied" -ForegroundColor Yellow
    foreach ($conn in $port6379) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "    Occupying process: PID $($conn.OwningProcess) - $($proc.ProcessName)" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  Port 6379: Released OK" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Old Redis disabled ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: Start scheduler server (will auto-create redis-lingua container)" -ForegroundColor Yellow
Write-Host "  cd D:\Programs\github\lingua_1" -ForegroundColor Cyan
Write-Host "  .\scripts\start_scheduler.ps1" -ForegroundColor Cyan
Write-Host ""
