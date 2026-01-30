# 分析ASR音频拒绝情况
# 目的：检查是否有音频被ASR拒绝或丢弃

$logFile = "electron-node\logs\electron-main.log"
if (-not (Test-Path $logFile)) {
    Write-Host "Log file not found: $logFile"
    exit 1
}

Write-Host "Analyzing ASR audio rejection..." -ForegroundColor Green
Write-Host "=" * 80

$content = Get-Content $logFile -Tail 30000

# 1. 查找所有音频质量拒绝的记录
Write-Host "`n=== ASR音频质量拒绝记录 ===" -ForegroundColor Cyan
$rejectLogs = $content | Select-String -Pattern "Audio quality|rejecting|RMS.*below|MIN_RMS_THRESHOLD|quality too low"
$rejectCount = 0
$rejectLogs | ForEach-Object { 
    $line = $_.Line
    if ($line -match '"jobId":"([^"]+)"|"utteranceIndex":(\d+)') {
        $jobId = if ($matches[1]) { $matches[1] } else { "unknown" }
        $utteranceIndex = if ($matches[2]) { $matches[2] } else { "unknown" }
        if ($line -match '"rms":"([^"]+)"|RMS.*\(([^)]+)\)') {
            $rms = if ($matches[1]) { $matches[1] } else { $matches[2] }
            if ($line -match '"minRmsThreshold":([^,}]+)|MIN_RMS_THRESHOLD.*\(([^)]+)\)') {
                $threshold = if ($matches[1]) { $matches[1] } else { $matches[2] }
                Write-Host "JobId: $jobId, UtteranceIndex: $utteranceIndex, RMS: $rms, Threshold: $threshold" -ForegroundColor Yellow
                $rejectCount++
            }
        }
    }
}
Write-Host "Total rejections: $rejectCount" -ForegroundColor $(if ($rejectCount -gt 0) { "Red" } else { "Green" })

# 2. 查找ASR返回空结果的记录
Write-Host "`n=== ASR返回空结果记录 ===" -ForegroundColor Cyan
$emptyLogs = $content | Select-String -Pattern "asrTextLength.*0|asrText.*\"\"|empty result|returned empty" | Select-Object -Last 20
$emptyCount = 0
$emptyLogs | ForEach-Object { 
    $line = $_.Line
    if ($line -match '"jobId":"([^"]+)"|"utteranceIndex":(\d+)') {
        $jobId = if ($matches[1]) { $matches[1] } else { "unknown" }
        $utteranceIndex = if ($matches[2]) { $matches[2] } else { "unknown" }
        if ($line -match '"asrTextLength":0|"asrText":""') {
            Write-Host "JobId: $jobId, UtteranceIndex: $utteranceIndex - Empty ASR result" -ForegroundColor Yellow
            $emptyCount++
        }
    }
}
Write-Host "Total empty results: $emptyCount" -ForegroundColor $(if ($emptyCount -gt 0) { "Red" } else { "Green" })

# 3. 查找每个job的音频处理情况
Write-Host "`n=== 各Job的音频处理情况 ===" -ForegroundColor Cyan
$jobAudioLogs = $content | Select-String -Pattern "job-960d8f27|job-23b12aac|job-e94b2cb6|utteranceIndex.*[3511]" | Select-String -Pattern "audio|ASR|batch|segment" | Select-Object -Last 50
$jobAudioLogs | ForEach-Object { 
    $line = $_.Line
    if ($line -match '"jobId":"([^"]+)"|"utteranceIndex":(\d+)') {
        $jobId = if ($matches[1]) { $matches[1] } else { "unknown" }
        $utteranceIndex = if ($matches[2]) { $matches[2] } else { "unknown" }
        if ($line -match "audioDurationMs|audioSizeBytes|segmentCount|batchCount") {
            Write-Host "JobId: $jobId, UtteranceIndex: $utteranceIndex" -ForegroundColor White
            if ($line -match '"audioDurationMs":(\d+)') {
                Write-Host "  AudioDuration: $($matches[1])ms" -ForegroundColor Cyan
            }
            if ($line -match '"segmentCount":(\d+)|"batchCount":(\d+)') {
                $count = if ($matches[1]) { $matches[1] } else { $matches[2] }
                Write-Host "  Segment/Batch Count: $count" -ForegroundColor Cyan
            }
        }
    }
}

# 4. 查找音频切分情况
Write-Host "`n=== 音频切分情况 ===" -ForegroundColor Cyan
$splitLogs = $content | Select-String -Pattern "splitAudioByEnergy|outputSegmentCount|inputAudioDurationMs" | Select-Object -Last 20
$splitLogs | ForEach-Object { 
    $line = $_.Line
    if ($line -match '"jobId":"([^"]+)"|"utteranceIndex":(\d+)') {
        $jobId = if ($matches[1]) { $matches[1] } else { "unknown" }
        $utteranceIndex = if ($matches[2]) { $matches[2] } else { "unknown" }
        if ($line -match '"inputAudioDurationMs":(\d+)|"outputSegmentCount":(\d+)') {
            $input = if ($matches[1]) { $matches[1] } else { "unknown" }
            $output = if ($matches[2]) { $matches[2] } else { "unknown" }
            Write-Host "JobId: $jobId, UtteranceIndex: $utteranceIndex, Input: ${input}ms, Output Segments: $output" -ForegroundColor White
        }
    }
}

Write-Host "`n" + ("=" * 80)
