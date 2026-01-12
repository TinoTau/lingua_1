# 提取每个 Job 的详细信息

param(
    [string]$NodeLog = "electron_node\electron-node\logs\electron-main.log"
)

Write-Host "`n=== Job 详细信息提取 ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $NodeLog)) {
    Write-Host "日志文件不存在: $NodeLog" -ForegroundColor Red
    exit 1
}

# 读取所有日志行
$allLogs = Get-Content $NodeLog -ErrorAction SilentlyContinue

# 存储所有 job 的信息
$jobs = @{}

# 解析日志，提取 job 信息
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
                SessionId = if ($log.sessionId) { $log.sessionId } else { $log.session_id }
                UtteranceIndex = if ($log.utteranceIndex) { $log.utteranceIndex } else { $log.utterance_index }
                StartTime = $null
                EndTime = $null
                ProcessingTimeMs = $null
                Steps = @{}
                Errors = @()
                Warnings = @()
            }
        }
        
        $job = $jobs[$jobId]
        
        # 提取时间戳
        if ($log.time) {
            if (-not $job.StartTime) {
                $job.StartTime = $log.time
            }
            $job.EndTime = $log.time
        }
        
        # 提取处理时间
        if ($log.processingTimeMs) {
            $job.ProcessingTimeMs = $log.processingTimeMs
        }
        
        # 提取各步骤信息
        $msg = if ($log.msg) { $log.msg } else { "" }
        
        # ASR 步骤
        if ($msg -match "ASR.*result|ASR.*completed|asrText") {
            $job.Steps["ASR"] = @{
                Time = $log.time
                Text = if ($log.asrText) { $log.asrText } else { $log.asrTextPreview }
                TextLength = $log.asrTextLength
                Language = $log.language
                QualityScore = $log.qualityScore
            }
        }
        
        # 聚合步骤
        if ($msg -match "Aggregation.*completed|runAggregationStep") {
            $job.Steps["AGGREGATION"] = @{
                Time = $log.time
                Text = if ($log.aggregatedText) { $log.aggregatedText } else { $log.aggregatedTextPreview }
                TextLength = $log.aggregatedTextLength
                Action = $log.action
            }
        }
        
        # 语义修复步骤
        if ($msg -match "semantic.*repair|SemanticRepair|runSemanticRepairStep") {
            if (-not $job.Steps["SEMANTIC_REPAIR"]) {
                $job.Steps["SEMANTIC_REPAIR"] = @{}
            }
            $step = $job.Steps["SEMANTIC_REPAIR"]
            $step.Time = $log.time
            if ($log.decision) {
                $step.Decision = $log.decision
                $step.Confidence = $log.confidence
                $step.OriginalText = $log.originalText
                $step.RepairedText = $log.repairedText
                $step.TextChanged = $log.textChanged
                $step.ReasonCodes = $log.reasonCodes
            }
            if ($log.serviceCallDurationMs) {
                $step.DurationMs = $log.serviceCallDurationMs
            }
            if ($log.repair_time_ms) {
                $step.DurationMs = $log.repair_time_ms
            }
        }
        
        # 去重步骤
        if ($msg -match "Dedup|dedup|runDedupStep") {
            $job.Steps["DEDUP"] = @{
                Time = $log.time
                ShouldSend = $log.shouldSend
                DedupReason = $log.dedupReason
            }
        }
        
        # 翻译步骤
        if ($msg -match "Translation.*completed|runTranslationStep|NMT.*OUTPUT") {
            if (-not $job.Steps["TRANSLATION"]) {
                $job.Steps["TRANSLATION"] = @{}
            }
            $step = $job.Steps["TRANSLATION"]
            $step.Time = $log.time
            if ($log.translatedText) {
                $step.TranslatedText = $log.translatedText
                $step.TranslatedTextLength = $log.translatedTextLength
            }
            if ($log.translationTimeMs) {
                $step.DurationMs = $log.translationTimeMs
            }
            if ($log.requestDurationMs) {
                $step.DurationMs = $log.requestDurationMs
            }
        }
        
        # TTS 步骤
        if ($msg -match "TTS.*completed|runTtsStep|TTSStage.*completed") {
            $job.Steps["TTS"] = @{
                Time = $log.time
                AudioLength = if ($log.audioLength) { $log.audioLength } else { $log.ttsAudioLength }
                AudioFormat = if ($log.audioFormat) { $log.audioFormat } else { $log.ttsFormat }
                DurationMs = $log.ttsTimeMs
            }
        }
        
        # 错误
        if ($log.level -ge 50) {
            $job.Errors += @{
                Time = $log.time
                Message = $msg
                Error = $log.error
            }
        }
        
        # 警告
        if ($log.level -eq 40) {
            $job.Warnings += @{
                Time = $log.time
                Message = $msg
            }
        }
    } catch {
        # 忽略解析错误
    }
}

# 计算每个步骤的耗时
foreach ($jobId in $jobs.Keys) {
    $job = $jobs[$jobId]
    $prevTime = $job.StartTime
    
    foreach ($stepName in @("ASR", "AGGREGATION", "SEMANTIC_REPAIR", "DEDUP", "TRANSLATION", "TTS")) {
        if ($job.Steps[$stepName] -and $job.Steps[$stepName].Time) {
            if ($prevTime) {
                $job.Steps[$stepName].ElapsedMs = $job.Steps[$stepName].Time - $prevTime
            }
            $prevTime = $job.Steps[$stepName].Time
        }
    }
}

# 输出结果
Write-Host "找到 $($jobs.Count) 个 Job" -ForegroundColor Green
Write-Host ""

foreach ($jobId in ($jobs.Keys | Sort-Object)) {
    $job = $jobs[$jobId]
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Job ID: $($job.JobId)" -ForegroundColor Yellow
    Write-Host "Session ID: $($job.SessionId)" -ForegroundColor Gray
    Write-Host "Utterance Index: $($job.UtteranceIndex)" -ForegroundColor Gray
    
    if ($job.ProcessingTimeMs) {
        Write-Host "总处理时间: $($job.ProcessingTimeMs)ms ($([math]::Round($job.ProcessingTimeMs/1000, 2))s)" -ForegroundColor Green
    }
    
    Write-Host "`n步骤详情:" -ForegroundColor Cyan
    
    # ASR
    if ($job.Steps["ASR"]) {
        $step = $job.Steps["ASR"]
        Write-Host "  [ASR]" -ForegroundColor White
        Write-Host "    文本长度: $($step.TextLength)" -ForegroundColor Gray
        Write-Host "    语言: $($step.Language)" -ForegroundColor Gray
        Write-Host "    质量分数: $($step.QualityScore)" -ForegroundColor Gray
        if ($step.ElapsedMs) {
            Write-Host "    耗时: $($step.ElapsedMs)ms" -ForegroundColor Gray
        }
        if ($step.Text) {
            $preview = if ($step.Text.Length -gt 50) { $step.Text.Substring(0, 50) + "..." } else { $step.Text }
            Write-Host "    文本预览: $preview" -ForegroundColor DarkGray
        }
    }
    
    # 聚合
    if ($job.Steps["AGGREGATION"]) {
        $step = $job.Steps["AGGREGATION"]
        Write-Host "  [聚合]" -ForegroundColor White
        Write-Host "    文本长度: $($step.TextLength)" -ForegroundColor Gray
        Write-Host "    动作: $($step.Action)" -ForegroundColor Gray
        if ($step.ElapsedMs) {
            Write-Host "    耗时: $($step.ElapsedMs)ms" -ForegroundColor Gray
        }
    }
    
    # 语义修复
    if ($job.Steps["SEMANTIC_REPAIR"]) {
        $step = $job.Steps["SEMANTIC_REPAIR"]
        Write-Host "  [语义修复]" -ForegroundColor White
        Write-Host "    决策: $($step.Decision)" -ForegroundColor $(if ($step.Decision -eq "REPAIR") { "Yellow" } else { "Gray" })
        Write-Host "    置信度: $($step.Confidence)" -ForegroundColor Gray
        if ($step.DurationMs) {
            Write-Host "    耗时: $($step.DurationMs)ms" -ForegroundColor Gray
        }
        if ($step.TextChanged) {
            Write-Host "    文本已修改: $($step.TextChanged)" -ForegroundColor Yellow
        }
        if ($step.ReasonCodes) {
            Write-Host "    原因: $($step.ReasonCodes -join ', ')" -ForegroundColor Gray
        }
        if ($step.OriginalText -and $step.RepairedText) {
            $origPreview = if ($step.OriginalText.Length -gt 30) { $step.OriginalText.Substring(0, 30) + "..." } else { $step.OriginalText }
            $repairPreview = if ($step.RepairedText.Length -gt 30) { $step.RepairedText.Substring(0, 30) + "..." } else { $step.RepairedText }
            Write-Host "    修复前: $origPreview" -ForegroundColor DarkGray
            Write-Host "    修复后: $repairPreview" -ForegroundColor DarkGray
        }
        if ($step.ElapsedMs) {
            Write-Host "    步骤耗时: $($step.ElapsedMs)ms" -ForegroundColor Gray
        }
    }
    
    # 去重
    if ($job.Steps["DEDUP"]) {
        $step = $job.Steps["DEDUP"]
        Write-Host "  [去重]" -ForegroundColor White
        Write-Host "    是否发送: $($step.ShouldSend)" -ForegroundColor Gray
        if ($step.DedupReason) {
            Write-Host "    去重原因: $($step.DedupReason)" -ForegroundColor Yellow
        }
    }
    
    # 翻译
    if ($job.Steps["TRANSLATION"]) {
        $step = $job.Steps["TRANSLATION"]
        Write-Host "  [翻译]" -ForegroundColor White
        Write-Host "    文本长度: $($step.TranslatedTextLength)" -ForegroundColor Gray
        if ($step.DurationMs) {
            Write-Host "    耗时: $($step.DurationMs)ms" -ForegroundColor Gray
        }
        if ($step.TranslatedText) {
            $preview = if ($step.TranslatedText.Length -gt 50) { $step.TranslatedText.Substring(0, 50) + "..." } else { $step.TranslatedText }
            Write-Host "    翻译预览: $preview" -ForegroundColor DarkGray
        }
        if ($step.ElapsedMs) {
            Write-Host "    步骤耗时: $($step.ElapsedMs)ms" -ForegroundColor Gray
        }
    }
    
    # TTS
    if ($job.Steps["TTS"]) {
        $step = $job.Steps["TTS"]
        Write-Host "  [TTS]" -ForegroundColor White
        Write-Host "    音频长度: $($step.AudioLength) bytes" -ForegroundColor Gray
        Write-Host "    音频格式: $($step.AudioFormat)" -ForegroundColor Gray
        if ($step.DurationMs) {
            Write-Host "    耗时: $($step.DurationMs)ms" -ForegroundColor Gray
        }
        if ($step.ElapsedMs) {
            Write-Host "    步骤耗时: $($step.ElapsedMs)ms" -ForegroundColor Gray
        }
    }
    
    # 错误和警告
    if ($job.Errors.Count -gt 0) {
        Write-Host "`n  错误 ($($job.Errors.Count)):" -ForegroundColor Red
        foreach ($error in $job.Errors) {
            Write-Host "    - $($error.Message)" -ForegroundColor Red
        }
    }
    
    if ($job.Warnings.Count -gt 0) {
        Write-Host "`n  警告 ($($job.Warnings.Count)):" -ForegroundColor Yellow
        foreach ($warning in $job.Warnings) {
            Write-Host "    - $($warning.Message)" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
}

Write-Host "=== 分析完成 ===" -ForegroundColor Cyan
