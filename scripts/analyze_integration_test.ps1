# 分析集成测试日志
# 检查：1. 语义修复是否生效 2. 任务耗时 3. 无可用节点原因

param(
    [string]$SchedulerLog = "central_server\scheduler\logs\scheduler.log",
    [string]$NodeLog = "electron_node\electron-node\logs\electron-main.log",
    [string]$SemanticRepairLog = "electron_node\services\semantic_repair_zh\logs\semantic-repair-zh-service.log"
)

Write-Host "`n=== Integration Test Log Analysis ===" -ForegroundColor Cyan

# 1. Check if semantic repair is working
Write-Host "`n[1] Checking semantic repair..." -ForegroundColor Yellow
if (Test-Path $NodeLog) {
    Write-Host "Checking node log: $NodeLog" -ForegroundColor Gray
    $semanticRepairLogs = Select-String -Path $NodeLog -Pattern "semantic.*repair|SemanticRepair|语义修复" -Context 0,2 | Select-Object -Last 20
    if ($semanticRepairLogs) {
        Write-Host "Found semantic repair logs:" -ForegroundColor Green
        $semanticRepairLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
        }
    } else {
        Write-Host "No semantic repair logs found" -ForegroundColor Red
    }
} else {
    Write-Host "Node log file not found: $NodeLog" -ForegroundColor Red
}

# Check semantic repair service log
if (Test-Path $SemanticRepairLog) {
    Write-Host "`nChecking semantic repair service log: $SemanticRepairLog" -ForegroundColor Gray
    $repairServiceLogs = Select-String -Path $SemanticRepairLog -Pattern "SEMANTIC_REPAIR.*OUTPUT|repair.*completed|decision=" -Context 0,1 | Select-Object -Last 20
    if ($repairServiceLogs) {
        Write-Host "Found semantic repair service output:" -ForegroundColor Green
        $repairServiceLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
        }
    } else {
        Write-Host "No semantic repair service output found" -ForegroundColor Yellow
    }
} else {
    Write-Host "Semantic repair service log file not found: $SemanticRepairLog" -ForegroundColor Yellow
}

# 2. Check task timing
Write-Host "`n[2] Checking task timing..." -ForegroundColor Yellow
if (Test-Path $SchedulerLog) {
    Write-Host "Checking scheduler log: $SchedulerLog" -ForegroundColor Gray
    $timingLogs = Select-String -Path $SchedulerLog -Pattern "job.*duration|耗时|elapsed|time.*ms|dispatch.*time" -Context 0,1 | Select-Object -Last 30
    if ($timingLogs) {
        Write-Host "Found timing logs:" -ForegroundColor Green
        $timingLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
        }
    } else {
        Write-Host "No timing logs found" -ForegroundColor Yellow
    }
} else {
    Write-Host "Scheduler log file not found: $SchedulerLog" -ForegroundColor Red
}

# 3. Check no available node reasons
Write-Host "`n[3] Checking no available node reasons..." -ForegroundColor Yellow
if (Test-Path $SchedulerLog) {
    $noNodeLogs = Select-String -Path $SchedulerLog -Pattern "无可用节点|no available node|Node excluded|resource threshold|capacity exceeded|status not ready" -Context 2,2 | Select-Object -Last 30
    if ($noNodeLogs) {
        Write-Host "Found node selection failure logs:" -ForegroundColor Green
        $noNodeLogs | ForEach-Object {
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
        Write-Host "No node selection failure logs found" -ForegroundColor Yellow
    }
    
    # Check resource usage
    Write-Host "`nChecking node resource usage..." -ForegroundColor Gray
    $resourceLogs = Select-String -Path $SchedulerLog -Pattern "cpu_usage|gpu_usage|memory_usage|resource.*threshold" -Context 0,1 | Select-Object -Last 20
    if ($resourceLogs) {
        Write-Host "Found resource usage logs:" -ForegroundColor Green
        $resourceLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
        }
    }
} else {
    Write-Host "Scheduler log file not found: $SchedulerLog" -ForegroundColor Red
}

# 4. Check recent job processing
Write-Host "`n[4] Checking recent job processing..." -ForegroundColor Yellow
if (Test-Path $SchedulerLog) {
    $jobLogs = Select-String -Path $SchedulerLog -Pattern "job-|Job.*created|Job.*dispatched|Job.*completed" -Context 0,1 | Select-Object -Last 30
    if ($jobLogs) {
        Write-Host "Found recent job processing logs:" -ForegroundColor Green
        $jobLogs | ForEach-Object {
            Write-Host "  $($_.Line)" -ForegroundColor White
        }
    }
}

Write-Host "`n=== Analysis Complete ===" -ForegroundColor Cyan
Write-Host "`nTips:" -ForegroundColor Yellow
Write-Host "  - If semantic repair is not working, check if semantic repair service is started on node" -ForegroundColor White
Write-Host "  - If task timing is too long, check node service queue and GPU usage" -ForegroundColor White
Write-Host "  - If no available nodes, check if resource usage exceeds threshold (CPU/GPU: 85%, Memory: 95%)" -ForegroundColor White
