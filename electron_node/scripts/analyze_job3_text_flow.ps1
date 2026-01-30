# 分析job3的完整文本流程
# 目的：找出job3文本不完整和语序混乱的原因

$logFile = "electron-node\logs\electron-main.log"
if (-not (Test-Path $logFile)) {
    Write-Host "Log file not found: $logFile"
    exit 1
}

Write-Host "Analyzing job3 (utteranceIndex=2) text flow..."
Write-Host "=" * 80

$content = Get-Content $logFile -Tail 20000

# 查找所有与job3相关的日志
$job3Logs = $content | Select-String -Pattern "utteranceIndex.*2|job-168a54c4-0b31-404f-8e60-e50df06c9ff8|job-355e0727-1b60-418f-b4ad-929da7be042b"

Write-Host "`n=== ASR阶段 ===" -ForegroundColor Cyan

# 提取ASR结果
$asrResults = $job3Logs | Select-String -Pattern "asrText|ASR OUTPUT|ASR batch.*completed"
foreach ($line in $asrResults) {
    if ($line.Line -match '"asrText":"([^"]+)"|"asrTextPreview":"([^"]+)"') {
        $text = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  ASR: $text" -ForegroundColor Yellow
    }
}

Write-Host "`n=== 文本合并阶段 (TextMerge) ===" -ForegroundColor Cyan

# 提取TextMerge结果
$textMergeLogs = $job3Logs | Select-String -Pattern "TextMerge|mergedText"
foreach ($line in $textMergeLogs) {
    if ($line.Line -match '"mergedTextPreview":"([^"]+)"|"mergedText":"([^"]+)"') {
        $text = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  Merged: $text" -ForegroundColor Yellow
    }
    if ($line.Line -match '"batchTexts"') {
        Write-Host "  $($line.Line)" -ForegroundColor Gray
    }
}

Write-Host "`n=== 聚合阶段 (Aggregation) ===" -ForegroundColor Cyan

# 提取聚合结果
$aggLogs = $job3Logs | Select-String -Pattern "aggregatedText|AggregationStage"
foreach ($line in $aggLogs) {
    if ($line.Line -match '"aggregatedText":"([^"]+)"|"aggregatedTextPreview":"([^"]+)"') {
        $text = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  Aggregated: $text" -ForegroundColor Yellow
    }
}

Write-Host "`n=== 语义修复阶段 (Semantic Repair) ===" -ForegroundColor Cyan

# 提取语义修复结果
$repairLogs = $job3Logs | Select-String -Pattern "repairedText|SemanticRepair"
foreach ($line in $repairLogs) {
    if ($line.Line -match '"repairedText":"([^"]+)"|"repairedTextPreview":"([^"]+)"') {
        $text = if ($matches[1]) { $matches[1] } else { $matches[2] }
        Write-Host "  Repaired: $text" -ForegroundColor Yellow
    }
}

Write-Host "`n=== 最终发送结果 ===" -ForegroundColor Cyan

# 提取最终发送的结果
$finalLogs = $job3Logs | Select-String -Pattern "Sending job_result|textAsr"
foreach ($line in $finalLogs) {
    if ($line.Line -match '"textAsr":"([^"]+)"') {
        $text = $matches[1]
        Write-Host "  Final: $text" -ForegroundColor Green
    }
}

Write-Host "`n=== Batch信息 ===" -ForegroundColor Cyan

# 提取batch信息
$batchLogs = $job3Logs | Select-String -Pattern "batchIndex|batchTexts|segmentIndex"
foreach ($line in $batchLogs) {
    if ($line.Line -match '"batchIndex":(\d+)|"segmentIndex":(\d+)') {
        $index = if ($matches[1]) { $matches[1] } else { $matches[2] }
        if ($line.Line -match '"textPreview":"([^"]+)"') {
            $text = $matches[1]
            Write-Host "  Batch $index : $text" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n" + ("=" * 80)
