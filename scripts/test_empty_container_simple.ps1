# Simple test checker for empty container acknowledgment

$nodeLogPath = "electron_node\electron-node\logs\electron-main.log"
$schedulerLogPath = "central_server\scheduler\logs"

Write-Host "========================================" 
Write-Host "Empty Container Acknowledgment Test Check"
Write-Host "========================================" 
Write-Host ""

# Check node log
if (Test-Path $nodeLogPath) {
    Write-Host "Node log found: $nodeLogPath" -ForegroundColor Green
    $nodeMatches = Select-String -Path $nodeLogPath -Pattern "Empty containers detected|NO_TEXT_ASSIGNED" -Context 1
    if ($nodeMatches) {
        Write-Host "Found empty container logs:" -ForegroundColor Green
        $nodeMatches | ForEach-Object { Write-Host $_.Line }
    } else {
        Write-Host "No empty container logs found in node log" -ForegroundColor Yellow
    }
} else {
    Write-Host "Node log not found: $nodeLogPath" -ForegroundColor Yellow
}

Write-Host ""

# Check scheduler log
if (Test-Path $schedulerLogPath) {
    $schedulerLogs = Get-ChildItem -Path $schedulerLogPath -Filter "scheduler*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
    if ($schedulerLogs) {
        $latestLog = $schedulerLogs[0]
        Write-Host "Scheduler log found: $($latestLog.FullName)" -ForegroundColor Green
        $schedulerMatches = Select-String -Path $latestLog.FullName -Pattern "NO_TEXT_ASSIGNED" -Context 1
        if ($schedulerMatches) {
            Write-Host "Found NO_TEXT_ASSIGNED in scheduler log:" -ForegroundColor Green
            $schedulerMatches | ForEach-Object { Write-Host $_.Line }
        } else {
            Write-Host "No NO_TEXT_ASSIGNED found in scheduler log" -ForegroundColor Yellow
        }
    } else {
        Write-Host "No scheduler log files found in $schedulerLogPath" -ForegroundColor Yellow
    }
} else {
    Write-Host "Scheduler log directory not found: $schedulerLogPath" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" 
Write-Host "Test Instructions:" 
Write-Host "1. Open Web client and create new session"
Write-Host "2. Speak continuously for 35+ seconds without manual send"
Write-Host "3. Wait for system timeout to finalize"
Write-Host "4. Run this script again to check results"
Write-Host "========================================" 
