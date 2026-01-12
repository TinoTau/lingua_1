# View Semantic Repair ZH Service Logs
# 查看中文语义修复服务日志

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Semantic Repair ZH Service - Log Viewer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查服务状态
Write-Host "[Log Viewer] Checking service status..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:5013/health" -UseBasicParsing -ErrorAction Stop
    $health = $response.Content | ConvertFrom-Json
    Write-Host "[Log Viewer] Service Status: $($health.status)" -ForegroundColor $(if ($health.status -eq "healthy") { "Green" } else { "Yellow" })
    Write-Host "[Log Viewer] Model Loaded: $($health.model_loaded)" -ForegroundColor Green
    Write-Host "[Log Viewer] Model Version: $($health.model_version)" -ForegroundColor Green
    Write-Host "[Log Viewer] Warmed: $($health.warmed)" -ForegroundColor Green
} catch {
    Write-Host "[Log Viewer] ⚠️  Service is not responding" -ForegroundColor Red
    Write-Host "[Log Viewer] Error: $_" -ForegroundColor Red
}
Write-Host ""

# 检查进程信息
Write-Host "[Log Viewer] Checking process information..." -ForegroundColor Yellow
$port = 5013
$connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($connections) {
    $processId = $connections[0].OwningProcess
    Write-Host "[Log Viewer] Service PID: $processId" -ForegroundColor Green
    
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process) {
        $memoryMB = [math]::Round($process.WorkingSet64 / 1MB, 2)
        $cpuTime = $process.TotalProcessorTime
        $startTime = $process.StartTime
        
        Write-Host "[Log Viewer] Process Name: $($process.ProcessName)" -ForegroundColor Cyan
        Write-Host "[Log Viewer] Memory Usage: $memoryMB MB" -ForegroundColor Cyan
        Write-Host "[Log Viewer] CPU Time: $cpuTime" -ForegroundColor Cyan
        Write-Host "[Log Viewer] Start Time: $startTime" -ForegroundColor Cyan
    }
} else {
    Write-Host "[Log Viewer] ⚠️  No process found on port $port" -ForegroundColor Yellow
}
Write-Host ""

# 查找日志文件
Write-Host "[Log Viewer] Searching for log files..." -ForegroundColor Yellow

# 1. 检查主进程日志
$mainLogPath = "electron_node\electron-node\logs\electron-main.log"
if (Test-Path $mainLogPath) {
    $logSize = (Get-Item $mainLogPath).Length
    Write-Host "[Log Viewer] Found main log: $mainLogPath ($([math]::Round($logSize / 1KB, 2)) KB)" -ForegroundColor Green
    
    if ($logSize -gt 0) {
        Write-Host "[Log Viewer] Last 100 lines with 'semantic-repair-zh' or 'Semantic Repair ZH':" -ForegroundColor Cyan
        Get-Content $mainLogPath -Tail 100 | Select-String -Pattern "semantic-repair-zh|Semantic Repair ZH" -Context 2
    } else {
        Write-Host "[Log Viewer] ⚠️  Log file is empty" -ForegroundColor Yellow
    }
} else {
    Write-Host "[Log Viewer] ⚠️  Main log not found: $mainLogPath" -ForegroundColor Yellow
}
Write-Host ""

# 2. 检查服务目录下的日志
$serviceLogDir = "electron_node\services\semantic_repair_zh\logs"
if (Test-Path $serviceLogDir) {
    $serviceLogs = Get-ChildItem $serviceLogDir -Filter "*.log" | Sort-Object LastWriteTime -Descending
    if ($serviceLogs) {
        Write-Host "[Log Viewer] Found service logs:" -ForegroundColor Green
        foreach ($log in $serviceLogs) {
            Write-Host "[Log Viewer]   - $($log.Name) ($([math]::Round($log.Length / 1KB, 2)) KB, modified: $($log.LastWriteTime))" -ForegroundColor Cyan
            Write-Host "[Log Viewer] Last 50 lines:" -ForegroundColor Yellow
            Get-Content $log.FullName -Tail 50
            Write-Host ""
        }
    } else {
        Write-Host "[Log Viewer] ⚠️  No log files found in $serviceLogDir" -ForegroundColor Yellow
    }
} else {
    Write-Host "[Log Viewer] ⚠️  Service log directory not found: $serviceLogDir" -ForegroundColor Yellow
}
Write-Host ""

# 3. 查找所有相关日志文件
Write-Host "[Log Viewer] Searching for all log files..." -ForegroundColor Yellow
$allLogs = Get-ChildItem "electron_node" -Recurse -Filter "*.log" -ErrorAction SilentlyContinue | 
    Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-24) } | 
    Sort-Object LastWriteTime -Descending | 
    Select-Object -First 10

if ($allLogs) {
    Write-Host "[Log Viewer] Recent log files (last 24 hours):" -ForegroundColor Green
    foreach ($log in $allLogs) {
        $size = [math]::Round($log.Length / 1KB, 2)
        Write-Host "[Log Viewer]   - $($log.FullName) ($size KB, $($log.LastWriteTime))" -ForegroundColor Cyan
    }
} else {
    Write-Host "[Log Viewer] ⚠️  No recent log files found" -ForegroundColor Yellow
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Note: If logs are not found, the service may" -ForegroundColor Yellow
Write-Host "      be outputting to console instead of files." -ForegroundColor Yellow
Write-Host "      Try running start_debug.ps1 to see real-time logs." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
