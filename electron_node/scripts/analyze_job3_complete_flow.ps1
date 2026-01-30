# 分析job3的完整处理流程
# 目的：找出job3文本丢失的原因

$logFile = "electron-node\logs\electron-main.log"
if (-not (Test-Path $logFile)) {
    Write-Host "Log file not found: $logFile"
    exit 1
}

Write-Host "Analyzing job3 complete flow..." -ForegroundColor Green
Write-Host "=" * 80

$content = Get-Content $logFile -Tail 20000

# 查找所有与job3相关的日志
$allJob3Logs = $content | Select-String -Pattern "job-168a54c4-0b31-404f-8e60-e50df06c9ff8|job-355e0727-1b60-418f-b4ad-929da7be042b|utteranceIndex.*2"

Write-Host "`n=== Job3 (job-168a54c4) 音频处理 ===" -ForegroundColor Cyan
$audioLogs = $allJob3Logs | Select-String -Pattern "job-168a54c4.*audio|job-168a54c4.*batch|job-168a54c4.*segment"
$audioLogs | Select-Object -First 20 | ForEach-Object { 
    if ($_.Line -match "batchesCount|segmentCount|originalJobIds|batchJobIds") {
        Write-Host $_.Line -ForegroundColor Yellow
    }
}

Write-Host "`n=== Job3 ASR批次处理 ===" -ForegroundColor Cyan
$asrLogs = $allJob3Logs | Select-String -Pattern "job-168a54c4.*ASR|job-168a54c4.*batch|job-168a54c4.*segment"
$asrLogs | Select-Object -First 30 | ForEach-Object { 
    if ($_.Line -match "segmentIndex|asrText|batchIndex|originalJobId") {
        Write-Host $_.Line -ForegroundColor Yellow
    }
}

Write-Host "`n=== Job-355e0727 (job1) 的batch累积 ===" -ForegroundColor Cyan
$job1Logs = $allJob3Logs | Select-String -Pattern "job-355e0727.*accumulate|job-355e0727.*TextMerge|job-355e0727.*batch"
$job1Logs | Select-Object -First 30 | ForEach-Object { 
    if ($_.Line -match "batchIndex|receivedCount|expectedSegmentCount|mergedText|batchTexts") {
        Write-Host $_.Line -ForegroundColor Yellow
    }
}

Write-Host "`n=== 查找'接下来这一句'相关的ASR结果 ===" -ForegroundColor Cyan
$nextLogs = $content | Select-String -Pattern "接下来|评论看看|我会尽量连续"
$nextLogs | Select-Object -First 20 | ForEach-Object { 
    if ($_.Line -match "asrText|jobId|utteranceIndex|originalJobId") {
        Write-Host $_.Line -ForegroundColor Yellow
    }
}

Write-Host "`n" + ("=" * 80)
