# Analyze Audio Logs Script
# Extracts audio loss and processing efficiency information from three-tier logs

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Audio Logs Analysis Tool" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Define log file paths
$schedulerLog = "central_server\scheduler\logs\scheduler.log"
$webClientLog = "webapp\web-client\logs\web-client.log"
$electronNodeLog = "electron_node\electron-node\logs\electron-main.log"

# Check if log files exist
$logsExist = $true
if (-not (Test-Path $schedulerLog)) {
    Write-Host "Warning: Scheduler log not found: $schedulerLog" -ForegroundColor Yellow
    $logsExist = $false
}
if (-not (Test-Path $webClientLog)) {
    Write-Host "Warning: Web client log not found: $webClientLog" -ForegroundColor Yellow
    $logsExist = $false
}
if (-not (Test-Path $electronNodeLog)) {
    Write-Host "Warning: Electron node log not found: $electronNodeLog" -ForegroundColor Yellow
    $logsExist = $false
}

if (-not $logsExist) {
    Write-Host "Some log files are missing. Analysis may be incomplete." -ForegroundColor Yellow
    Write-Host ""
}

# 1. Analyze Audio Loss
Write-Host "[1/3] Analyzing Audio Loss..." -ForegroundColor Yellow
Write-Host ""

$audioLossPatterns = @(
    "Audio buffer empty",
    "Empty translation result",
    "missing index",
    "audio.*lost",
    "audio.*missing",
    "utterance.*lost"
)

$audioLossCount = 0
$audioLossDetails = @()

if (Test-Path $schedulerLog) {
    foreach ($pattern in $audioLossPatterns) {
        $matches = Select-String -Path $schedulerLog -Pattern $pattern -CaseSensitive:$false
        if ($matches) {
            $audioLossCount += $matches.Count
            foreach ($match in $matches | Select-Object -Last 10) {
                $audioLossDetails += @{
                    Source = "Scheduler"
                    Pattern = $pattern
                    Line = $match.LineNumber
                    Content = $match.Line.Substring(0, [Math]::Min(200, $match.Line.Length))
                }
            }
        }
    }
}

Write-Host "  Found $audioLossCount audio loss related entries" -ForegroundColor $(if ($audioLossCount -gt 0) { "Yellow" } else { "Green" })

if ($audioLossDetails.Count -gt 0) {
    Write-Host ""
    Write-Host "  Recent Audio Loss Events:" -ForegroundColor Cyan
    $audioLossDetails | Select-Object -Last 10 | ForEach-Object {
        Write-Host "    [$($_.Source)] Line $($_.Line): $($_.Content.Substring(0, [Math]::Min(150, $_.Content.Length)))..." -ForegroundColor Gray
    }
}

Write-Host ""

# 2. Analyze Processing Efficiency
Write-Host "[2/3] Analyzing Processing Efficiency..." -ForegroundColor Yellow
Write-Host ""

$efficiencyPatterns = @(
    "processingEfficiency",
    "processing.*efficiency",
    "OBS-1",
    "processing_time_ms",
    "elapsed_ms"
)

$efficiencyData = @()

if (Test-Path $schedulerLog) {
    # Extract processing efficiency from heartbeat
    $heartbeatMatches = Select-String -Path $schedulerLog -Pattern "processingEfficiency|OBS-1" -CaseSensitive:$false | Select-Object -Last 20
    foreach ($match in $heartbeatMatches) {
        if ($match.Line -match '"processingEfficiency":([\d.]+)') {
            $efficiency = [double]$matches[1]
            $efficiencyData += @{
                Source = "Scheduler (Heartbeat)"
                Efficiency = $efficiency
                Timestamp = $match.LineNumber
                Raw = $match.Line.Substring(0, [Math]::Min(300, $match.Line.Length))
            }
        }
    }
    
    # Extract processing time from job results
    $jobResultMatches = Select-String -Path $schedulerLog -Pattern '"processing_time_ms":(\d+)' -CaseSensitive:$false | Select-Object -Last 20
    foreach ($match in $jobResultMatches) {
        if ($match.Line -match '"processing_time_ms":(\d+)') {
            $processingTime = [int]$matches[1]
            # Try to extract audio duration if available
            $audioDuration = $null
            if ($match.Line -match '"audioDurationMs":(\d+)') {
                $audioDuration = [int]$matches[1]
            }
            $efficiencyData += @{
                Source = "Scheduler (Job Result)"
                ProcessingTime = $processingTime
                AudioDuration = $audioDuration
                Efficiency = if ($audioDuration) { [math]::Round($audioDuration / $processingTime, 2) } else { $null }
                Timestamp = $match.LineNumber
                Raw = $match.Line.Substring(0, [Math]::Min(200, $match.Line.Length))
            }
        }
    }
}

Write-Host "  Found $($efficiencyData.Count) processing efficiency entries" -ForegroundColor $(if ($efficiencyData.Count -gt 0) { "Green" } else { "Yellow" })

if ($efficiencyData.Count -gt 0) {
    Write-Host ""
    Write-Host "  Processing Efficiency Summary:" -ForegroundColor Cyan
    
    # Group by source
    $heartbeatEfficiencies = $efficiencyData | Where-Object { $_.Source -like "*Heartbeat*" -and $_.Efficiency } | Select-Object -ExpandProperty Efficiency
    $jobEfficiencies = $efficiencyData | Where-Object { $_.Source -like "*Job Result*" -and $_.Efficiency } | Select-Object -ExpandProperty Efficiency
    
    if ($heartbeatEfficiencies.Count -gt 0) {
        $avgHeartbeat = ($heartbeatEfficiencies | Measure-Object -Average).Average
        $minHeartbeat = ($heartbeatEfficiencies | Measure-Object -Minimum).Minimum
        $maxHeartbeat = ($heartbeatEfficiencies | Measure-Object -Maximum).Maximum
        Write-Host "    Heartbeat Cycle Efficiency:" -ForegroundColor White
        Write-Host "      Average: $([math]::Round($avgHeartbeat, 2))x" -ForegroundColor Gray
        Write-Host "      Min: $([math]::Round($minHeartbeat, 2))x" -ForegroundColor Gray
        Write-Host "      Max: $([math]::Round($maxHeartbeat, 2))x" -ForegroundColor Gray
        Write-Host "      Count: $($heartbeatEfficiencies.Count)" -ForegroundColor Gray
    }
    
    if ($jobEfficiencies.Count -gt 0) {
        $avgJob = ($jobEfficiencies | Measure-Object -Average).Average
        $minJob = ($jobEfficiencies | Measure-Object -Minimum).Minimum
        $maxJob = ($jobEfficiencies | Measure-Object -Maximum).Maximum
        Write-Host "    Job-Level Efficiency:" -ForegroundColor White
        Write-Host "      Average: $([math]::Round($avgJob, 2))x" -ForegroundColor Gray
        Write-Host "      Min: $([math]::Round($minJob, 2))x" -ForegroundColor Gray
        Write-Host "      Max: $([math]::Round($maxJob, 2))x" -ForegroundColor Gray
        Write-Host "      Count: $($jobEfficiencies.Count)" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "  Recent Processing Efficiency Entries:" -ForegroundColor Cyan
    $efficiencyData | Select-Object -Last 10 | ForEach-Object {
        if ($_.Efficiency) {
            Write-Host "    [$($_.Source)] Efficiency: $([math]::Round($_.Efficiency, 2))x" -ForegroundColor Gray
        } elseif ($_.ProcessingTime) {
            Write-Host "    [$($_.Source)] Processing Time: $($_.ProcessingTime)ms" -ForegroundColor Gray
        }
    }
}

Write-Host ""

# 3. Analyze Processing Times
Write-Host "[3/3] Analyzing Processing Times..." -ForegroundColor Yellow
Write-Host ""

$processingTimes = @()

if (Test-Path $schedulerLog) {
    $timeMatches = Select-String -Path $schedulerLog -Pattern '"processing_time_ms":(\d+)|"elapsed_ms":"(\d+)ms"' -CaseSensitive:$false | Select-Object -Last 30
    foreach ($match in $timeMatches) {
        if ($match.Line -match '"processing_time_ms":(\d+)') {
            $processingTimes += [int]$matches[1]
        } elseif ($match.Line -match '"elapsed_ms":"(\d+)ms"') {
            $processingTimes += [int]$matches[1]
        }
    }
}

if ($processingTimes.Count -gt 0) {
    $avgTime = ($processingTimes | Measure-Object -Average).Average
    $minTime = ($processingTimes | Measure-Object -Minimum).Minimum
    $maxTime = ($processingTimes | Measure-Object -Maximum).Maximum
    $p50 = ($processingTimes | Sort-Object)[[math]::Floor($processingTimes.Count * 0.5)]
    $p95 = ($processingTimes | Sort-Object)[[math]::Floor($processingTimes.Count * 0.95)]
    $p99 = ($processingTimes | Sort-Object)[[math]::Floor($processingTimes.Count * 0.99)]
    
    Write-Host "  Processing Time Statistics:" -ForegroundColor Cyan
    Write-Host "    Count: $($processingTimes.Count)" -ForegroundColor Gray
    Write-Host "    Average: $([math]::Round($avgTime, 2))ms" -ForegroundColor Gray
    Write-Host "    Min: $minTime ms" -ForegroundColor Gray
    Write-Host "    Max: $maxTime ms" -ForegroundColor Gray
    Write-Host "    P50: $p50 ms" -ForegroundColor Gray
    Write-Host "    P95: $p95 ms" -ForegroundColor Gray
    Write-Host "    P99: $p99 ms" -ForegroundColor Gray
} else {
    Write-Host "  No processing time data found" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Analysis Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

