# Check logs for scheduler and node
# This script helps debug issues by showing recent logs

param(
    [string]$SchedulerLogPath = "central_server\scheduler\logs\scheduler.log",
    [string]$NodeLogPath = "electron_node\electron-node\logs\electron-main.log",
    [int]$Lines = 50
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Checking Logs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# Check Scheduler Logs
$schedulerLog = Join-Path $projectRoot $SchedulerLogPath
Write-Host "Scheduler Log: $schedulerLog" -ForegroundColor Yellow
if (Test-Path $schedulerLog) {
    Write-Host "Last $Lines lines:" -ForegroundColor Gray
    Get-Content $schedulerLog -Tail $Lines | Select-Object -Last $Lines
} else {
    Write-Host "Log file not found" -ForegroundColor Red
    Write-Host "Checking for other log files..." -ForegroundColor Gray
    $logDir = Split-Path $schedulerLog
    if (Test-Path $logDir) {
        Get-ChildItem $logDir -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 5 | ForEach-Object {
            Write-Host "Found: $($_.Name) (Last modified: $($_.LastWriteTime))" -ForegroundColor Gray
        }
    }
}
Write-Host ""

# Check Node Logs
$nodeLog = Join-Path $projectRoot $NodeLogPath
Write-Host "Node Log: $nodeLog" -ForegroundColor Yellow
if (Test-Path $nodeLog) {
    Write-Host "Last $Lines lines:" -ForegroundColor Gray
    Get-Content $nodeLog -Tail $Lines | Select-Object -Last $Lines
} else {
    Write-Host "Log file not found" -ForegroundColor Red
    Write-Host "Checking for other log files..." -ForegroundColor Gray
    $logDir = Split-Path $nodeLog
    if (Test-Path $logDir) {
        Get-ChildItem $logDir -Filter "*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 5 | ForEach-Object {
            Write-Host "Found: $($_.Name) (Last modified: $($_.LastWriteTime))" -ForegroundColor Gray
        }
    }
}
Write-Host ""

# Check stats API
Write-Host "Checking Stats API..." -ForegroundColor Yellow
try {
    $statsResponse = Invoke-WebRequest -Uri "http://localhost:3001/api/v1/stats" -Method GET -ErrorAction Stop
    $statsData = $statsResponse.Content | ConvertFrom-Json
    Write-Host "Connected Nodes: $($statsData.nodes.connected_nodes)" -ForegroundColor Green
    Write-Host "Available Services: $($statsData.nodes.available_services.Count)" -ForegroundColor Green
    Write-Host "Service Node Counts:" -ForegroundColor Green
    $statsData.nodes.service_node_counts.PSObject.Properties | ForEach-Object {
        Write-Host "  $($_.Name): $($_.Value)" -ForegroundColor Gray
    }
    if ($statsData.nodes.service_node_counts.PSObject.Properties.Count -eq 0) {
        Write-Host "  (empty - no services with Ready status)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "Failed to fetch stats API: $_" -ForegroundColor Red
    Write-Host "Is scheduler running on http://localhost:3001?" -ForegroundColor Yellow
}
Write-Host ""

