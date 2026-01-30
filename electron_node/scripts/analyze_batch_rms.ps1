# 分析每个job的各个batch的RMS值
# 目的：检查是否所有job的后半句音频质量都偏低

$logFile = "electron-node\logs\electron-main.log"
if (-not (Test-Path $logFile)) {
    Write-Host "Log file not found: $logFile"
    exit 1
}

Write-Host "Analyzing batch RMS values from log file..."
Write-Host "=" * 80

$content = Get-Content $logFile -Tail 10000
$jobs = @{}
$currentJob = $null
$currentSegmentIndex = -1

foreach ($line in $content) {
    # 提取jobId
    if ($line -match '"jobId":"(job-[^"]+)"') {
        $currentJob = $matches[1]
        if (-not $jobs.ContainsKey($currentJob)) {
            $jobs[$currentJob] = @{
                batches = @()
            }
        }
    }
    
    # 提取segmentIndex
    if ($line -match '"segmentIndex":(\d+)') {
        $currentSegmentIndex = [int]$matches[1]
    }
    
    # 提取RMS值
    if ($line -match '"rms":"([^"]+)"') {
        $rms = [double]$matches[1]
        if ($currentJob) {
            $batchInfo = @{
                segmentIndex = $currentSegmentIndex
                rms = $rms
                rejected = $false
            }
            
            # 检查是否被拒绝
            if ($line -match "Audio quality too low|rejecting") {
                $batchInfo.rejected = $true
            }
            
            # 检查是否已经有这个segmentIndex的batch
            $existing = $jobs[$currentJob].batches | Where-Object { $_.segmentIndex -eq $currentSegmentIndex }
            if (-not $existing) {
                $jobs[$currentJob].batches += $batchInfo
            }
        }
    }
}

# 输出结果
$jobsWithBatches = $jobs.GetEnumerator() | Where-Object { $_.Value.batches.Count -gt 0 }

if ($jobsWithBatches.Count -eq 0) {
    Write-Host "No jobs with batch RMS data found in log"
    exit 0
}

Write-Host "`nFound $($jobsWithBatches.Count) jobs with batch data`n"

foreach ($jobEntry in $jobsWithBatches) {
    $jobId = $jobEntry.Key
    $batches = $jobEntry.Value.batches | Sort-Object segmentIndex
    
    Write-Host "=" * 80
    Write-Host "Job: $jobId"
    Write-Host "-" * 80
    
    $firstBatchRms = $null
    $subsequentBatchesRms = @()
    
    foreach ($batch in $batches) {
        $status = if ($batch.rejected) { "REJECTED" } else { "ACCEPTED" }
        $threshold = if ($batch.segmentIndex -eq 0) { "0.015 (strict)" } else { "0.008 (relaxed)" }
        $thresholdMet = if ($batch.segmentIndex -eq 0) { 
            $batch.rms -ge 0.015 
        } else { 
            $batch.rms -ge 0.008 
        }
        
        Write-Host "  Batch $($batch.segmentIndex): RMS = $($batch.rms.ToString('F4')) [$status] (threshold: $threshold, met: $thresholdMet)"
        
        if ($batch.segmentIndex -eq 0) {
            $firstBatchRms = $batch.rms
        } else {
            $subsequentBatchesRms += $batch.rms
        }
    }
    
    # 分析
    if ($firstBatchRms -ne $null -and $subsequentBatchesRms.Count -gt 0) {
        $avgSubsequentRms = ($subsequentBatchesRms | Measure-Object -Average).Average
        $rmsDifference = $firstBatchRms - $avgSubsequentRms
        
        Write-Host "`n  Analysis:"
        Write-Host "    First batch RMS: $($firstBatchRms.ToString('F4'))"
        Write-Host "    Avg subsequent batches RMS: $($avgSubsequentRms.ToString('F4'))"
        Write-Host "    RMS difference: $($rmsDifference.ToString('F4'))"
        
        if ($rmsDifference -gt 0.005) {
            Write-Host "    ⚠️  WARNING: Subsequent batches have significantly lower RMS!"
        } elseif ($rmsDifference -lt -0.005) {
            Write-Host "    ℹ️  INFO: Subsequent batches have higher RMS (unusual)"
        } else {
            Write-Host "    ✓ RMS values are similar"
        }
    }
    
    Write-Host ""
}

Write-Host "=" * 80
Write-Host "Analysis complete"
