# 集成测试性能分析脚本（简化版）
# 分析调度服务器、节点端、Web端的日志，统计流程耗时

param(
    [string]$SchedulerLogPath = "central_server\scheduler\logs\scheduler.log",
    [string]$NodeLogPath = "electron_node\electron-node\logs\electron-main.log",
    [string]$WebLogPath = "webapp\web-client\logs\web-client.log"
)

Write-Host "=== 集成测试性能分析 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 分析调度服务器日志
Write-Host "1. 调度服务器日志分析" -ForegroundColor Yellow
if (Test-Path $SchedulerLogPath) {
    $log = Get-Content $SchedulerLogPath -Tail 500
    
    # 提取错误和警告
    Write-Host "`n  错误 (ERROR):" -ForegroundColor Red
    $errors = $log | Select-String -Pattern '"level":"ERROR"' | Select-Object -Last 5
    if ($errors) {
        foreach ($e in $errors) {
            try {
                $json = $e.Line | ConvertFrom-Json
                Write-Host "    $($json.timestamp) - $($json.fields.message)" -ForegroundColor Red
                if ($json.fields.error) {
                    Write-Host "      错误详情: $($json.fields.error)" -ForegroundColor Red
                }
            } catch {
                Write-Host "    $($e.Line.Substring(0, [Math]::Min(200, $_.Line.Length)))" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "    无错误" -ForegroundColor Green
    }
    
    Write-Host "`n  警告 (WARN):" -ForegroundColor Yellow
    $warnings = $log | Select-String -Pattern '"level":"WARN"' | Select-Object -Last 10
    if ($warnings) {
        foreach ($w in $warnings) {
            try {
                $json = $w.Line | ConvertFrom-Json
                $msg = $json.fields.message
                # 过滤掉正常的警告（如 Phase2 XREADGROUP，这是启动时的正常现象）
                if ($msg -notmatch "Phase2 XREADGROUP") {
                    Write-Host "    $($json.timestamp) - $msg" -ForegroundColor Yellow
                }
            } catch {
                # 忽略解析错误
            }
        }
    } else {
        Write-Host "    无警告" -ForegroundColor Green
    }
    
    # 提取最近一次完整任务的时间线
    Write-Host "`n  最近一次完整任务流程 (job_id: s-F3C3DFDC:7):" -ForegroundColor Yellow
    $job7 = $log | Select-String -Pattern "s-F3C3DFDC:7"
    
    $events = @()
    foreach ($line in $job7) {
        try {
            $json = $line.Line | ConvertFrom-Json
            $msg = $json.fields.message
            if ($msg -match "创建翻译任务|任务调度成功|JobAssign|Received JobResult|任务完成成功|翻译结果|elapsed_ms|processing_time_ms") {
                $events += [PSCustomObject]@{
                    Time = $json.timestamp
                    Event = $msg
                    JobId = if ($json.fields.job_id) { $json.fields.job_id } else { "" }
                    Elapsed = if ($json.fields.elapsed_ms) { $json.fields.elapsed_ms } else { "" }
                }
            }
        } catch {
            # 忽略解析错误
        }
    }
    
    if ($events.Count -gt 0) {
        $events | Sort-Object Time | ForEach-Object {
            $elapsedInfo = if ($_.Elapsed) { " (耗时: $($_.Elapsed) ms)" } else { "" }
            Write-Host "    $($_.Time) - $($_.Event)$elapsedInfo"
        }
        
        # 计算总耗时
        if ($events.Count -ge 2) {
            $firstTime = [DateTime]::Parse($events[0].Time)
            $lastTime = [DateTime]::Parse($events[-1].Time)
            $totalMs = ($lastTime - $firstTime).TotalMilliseconds
            Write-Host "`n    总耗时: $([Math]::Round($totalMs, 2)) ms" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  调度服务器日志文件不存在" -ForegroundColor Red
}

# 2. 分析节点端日志
Write-Host "`n2. 节点端日志分析" -ForegroundColor Yellow
if (Test-Path $NodeLogPath) {
    $log = Get-Content $NodeLogPath -Tail 200
    
    Write-Host "  错误和警告:" -ForegroundColor Yellow
    $errors = $log | Select-String -Pattern '"level":(50|40)|ERROR|WARN' | Select-Object -Last 10
    if ($errors) {
        $errors | ForEach-Object {
            Write-Host "    $($_.Line.Substring(0, [Math]::Min(200, $_.Line.Length)))" -ForegroundColor Yellow
        }
    } else {
        Write-Host "    无错误和警告" -ForegroundColor Green
    }
    
    # 提取 processing_time_ms
    Write-Host "`n  节点处理耗时:" -ForegroundColor Yellow
    $processing = $log | Select-String -Pattern "processing_time_ms" | Select-Object -Last 3
    foreach ($p in $processing) {
        if ($p -match '"processing_time_ms":(\d+)') {
            $ms = $matches[1]
            Write-Host "    processing_time_ms: $ms ms" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  节点端日志文件不存在" -ForegroundColor Yellow
}

# 3. 分析Web端日志
Write-Host "`n3. Web端日志分析" -ForegroundColor Yellow
if (Test-Path $WebLogPath) {
    $log = Get-Content $WebLogPath -Tail 200
    
    Write-Host "  错误和警告:" -ForegroundColor Yellow
    $errors = $log | Select-String -Pattern "ERROR|WARN|error|warn" | Select-Object -Last 10
    if ($errors) {
        $errors | ForEach-Object {
            Write-Host "    $($_.Line.Substring(0, [Math]::Min(200, $_.Line.Length)))" -ForegroundColor Yellow
        }
    } else {
        Write-Host "    无错误和警告" -ForegroundColor Green
    }
} else {
    Write-Host "  Web端日志文件不存在" -ForegroundColor Yellow
}

Write-Host "`n=== 分析完成 ===" -ForegroundColor Cyan
