# 分析所有Job的完整处理流程（简化版）
# 目的：找出文本丢失和顺序混乱的原因

$logPath = "electron-node\logs\electron-main.log"

if (-not (Test-Path $logPath)) {
    Write-Host "日志文件不存在: $logPath" -ForegroundColor Red
    exit 1
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "分析所有Job的完整处理流程" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 查找所有包含job_id的日志行
Write-Host "1. 提取所有job_id..." -ForegroundColor Yellow
$allJobLines = Get-Content $logPath | Select-String -Pattern "job_id"

# 提取唯一的job_id
$jobIds = @()
foreach ($line in $allJobLines) {
    if ($line -match 'job_id[":\s]+([a-f0-9-]+)') {
        $jobId = $matches[1]
        if ($jobId.Length -ge 8 -and $jobIds -notcontains $jobId) {
            $jobIds += $jobId
        }
    }
}

Write-Host "找到 $($jobIds.Count) 个唯一的job_id" -ForegroundColor Green
Write-Host ""

# 分析每个job
foreach ($jobId in $jobIds) {
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "分析 Job: $jobId" -ForegroundColor Cyan
    Write-Host "=========================================" -ForegroundColor Cyan
    
    # 提取该job的所有日志
    $jobLogs = Get-Content $logPath | Select-String -Pattern $jobId
    
    if ($jobLogs.Count -eq 0) {
        Write-Host "未找到该job的日志" -ForegroundColor Red
        continue
    }
    
    Write-Host "找到 $($jobLogs.Count) 条相关日志" -ForegroundColor Green
    Write-Host ""
    
    # 提取utterance_index
    $utteranceIndex = $null
    foreach ($log in $jobLogs) {
        if ($log -match 'utterance_index[":\s]+(\d+)') {
            $utteranceIndex = [int]$matches[1]
            break
        }
    }
    
    Write-Host "UtteranceIndex: $utteranceIndex" -ForegroundColor Green
    
    # 提取ASR批次信息
    Write-Host "`n--- ASR批次信息 ---" -ForegroundColor Yellow
    $asrBatches = $jobLogs | Select-String -Pattern "(?:ASR batch|addASRSegment|Accumulate.*Added ASR segment)"
    Write-Host "ASR批次数量: $($asrBatches.Count)" -ForegroundColor Cyan
    
    foreach ($asrLog in $asrBatches | Select-Object -First 5) {
        Write-Host "  $($asrLog.Line.Substring(0, [Math]::Min(150, $asrLog.Line.Length)))" -ForegroundColor Gray
    }
    
    # 提取TextMerge信息
    Write-Host "`n--- TextMerge信息 ---" -ForegroundColor Yellow
    $textMergeLogs = $jobLogs | Select-String -Pattern "(?:TextMerge|Merged ASR batches)"
    if ($textMergeLogs) {
        foreach ($mergeLog in $textMergeLogs | Select-Object -First 3) {
            Write-Host "  $($mergeLog.Line.Substring(0, [Math]::Min(150, $mergeLog.Line.Length)))" -ForegroundColor Gray
        }
    } else {
        Write-Host "  未找到TextMerge日志" -ForegroundColor Red
    }
    
    # 检查空容器
    Write-Host "`n--- 空容器检测 ---" -ForegroundColor Yellow
    $emptyLogs = $jobLogs | Select-String -Pattern "(?:empty container|NO_TEXT_ASSIGNED|ASR result is empty)"
    if ($emptyLogs) {
        Write-Host "  ⚠️  检测到空容器" -ForegroundColor Red
        foreach ($emptyLog in $emptyLogs | Select-Object -First 2) {
            Write-Host "    $($emptyLog.Line.Substring(0, [Math]::Min(150, $emptyLog.Line.Length)))" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ✓ 未检测到空容器" -ForegroundColor Green
    }
    
    # 检查音频被拒绝
    Write-Host "`n--- 音频质量检查 ---" -ForegroundColor Yellow
    $rejectedLogs = $jobLogs | Select-String -Pattern "(?:audio rejected|RMS.*below|quality.*rejected)"
    if ($rejectedLogs) {
        Write-Host "  ⚠️  检测到音频被拒绝" -ForegroundColor Red
        foreach ($rejectedLog in $rejectedLogs | Select-Object -First 2) {
            Write-Host "    $($rejectedLog.Line.Substring(0, [Math]::Min(150, $rejectedLog.Line.Length)))" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ✓ 未检测到音频被拒绝" -ForegroundColor Green
    }
    
    Write-Host ""
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "分析完成！" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
