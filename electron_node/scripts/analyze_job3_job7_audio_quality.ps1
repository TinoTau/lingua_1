# 分析job3和job7的音频质量
$logFile = "electron-node\logs\electron-main.log"

if (-not (Test-Path $logFile)) {
    Write-Host "Log file not found: $logFile" -ForegroundColor Red
    exit 1
}

Write-Host "Analyzing job3 and job7 audio quality..." -ForegroundColor Green
Write-Host "=" * 80

$content = Get-Content $logFile -Tail 100000

# Job3: job-6d7dae5a-45b9-4ec3-9e49-0211d884cc20
Write-Host "`n=== JOB3 Audio Quality ===" -ForegroundColor Yellow
Write-Host "Job ID: job-6d7dae5a-45b9-4ec3-9e49-0211d884cc20" -ForegroundColor Cyan

# 查找job3的所有音频质量检查
$job3Audio = $content | Select-String -Pattern "job-6d7dae5a" | Select-String -Pattern "rms|RMS|audio.*quality|Audio input quality"
$job3Audio | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"rms":"([^"]+)"|"rms":([\d.]+)') {
        $rms = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  RMS: $rms" -ForegroundColor Cyan
    }
    if ($line -match '"minRmsThreshold":([\d.]+)') {
        Write-Host "  Threshold: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"audioDurationMs":(\d+)') {
        Write-Host "  Duration: $($matches[1])ms" -ForegroundColor Cyan
    }
}

# 查找job3的音频切分信息
Write-Host "`n--- JOB3 Audio Split Info ---" -ForegroundColor Cyan
$job3Split = $content | Select-String -Pattern "job-6d7dae5a" | Select-String -Pattern "Audio split|split by energy|outputSegmentCount|segmentCount"
$job3Split | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"outputSegmentCount":(\d+)|"segmentCount":(\d+)') {
        $count = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  SegmentCount: $count" -ForegroundColor Cyan
    }
    if ($line -match '"inputAudioDurationMs":(\d+)') {
        Write-Host "  InputDuration: $($matches[1])ms" -ForegroundColor Cyan
    }
}

# 查找job3的batch信息
Write-Host "`n--- JOB3 Batch Info ---" -ForegroundColor Cyan
$job3Batch = $content | Select-String -Pattern "job-6d7dae5a" | Select-String -Pattern "batchesCount|originalJobIds|batchJobInfo"
$job3Batch | Select-Object -First 10 | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"batchesCount":(\d+)') {
        Write-Host "  BatchesCount: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"originalJobIds":\[([^\]]+)\]') {
        Write-Host "  OriginalJobIds: $($matches[1])" -ForegroundColor Cyan
    }
}

# Job7: job-4e6d4c35-614f-4587-bf41-870b76e321c5
Write-Host "`n=== JOB7 Audio Quality ===" -ForegroundColor Yellow
Write-Host "Job ID: job-4e6d4c35-614f-4587-bf41-870b76e321c5" -ForegroundColor Cyan

# 查找job7的所有音频质量检查
$job7Audio = $content | Select-String -Pattern "job-4e6d4c35" | Select-String -Pattern "rms|RMS|audio.*quality|Audio input quality"
$job7Audio | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"rms":"([^"]+)"|"rms":([\d.]+)') {
        $rms = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  RMS: $rms" -ForegroundColor Cyan
    }
    if ($line -match '"minRmsThreshold":([\d.]+)') {
        Write-Host "  Threshold: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"audioDurationMs":(\d+)') {
        Write-Host "  Duration: $($matches[1])ms" -ForegroundColor Cyan
    }
}

# 查找job7的音频切分信息
Write-Host "`n--- JOB7 Audio Split Info ---" -ForegroundColor Cyan
$job7Split = $content | Select-String -Pattern "job-4e6d4c35" | Select-String -Pattern "Audio split|split by energy|outputSegmentCount|segmentCount"
$job7Split | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"outputSegmentCount":(\d+)|"segmentCount":(\d+)') {
        $count = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  SegmentCount: $count" -ForegroundColor Cyan
    }
    if ($line -match '"inputAudioDurationMs":(\d+)') {
        Write-Host "  InputDuration: $($matches[1])ms" -ForegroundColor Cyan
    }
}

# 查找job7的batch信息
Write-Host "`n--- JOB7 Batch Info ---" -ForegroundColor Cyan
$job7Batch = $content | Select-String -Pattern "job-4e6d4c35" | Select-String -Pattern "batchesCount|originalJobIds|batchJobInfo"
$job7Batch | Select-Object -First 10 | ForEach-Object {
    $line = $_.Line
    Write-Host $line -ForegroundColor White
    if ($line -match '"batchesCount":(\d+)') {
        Write-Host "  BatchesCount: $($matches[1])" -ForegroundColor Cyan
    }
    if ($line -match '"originalJobIds":\[([^\]]+)\]') {
        Write-Host "  OriginalJobIds: $($matches[1])" -ForegroundColor Cyan
    }
}

# 查找所有batch的RMS值（按batchIndex排序）
Write-Host "`n=== All Batches RMS Values (for job3 and job7) ===" -ForegroundColor Yellow
$allBatches = $content | Select-String -Pattern "job-6d7dae5a|job-4e6d4c35" | Select-String -Pattern "ASR task.*Audio input quality|rms.*minRmsThreshold"
$allBatches | ForEach-Object {
    $line = $_.Line
    if ($line -match '"rms":"([^"]+)"|"rms":([\d.]+)') {
        $rms = if ($matches[1]) { $matches[1] } else { $matches[2] }
        if ($line -match '"jobId":"([^"]+)"') {
            $jobId = $matches[1]
            Write-Host "JobId: $jobId, RMS: $rms" -ForegroundColor White
        }
        if ($line -match '"segmentIndex":(\d+)') {
            $segmentIndex = $matches[1]
            Write-Host "  SegmentIndex: $segmentIndex" -ForegroundColor Cyan
        }
        if ($line -match '"audioDurationMs":(\d+)') {
            $duration = $matches[1]
            Write-Host "  Duration: $duration ms" -ForegroundColor Cyan
        }
    }
}

# 查找音频被拒绝的情况
Write-Host "`n=== Audio Rejection Check ===" -ForegroundColor Yellow
$rejections = $content | Select-String -Pattern "job-6d7dae5a|job-4e6d4c35" | Select-String -Pattern "rejected|Rejected|audio.*reject|quality.*reject"
$rejections | ForEach-Object {
    Write-Host $_.Line -ForegroundColor Red
}

Write-Host "`nAnalysis completed!" -ForegroundColor Green
