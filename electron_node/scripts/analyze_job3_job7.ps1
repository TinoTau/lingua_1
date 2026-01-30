# 分析job3和job7后半句丢失问题
$logFile = "electron-node\logs\electron-main.log"

if (-not (Test-Path $logFile)) {
    Write-Host "Log file not found: $logFile" -ForegroundColor Red
    exit 1
}

Write-Host "Analyzing job3 and job7 tail loss..." -ForegroundColor Green
Write-Host "=" * 80

$content = Get-Content $logFile -Tail 100000

# 查找job3和job7的完整处理流程
Write-Host "`n=== JOB3 TextMerge ===" -ForegroundColor Yellow
$job3Merge = $content | Select-String -Pattern '"originalJobId":"[^"]*job[^"]*3[^"]*"|"jobId":"[^"]*job[^"]*3[^"]*"' | Select-String -Pattern "TextMerge|mergeASRText"
$job3Merge | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"mergedText":"([^"]+)"') {
        $text = $matches[1]
        Write-Host "  MergedText: $text" -ForegroundColor Cyan
    }
    if ($line -match '"batchCount":(\d+)') {
        Write-Host "  BatchCount: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"receivedCount":(\d+)') {
        Write-Host "  ReceivedCount: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"expectedSegmentCount":(\d+)') {
        Write-Host "  ExpectedSegmentCount: $($matches[1])" -ForegroundColor Cyan
    }
}

Write-Host "`n=== JOB3 ASR Batches ===" -ForegroundColor Yellow
$job3Batches = $content | Select-String -Pattern '"originalJobId":"[^"]*job[^"]*3[^"]*"|"jobId":"[^"]*job[^"]*3[^"]*"' | Select-String -Pattern "accumulateASRSegment|Added ASR"
$job3Batches | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"batchIndex":(\d+)') {
        Write-Host "  BatchIndex: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"asrText":"([^"]+)"|"asrTextPreview":"([^"]+)"') {
        $text = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  ASRText: $text" -ForegroundColor Cyan
    }
}

Write-Host "`n=== JOB7 TextMerge ===" -ForegroundColor Yellow
$job7Merge = $content | Select-String -Pattern '"originalJobId":"[^"]*job[^"]*7[^"]*"|"jobId":"[^"]*job[^"]*7[^"]*"' | Select-String -Pattern "TextMerge|mergeASRText"
$job7Merge | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"mergedText":"([^"]+)"') {
        $text = $matches[1]
        Write-Host "  MergedText: $text" -ForegroundColor Cyan
    }
    if ($line -match '"batchCount":(\d+)') {
        Write-Host "  BatchCount: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"receivedCount":(\d+)') {
        Write-Host "  ReceivedCount: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"expectedSegmentCount":(\d+)') {
        Write-Host "  ExpectedSegmentCount: $($matches[1])" -ForegroundColor Cyan
    }
}

Write-Host "`n=== JOB7 ASR Batches ===" -ForegroundColor Yellow
$job7Batches = $content | Select-String -Pattern '"originalJobId":"[^"]*job[^"]*7[^"]*"|"jobId":"[^"]*job[^"]*7[^"]*"' | Select-String -Pattern "accumulateASRSegment|Added ASR"
$job7Batches | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"batchIndex":(\d+)') {
        Write-Host "  BatchIndex: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"asrText":"([^"]+)"|"asrTextPreview":"([^"]+)"') {
        $text = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  ASRText: $text" -ForegroundColor Cyan
    }
}

Write-Host "`n=== JOB3 Batch Assignment ===" -ForegroundColor Yellow
$job3Assign = $content | Select-String -Pattern '"originalJobId":"[^"]*job[^"]*3[^"]*"|"jobId":"[^"]*job[^"]*3[^"]*"' | Select-String -Pattern "originalJobIds|batchJobInfo|Batches assigned"
$job3Assign | Select-Object -First 10 | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
}

Write-Host "`n=== JOB7 Batch Assignment ===" -ForegroundColor Yellow
$job7Assign = $content | Select-String -Pattern '"originalJobId":"[^"]*job[^"]*7[^"]*"|"jobId":"[^"]*job[^"]*7[^"]*"' | Select-String -Pattern "originalJobIds|batchJobInfo|Batches assigned"
$job7Assign | Select-Object -First 10 | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
}

Write-Host "`n=== JOB3 Empty Container Check ===" -ForegroundColor Yellow
$job3Empty = $content | Select-String -Pattern '"originalJobId":"[^"]*job[^"]*3[^"]*"|"jobId":"[^"]*job[^"]*3[^"]*"' | Select-String -Pattern "Empty container|NO_TEXT_ASSIGNED|emptyJobIds"
$job3Empty | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
}

Write-Host "`n=== JOB7 Empty Container Check ===" -ForegroundColor Yellow
$job7Empty = $content | Select-String -Pattern '"originalJobId":"[^"]*job[^"]*7[^"]*"|"jobId":"[^"]*job[^"]*7[^"]*"' | Select-String -Pattern "Empty container|NO_TEXT_ASSIGNED|emptyJobIds"
$job7Empty | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
}

Write-Host "`nAnalysis completed!" -ForegroundColor Green
