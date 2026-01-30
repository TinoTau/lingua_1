# 分析最新集成测试的日志
# 提取每个job的处理过程，检查audio聚合、utterance聚合和语义修复

$logFile = "d:\Programs\github\lingua_1\electron_node\electron-node\logs\electron-main.log"

if (-not (Test-Path $logFile)) {
    Write-Host "日志文件不存在: $logFile" -ForegroundColor Red
    exit 1
}

Write-Host "分析日志文件: $logFile" -ForegroundColor Green
Write-Host "=" * 80

# 读取日志文件
$logs = Get-Content $logFile -Encoding UTF8

# 提取所有job ID和utteranceIndex
$jobPattern = 'job-[0-9a-f-]{36}'
$utterancePattern = '"utteranceIndex":(\d+)'

$jobs = @{}
$currentJob = $null
$currentUtteranceIndex = $null

foreach ($line in $logs) {
    # 提取job ID
    if ($line -match $jobPattern) {
        $jobId = $matches[0]
        if (-not $jobs.ContainsKey($jobId)) {
            $jobs[$jobId] = @{
                jobId = $jobId
                utteranceIndex = $null
                audioAggregation = @()
                asrResult = $null
                utteranceAggregation = $null
                semanticRepair = $null
                errors = @()
            }
        }
        $currentJob = $jobId
    }
    
    # 提取utteranceIndex
    if ($line -match $utterancePattern) {
        $utteranceIndex = [int]$matches[1]
        $currentUtteranceIndex = $utteranceIndex
        if ($currentJob -and $jobs.ContainsKey($currentJob)) {
            $jobs[$currentJob].utteranceIndex = $utteranceIndex
        }
    }
    
    # 提取关键信息
    if ($currentJob -and $jobs.ContainsKey($currentJob)) {
        $job = $jobs[$currentJob]
        
        # Audio聚合相关
        if ($line -match "AudioAggregator|processAudioChunk|audioSegments") {
            $job.audioAggregation += $line
        }
        
        # ASR结果
        if ($line -match "ASR OUTPUT|asrText") {
            if ($line -match '"asrText":"([^"]+)"') {
                $job.asrResult = $matches[1]
            }
        }
        
        # Utterance聚合相关
        if ($line -match "AggregationStage|processUtterance|aggregatedText") {
            $job.utteranceAggregation += $line
        }
        
        # 语义修复相关
        if ($line -match "semantic.*repair|SEMANTIC_REPAIR|semanticRepair") {
            $job.semanticRepair += $line
        }
        
        # 错误
        if ($line -match '"level":(40|50|60)') {
            $job.errors += $line
        }
    }
}

# 按utteranceIndex排序
$sortedJobs = $jobs.Values | Sort-Object { $_.utteranceIndex }

Write-Host "`n找到 $($sortedJobs.Count) 个job" -ForegroundColor Green
Write-Host "=" * 80

foreach ($job in $sortedJobs) {
    Write-Host "`nJob: $($job.jobId)" -ForegroundColor Cyan
    Write-Host "UtteranceIndex: $($job.utteranceIndex)" -ForegroundColor Yellow
    
    # ASR结果
    if ($job.asrResult) {
        Write-Host "ASR结果: $($job.asrResult)" -ForegroundColor Green
    } else {
        Write-Host "ASR结果: [未找到]" -ForegroundColor Red
    }
    
    # Audio聚合
    Write-Host "`nAudio聚合日志数量: $($job.audioAggregation.Count)" -ForegroundColor Yellow
    if ($job.audioAggregation.Count -gt 0) {
        $audioSummary = $job.audioAggregation | Select-Object -First 5
        foreach ($log in $audioSummary) {
            Write-Host "  - $log" -ForegroundColor Gray
        }
    }
    
    # Utterance聚合
    Write-Host "`nUtterance聚合日志数量: $($job.utteranceAggregation.Count)" -ForegroundColor Yellow
    if ($job.utteranceAggregation.Count -gt 0) {
        $aggSummary = $job.utteranceAggregation | Select-Object -First 5
        foreach ($log in $aggSummary) {
            Write-Host "  - $log" -ForegroundColor Gray
        }
    }
    
    # 语义修复
    Write-Host "`n语义修复日志数量: $($job.semanticRepair.Count)" -ForegroundColor Yellow
    if ($job.semanticRepair.Count -gt 0) {
        foreach ($log in $job.semanticRepair) {
            Write-Host "  - $log" -ForegroundColor Gray
        }
    } else {
        Write-Host "  [未找到语义修复日志]" -ForegroundColor Red
    }
    
    # 错误
    if ($job.errors.Count -gt 0) {
        Write-Host "`n错误/警告数量: $($job.errors.Count)" -ForegroundColor Red
        foreach ($error in $job.errors) {
            Write-Host "  - $error" -ForegroundColor Red
        }
    }
    
    Write-Host "`n" + ("-" * 80)
}

Write-Host "`n分析完成" -ForegroundColor Green
