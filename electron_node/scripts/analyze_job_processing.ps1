# 分析每个job的处理过程
# 提取ASR结果、utterance聚合结果、语义修复结果

$logFile = "d:\Programs\github\lingua_1\electron_node\electron-node\logs\electron-main.log"

if (-not (Test-Path $logFile)) {
    Write-Host "日志文件不存在: $logFile" -ForegroundColor Red
    exit 1
}

Write-Host "分析日志文件: $logFile" -ForegroundColor Green
Write-Host "=" * 80

# 读取日志文件
$logs = Get-Content $logFile -Encoding UTF8

# 按utteranceIndex分组
$jobsByIndex = @{}

foreach ($line in $logs) {
    # 提取utteranceIndex
    if ($line -match '"utteranceIndex":(\d+)') {
        $utteranceIndex = [int]$matches[1]
        
        if (-not $jobsByIndex.ContainsKey($utteranceIndex)) {
            $jobsByIndex[$utteranceIndex] = @{
                utteranceIndex = $utteranceIndex
                jobId = $null
                asrText = $null
                aggregatedText = $null
                semanticRepairText = $null
                semanticRepairCalled = $false
                errors = @()
                audioAggregation = @()
            }
        }
        
        $job = $jobsByIndex[$utteranceIndex]
        
        # 提取jobId
        if ($line -match 'job-[0-9a-f-]{36}') {
            $job.jobId = $matches[0]
        }
        
        # 提取ASR结果
        if ($line -match '"asrText":"([^"]+)"') {
            $job.asrText = $matches[1]
        }
        
        # 提取aggregatedText
        if ($line -match '"aggregatedText":"([^"]+)"') {
            $job.aggregatedText = $matches[1]
        }
        
        # 检查语义修复
        if ($line -match "SEMANTIC_REPAIR|semantic.*repair|runSemanticRepairStep") {
            $job.semanticRepairCalled = $true
            if ($line -match '"repairedText":"([^"]+)"|"text":"([^"]+)"') {
                $job.semanticRepairText = if ($matches[1]) { $matches[1] } else { $matches[2] }
            }
        }
        
        # Audio聚合相关
        if ($line -match "AudioAggregator|processAudioChunk|audioSegments") {
            $job.audioAggregation += $line
        }
        
        # 错误
        if ($line -match '"level":(40|50|60)') {
            $job.errors += $line
        }
    }
}

# 按utteranceIndex排序
$sortedJobs = $jobsByIndex.Values | Sort-Object { $_.utteranceIndex }

Write-Host "`n找到 $($sortedJobs.Count) 个job" -ForegroundColor Green
Write-Host "=" * 80

foreach ($job in $sortedJobs) {
    Write-Host "`n[Job $($job.utteranceIndex)]" -ForegroundColor Cyan
    Write-Host "JobId: $($job.jobId)" -ForegroundColor Yellow
    
    # ASR结果
    Write-Host "`nASR结果:" -ForegroundColor Green
    if ($job.asrText) {
        Write-Host "  $($job.asrText)" -ForegroundColor White
    } else {
        Write-Host "  [未找到]" -ForegroundColor Red
    }
    
    # Utterance聚合结果
    Write-Host "`nUtterance聚合结果:" -ForegroundColor Green
    if ($job.aggregatedText) {
        Write-Host "  $($job.aggregatedText)" -ForegroundColor White
        if ($job.asrText -and $job.aggregatedText -ne $job.asrText) {
            Write-Host "  [注意: 与ASR结果不同]" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [未找到]" -ForegroundColor Red
    }
    
    # 语义修复
    Write-Host "`n语义修复:" -ForegroundColor Green
    if ($job.semanticRepairCalled) {
        Write-Host "  [已调用]" -ForegroundColor Green
        if ($job.semanticRepairText) {
            Write-Host "  修复后文本: $($job.semanticRepairText)" -ForegroundColor White
        } else {
            Write-Host "  [未找到修复后文本]" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [未调用]" -ForegroundColor Red
    }
    
    # Audio聚合
    Write-Host "`nAudio聚合日志数量: $($job.audioAggregation.Count)" -ForegroundColor Yellow
    
    # 错误
    if ($job.errors.Count -gt 0) {
        Write-Host "`n错误/警告数量: $($job.errors.Count)" -ForegroundColor Red
        foreach ($error in $job.errors) {
            Write-Host "  - $error" -ForegroundColor Red
        }
    }
    
    Write-Host "`n" + ("-" * 80)
}

# 总结
Write-Host "`n总结:" -ForegroundColor Green
$semanticRepairCount = ($sortedJobs | Where-Object { $_.semanticRepairCalled }).Count
Write-Host "语义修复调用次数: $semanticRepairCount / $($sortedJobs.Count)" -ForegroundColor $(if ($semanticRepairCount -eq 0) { "Red" } else { "Yellow" })

$errorCount = ($sortedJobs | Where-Object { $_.errors.Count -gt 0 }).Count
Write-Host "有错误的job数量: $errorCount / $($sortedJobs.Count)" -ForegroundColor $(if ($errorCount -gt 0) { "Red" } else { "Green" })

Write-Host "`n分析完成" -ForegroundColor Green
