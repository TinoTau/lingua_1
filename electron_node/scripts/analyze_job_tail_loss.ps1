# 分析job句尾丢失问题
# 目的：找出哪些job丢失了句尾的半句话

$logFile = "electron-node\logs\electron-main.log"
if (-not (Test-Path $logFile)) {
    Write-Host "Log file not found: $logFile"
    exit 1
}

Write-Host "Analyzing job tail loss..." -ForegroundColor Green
Write-Host "=" * 80

$content = Get-Content $logFile -Tail 30000

# 查找所有job的完整处理流程
Write-Host "`n=== 所有job的TextMerge结果 ===" -ForegroundColor Cyan
$textMergeLogs = $content | Select-String -Pattern "TextMerge|mergedText"
$textMergeLogs | ForEach-Object { 
    $line = $_.Line
    if ($line -match '"originalJobId":"([^"]+)"') {
        $originalJobId = $matches[1]
        if ($line -match '"mergedText":"([^"]+)"') {
            $mergedText = $matches[1]
            Write-Host "`nOriginalJobId: $originalJobId" -ForegroundColor Yellow
            Write-Host "MergedText: $mergedText" -ForegroundColor White
        }
        if ($line -match '"batchCount":(\d+)') {
            $batchCount = $matches[1]
            Write-Host "BatchCount: $batchCount" -ForegroundColor Cyan
        }
        if ($line -match '"expectedSegmentCount":(\d+)') {
            $expected = $matches[1]
            Write-Host "ExpectedSegmentCount: $expected" -ForegroundColor Cyan
        }
        if ($line -match '"receivedCount":(\d+)') {
            $received = $matches[1]
            Write-Host "ReceivedCount: $received" -ForegroundColor Cyan
        }
        if ($line -match '"missingCount":(\d+)') {
            $missing = $matches[1]
            if ([int]$missing -gt 0) {
                Write-Host "MissingCount: $missing ⚠️" -ForegroundColor Red
            }
        }
    }
}

Write-Host "`n=== 查找所有job的ASR批次 ===" -ForegroundColor Cyan
$asrBatchLogs = $content | Select-String -Pattern "Added ASR batch|accumulateASRSegment" | Select-Object -Last 30
$asrBatchLogs | ForEach-Object { 
    $line = $_.Line
    if ($line -match '"originalJobId":"([^"]+)"|"jobId":"([^"]+)"') {
        $jobId = if ($matches[1]) { $matches[1] } else { $matches[2] }
        if ($line -match '"batchIndex":(\d+)') {
            $batchIndex = $matches[1]
            if ($line -match '"asrText":"([^"]+)"|"asrTextPreview":"([^"]+)"') {
                $asrText = if ($matches[1]) { $matches[1] } else { $matches[2] }
                Write-Host "JobId: $jobId, BatchIndex: $batchIndex, ASRText: $asrText" -ForegroundColor White
            }
        }
    }
}

Write-Host "`n=== 查找缺失的batch ===" -ForegroundColor Cyan
$missingLogs = $content | Select-String -Pattern "missing|Missing segment|isMissing.*true"
$missingLogs | ForEach-Object { 
    $line = $_.Line
    if ($line -match '"originalJobId":"([^"]+)"') {
        $originalJobId = $matches[1]
        Write-Host "Missing batch for OriginalJobId: $originalJobId" -ForegroundColor Red
        Write-Host $line -ForegroundColor Gray
    }
}

Write-Host "`n" + ("=" * 80)
