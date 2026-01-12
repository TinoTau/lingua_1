# 显示每个 Job 在各服务中的耗时（简化版）

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
        if ($msg -match "ASR.*OUTPUT|faster-whisper.*succeeded") {
            if ($log.requestDurationMs) {
                $job.ASR = $log.requestDurationMs
            }
        }
        
        # 语义修复耗时
        if ($msg -match "semantic.*repair|Semantic repair task completed|runSemanticRepairStep") {
            if ($log.serviceCallDurationMs) {
                $job.SemanticRepair = $log.serviceCallDurationMs
            }
            if ($log.repair_time_ms) {
                $job.SemanticRepair = $log.repair_time_ms
            }
        }
        
        # 翻译耗时
        if ($msg -match "Translation.*completed|NMT.*OUTPUT|runTranslationStep|TranslationStage.*completed") {
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

# 输出结果表格
Write-Host "Job ID              总耗时(ms)  ASR(ms)  聚合(ms)  语义修复(ms)  去重(ms)  翻译(ms)  TTS(ms)" -ForegroundColor Yellow
Write-Host ("-" * 90) -ForegroundColor Gray

foreach ($jobId in ($jobs.Keys | Sort-Object)) {
    $job = $jobs[$jobId]
    
    $total = if ($job.ProcessingTimeMs) { $job.ProcessingTimeMs.ToString().PadLeft(8) } else { "    N/A" }
    $asr = if ($job.ASR) { $job.ASR.ToString().PadLeft(7) } else { "   N/A" }
    $agg = if ($job.Aggregation) { $job.Aggregation.ToString().PadLeft(7) } else { "   N/A" }
    $sem = if ($job.SemanticRepair) { $job.SemanticRepair.ToString().PadLeft(10) } else { "      N/A" }
    $dedup = if ($job.Dedup) { $job.Dedup.ToString().PadLeft(7) } else { "   N/A" }
    $trans = if ($job.Translation) { $job.Translation.ToString().PadLeft(7) } else { "   N/A" }
    $tts = if ($job.TTS) { $job.TTS.ToString().PadLeft(7) } else { "   N/A" }
    
    Write-Host ("$($jobId.PadRight(19))$total  $asr  $agg  $sem  $dedup  $trans  $tts") -ForegroundColor White
}

# 计算平均值
Write-Host ""
Write-Host "平均值:" -ForegroundColor Cyan
$avgTotal = ($jobs.Values | Where-Object { $_.ProcessingTimeMs } | ForEach-Object { $_.ProcessingTimeMs } | Measure-Object -Average).Average
$avgSem = ($jobs.Values | Where-Object { $_.SemanticRepair } | ForEach-Object { $_.SemanticRepair } | Measure-Object -Average).Average
$avgTrans = ($jobs.Values | Where-Object { $_.Translation } | ForEach-Object { $_.Translation } | Measure-Object -Average).Average
$avgTts = ($jobs.Values | Where-Object { $_.TTS } | ForEach-Object { $_.TTS } | Measure-Object -Average).Average

Write-Host ("总耗时: {0:N0}ms" -f $avgTotal) -ForegroundColor White
Write-Host ("语义修复: {0:N0}ms" -f $avgSem) -ForegroundColor White
Write-Host ("翻译: {0:N0}ms" -f $avgTrans) -ForegroundColor White
Write-Host ("TTS: {0:N0}ms" -f $avgTts) -ForegroundColor White

Write-Host ""
Write-Host "=== 统计完成 ===" -ForegroundColor Cyan
