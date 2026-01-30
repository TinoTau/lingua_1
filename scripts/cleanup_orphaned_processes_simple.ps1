# Simple Process Cleanup Script - Fast and Direct
# No command-line queries to avoid hanging

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Quick Cleanup Orphaned Processes" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Find processes (without querying command lines)
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -notlike "*\Windows\*" -and $_.Path -notlike "*\Program Files\*"
}

$pythonProcesses = Get-Process -Name "python*" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -notlike "*\Windows\*" -and $_.Path -notlike "*\Program Files\*"
}

$esBuilderProcesses = Get-Process -Name "esBuilder*" -ErrorAction SilentlyContinue

# Show counts
Write-Host "Found processes:" -ForegroundColor Yellow
Write-Host "  - Node.js: $($nodeProcesses.Count)" -ForegroundColor Gray
Write-Host "  - Python: $($pythonProcesses.Count)" -ForegroundColor Gray
Write-Host "  - esBuilder: $($esBuilderProcesses.Count)" -ForegroundColor Gray
Write-Host ""

$totalCount = $nodeProcesses.Count + $pythonProcesses.Count + $esBuilderProcesses.Count

if ($totalCount -eq 0) {
    Write-Host "No processes to cleanup" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# 2. Kill processes directly (no prompt)
Write-Host "Cleaning up $totalCount processes..." -ForegroundColor Yellow
Write-Host ""

$killedCount = 0
$failedCount = 0

# Kill Node.js
foreach ($proc in $nodeProcesses) {
    try {
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        Write-Host "  Terminated Node.js (PID: $($proc.Id))" -ForegroundColor Gray
        $killedCount++
    } catch {
        Write-Host "  Failed to terminate (PID: $($proc.Id))" -ForegroundColor Red
        $failedCount++
    }
}

# Kill Python
foreach ($proc in $pythonProcesses) {
    try {
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        Write-Host "  Terminated Python (PID: $($proc.Id))" -ForegroundColor Gray
        $killedCount++
    } catch {
        Write-Host "  Failed to terminate (PID: $($proc.Id))" -ForegroundColor Red
        $failedCount++
    }
}

# Kill esBuilder
foreach ($proc in $esBuilderProcesses) {
    try {
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        Write-Host "  Terminated esBuilder (PID: $($proc.Id))" -ForegroundColor Gray
        $killedCount++
    } catch {
        Write-Host "  Failed to terminate (PID: $($proc.Id))" -ForegroundColor Red
        $failedCount++
    }
}

# 3. Summary
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cleaned: $killedCount processes" -ForegroundColor Green
if ($failedCount -gt 0) {
    Write-Host "Failed: $failedCount processes" -ForegroundColor Red
}
Write-Host ""
