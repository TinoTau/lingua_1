# Simple GPU Arbiter Check Script
# No Chinese characters to avoid encoding issues

Write-Host "=== GPU Arbiter Status Check ===" -ForegroundColor Green
Write-Host ""

# 1. Check Node Process
Write-Host "1. Checking Node Process..." -ForegroundColor Yellow
$nodeProcesses = Get-Process | Where-Object { $_.ProcessName -like "*electron*" }
if ($nodeProcesses) {
    Write-Host "  [OK] Node is running ($($nodeProcesses.Count) processes)" -ForegroundColor Green
    $nodeProcesses | Select-Object -First 3 | ForEach-Object {
        Write-Host "    - PID: $($_.Id), Started: $(Get-Date $_.StartTime -Format 'HH:mm:ss')" -ForegroundColor Cyan
    }
} else {
    Write-Host "  [WARN] Node process not found" -ForegroundColor Yellow
}

# 2. Check Config
Write-Host "`n2. Checking Configuration..." -ForegroundColor Yellow
$configPath = "$env:APPDATA\electron-node\electron-node-config.json"
if (Test-Path $configPath) {
    Write-Host "  [OK] Config file exists" -ForegroundColor Green
    try {
        $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($config.gpuArbiter) {
            Write-Host "  GPU Arbiter Config:" -ForegroundColor Cyan
            Write-Host "    enabled: $($config.gpuArbiter.enabled)" -ForegroundColor $(if ($config.gpuArbiter.enabled) { "Green" } else { "Yellow" })
            Write-Host "    gpuKeys: $($config.gpuArbiter.gpuKeys -join ', ')" -ForegroundColor Cyan
            Write-Host "    queueLimit: $($config.gpuArbiter.defaultQueueLimit)" -ForegroundColor Cyan
            Write-Host "    holdMaxMs: $($config.gpuArbiter.defaultHoldMaxMs)" -ForegroundColor Cyan
            
            if ($config.gpuArbiter.enabled) {
                Write-Host "  [OK] GPU Arbiter is ENABLED" -ForegroundColor Green
            } else {
                Write-Host "  [WARN] GPU Arbiter is DISABLED" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [WARN] GPU Arbiter config not found" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [ERROR] Failed to parse config: $_" -ForegroundColor Red
    }
} else {
    Write-Host "  [WARN] Config file not found" -ForegroundColor Yellow
    Write-Host "    Using default config (GPU Arbiter disabled)" -ForegroundColor Gray
}

# 3. Check Logs
Write-Host "`n3. Checking Logs..." -ForegroundColor Yellow
$logDirs = @(
    "$env:APPDATA\electron-node\logs",
    "$env:LOCALAPPDATA\electron-node\logs"
)

$logFound = $false
foreach ($logDir in $logDirs) {
    if (Test-Path $logDir) {
        $logFiles = Get-ChildItem -Path $logDir -Filter "*.log" -ErrorAction SilentlyContinue | 
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($logFiles) {
            $logFound = $true
            $latestLog = $logFiles[0].FullName
            Write-Host "  [OK] Found log file: $($logFiles[0].Name)" -ForegroundColor Green
            Write-Host "    Path: $latestLog" -ForegroundColor Gray
            Write-Host "    Last modified: $(Get-Date $logFiles[0].LastWriteTime -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
            
            # Check for GPU Arbiter logs
            Write-Host "`n  Checking for GPU Arbiter logs..." -ForegroundColor Yellow
            $gpuLogs = Select-String -Path $latestLog -Pattern "GpuArbiter|gpu.*arbiter|GPU.*lease" -CaseSensitive:$false | Select-Object -Last 10
            if ($gpuLogs) {
                Write-Host "  [OK] Found GPU Arbiter logs ($($gpuLogs.Count) entries):" -ForegroundColor Green
                $gpuLogs | ForEach-Object {
                    $line = $_.Line.Trim()
                    if ($line.Length -gt 100) {
                        $line = $line.Substring(0, 100) + "..."
                    }
                    Write-Host "    $line" -ForegroundColor Gray
                }
            } else {
                Write-Host "  [INFO] No GPU Arbiter logs found yet" -ForegroundColor Yellow
                Write-Host "    Possible reasons:" -ForegroundColor Yellow
                Write-Host "    1. GPU Arbiter not enabled" -ForegroundColor Gray
                Write-Host "    2. Node not restarted after enabling" -ForegroundColor Gray
                Write-Host "    3. No GPU tasks processed yet" -ForegroundColor Gray
            }
            break
        }
    }
}

if (-not $logFound) {
    Write-Host "  [WARN] No log files found" -ForegroundColor Yellow
}

# 4. Summary
Write-Host "`n4. Summary:" -ForegroundColor Yellow
$configPath = "$env:APPDATA\electron-node\electron-node-config.json"
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.gpuArbiter -and $config.gpuArbiter.enabled) {
        Write-Host "  [OK] GPU Arbiter is configured and enabled" -ForegroundColor Green
        Write-Host "  [ACTION] If you just enabled it, RESTART the node" -ForegroundColor Cyan
        Write-Host "  [TEST] After restart, send translation tasks and check logs for:" -ForegroundColor Cyan
        Write-Host "    - 'GpuArbiter initialized'" -ForegroundColor Gray
        Write-Host "    - 'GpuArbiter: Lease acquired'" -ForegroundColor Gray
        Write-Host "    - 'GpuArbiter: Lease released'" -ForegroundColor Gray
    } else {
        Write-Host "  [WARN] GPU Arbiter is not enabled" -ForegroundColor Yellow
        Write-Host "  [ACTION] Enable it in config and restart node" -ForegroundColor Cyan
    }
} else {
    Write-Host "  [INFO] Config file will be created on first node run" -ForegroundColor Cyan
}

Write-Host "`n=== Check Complete ===" -ForegroundColor Green
