# Start Scheduler + Node for turn-related test
# Run from repo root: .\scripts\start_scheduler_and_node_turn_test.ps1

$ErrorActionPreference = "Stop"
$projectRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { Get-Location }
if (-not (Test-Path (Join-Path $projectRoot "central_server"))) {
    $projectRoot = Get-Location
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Start Scheduler + Node (turn test)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$schedulerPath = Join-Path (Join-Path $projectRoot "central_server") "scheduler"
$configPath = Join-Path $schedulerPath "config.toml"
$phase2Enabled = $false
if (Test-Path $configPath) {
    $configContent = Get-Content $configPath -Raw
    if ($configContent -match '\[scheduler\.phase2\][\s\S]*?enabled\s*=\s*(true|false)') {
        $phase2Enabled = ($matches[1] -eq "true")
    }
}
if ($phase2Enabled) {
    Write-Host "[1/4] Check Redis..." -ForegroundColor Yellow
    $redisOk = $false
    try {
        $r = docker exec redis-lingua redis-cli ping 2>&1
        if ($r -match "PONG") { $redisOk = $true }
        else { docker start redis-lingua 2>&1 | Out-Null; Start-Sleep -Seconds 2; $redisOk = $true }
    } catch { }
    if (-not $redisOk) {
        Write-Host "      Start Redis first: docker start redis-lingua" -ForegroundColor Red
        exit 1
    }
    Write-Host "      Redis OK" -ForegroundColor Green
} else {
    Write-Host "[1/4] Phase2 disabled, skip Redis" -ForegroundColor Gray
}

Write-Host "[2/4] Start Scheduler (new window)..." -ForegroundColor Yellow
$startSchedulerScript = Join-Path $projectRoot (Join-Path "scripts" "start_scheduler.ps1")
if (-not (Test-Path $startSchedulerScript)) {
    Write-Host "      start_scheduler.ps1 not found" -ForegroundColor Red
    exit 1
}
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $startSchedulerScript
Start-Sleep -Seconds 3

$maxWait = 60
$waited = 0
while ($waited -lt $maxWait) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:5010/api/v1/stats" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep -Seconds 2
    $waited += 2
}
if ($waited -ge $maxWait) {
    Write-Host "      Scheduler not ready in ${maxWait}s" -ForegroundColor Red
    exit 1
}
Write-Host "      Scheduler ready: http://localhost:5010" -ForegroundColor Green

Write-Host "[3/4] Start Node (new window)..." -ForegroundColor Yellow
$startNodeScript = Join-Path $projectRoot (Join-Path "scripts" "start_electron_node.ps1")
if (-not (Test-Path $startNodeScript)) {
    Write-Host "      start_electron_node.ps1 not found" -ForegroundColor Red
    exit 1
}
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", $startNodeScript
Start-Sleep -Seconds 8

Write-Host "[4/4] Check node registration..." -ForegroundColor Yellow
try {
    $stats = Invoke-RestMethod -Uri "http://localhost:5010/api/v1/stats" -TimeoutSec 5
    $nodeCount = 0
    if ($stats.nodes -ne $null) { $nodeCount = @($stats.nodes).Count }
    if ($stats.node_count -ne $null) { $nodeCount = $stats.node_count }
    Write-Host "      /api/v1/stats OK, nodes: $nodeCount" -ForegroundColor Green
} catch {
    Write-Host "      Could not read /api/v1/stats" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Turn test instructions" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "1. Open dashboard: http://localhost:5010/dashboard" -ForegroundColor White
Write-Host "2. Use Web client: create session, speak long sentence (>10s)" -ForegroundColor White
Write-Host "3. In node log check: bufferKey = turnId|tgt_lang, TURN_NOT_FLUSHED, append only" -ForegroundColor White
Write-Host "   Node logs: electron_node/electron-node/logs/" -ForegroundColor Gray
Write-Host ""
