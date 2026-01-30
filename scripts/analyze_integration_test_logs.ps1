# 分析集成测试日志
# 用于诊断前半句丢失问题

param(
    [string]$SessionId = "",
    [string]$SchedulerLogPath = "central_server\scheduler\logs\scheduler.log",
    [string]$NodeLogPath = "electron_node\electron-node\logs\electron-main.log",
    [int]$Lines = 1000
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "集成测试日志分析" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

# 1. 分析调度服务器日志
Write-Host "1. 调度服务器日志分析" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray

$schedulerLog = Join-Path $projectRoot $SchedulerLogPath
if (Test-Path $schedulerLog) {
    $schedulerContent = Get-Content $schedulerLog -Tail $Lines
    
    # 提取 Job 创建日志
    Write-Host "`n[Job 创建日志]" -ForegroundColor Green
    $jobCreationLogs = $schedulerContent | Select-String -Pattern "任务创建|Job 创建成功|Finalize triggered" | Select-Object -Last 20
    if ($jobCreationLogs) {
        $jobCreationLogs | ForEach-Object {
            Write-Host $_.Line -ForegroundColor White
        }
    } else {
        Write-Host "未找到 Job 创建日志" -ForegroundColor Red
    }
    
    # 提取 utterance_index
    Write-Host "`n[UtteranceIndex 列表]" -ForegroundColor Green
    $utteranceIndices = $schedulerContent | Select-String -Pattern "utterance_index\s*[=:]\s*(\d+)" | ForEach-Object {
        if ($_.Matches[0].Groups[1].Value) {
            [int]$_.Matches[0].Groups[1].Value
        }
    } | Sort-Object -Unique
    
    if ($utteranceIndices) {
        Write-Host "找到的 utterance_index: $($utteranceIndices -join ', ')" -ForegroundColor White
        
        # 检查连续性
        $maxIndex = ($utteranceIndices | Measure-Object -Maximum).Maximum
        $expected = 0..$maxIndex
        $missing = $expected | Where-Object { $_ -notin $utteranceIndices }
        
        if ($missing) {
            Write-Host "缺失的 utterance_index: $($missing -join ', ')" -ForegroundColor Red
        } else {
            Write-Host "utterance_index 连续" -ForegroundColor Green
        }
    } else {
        Write-Host "未找到 utterance_index" -ForegroundColor Red
    }
    
    # 提取 Finalize 原因
    Write-Host "`n[Finalize 原因统计]" -ForegroundColor Green
    $finalizeReasons = $schedulerContent | Select-String -Pattern "reason\s*[=:]\s*['""]?(\w+)['""]?" | ForEach-Object {
        if ($_.Matches[0].Groups[1].Value) {
            $_.Matches[0].Groups[1].Value
        }
    } | Group-Object | Sort-Object Count -Descending
    
    if ($finalizeReasons) {
        $finalizeReasons | ForEach-Object {
            Write-Host "  $($_.Name): $($_.Count) 次" -ForegroundColor White
        }
    } else {
        Write-Host "未找到 Finalize 原因" -ForegroundColor Red
    }
    
} else {
    Write-Host "调度服务器日志文件不存在: $schedulerLog" -ForegroundColor Red
}

Write-Host ""

# 2. 分析节点端日志
Write-Host "2. 节点端日志分析" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Gray

$nodeLog = Join-Path $projectRoot $NodeLogPath
if (Test-Path $nodeLog) {
    $nodeContent = Get-Content $nodeLog -Tail $Lines
    
    # 提取 AudioAggregator 处理日志
    Write-Host "`n[AudioAggregator 处理日志]" -ForegroundColor Green
    $audioAggregatorLogs = $nodeContent | Select-String -Pattern "AudioAggregator.*Processing|hasMergedPendingAudio|inputAudioDurationMs" | Select-Object -Last 20
    if ($audioAggregatorLogs) {
        $audioAggregatorLogs | ForEach-Object {
            Write-Host $_.Line -ForegroundColor White
        }
    } else {
        Write-Host "未找到 AudioAggregator 处理日志" -ForegroundColor Red
    }
    
    # 提取 Finalize Handler 日志
    Write-Host "`n[Finalize Handler 日志]" -ForegroundColor Green
    $finalizeHandlerLogs = $nodeContent | Select-String -Pattern "FinalizeHandler.*utteranceIndex|UtteranceIndex跳跃|连续utteranceIndex" | Select-Object -Last 20
    if ($finalizeHandlerLogs) {
        $finalizeHandlerLogs | ForEach-Object {
            Write-Host $_.Line -ForegroundColor White
        }
    } else {
        Write-Host "未找到 Finalize Handler 日志" -ForegroundColor Red
    }
    
    # 提取 AggregatorMiddleware 去重日志
    Write-Host "`n[AggregatorMiddleware 去重日志]" -ForegroundColor Green
    $deduplicationLogs = $nodeContent | Select-String -Pattern "Filtering duplicate|Detected overlap|substring duplicate" | Select-Object -Last 20
    if ($deduplicationLogs) {
        $deduplicationLogs | ForEach-Object {
            Write-Host $_.Line -ForegroundColor White
        }
    } else {
        Write-Host "未找到 AggregatorMiddleware 去重日志" -ForegroundColor Gray
    }
    
    # 提取音频时长信息
    Write-Host "`n[音频时长统计]" -ForegroundColor Green
    $audioDurationLogs = $nodeContent | Select-String -Pattern "inputAudioDurationMs\s*[=:]\s*(\d+)" | ForEach-Object {
        if ($_.Matches[0].Groups[1].Value) {
            [int]$_.Matches[0].Groups[1].Value
        }
    }
    
    if ($audioDurationLogs) {
        $shortAudio = $audioDurationLogs | Where-Object { $_ -lt 1000 }
        $mediumAudio = $audioDurationLogs | Where-Object { $_ -ge 1000 -and $_ -lt 5000 }
        $longAudio = $audioDurationLogs | Where-Object { $_ -ge 5000 }
        
        Write-Host "  短音频（< 1秒）: $($shortAudio.Count) 个" -ForegroundColor $(if ($shortAudio.Count -gt 0) { "Yellow" } else { "Green" })
        Write-Host "  中等音频（1-5秒）: $($mediumAudio.Count) 个" -ForegroundColor White
        Write-Host "  长音频（≥ 5秒）: $($longAudio.Count) 个" -ForegroundColor White
        
        if ($shortAudio) {
            Write-Host "  短音频时长: $($shortAudio -join 'ms, ')ms" -ForegroundColor Yellow
        }
    } else {
        Write-Host "未找到音频时长信息" -ForegroundColor Red
    }
    
} else {
    Write-Host "节点端日志文件不存在: $nodeLog" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "分析完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
