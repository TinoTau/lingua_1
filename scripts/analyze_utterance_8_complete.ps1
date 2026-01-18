# 分析Utterance [8]的完整处理流程

param(
    [string]$NodeLogPath = "electron_node\electron-node\logs\electron-main.log",
    [string]$NmtLogPath = "electron_node\services\nmt_m2m100\logs\nmt-service.log"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Utterance [8] 完整处理流程分析" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 节点端日志 - [8]的完整流程
Write-Host "--- 节点端日志 ---" -ForegroundColor Yellow
if (Test-Path $NodeLogPath) {
    $job657Logs = Get-Content $NodeLogPath -Encoding UTF8 -Tail 5000 | 
        ForEach-Object { 
            try { $_ | ConvertFrom-Json -ErrorAction Stop } catch { $null }
        } | 
        Where-Object { 
            $null -ne $_ -and (
                ($_.jobId -match "s-B9BEC010:657" -or $_.originalJobId -match "s-B9BEC010:657") -and
                ($_.utteranceIndex -eq 8 -or $_.utterance_index -eq 8)
            )
        }
    
    if ($job657Logs) {
        Write-Host "找到 $($job657Logs.Count) 条相关日志" -ForegroundColor Green
        Write-Host ""
        
        # ASR
        Write-Host "### ASR输出" -ForegroundColor Cyan
        $asrLogs = $job657Logs | Where-Object { $_.msg -match "ASR.*completed|asrText" }
        $asrLogs | ForEach-Object {
            if ($_.asrText) {
                Write-Host "  Batch $($_.segmentIndex): $($_.asrText)" -ForegroundColor White
            }
        }
        Write-Host ""
        
        # 语义修复
        Write-Host "### 语义修复" -ForegroundColor Cyan
        $repairLogs = $job657Logs | Where-Object { $_.msg -match "Semantic repair.*completed|decision" }
        $repairLogs | ForEach-Object {
            if ($_.originalText) {
                Write-Host "  输入: $($_.originalText.Substring(0, [Math]::Min(80, $_.originalText.Length)))..." -ForegroundColor White
            }
            if ($_.repairedText) {
                Write-Host "  输出: $($_.repairedText.Substring(0, [Math]::Min(80, $_.repairedText.Length)))..." -ForegroundColor White
            }
            if ($_.decision) {
                Write-Host "  决策: $($_.decision)" -ForegroundColor Gray
            }
        }
        
        # Context更新
        Write-Host "### Context更新" -ForegroundColor Cyan
        $contextLogs = $job657Logs | Where-Object { $_.msg -match "Updated recentCommittedText" }
        if ($contextLogs) {
            Write-Host "  找到Context更新日志" -ForegroundColor Green
        } else {
            Write-Host "  未找到Context更新日志（可能是修复前的测试）" -ForegroundColor Yellow
        }
        Write-Host ""
        
        # NMT
        Write-Host "### NMT翻译" -ForegroundColor Cyan
        $nmtLogs = $job657Logs | Where-Object { $_.msg -match "NMT INPUT|NMT OUTPUT|Translation.*completed" }
        $nmtLogs | ForEach-Object {
            if ($_.textToTranslate) {
                Write-Host "  输入: $($_.textToTranslate.Substring(0, [Math]::Min(60, $_.textToTranslate.Length)))..." -ForegroundColor White
            }
            if ($_.contextText) {
                Write-Host "  Context: $($_.contextText.Substring(0, [Math]::Min(60, $_.contextText.Length)))..." -ForegroundColor Gray
            }
            if ($_.translatedText -or $_.nmtResultText) {
                $text = $_.translatedText ?? $_.nmtResultText
                Write-Host "  输出: $($text.Substring(0, [Math]::Min(100, $text.Length)))..." -ForegroundColor White
            }
        }
        Write-Host ""
    } else {
        Write-Host "未找到[8]的相关日志" -ForegroundColor Yellow
    }
} else {
    Write-Host "节点端日志不存在" -ForegroundColor Red
}

# 2. NMT服务日志 - [8]的翻译记录
Write-Host "--- NMT服务日志 ---" -ForegroundColor Yellow
if (Test-Path $NmtLogPath) {
    Write-Host "查找[8]的NMT翻译记录（时间约20:06:07）..." -ForegroundColor Gray
    $nmtLogs = Get-Content $NmtLogPath -Encoding UTF8 | Select-String -Pattern "20:06:07|这场剧|This series" -Context 15
    if ($nmtLogs) {
        Write-Host "找到NMT翻译记录" -ForegroundColor Green
        $nmtLogs | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "未找到[8]的NMT翻译记录" -ForegroundColor Yellow
        Write-Host "  尝试查找所有20:06的翻译记录..." -ForegroundColor Gray
        $allLogs = Get-Content $NmtLogPath -Encoding UTF8 | Select-String -Pattern "20:06" -Context 5
        if ($allLogs) {
            $allLogs | Select-Object -Last 30 | ForEach-Object { Write-Host $_ }
        }
    }
    Write-Host ""
} else {
    Write-Host "NMT服务日志不存在" -ForegroundColor Red
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "分析完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
