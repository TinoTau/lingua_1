# ASR Job 问题分析脚本
# 用于分析Job4/Job5/Job7/Job8的问题

param(
    [string]$LogFile = "",
    [string]$JobId = ""
)

# 如果没有指定日志文件，尝试查找
if ([string]::IsNullOrEmpty($LogFile)) {
    # 尝试多个可能的日志文件位置
    $possiblePaths = @(
        "logs\electron-main.log",
        "electron_node\electron-node\logs\electron-main.log",
        "electron_node\electron-node\main\logs\electron-main.log",
        "electron_node\electron-node\main\electron-node\main\logs\electron-main.log"
    )
    
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) {
            $LogFile = $path
            Write-Host "找到日志文件: $LogFile" -ForegroundColor Green
            break
        }
    }
    
    if ([string]::IsNullOrEmpty($LogFile)) {
        Write-Host "错误: 未找到日志文件，请指定 -LogFile 参数" -ForegroundColor Red
        Write-Host "例如: .\analyze_job_issues.ps1 -LogFile 'logs\electron-main.log'" -ForegroundColor Yellow
        exit 1
    }
}

if (-not (Test-Path $LogFile)) {
    Write-Host "错误: 日志文件不存在: $LogFile" -ForegroundColor Red
    exit 1
}

Write-Host "=== ASR Job 问题分析 ===" -ForegroundColor Green
Write-Host "日志文件: $LogFile" -ForegroundColor Cyan
Write-Host ""

# 如果指定了JobId，只分析该Job
if ($JobId) {
    Write-Host "=== 分析 Job $JobId ===" -ForegroundColor Yellow
    $jobPattern = $JobId
} else {
    Write-Host "=== 分析所有相关Job (Job0, Job1, Job4, Job5, Job7, Job8, Job11) ===" -ForegroundColor Yellow
    $jobPattern = "job-[014578]|job-11"
}

# 1. 检查Job1的finalize类型和pending音频
Write-Host "`n[1] 检查Job1的finalize类型和pending音频" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$job1Logs = Select-String -Path $LogFile -Pattern "job-1.*isPauseTriggered|job-1.*isManualCut|job-1.*isTimeoutTriggered|job-1.*pendingPauseAudio|PauseMerge.*job-1|job-1.*utteranceIndex" -ErrorAction SilentlyContinue | Select-Object -First 15
if ($job1Logs) {
    $job1Logs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job1相关日志" -ForegroundColor Gray
}

# 2. 检查Job4处理时的pending音频和utteranceIndex
Write-Host "`n[2] 检查Job4处理时的pending音频和utteranceIndex" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$job4PendingLogs = Select-String -Path $LogFile -Pattern "job-4.*pending|job-4.*utteranceIndex|TimeoutMerge.*job-4|PauseMerge.*job-4|Checking pending.*job-4|belongs to different utterance.*job-4" -ErrorAction SilentlyContinue | Select-Object -First 25
if ($job4PendingLogs) {
    $job4PendingLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job4 pending音频相关日志" -ForegroundColor Gray
}

# 3. 检查Job4的originalJobIds分配
Write-Host "`n[3] 检查Job4的originalJobIds分配" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$job4OriginalLogs = Select-String -Path $LogFile -Pattern "job-4.*originalJobIds|job-4.*container assignment|job-4.*Multiple jobs|job-4.*Independent utterance|job-4.*Registering original job" -ErrorAction SilentlyContinue | Select-Object -First 15
if ($job4OriginalLogs) {
    $job4OriginalLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job4 originalJobIds分配相关日志" -ForegroundColor Gray
}

# 4. 检查Job4的音频聚合和切分
Write-Host "`n[4] 检查Job4的音频聚合和切分" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$job4AudioLogs = Select-String -Path $LogFile -Pattern "AudioAggregator.*job-4.*Audio chunk|AudioAggregator.*job-4.*Audio split|AudioAggregator.*job-4.*StreamingBatch|AudioAggregator.*job-4.*TimeoutFinalize|AudioAggregator.*job-4.*TimeoutMerge" -ErrorAction SilentlyContinue | Select-Object -First 20
if ($job4AudioLogs) {
    $job4AudioLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job4音频聚合相关日志" -ForegroundColor Gray
}

# 5. 检查Job4的ASR批次处理
Write-Host "`n[5] 检查Job4的ASR批次处理" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$job4AsrLogs = Select-String -Path $LogFile -Pattern "runAsrStep.*job-4.*Registering|runAsrStep.*job-4.*ASR batch|runAsrStep.*job-4.*Added ASR batch|runAsrStep.*job-4.*originalJobId" -ErrorAction SilentlyContinue | Select-Object -First 20
if ($job4AsrLogs) {
    $job4AsrLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job4 ASR处理相关日志" -ForegroundColor Gray
}

# 6. 检查Job4的ASR结果累积和分发
Write-Host "`n[6] 检查Job4的ASR结果累积和分发" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$job4DispatcherLogs = Select-String -Path $LogFile -Pattern "OriginalJobResultDispatcher.*job-4|Accumulating ASR segment.*job-4|TextMerge.*job-4|Merged ASR batches.*job-4" -ErrorAction SilentlyContinue | Select-Object -First 20
if ($job4DispatcherLogs) {
    $job4DispatcherLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job4 ASR结果分发相关日志" -ForegroundColor Gray
}

# 7. 检查Job5/Job7/Job8的pendingSmallSegments
Write-Host "`n[7] 检查Job5/Job7/Job8的pendingSmallSegments" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$pendingSmallLogs = Select-String -Path $LogFile -Pattern "job-[578].*pendingSmallSegments|Remaining small segments.*job-[578]|pendingSmallSegments.*job-[578]" -ErrorAction SilentlyContinue | Select-Object -First 15
if ($pendingSmallLogs) {
    $pendingSmallLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job5/Job7/Job8 pendingSmallSegments相关日志" -ForegroundColor Gray
}

# 8. 检查Job5/Job7/Job8的音频切分和批次创建
Write-Host "`n[8] 检查Job5/Job7/Job8的音频切分和批次创建" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$job578AudioLogs = Select-String -Path $LogFile -Pattern "Audio split by energy completed.*job-[578]|Streaming batches created.*job-[578]|AudioAggregator.*job-[578].*StreamingBatch" -ErrorAction SilentlyContinue | Select-Object -First 15
if ($job578AudioLogs) {
    $job578AudioLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job5/Job7/Job8音频切分相关日志" -ForegroundColor Gray
}

# 9. 检查第四句话的超时处理
Write-Host "`n[9] 检查第四句话的超时处理（查找所有超时相关日志）" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$timeoutLogs = Select-String -Path $LogFile -Pattern "isTimeoutTriggered.*true|TimeoutFinalize|pendingTimeoutAudio.*TTL|pendingTimeoutAudio.*merged|pendingTimeoutAudio.*waiting|pendingTimeoutAudio.*clearing|TimeoutMerge" -ErrorAction SilentlyContinue | Select-Object -First 30
if ($timeoutLogs) {
    $timeoutLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到超时处理相关日志" -ForegroundColor Gray
}

# 10. 检查所有相关job的utteranceIndex
Write-Host "`n[10] 检查所有相关job的utteranceIndex" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$utteranceLogs = Select-String -Path $LogFile -Pattern "job-[014578].*utteranceIndex|utteranceIndex.*job-[014578]|job-11.*utteranceIndex" -ErrorAction SilentlyContinue | Select-Object -First 30
if ($utteranceLogs) {
    $utteranceIndexMap = @{}
    $utteranceLogs | ForEach-Object { 
        $line = $_.Line
        if ($line -match '"jobId":\s*"([^"]+)"') {
            $jobId = $matches[1]
        }
        if ($line -match '"utteranceIndex":\s*(\d+)') {
            $utteranceIndex = $matches[1]
            if ($jobId) {
                if (-not $utteranceIndexMap.ContainsKey($jobId)) {
                    $utteranceIndexMap[$jobId] = @()
                }
                $utteranceIndexMap[$jobId] += $utteranceIndex
            }
        }
        Write-Host $line
    }
    Write-Host "`nutteranceIndex汇总:" -ForegroundColor Cyan
    $utteranceIndexMap.GetEnumerator() | Sort-Object Name | ForEach-Object {
        $uniqueIndices = $_.Value | Sort-Object -Unique
        Write-Host "  $($_.Key): $($uniqueIndices -join ', ')" -ForegroundColor Cyan
    }
} else {
    Write-Host "未找到utteranceIndex相关日志" -ForegroundColor Gray
}

# 11. 检查utteranceIndex不一致的警告
Write-Host "`n[11] 检查utteranceIndex不一致的警告" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$warningLogs = Select-String -Path $LogFile -Pattern "belongs to different utterance|PendingPauseAudio belongs|PendingTimeoutAudio belongs" -ErrorAction SilentlyContinue | Select-Object -First 20
if ($warningLogs) {
    Write-Host "找到utteranceIndex不一致的警告:" -ForegroundColor Red
    $warningLogs | ForEach-Object { Write-Host $_.Line -ForegroundColor Red }
} else {
    Write-Host "未找到utteranceIndex不一致的警告（这可能意味着检查没有生效）" -ForegroundColor Yellow
}

# 12. 检查Job4的完整处理流程（按时间顺序）
Write-Host "`n[12] 检查Job4的完整处理流程（按时间顺序，最后50条）" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray
$job4AllLogs = Select-String -Path $LogFile -Pattern "job-4" -ErrorAction SilentlyContinue | Select-Object -Last 50
if ($job4AllLogs) {
    $job4AllLogs | ForEach-Object { Write-Host $_.Line }
} else {
    Write-Host "未找到Job4相关日志" -ForegroundColor Gray
}

Write-Host "`n=== 分析完成 ===" -ForegroundColor Green
Write-Host "`n提示: 如果日志文件不在当前目录，请使用 -LogFile 参数指定完整路径" -ForegroundColor Yellow
Write-Host "例如: .\analyze_job_issues.ps1 -LogFile 'D:\path\to\logs\electron-main.log'" -ForegroundColor Yellow
