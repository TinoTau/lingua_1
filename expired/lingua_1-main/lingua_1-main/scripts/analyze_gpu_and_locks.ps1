# Analyze GPU usage and lock contention issues
# Check: 1. GPU usage timeline 2. GPU arbiter status 3. Scheduler lock contention

param(
    [string]$SchedulerLog = "central_server\scheduler\logs\scheduler.log",
    [string]$NodeLog = "electron_node\electron-node\logs\electron-main.log"
)

Write-Host "`n=== GPU Usage and Lock Contention Analysis ===" -ForegroundColor Cyan

# 1. Check GPU usage timeline
Write-Host "`n[1] Checking GPU usage timeline..." -ForegroundColor Yellow
if (Test-Path $NodeLog) {
    Write-Host "Checking node log: $NodeLog" -ForegroundColor Gray
    $gpuLogs = Select-String -Path $NodeLog -Pattern "gpu.*percent|gpu.*usage|GPU.*usage|gpu_percent" -Context 1,1 | Select-Object -Last 50
    if ($gpuLogs) {
        Write-Host "Found GPU usage logs:" -ForegroundColor Green
        $gpuLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
            if ($_.Context.PreContext) {
                $_.Context.PreContext | ForEach-Object {
                    Write-Host "    [Before] $_" -ForegroundColor Gray
                }
            }
            if ($_.Context.PostContext) {
                $_.Context.PostContext | ForEach-Object {
                    Write-Host "    [After] $_" -ForegroundColor Gray
                }
            }
        }
    } else {
        Write-Host "No GPU usage logs found" -ForegroundColor Yellow
    }
} else {
    Write-Host "Node log file not found: $NodeLog" -ForegroundColor Red
}

# 2. Check GPU arbiter logs
Write-Host "`n[2] Checking GPU arbiter logs..." -ForegroundColor Yellow
if (Test-Path $NodeLog) {
    $arbiterLogs = Select-String -Path $NodeLog -Pattern "GpuArbiter|GPU.*lease|acquire.*lease|release.*lease|GPU.*arbiter|gpu.*arbiter" -Context 0,2 | Select-Object -Last 50
    if ($arbiterLogs) {
        Write-Host "Found GPU arbiter logs:" -ForegroundColor Green
        $arbiterLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
        }
    } else {
        Write-Host "No GPU arbiter logs found (may not be enabled)" -ForegroundColor Yellow
    }
    
    # Check if GPU arbiter is enabled
    $arbiterEnabled = Select-String -Path $NodeLog -Pattern "GpuArbiter.*enabled|GPU.*arbiter.*enabled|gpuArbiter.*enabled" -Context 0,1 | Select-Object -Last 5
    if ($arbiterEnabled) {
        Write-Host "`nGPU arbiter enabled status:" -ForegroundColor Gray
        $arbiterEnabled | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
        }
    }
} else {
    Write-Host "Node log file not found: $NodeLog" -ForegroundColor Red
}

# 3. Check scheduler lock contention
Write-Host "`n[3] Checking scheduler lock contention..." -ForegroundColor Yellow
if (Test-Path $SchedulerLog) {
    $lockLogs = Select-String -Path $SchedulerLog -Pattern "锁等待超过阈值|lock.*wait|contention|wait_ms" -Context 1,1 | Select-Object -Last 50
    if ($lockLogs) {
        Write-Host "Found lock wait logs:" -ForegroundColor Green
        $lockLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
            if ($_.Context.PreContext) {
                $_.Context.PreContext | ForEach-Object {
                    Write-Host "    [Before] $_" -ForegroundColor Gray
                }
            }
            if ($_.Context.PostContext) {
                $_.Context.PostContext | ForEach-Object {
                    Write-Host "    [After] $_" -ForegroundColor Gray
                }
            }
        }
        
        # Statistics on lock wait times
        Write-Host "`nLock wait time statistics:" -ForegroundColor Gray
        $lockWaitTimes = $lockLogs | ForEach-Object {
            if ($_.Line -match "wait_ms\s*=\s*(\d+)") {
                [int]$matches[1]
            }
        } | Where-Object { $_ -gt 0 }
        if ($lockWaitTimes) {
            $maxWait = ($lockWaitTimes | Measure-Object -Maximum).Maximum
            $avgWait = ($lockWaitTimes | Measure-Object -Average).Average
            Write-Host "  Max wait time: $maxWait ms" -ForegroundColor White
            Write-Host "  Average wait time: $([math]::Round($avgWait, 2)) ms" -ForegroundColor White
            Write-Host "  Count > 100ms: $(($lockWaitTimes | Where-Object { $_ -gt 100 }).Count)" -ForegroundColor White
            Write-Host "  Count > 500ms: $(($lockWaitTimes | Where-Object { $_ -gt 500 }).Count)" -ForegroundColor White
            Write-Host "  Count > 1000ms: $(($lockWaitTimes | Where-Object { $_ -gt 1000 }).Count)" -ForegroundColor White
        }
    } else {
        Write-Host "No lock wait logs found" -ForegroundColor Yellow
    }
    
    # Check specific lock wait times
    Write-Host "`nChecking specific lock wait times:" -ForegroundColor Gray
    $specificLocks = @("node_registry.nodes.write", "node_registry.nodes.read", "node_registry.phase3_node_pool.write", "node_registry.phase3_pool_index.write")
    foreach ($lockName in $specificLocks) {
        $lockSpecificLogs = Select-String -Path $SchedulerLog -Pattern "lock.*=.*$lockName|lock.*$lockName" -Context 0,0 | Select-Object -Last 10
        if ($lockSpecificLogs) {
            Write-Host "  $lockName :" -ForegroundColor Yellow
            $lockSpecificLogs | ForEach-Object {
                if ($_.Line -match "wait_ms\s*=\s*(\d+)") {
                    Write-Host "    $($matches[1]) ms" -ForegroundColor White
                }
            }
        }
    }
} else {
    Write-Host "Scheduler log file not found: $SchedulerLog" -ForegroundColor Red
}

# 4. Check task timing distribution
Write-Host "`n[4] Checking task timing distribution..." -ForegroundColor Yellow
if (Test-Path $SchedulerLog) {
    $timingLogs = Select-String -Path $SchedulerLog -Pattern "elapsed_ms|processing_time_ms|dispatch.*time" -Context 0,0 | Select-Object -Last 30
    if ($timingLogs) {
        Write-Host "Found task timing logs:" -ForegroundColor Green
        $timingLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
        }
    }
}

Write-Host "`n=== Analysis Complete ===" -ForegroundColor Cyan
Write-Host "`nKey Findings:" -ForegroundColor Yellow
Write-Host "  - If GPU usage stays at 100%, check if tasks are not releasing GPU leases" -ForegroundColor White
Write-Host "  - If GPU arbiter is not enabled, node cannot control GPU concurrency, may cause high GPU usage" -ForegroundColor White
Write-Host "  - If lock wait times are too long, may be due to long lock hold times or too many concurrent accesses" -ForegroundColor White
