# 分析集成测试日志
# 检查：1. 每个job耗时 2. 语义修复服务调用 3. 异常情况

param(
    [string]$NodeLog = "electron_node\electron-node\logs\electron-main.log",
    [string]$InferenceLog = "electron_node\services\node-inference\logs\node-inference.log",
    [string]$SemanticRepairLog = "electron_node\services\semantic_repair_zh\logs\semantic-repair-zh-service.log"
)

Write-Host "`n=== 集成测试日志分析 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 分析 Node 端日志
Write-Host "[1] 分析 Node 端日志..." -ForegroundColor Yellow
if (Test-Path $NodeLog) {
    $nodeLogs = Get-Content $NodeLog -ErrorAction SilentlyContinue | Where-Object { $_ -match 'job|Job|task|Task|semantic|repair|耗时|duration|time.*ms|error|Error|ERROR' }
    
    # 提取 job 处理记录
    Write-Host "`n  Job 处理记录:" -ForegroundColor Green
    $jobLogs = Get-Content $NodeLog -ErrorAction SilentlyContinue | Where-Object { $_ -match '"jobId"|"job_id"|onTaskProcessed|runJobPipeline|Job.*processed' }
    if ($jobLogs) {
        $jobLogs | Select-Object -Last 20 | ForEach-Object {
            try {
                $log = $_ | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($log) {
                    $time = if ($log.time) { [DateTimeOffset]::FromUnixTimeMilliseconds($log.time).ToString("HH:mm:ss.fff") } else { "N/A" }
                    Write-Host "    [$time] $($log.msg)" -ForegroundColor White
                    if ($log.jobId) { Write-Host "      JobId: $($log.jobId)" -ForegroundColor Gray }
                    if ($log.job_id) { Write-Host "      JobId: $($log.job_id)" -ForegroundColor Gray }
                }
            } catch {
                # 忽略解析错误
            }
        }
    } else {
        Write-Host "    未找到 Job 处理记录" -ForegroundColor Yellow
    }
    
    # 检查语义修复调用
    Write-Host "`n  语义修复服务调用:" -ForegroundColor Green
    $semanticLogs = Get-Content $NodeLog -ErrorAction SilentlyContinue | Where-Object { $_ -match 'semantic.*repair|SemanticRepair|runSemanticRepairStep|语义修复' }
    if ($semanticLogs) {
        $semanticLogs | Select-Object -Last 20 | ForEach-Object {
            try {
                $log = $_ | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($log) {
                    $time = if ($log.time) { [DateTimeOffset]::FromUnixTimeMilliseconds($log.time).ToString("HH:mm:ss.fff") } else { "N/A" }
                    Write-Host "    [$time] $($log.msg)" -ForegroundColor White
                    if ($log.jobId) { Write-Host "      JobId: $($log.jobId)" -ForegroundColor Gray }
                    if ($log.job_id) { Write-Host "      JobId: $($log.job_id)" -ForegroundColor Gray }
                }
            } catch {
                # 忽略解析错误
            }
        }
    } else {
        Write-Host "    未找到语义修复调用记录" -ForegroundColor Red
    }
    
    # 检查错误
    Write-Host "`n  错误记录:" -ForegroundColor Green
    $errorLogs = Get-Content $NodeLog -ErrorAction SilentlyContinue | Where-Object { $_ -match '"level":(50|40)|"error"|Error|ERROR' }
    if ($errorLogs) {
        $errorLogs | Select-Object -Last 10 | ForEach-Object {
            try {
                $log = $_ | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($log -and ($log.level -ge 40)) {
                    $time = if ($log.time) { [DateTimeOffset]::FromUnixTimeMilliseconds($log.time).ToString("HH:mm:ss.fff") } else { "N/A" }
                    Write-Host "    [$time] $($log.msg)" -ForegroundColor Red
                    if ($log.error) { Write-Host "      Error: $($log.error)" -ForegroundColor Gray }
                }
            } catch {
                # 忽略解析错误
            }
        }
    } else {
        Write-Host "    未找到错误记录" -ForegroundColor Green
    }
} else {
    Write-Host "  Node 日志文件不存在: $NodeLog" -ForegroundColor Red
}

# 2. 分析语义修复服务日志
Write-Host "`n[2] 分析语义修复服务日志..." -ForegroundColor Yellow
$semanticRepairLogFiles = @(
    "electron_node\services\semantic_repair_zh\logs\semantic-repair-zh-service.log",
    "electron_node\services\semantic_repair_zh\full_startup.log"
)
$foundSemanticLog = $false
foreach ($logFile in $semanticRepairLogFiles) {
    if (Test-Path $logFile) {
        $foundSemanticLog = $true
        Write-Host "`n  检查文件: $logFile" -ForegroundColor Gray
        $semanticLogs = Get-Content $logFile -ErrorAction SilentlyContinue | Where-Object { $_ -match 'SEMANTIC_REPAIR|repair.*completed|decision=|INPUT|OUTPUT' }
        if ($semanticLogs) {
            Write-Host "  找到语义修复服务调用记录:" -ForegroundColor Green
            $semanticLogs | Select-Object -Last 20 | ForEach-Object {
                Write-Host "    $_" -ForegroundColor White
            }
        } else {
            Write-Host "  未找到语义修复服务调用记录" -ForegroundColor Yellow
        }
        break
    }
}
if (-not $foundSemanticLog) {
    Write-Host "  语义修复服务日志文件不存在" -ForegroundColor Yellow
    Write-Host "  检查目录: electron_node\services\semantic_repair_zh\logs\" -ForegroundColor Gray
    $logDir = "electron_node\services\semantic_repair_zh\logs"
    if (Test-Path $logDir) {
        Get-ChildItem $logDir | ForEach-Object {
            Write-Host "    $($_.Name)" -ForegroundColor Gray
        }
    }
}

# 3. 分析推理服务日志
Write-Host "`n[3] 分析推理服务日志..." -ForegroundColor Yellow
if (Test-Path $InferenceLog) {
    Write-Host "  检查文件: $InferenceLog" -ForegroundColor Gray
    $inferenceLogs = Get-Content $InferenceLog -ErrorAction SilentlyContinue | Select-Object -Last 50
    if ($inferenceLogs) {
        Write-Host "  最近的推理服务日志 (最后50行):" -ForegroundColor Green
        $inferenceLogs | ForEach-Object {
            Write-Host "    $_" -ForegroundColor White
        }
    }
} else {
    Write-Host "  推理服务日志文件不存在: $InferenceLog" -ForegroundColor Yellow
}

# 4. 统计 Job 耗时
Write-Host "`n[4] 统计 Job 耗时..." -ForegroundColor Yellow
if (Test-Path $NodeLog) {
    $allLogs = Get-Content $NodeLog -ErrorAction SilentlyContinue
    $jobStartTimes = @{}
    $jobEndTimes = @{}
    
    foreach ($line in $allLogs) {
        try {
            $log = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($log) {
                $jobId = if ($log.jobId) { $log.jobId } else { $log.job_id }
                if ($jobId) {
                    if ($log.msg -match 'Job.*start|runJobPipeline') {
                        if (-not $jobStartTimes[$jobId]) {
                            $jobStartTimes[$jobId] = $log.time
                        }
                    }
                    if ($log.msg -match 'Job.*end|Job.*completed|Job.*finished') {
                        $jobEndTimes[$jobId] = $log.time
                    }
                }
            }
        } catch {
            # 忽略解析错误
        }
    }
    
    if ($jobStartTimes.Count -gt 0) {
        Write-Host "  找到 $($jobStartTimes.Count) 个 Job" -ForegroundColor Green
        foreach ($jobId in $jobStartTimes.Keys) {
            $startTime = $jobStartTimes[$jobId]
            $endTime = $jobEndTimes[$jobId]
            if ($endTime) {
                $duration = $endTime - $startTime
                Write-Host "    JobId: $jobId, 耗时: ${duration}ms" -ForegroundColor White
            } else {
                Write-Host "    JobId: $jobId, 状态: 进行中" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "  未找到 Job 耗时记录" -ForegroundColor Yellow
    }
}

Write-Host "`n=== 分析完成 ===" -ForegroundColor Cyan
