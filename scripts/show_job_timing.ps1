# 显示每个 Job 在各服务中的耗时

param(
    [string]$NodeLog = "electron_node\electron-node\logs\electron-main.log"
)

Write-Host "`n=== Job 各服务耗时统计 ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $NodeLog)) {
    Write-Host "日志文件不存在: $NodeLog" -ForegroundColor Red
    exit 1
}

# 读取所有日志行
$allLogs = Get-Content $NodeLog -ErrorAction SilentlyContinue

# 存储所有 job 的耗时信息
$jobs = @{}

# 解析日志，提取耗时信息
foreach ($line in $allLogs) {
    try {
        $log = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
        if (-not $log) { continue }
        
        $jobId = if ($log.jobId) { $log.jobId } else { $log.job_id }
        if (-not $jobId) { continue }
        
        # 初始化 job 信息
        if (-not $jobs[$jobId]) {
            $jobs[$jobId] = @{
                JobId = $jobId
                ProcessingTimeMs = $null
                ASR = $null
                Aggregation = $null
                SemanticRepair = $null
                Dedup = $null
                Translation = $null
                TTS = $null
            }
        }
        
        $job = $jobs[$jobId]
        
        # 提取总处理时间
        if ($log.processingTimeMs) {
            $job.ProcessingTimeMs = $log.processingTimeMs
        }
        
        $msg = if ($log.msg) { $log.msg } else { "" }
        
        # ASR 耗时
        if ($msg -match "ASR.*result|ASR.*completed" -and $log.asrTextLength) {
            # 从时间戳计算，或者从其他字段获取
        }
        
        # 语义修复耗时
        if ($msg -match "semantic.*repair.*completed|Semantic repair task completed") {
            if ($log.serviceCallDurationMs) {
                $job.SemanticRepair = $log.serviceCallDurationMs
            }
            if ($log.repair_time_ms) {
                $job.SemanticRepair = $log.repair_time_ms
            }
        }
        
        # 翻译耗时
        if ($msg -match "Translation.*completed|NMT.*OUTPUT|runTranslationStep") {
            if ($log.translationTimeMs) {
                $job.Translation = $log.translationTimeMs
            }
            if ($log.requestDurationMs) {
                $job.Translation = $log.requestDurationMs
            }
        }
        
        # TTS 耗时
        if ($msg -match "TTS.*completed|runTtsStep|TTSStage.*completed") {
            if ($log.ttsTimeMs) {
                $job.TTS = $log.ttsTimeMs
            }
        }
    } catch {
        # 忽略解析错误
    }
}

# 再次遍历，计算各步骤的耗时（基于时间戳）
$prevJobTime = @{}
foreach ($line in $allLogs) {
    try {
        $log = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
        if (-not $log) { continue }
        
        $jobId = if ($log.jobId) { $log.jobId } else { $log.job_id }
        if (-not $jobId) { continue }
        
        if (-not $jobs[$jobId]) { continue }
        $job = $jobs[$jobId]
        
        $msg = if ($log.msg) { $log.msg } else { "" }
        $time = $log.time
        
        # ASR 完成
        if ($msg -match "ASR.*result|ASR.*completed|asrText") {
            if (-not $prevJobTime[$jobId]) {
                $prevJobTime[$jobId] = $time
            }
            if (-not $job.ASR) {
                $job.ASR = $time - $prevJobTime[$jobId]
            }
            $prevJobTime[$jobId] = $time
        }
        
        # 聚合完成
        if ($msg -match "Aggregation.*completed|runAggregationStep") {
            if ($prevJobTime[$jobId] -and -not $job.Aggregation) {
                $job.Aggregation = $time - $prevJobTime[$jobId]
            }
            $prevJobTime[$jobId] = $time
        }
        
        # 语义修复完成
        if ($msg -match "runSemanticRepairStep.*completed|Semantic repair task completed") {
            if ($prevJobTime[$jobId] -and -not $job.SemanticRepair) {
                $job.SemanticRepair = $time - $prevJobTime[$jobId]
            }
            $prevJobTime[$jobId] = $time
        }
        
        # 去重完成
        if ($msg -match "runDedupStep.*completed") {
            if ($prevJobTime[$jobId] -and -not $job.Dedup) {
                $job.Dedup = $time - $prevJobTime[$jobId]
            }
            $prevJobTime[$jobId] = $time
        }
        
        # 翻译完成
        if ($msg -match "runTranslationStep.*completed|Translation.*completed") {
            if ($prevJobTime[$jobId] -and -not $job.Translation) {
                $job.Translation = $time - $prevJobTime[$jobId]
            }
            $prevJobTime[$jobId] = $time
        }
        
        # TTS 完成
        if ($msg -match "runTtsStep.*completed|TTS.*completed") {
            if ($prevJobTime[$jobId] -and -not $job.TTS) {
                $job.TTS = $time - $prevJobTime[$jobId]
            }
            $prevJobTime[$jobId] = $time
        }
    } catch {
        # 忽略解析错误
    }
}

# 输出结果表格
Write-Host ("{0,-20} {1,-10} {2,-10} {3,-15} {4,-10} {5,-12} {6,-10} {7,-10}" -f "Job ID", "总耗时(ms)", "ASR(ms)", "聚合(ms)", "语义修复(ms)", "去重(ms)", "翻译(ms)", "TTS(ms)") -ForegroundColor Yellow
Write-Host ("-" * 110) -ForegroundColor Gray

foreach ($jobId in ($jobs.Keys | Sort-Object)) {
    $job = $jobs[$jobId]
    
    $total = if ($job.ProcessingTimeMs) { $job.ProcessingTimeMs.ToString() } else { "N/A" }
    $asr = if ($job.ASR) { $job.ASR.ToString() } else { "N/A" }
    $agg = if ($job.Aggregation) { $job.Aggregation.ToString() } else { "N/A" }
    $sem = if ($job.SemanticRepair) { $job.SemanticRepair.ToString() } else { "N/A" }
    $dedup = if ($job.Dedup) { $job.Dedup.ToString() } else { "N/A" }
    $trans = if ($job.Translation) { $job.Translation.ToString() } else { "N/A" }
    $tts = if ($job.TTS) { $job.TTS.ToString() } else { "N/A" }
    
    Write-Host ("{0,-20} {1,-10} {2,-10} {3,-15} {4,-10} {5,-12} {6,-10} {7,-10}" -f $jobId, $total, $asr, $agg, $sem, $dedup, $trans, $tts) -ForegroundColor White
}

Write-Host ""
Write-Host "=== 统计完成 ===" -ForegroundColor Cyan
