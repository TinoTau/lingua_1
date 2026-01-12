# 分析最后一句话未返回的问题
# 检查三端日志：scheduler.log, electron-main.log, web端日志

param(
    [string]$SchedulerLog = "central_server\scheduler\logs\scheduler.log",
    [string]$NodeLog = "electron_node\electron-node\logs\electron-main.log",
    [string]$SessionId = ""
)

Write-Host "=== 分析最后一句话未返回的问题 ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $SchedulerLog)) {
    Write-Host "错误: 找不到调度服务器日志: $SchedulerLog" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $NodeLog)) {
    Write-Host "警告: 找不到节点日志: $NodeLog" -ForegroundColor Yellow
}

# 读取调度服务器日志
Write-Host "1. 检查最后一句话的音频块是否到达调度服务器..." -ForegroundColor Yellow
$schedulerLogContent = Get-Content $SchedulerLog -Encoding UTF8 -ErrorAction SilentlyContinue

if ($SessionId) {
    $audioChunks = $schedulerLogContent | Select-String -Pattern "audio_chunk.*session_id.*$SessionId" | Select-Object -Last 10
} else {
    $audioChunks = $schedulerLogContent | Select-String -Pattern "audio_chunk" | Select-Object -Last 20
}

if ($audioChunks) {
    Write-Host "找到音频块记录:" -ForegroundColor Green
    $audioChunks | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "未找到音频块记录" -ForegroundColor Red
}

Write-Host ""
Write-Host "2. 检查最后一句话是否触发了 finalize..." -ForegroundColor Yellow
if ($SessionId) {
    $finalizeLogs = $schedulerLogContent | Select-String -Pattern "finalize.*session_id.*$SessionId|Finalizing.*$SessionId" | Select-Object -Last 10
} else {
    $finalizeLogs = $schedulerLogContent | Select-String -Pattern "finalize|Finalizing" | Select-Object -Last 20
}

if ($finalizeLogs) {
    Write-Host "找到 finalize 记录:" -ForegroundColor Green
    $finalizeLogs | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "未找到 finalize 记录" -ForegroundColor Red
}

Write-Host ""
Write-Host "3. 检查超时机制是否触发..." -ForegroundColor Yellow
if ($SessionId) {
    $timeoutLogs = $schedulerLogContent | Select-String -Pattern "Timeout.*$SessionId|timeout.*$SessionId" | Select-Object -Last 10
} else {
    $timeoutLogs = $schedulerLogContent | Select-String -Pattern "Timeout|timeout" | Select-Object -Last 20
}

if ($timeoutLogs) {
    Write-Host "找到超时记录:" -ForegroundColor Green
    $timeoutLogs | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "未找到超时记录（可能超时未触发）" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "4. 检查最后一句话是否创建了 job..." -ForegroundColor Yellow
if ($SessionId) {
    $jobLogs = $schedulerLogContent | Select-String -Pattern "job_assign.*session_id.*$SessionId|Creating job.*$SessionId" | Select-Object -Last 10
} else {
    $jobLogs = $schedulerLogContent | Select-String -Pattern "job_assign|Creating job" | Select-Object -Last 20
}

if ($jobLogs) {
    Write-Host "找到 job 创建记录:" -ForegroundColor Green
    $jobLogs | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "未找到 job 创建记录（最后一句话可能没有创建 job）" -ForegroundColor Red
}

Write-Host ""
Write-Host "5. 检查节点端是否收到最后一句话的 job..." -ForegroundColor Yellow
if (Test-Path $NodeLog) {
    $nodeLogContent = Get-Content $NodeLog -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($SessionId) {
        $nodeJobLogs = $nodeLogContent | Select-String -Pattern "job_assign.*$SessionId|Received job.*$SessionId" | Select-Object -Last 10
    } else {
        $nodeJobLogs = $nodeLogContent | Select-String -Pattern "job_assign|Received job" | Select-Object -Last 20
    }
    
    if ($nodeJobLogs) {
        Write-Host "找到节点端 job 记录:" -ForegroundColor Green
        $nodeJobLogs | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "未找到节点端 job 记录（最后一句话可能没有发送到节点）" -ForegroundColor Red
    }
} else {
    Write-Host "节点日志不存在，跳过" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "6. 检查 utterance_index 的连续性..." -ForegroundColor Yellow
if ($SessionId) {
    $indexLogs = $schedulerLogContent | Select-String -Pattern "utterance_index.*$SessionId" | Select-Object -Last 30
} else {
    $indexLogs = $schedulerLogContent | Select-String -Pattern "utterance_index" | Select-Object -Last 50
}

if ($indexLogs) {
    Write-Host "找到 utterance_index 记录（最后30条）:" -ForegroundColor Green
    $indexLogs | ForEach-Object { Write-Host "  $_" }
    
    # 尝试提取 utterance_index 值
    $indices = @()
    $indexLogs | ForEach-Object {
        if ($_ -match "utterance_index[:\s]+(\d+)") {
            $indices += [int]$matches[1]
        }
    }
    
    if ($indices.Count -gt 0) {
        Write-Host ""
        Write-Host "utterance_index 序列: $($indices -join ', ')" -ForegroundColor Cyan
        $maxIndex = ($indices | Measure-Object -Maximum).Maximum
        $minIndex = ($indices | Measure-Object -Minimum).Minimum
        Write-Host "范围: $minIndex 到 $maxIndex" -ForegroundColor Cyan
        
        # 检查是否有跳号
        $gaps = @()
        for ($i = $minIndex; $i -lt $maxIndex; $i++) {
            if ($indices -notcontains $i) {
                $gaps += $i
            }
        }
        if ($gaps.Count -gt 0) {
            Write-Host "警告: 发现 utterance_index 跳号: $($gaps -join ', ')" -ForegroundColor Red
        } else {
            Write-Host "utterance_index 连续" -ForegroundColor Green
        }
    }
} else {
    Write-Host "未找到 utterance_index 记录" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 分析完成 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "诊断建议:" -ForegroundColor Yellow
Write-Host "1. 如果最后一句话的音频块到达了，但没有 finalize，可能是超时机制未触发"
Write-Host "2. 如果 finalize 了但没有创建 job，可能是缓冲区为空（Fix-B 应该防止这种情况）"
Write-Host "3. 如果创建了 job 但没有发送到节点，可能是节点不可用或调度问题"
Write-Host "4. 如果发送到节点了但没有返回结果，可能是节点端处理问题"

