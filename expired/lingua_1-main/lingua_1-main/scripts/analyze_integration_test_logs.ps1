# 集成测试日志分析脚本
# 分析调度服务器、节点端和Web端的日志，计算每个任务在各步骤的耗时

$ErrorActionPreference = "Continue"

Write-Host "=== 集成测试日志分析 ===" -ForegroundColor Cyan
Write-Host ""

# 日志文件路径
$schedulerLog = "central_server\scheduler\logs\scheduler.log"
$nodeLog = "electron_node\electron-node\logs\electron-main.log"
$webLog = "webapp\web-client\logs\web-client.log"

# 1. 检查日志文件是否存在
Write-Host "1. 检查日志文件..." -ForegroundColor Yellow
$logs = @{}
if (Test-Path $schedulerLog) {
    $logs["scheduler"] = $schedulerLog
    Write-Host "  ✓ 调度服务器日志: $schedulerLog" -ForegroundColor Green
} else {
    Write-Host "  ✗ 调度服务器日志不存在: $schedulerLog" -ForegroundColor Red
}

if (Test-Path $nodeLog) {
    $logs["node"] = $nodeLog
    Write-Host "  ✓ 节点端日志: $nodeLog" -ForegroundColor Green
} else {
    Write-Host "  ✗ 节点端日志不存在: $nodeLog" -ForegroundColor Red
}

if (Test-Path $webLog) {
    $logs["web"] = $webLog
    Write-Host "  ✓ Web端日志: $webLog" -ForegroundColor Green
} else {
    Write-Host "  ✗ Web端日志不存在: $webLog" -ForegroundColor Red
}

Write-Host ""

# 2. 提取任务ID（session_id和job_id）
Write-Host "2. 提取任务ID..." -ForegroundColor Yellow
$allJobIds = @{}
$allSessionIds = @{}

if ($logs.ContainsKey("scheduler")) {
    $schedulerLines = Get-Content $logs["scheduler"] -Tail 2000
    foreach ($line in $schedulerLines) {
        # 提取 session_id (格式: session_id=s-XXXXX)
        if ($line -match 'session_id=([sS]-[A-F0-9]+)') {
            $sessionId = $matches[1]
            $allSessionIds[$sessionId] = $true
        }
        # 提取 job_id (格式: job_id=s-XXXXX:Y)
        if ($line -match 'job_id=([sS]-[A-F0-9]+:\d+)') {
            $jobId = $matches[1]
            $allJobIds[$jobId] = $true
        }
    }
}

Write-Host "  找到 $($allSessionIds.Count) 个会话ID" -ForegroundColor Gray
Write-Host "  找到 $($allJobIds.Count) 个任务ID" -ForegroundColor Gray

# 显示前10个
if ($allSessionIds.Count -gt 0) {
    Write-Host "  示例会话ID:" -ForegroundColor Gray
    $allSessionIds.Keys | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
}

Write-Host ""

# 3. 分析每个任务的时间线
Write-Host "3. 分析任务时间线..." -ForegroundColor Yellow

# 解析日志行的时间戳（Rust tracing格式）
function Parse-Timestamp {
    param([string]$line)
    
    # Rust tracing 格式: 2025-01-11T23:05:12.123456Z
    if ($line -match '(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+)') {
        $timestampStr = $matches[1]
        try {
            return [DateTimeOffset]::Parse($timestampStr)
        } catch {
            return $null
        }
    }
    return $null
}

# 分析单个任务
$taskAnalysis = @{}

foreach ($sessionId in $allSessionIds.Keys) {
    $jobIds = $allJobIds.Keys | Where-Object { $_ -like "$sessionId*" }
    
    foreach ($jobId in $jobIds) {
        Write-Host "  分析任务: $jobId" -ForegroundColor Gray
        
        $events = @{
            "task_created" = $null      # 任务创建
            "job_assign_sent" = $null   # 任务发送给节点
            "job_ack_received" = $null  # 节点确认接收
            "job_started" = $null       # 节点开始处理
            "job_result_received" = $null  # 节点返回结果
            "result_sent_to_web" = $null   # 结果发送给Web
        }
        
        # 从调度服务器日志提取
        if ($logs.ContainsKey("scheduler")) {
            $schedulerLines = Get-Content $logs["scheduler"] -Tail 2000
            foreach ($line in $schedulerLines) {
                if ($line -match $jobId) {
                    $ts = Parse-Timestamp $line
                    if ($ts) {
                        # 任务创建
                        if ($line -match '翻译任务创建|create.*job|dispatch_task') {
                            if (-not $events["task_created"]) {
                                $events["task_created"] = $ts
                            }
                        }
                        # 任务发送
                        if ($line -match 'JobAssign|job_assign|发送.*任务') {
                            if (-not $events["job_assign_sent"]) {
                                $events["job_assign_sent"] = $ts
                            }
                        }
                        # 节点确认
                        if ($line -match 'JobAck|job_ack|确认.*接收') {
                            if (-not $events["job_ack_received"]) {
                                $events["job_ack_received"] = $ts
                            }
                        }
                        # 节点开始
                        if ($line -match 'JobStarted|job_started|开始.*处理') {
                            if (-not $events["job_started"]) {
                                $events["job_started"] = $ts
                            }
                        }
                        # 结果接收
                        if ($line -match 'JobResult|job_result|收到.*结果') {
                            if (-not $events["job_result_received"]) {
                                $events["job_result_received"] = $ts
                            }
                        }
                        # 结果发送给Web
                        if ($line -match '发送.*结果|send.*result|SessionMessage') {
                            if (-not $events["result_sent_to_web"]) {
                                $events["result_sent_to_web"] = $ts
                            }
                        }
                    }
                }
            }
        }
        
        # 计算耗时
        $durations = @{}
        if ($events["task_created"] -and $events["job_assign_sent"]) {
            $durations["创建到发送"] = ($events["job_assign_sent"] - $events["task_created"]).TotalMilliseconds
        }
        if ($events["job_assign_sent"] -and $events["job_ack_received"]) {
            $durations["发送到确认"] = ($events["job_ack_received"] - $events["job_assign_sent"]).TotalMilliseconds
        }
        if ($events["job_ack_received"] -and $events["job_started"]) {
            $durations["确认到开始"] = ($events["job_started"] - $events["job_ack_received"]).TotalMilliseconds
        }
        if ($events["job_started"] -and $events["job_result_received"]) {
            $durations["处理时间"] = ($events["job_result_received"] - $events["job_started"]).TotalMilliseconds
        }
        if ($events["job_result_received"] -and $events["result_sent_to_web"]) {
            $durations["结果到Web"] = ($events["result_sent_to_web"] - $events["job_result_received"]).TotalMilliseconds
        }
        if ($events["task_created"] -and $events["result_sent_to_web"]) {
            $durations["总耗时"] = ($events["result_sent_to_web"] - $events["task_created"]).TotalMilliseconds
        }
        
        $taskAnalysis[$jobId] = @{
            Events = $events
            Durations = $durations
        }
    }
}

Write-Host ""

# 4. 输出分析结果
Write-Host "4. 任务耗时分析结果:" -ForegroundColor Yellow
Write-Host ""

foreach ($jobId in ($taskAnalysis.Keys | Sort-Object)) {
    $analysis = $taskAnalysis[$jobId]
    Write-Host "任务: $jobId" -ForegroundColor Cyan
    
    foreach ($key in $analysis.Durations.Keys | Sort-Object) {
        $ms = $analysis.Durations[$key]
        $color = if ($ms -gt 5000) { "Red" } elseif ($ms -gt 2000) { "Yellow" } else { "Green" }
        Write-Host "  $key : $([math]::Round($ms, 2)) ms" -ForegroundColor $color
    }
    
    Write-Host ""
}

# 5. 统计错误和警告
Write-Host "5. 错误和警告统计:" -ForegroundColor Yellow
Write-Host ""

if ($logs.ContainsKey("scheduler")) {
    $errorCount = (Get-Content $logs["scheduler"] -Tail 2000 | Select-String -Pattern "ERROR" -CaseSensitive).Count
    $warnCount = (Get-Content $logs["scheduler"] -Tail 2000 | Select-String -Pattern "WARN" -CaseSensitive).Count
    Write-Host "  调度服务器 (最近2000行):" -ForegroundColor Gray
    Write-Host "    ERROR: $errorCount" -ForegroundColor $(if ($errorCount -gt 0) { "Red" } else { "Green" })
    Write-Host "    WARN: $warnCount" -ForegroundColor $(if ($warnCount -gt 0) { "Yellow" } else { "Green" })
}

if ($logs.ContainsKey("node")) {
    $errorCount = (Get-Content $logs["node"] -Tail 2000 | Select-String -Pattern '"level":\s*50|"level":\s*40' -CaseSensitive).Count
    $warnCount = (Get-Content $logs["node"] -Tail 2000 | Select-String -Pattern '"level":\s*40' -CaseSensitive).Count
    Write-Host "  节点端 (最近2000行):" -ForegroundColor Gray
    Write-Host "    ERROR (level 50): $errorCount" -ForegroundColor $(if ($errorCount -gt 0) { "Red" } else { "Green" })
    Write-Host "    WARN (level 40): $warnCount" -ForegroundColor $(if ($warnCount -gt 0) { "Yellow" } else { "Green" })
}

Write-Host ""
Write-Host "分析完成！" -ForegroundColor Green
