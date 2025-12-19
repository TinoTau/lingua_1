# Check capability_state format from node logs
# This helps debug why service_node_counts is all 0

param(
    [string]$NodeLogPath = "electron_node\electron-node\logs\electron-main.log",
    [int]$Lines = 100
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Checking capability_state from Node Logs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

$nodeLog = Join-Path $projectRoot $NodeLogPath
Write-Host "Node Log: $nodeLog" -ForegroundColor Yellow

if (Test-Path $nodeLog) {
    Write-Host "Searching for capability_state related logs..." -ForegroundColor Gray
    $content = Get-Content $nodeLog -Tail ($Lines * 2) | Select-String -Pattern "capability|enabledServices|installedButNotEnabled" -Context 0,5
    if ($content) {
        $content | ForEach-Object {
            Write-Host $_.Line -ForegroundColor White
            if ($_.Context.PostContext) {
                $_.Context.PostContext | ForEach-Object {
                    Write-Host "  $_" -ForegroundColor Gray
                }
            }
            Write-Host ""
        }
    } else {
        Write-Host "No capability_state related logs found in last $Lines lines" -ForegroundColor Yellow
        Write-Host "Showing last $Lines lines instead:" -ForegroundColor Gray
        Get-Content $nodeLog -Tail $Lines
    }
} else {
    Write-Host "Log file not found: $nodeLog" -ForegroundColor Red
}

Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  - capability_state keys should be service_id (e.g., 'nmt-m2m100'), not model_id" -ForegroundColor Yellow
Write-Host "  - Only services with status 'ready' should be counted" -ForegroundColor Yellow
Write-Host "  - Check if services are actually running/ready in the node" -ForegroundColor Yellow

