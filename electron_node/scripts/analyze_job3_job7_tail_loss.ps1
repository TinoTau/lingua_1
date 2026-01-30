# 分析job3和job7后半句丢失问题
# 检查每个job在各服务里的处理过程，输入是什么输出是什么

$logPath = "D:\Programs\github\lingua_1\electron_node\electron-node\logs\main.log"

if (-not (Test-Path $logPath)) {
    Write-Host "日志文件不存在: $logPath" -ForegroundColor Red
    exit 1
}

Write-Host "分析job3和job7后半句丢失问题..." -ForegroundColor Green
Write-Host "=" * 80

# 查找job3和job7相关的所有日志
$job3Logs = Select-String -Path $logPath -Pattern "job.*3|job_id.*3" -Context 0, 5 | Select-Object -First 200
$job7Logs = Select-String -Path $logPath -Pattern "job.*7|job_id.*7" -Context 0, 5 | Select-Object -First 200

Write-Host "`n=== JOB3 处理流程 ===" -ForegroundColor Yellow

# 分析job3的ASR处理
Write-Host "`n--- ASR处理 ---" -ForegroundColor Cyan
$job3ASR = $job3Logs | Where-Object { $_.Line -match "ASR|asr|runAsrStep" }
$job3ASR | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
    if ($_.Context.PostContext) {
        $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
}

# 分析job3的文本合并
Write-Host "`n--- 文本合并 (TextMerge) ---" -ForegroundColor Cyan
$job3Merge = $job3Logs | Where-Object { $_.Line -match "TextMerge|mergeASRText|OriginalJobResultDispatcher.*merge" }
$job3Merge | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
    if ($_.Context.PostContext) {
        $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
}

# 分析job3的batch分配
Write-Host "`n--- Batch分配 ---" -ForegroundColor Cyan
$job3Batch = $job3Logs | Where-Object { $_.Line -match "batch|Batch|originalJobIds|batchJobInfo" }
$job3Batch | Select-Object -First 20 | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
}

# 分析job3的空容器检测
Write-Host "`n--- 空容器检测 ---" -ForegroundColor Cyan
$job3Empty = $job3Logs | Where-Object { $_.Line -match "Empty container|NO_TEXT_ASSIGNED|emptyJobIds" }
$job3Empty | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
    if ($_.Context.PostContext) {
        $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
}

# 分析job3的ASR结果发送
Write-Host "`n--- ASR结果发送 ---" -ForegroundColor Cyan
$job3Send = $job3Logs | Where-Object { $_.Line -match "sendJobResult|Original job result sent|text_asr.*length" }
$job3Send | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
    if ($_.Context.PostContext) {
        $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
}

Write-Host "`n=== JOB7 处理流程 ===" -ForegroundColor Yellow

# 分析job7的ASR处理
Write-Host "`n--- ASR处理 ---" -ForegroundColor Cyan
$job7ASR = $job7Logs | Where-Object { $_.Line -match "ASR|asr|runAsrStep" }
$job7ASR | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
    if ($_.Context.PostContext) {
        $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
}

# 分析job7的文本合并
Write-Host "`n--- 文本合并 (TextMerge) ---" -ForegroundColor Cyan
$job7Merge = $job7Logs | Where-Object { $_.Line -match "TextMerge|mergeASRText|OriginalJobResultDispatcher.*merge" }
$job7Merge | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
    if ($_.Context.PostContext) {
        $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
}

# 分析job7的batch分配
Write-Host "`n--- Batch分配 ---" -ForegroundColor Cyan
$job7Batch = $job7Logs | Where-Object { $_.Line -match "batch|Batch|originalJobIds|batchJobInfo" }
$job7Batch | Select-Object -First 20 | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
}

# 分析job7的空容器检测
Write-Host "`n--- 空容器检测 ---" -ForegroundColor Cyan
$job7Empty = $job7Logs | Where-Object { $_.Line -match "Empty container|NO_TEXT_ASSIGNED|emptyJobIds" }
$job7Empty | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
    if ($_.Context.PostContext) {
        $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
}

# 分析job7的ASR结果发送
Write-Host "`n--- ASR结果发送 ---" -ForegroundColor Cyan
$job7Send = $job7Logs | Where-Object { $_.Line -match "sendJobResult|Original job result sent|text_asr.*length" }
$job7Send | ForEach-Object {
    Write-Host $_.Line -ForegroundColor White
    if ($_.Context.PostContext) {
        $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
}

# 查找所有batch的ASR结果
Write-Host "`n=== 所有Batch的ASR结果 ===" -ForegroundColor Yellow
$allBatches = Select-String -Path $logPath -Pattern "batchIndex|batch.*ASR|asrText.*length" -Context 2, 2
$allBatches | Select-Object -First 50 | ForEach-Object {
    if ($_.Line -match "job.*[37]|job_id.*[37]") {
        Write-Host $_.Line -ForegroundColor Yellow
        if ($_.Context.PreContext) {
            $_.Context.PreContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
        }
        if ($_.Context.PostContext) {
            $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
        }
    }
}

Write-Host "`nAnalysis completed!" -ForegroundColor Green
