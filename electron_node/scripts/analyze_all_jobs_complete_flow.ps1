# 分析所有Job的完整处理流程
# 目的：找出文本丢失和顺序混乱的原因

param(
    [string]$LogFile = "electron-node\logs\electron-main.log",
    [string]$SessionId = ""
)

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "分析所有Job的完整处理流程" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $LogFile)) {
    Write-Host "错误: 日志文件不存在: $LogFile" -ForegroundColor Red
    exit 1
}

# 提取所有job的job_id
Write-Host "1. 提取所有job的job_id..." -ForegroundColor Yellow
$jobIds = Get-Content $LogFile | Select-String -Pattern 'job_id["\s:]+([a-f0-9-]+)' | ForEach-Object {
    if ($_.Matches.Count -gt 0) {
        $_.Matches[0].Groups[1].Value
    }
} | Where-Object { $_ -ne $null } | Sort-Object -Unique

Write-Host "找到 $($jobIds.Count) 个唯一的job_id" -ForegroundColor Green
Write-Host ""

# 分析每个job的完整流程
$jobAnalysis = @()

foreach ($jobId in $jobIds) {
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "分析 Job: $jobId" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan
    
    $jobLogs = Get-Content $LogFile | Select-String -Pattern $jobId
    
    if ($jobLogs.Count -eq 0) {
        Write-Host "未找到该job的日志" -ForegroundColor Red
        continue
    }
    
    # 提取关键信息
    $jobInfo = @{
        JobId = $jobId
        UtteranceIndex = $null
        SessionId = $null
        AudioDuration = $null
        ASRBatches = @()
        ASRTexts = @()
        AggregationText = $null
        SemanticRepairText = $null
        FinalText = $null
        OriginalJobIds = @()
        BatchIndexes = @()
        TextMerge = $null
        EmptyContainer = $false
        AudioRejected = $false
        ProcessingErrors = @()
    }
    
    # 提取utterance_index
    $utteranceMatch = $jobLogs | Select-String -Pattern 'utterance_index[":\s]+(\d+)' | Select-Object -First 1
    if ($utteranceMatch -and $utteranceMatch.Matches.Count -gt 0) {
        $jobInfo.UtteranceIndex = [int]$utteranceMatch.Matches[0].Groups[1].Value
    }
    
    # 提取session_id
    $sessionMatch = $jobLogs | Select-String -Pattern 'session_id[":\s]+([a-f0-9-]+)' | Select-Object -First 1
    if ($sessionMatch -and $sessionMatch.Matches.Count -gt 0) {
        $jobInfo.SessionId = $sessionMatch.Matches[0].Groups[1].Value
    }
    
    # 提取音频时长
    $audioDurationMatch = $jobLogs | Select-String -Pattern '(?:audioDurationMs|durationMs|totalDurationMs)[":\s]+(\d+)' | Select-Object -First 1
    if ($audioDurationMatch -and $audioDurationMatch.Matches.Count -gt 0) {
        $jobInfo.AudioDuration = [int]$audioDurationMatch.Matches[0].Groups[1].Value
    }
    
    # 提取ASR批次信息
    $asrBatchLogs = $jobLogs | Select-String -Pattern '(?:ASR batch|ASR.*batch|addASRSegment|Accumulate.*Added ASR segment)'
    foreach ($asrLog in $asrBatchLogs) {
        $batchIndexMatch = $asrLog | Select-String -Pattern 'batchIndex[":\s]+(\d+)'
        $originalJobIdMatch = $asrLog | Select-String -Pattern 'originalJobId[":\s]+([a-f0-9-]+)'
        $asrTextMatch = $asrLog | Select-String -Pattern 'asrText[":\s]+"([^"]+)"'
        
        $batchInfo = @{
            BatchIndex = if ($batchIndexMatch -and $batchIndexMatch.Matches.Count -gt 0) { [int]$batchIndexMatch.Matches[0].Groups[1].Value } else { $null }
            OriginalJobId = if ($originalJobIdMatch -and $originalJobIdMatch.Matches.Count -gt 0) { $originalJobIdMatch.Matches[0].Groups[1].Value } else { $null }
            ASRText = if ($asrTextMatch -and $asrTextMatch.Matches.Count -gt 0) { $asrTextMatch.Matches[0].Groups[1].Value } else { $null }
        }
        
        $jobInfo.ASRBatches += $batchInfo
        if ($batchInfo.OriginalJobId) {
            $jobInfo.OriginalJobIds += $batchInfo.OriginalJobId
        }
        if ($batchInfo.BatchIndex -ne $null) {
            $jobInfo.BatchIndexes += $batchInfo.BatchIndex
        }
        if ($batchInfo.ASRText) {
            $jobInfo.ASRTexts += $batchInfo.ASRText
        }
    }
    
    # 提取TextMerge信息
    $textMergeLogs = $jobLogs | Select-String -Pattern '(?:TextMerge|Merged ASR batches)'
    if ($textMergeLogs) {
        $mergedTextMatch = $textMergeLogs | Select-String -Pattern '(?:mergedText|fullText)[":\s]+"([^"]+)"' | Select-Object -First 1
        if ($mergedTextMatch -and $mergedTextMatch.Matches.Count -gt 0) {
            $jobInfo.TextMerge = $mergedTextMatch.Matches[0].Groups[1].Value
        }
    }
    
    # 提取聚合文本
    $aggregationLogs = $jobLogs | Select-String -Pattern '(?:Aggregation|aggregatedText)'
    $aggregationTextMatch = $aggregationLogs | Select-String -Pattern '(?:aggregatedText|text)[":\s]+"([^"]+)"' | Select-Object -First 1
    if ($aggregationTextMatch -and $aggregationTextMatch.Matches.Count -gt 0) {
        $jobInfo.AggregationText = $aggregationTextMatch.Matches[0].Groups[1].Value
    }
    
    # 提取语义修复文本
    $semanticRepairLogs = $jobLogs | Select-String -Pattern '(?:SemanticRepair|repairedText)'
    $semanticRepairTextMatch = $semanticRepairLogs | Select-String -Pattern '(?:repairedText|text)[":\s]+"([^"]+)"' | Select-Object -First 1
    if ($semanticRepairTextMatch -and $semanticRepairTextMatch.Matches.Count -gt 0) {
        $jobInfo.SemanticRepairText = $semanticRepairTextMatch.Matches[0].Groups[1].Value
    }
    
    # 检查空容器
    $emptyContainerLogs = $jobLogs | Select-String -Pattern '(?:empty container|NO_TEXT_ASSIGNED|ASR result is empty)'
    if ($emptyContainerLogs) {
        $jobInfo.EmptyContainer = $true
    }
    
    # 检查音频被拒绝
    $audioRejectedLogs = $jobLogs | Select-String -Pattern '(?:audio rejected|RMS.*below|quality.*rejected)'
    if ($audioRejectedLogs) {
        $jobInfo.AudioRejected = $true
    }
    
    # 检查处理错误
    $errorLogs = $jobLogs | Select-String -Pattern '(?:error|Error|ERROR|failed|Failed|FAILED)'
    foreach ($errorLog in $errorLogs) {
        $jobInfo.ProcessingErrors += $errorLog.Line
    }
    
    # 输出分析结果
    Write-Host "UtteranceIndex: $($jobInfo.UtteranceIndex)" -ForegroundColor Green
    Write-Host "SessionId: $($jobInfo.SessionId)" -ForegroundColor Green
    Write-Host "AudioDuration: $($jobInfo.AudioDuration)ms" -ForegroundColor Green
    Write-Host "ASR Batches: $($jobInfo.ASRBatches.Count)" -ForegroundColor Green
    Write-Host "OriginalJobIds: $($jobInfo.OriginalJobIds -join ', ')" -ForegroundColor Green
    Write-Host "BatchIndexes: $($jobInfo.BatchIndexes -join ', ')" -ForegroundColor Green
    Write-Host ""
    
    if ($jobInfo.ASRBatches.Count -gt 0) {
        Write-Host "ASR批次详情:" -ForegroundColor Yellow
        foreach ($batch in $jobInfo.ASRBatches) {
            Write-Host "  BatchIndex: $($batch.BatchIndex), OriginalJobId: $($batch.OriginalJobId)" -ForegroundColor Cyan
            if ($batch.ASRText) {
                Write-Host "    ASRText: $($batch.ASRText.Substring(0, [Math]::Min(50, $batch.ASRText.Length)))..." -ForegroundColor Gray
            }
        }
        Write-Host ""
    }
    
    if ($jobInfo.TextMerge) {
        Write-Host "TextMerge: $($jobInfo.TextMerge.Substring(0, [Math]::Min(100, $jobInfo.TextMerge.Length)))..." -ForegroundColor Yellow
        Write-Host ""
    }
    
    if ($jobInfo.AggregationText) {
        Write-Host "AggregationText: $($jobInfo.AggregationText.Substring(0, [Math]::Min(100, $jobInfo.AggregationText.Length)))..." -ForegroundColor Yellow
        Write-Host ""
    }
    
    if ($jobInfo.EmptyContainer) {
        Write-Host "⚠️  空容器检测" -ForegroundColor Red
        Write-Host ""
    }
    
    if ($jobInfo.AudioRejected) {
        Write-Host "⚠️  音频被拒绝" -ForegroundColor Red
        Write-Host ""
    }
    
    if ($jobInfo.ProcessingErrors.Count -gt 0) {
        Write-Host "⚠️  处理错误 ($($jobInfo.ProcessingErrors.Count)个):" -ForegroundColor Red
        foreach ($error in $jobInfo.ProcessingErrors | Select-Object -First 3) {
            Write-Host "  $error" -ForegroundColor Red
        }
        Write-Host ""
    }
    
    $jobAnalysis += $jobInfo
    Write-Host ""
}

# 输出总结
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "总结" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Job数量: $($jobAnalysis.Count)" -ForegroundColor Green
Write-Host ""

# 按UtteranceIndex排序
$sortedJobs = $jobAnalysis | Where-Object { $_.UtteranceIndex -ne $null } | Sort-Object UtteranceIndex

Write-Host "按UtteranceIndex排序的Job:" -ForegroundColor Yellow
foreach ($job in $sortedJobs) {
    Write-Host "  [$($job.UtteranceIndex)] JobId: $($job.JobId), ASR Batches: $($job.ASRBatches.Count), OriginalJobIds: $($job.OriginalJobIds -join ', ')" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "分析完成！" -ForegroundColor Green
