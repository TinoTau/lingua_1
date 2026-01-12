# 集成测试性能分析脚本
# 分析调度服务器、节点端、Web端的日志，统计流程耗时

param(
    [string]$SchedulerLogPath = "central_server\scheduler\logs\scheduler.log",
    [string]$NodeLogPath = "electron_node\electron-node\logs\electron-main.log",
    [string]$WebLogPath = "webapp\web-client\logs\web-client.log",
    [int]$Lines = 500
)

Write-Host "=== 集成测试性能分析 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 分析调度服务器日志
Write-Host "1. 调度服务器日志分析" -ForegroundColor Yellow
if (Test-Path $SchedulerLogPath) {
    $schedulerLog = Get-Content $SchedulerLogPath -Tail $Lines
    
    # 提取最近的 session
    $lastSession = ($schedulerLog | Select-String -Pattern '"session_id":"(s-[A-F0-9]{8})"' | Select-Object -Last 1)
    if ($lastSession) {
        $sessionId = $lastSession.Matches[0].Groups[1].Value
        Write-Host "  最近的 session_id: $sessionId" -ForegroundColor Green
        
        # 提取该 session 的所有事件
        $sessionEvents = $schedulerLog | Select-String -Pattern $sessionId | Select-String -Pattern "timestamp"
        
        Write-Host "`n  错误和警告:" -ForegroundColor Yellow
        $errors = $schedulerLog | Select-String -Pattern "ERROR" | Select-Object -Last 5
        $warnings = $schedulerLog | Select-String -Pattern "WARN" | Select-Object -Last 5
        if ($errors) { $errors | ForEach-Object { Write-Host "    ERROR: $($_.Line.Substring(0, [Math]::Min(150, $_.Line.Length)))" -ForegroundColor Red } }
        if ($warnings) { $warnings | ForEach-Object { Write-Host "    WARN: $($_.Line.Substring(0, [Math]::Min(150, $_.Line.Length)))" -ForegroundColor Yellow } }
        if (-not $errors -and -not $warnings) { Write-Host "    无错误和警告" -ForegroundColor Green }
        
        # 提取关键时间点
        Write-Host "`n  关键流程时间点 (session: $sessionId):" -ForegroundColor Yellow
        $timeline = @()
        
        # 解析 JSON 日志中的时间戳
        foreach ($line in $sessionEvents) {
            try {
                $json = $line.Line | ConvertFrom-Json
                $timestamp = $json.timestamp
                $message = $json.fields.message
                
                # 提取关键事件
                if ($message -match "创建翻译任务|任务调度成功|JobAssign|任务完成成功|翻译结果|Received JobResult") {
                    $timeline += [PSCustomObject]@{
                        Time = $timestamp
                        Event = $message
                        JobId = if ($json.fields.job_id) { $json.fields.job_id } else { "" }
                    }
                }
            } catch {
                # 忽略解析错误
            }
        }
        
        $timeline | Sort-Object Time | ForEach-Object {
            Write-Host "    $($_.Time) - $($_.Event) - $($_.JobId)"
        }
        
        # 计算耗时
        if ($timeline.Count -ge 2) {
            Write-Host "`n  流程耗时统计:" -ForegroundColor Yellow
            $firstTime = [DateTime]::Parse($timeline[0].Time)
            $lastTime = [DateTime]::Parse($timeline[-1].Time)
            $totalMs = ($lastTime - $firstTime).TotalMilliseconds
            Write-Host "    总耗时: $([Math]::Round($totalMs, 2)) ms" -ForegroundColor Green
        }
    } else {
        Write-Host "  未找到 session 信息" -ForegroundColor Yellow
    }
} else {
    Write-Host "  调度服务器日志文件不存在: $SchedulerLogPath" -ForegroundColor Red
}

# 2. 分析节点端日志
Write-Host "`n2. 节点端日志分析" -ForegroundColor Yellow
if (Test-Path $NodeLogPath) {
    $nodeLog = Get-Content $NodeLogPath -Tail $Lines
    
    Write-Host "  错误和警告:" -ForegroundColor Yellow
    $errors = $nodeLog | Select-String -Pattern "ERROR|error" | Select-Object -Last 5
    $warnings = $nodeLog | Select-String -Pattern "WARN|warn" | Select-Object -Last 5
    if ($errors) { $errors | ForEach-Object { Write-Host "    ERROR: $($_.Line.Substring(0, [Math]::Min(150, $_.Line.Length)))" -ForegroundColor Red } }
    if ($warnings) { $warnings | ForEach-Object { Write-Host "    WARN: $($_.Line.Substring(0, [Math]::Min(150, $_.Line.Length)))" -ForegroundColor Yellow } }
    if (-not $errors -and -not $warnings) { Write-Host "    无错误和警告" -ForegroundColor Green }
    
    # 提取 processing_time_ms
    Write-Host "`n  节点处理耗时:" -ForegroundColor Yellow
    $processingTimes = $nodeLog | Select-String -Pattern "processing_time_ms" | Select-Object -Last 5
    foreach ($line in $processingTimes) {
        if ($line -match '"processing_time_ms":(\d+)') {
            $ms = $matches[1]
            Write-Host "    processing_time_ms: $ms ms" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  节点端日志文件不存在: $NodeLogPath" -ForegroundColor Yellow
}

# 3. 分析Web端日志
Write-Host "`n3. Web端日志分析" -ForegroundColor Yellow
if (Test-Path $WebLogPath) {
    $webLog = Get-Content $WebLogPath -Tail $Lines
    
    Write-Host "  错误和警告:" -ForegroundColor Yellow
    $errors = $webLog | Select-String -Pattern "ERROR|error" | Select-Object -Last 5
    $warnings = $webLog | Select-String -Pattern "WARN|warn" | Select-Object -Last 5
    if ($errors) { $errors | ForEach-Object { Write-Host "    ERROR: $($_.Line.Substring(0, [Math]::Min(150, $_.Line.Length)))" -ForegroundColor Red } }
    if ($warnings) { $warnings | ForEach-Object { Write-Host "    WARN: $($_.Line.Substring(0, [Math]::Min(150, $_.Line.Length)))" -ForegroundColor Yellow } }
    if (-not $errors -and -not $warnings) { Write-Host "    无错误和警告" -ForegroundColor Green }
} else {
    Write-Host "  Web端日志文件不存在: $WebLogPath" -ForegroundColor Yellow
}

Write-Host "`n=== 分析完成 ===" -ForegroundColor Cyan
