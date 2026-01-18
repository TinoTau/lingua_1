# 分析测试日志，追踪每个job的处理流程

param(
    [string]$LogPath = "electron_node\electron-node\logs\electron-main.log",
    [string[]]$JobIds = @("s-B9BEC010:649", "s-B9BEC010:650", "s-B9BEC010:653", "s-B9BEC010:656", "s-B9BEC010:657", "s-B9BEC010:660")
)

if (-not (Test-Path $LogPath)) {
    Write-Host "错误: 日志文件不存在: $LogPath" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Job处理流程分析" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 读取日志文件，逐行解析JSON
$logs = Get-Content $LogPath -Encoding UTF8 | ForEach-Object {
    try {
        $_ | ConvertFrom-Json -ErrorAction SilentlyContinue
    } catch {
        $null
    }
} | Where-Object { $null -ne $_ }

Write-Host "已加载 $($logs.Count) 条日志记录" -ForegroundColor Green
Write-Host ""

foreach ($jobId in $JobIds) {
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "Job: $jobId" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    
    $jobLogs = $logs | Where-Object { $_.jobId -eq $jobId -or $_.originalJobId -eq $jobId }
    
    if (-not $jobLogs) {
        Write-Host "未找到该job的日志" -ForegroundColor Yellow
        Write-Host ""
        continue
    }
    
    # 提取utterance_index
    $utteranceIndex = ($jobLogs | Where-Object { $_.utteranceIndex } | Select-Object -First 1).utteranceIndex
    Write-Host "Utterance Index: $utteranceIndex" -ForegroundColor Cyan
    Write-Host ""
    
    # 1. ASR结果
    Write-Host "--- ASR结果 ---" -ForegroundColor Green
    $asrLogs = $jobLogs | Where-Object { $_.msg -match "ASR.*completed|asrText" }
    if ($asrLogs) {
        foreach ($log in $asrLogs) {
            if ($log.asrText) {
                Write-Host "  ASR文本: $($log.asrText)" -ForegroundColor White
            }
            if ($log.asrTextLength) {
                Write-Host "  文本长度: $($log.asrTextLength)" -ForegroundColor Gray
            }
            if ($log.segmentCount) {
                Write-Host "  片段数: $($log.segmentCount)" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "  未找到ASR结果" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # 2. 语义修复
    Write-Host "--- 语义修复 ---" -ForegroundColor Green
    $semanticLogs = $jobLogs | Where-Object { $_.msg -match "semantic|Semantic|repair" -or $_.serviceId -match "semantic" }
    if ($semanticLogs) {
        foreach ($log in $semanticLogs) {
            if ($log.stdout -match "INPUT.*text_in=") {
                $match = [regex]::Match($log.stdout, "text_in='([^']+)'")
                if ($match.Success) {
                    Write-Host "  输入: $($match.Groups[1].Value)" -ForegroundColor White
                }
            }
            if ($log.stdout -match "OUTPUT.*text_out=") {
                $match = [regex]::Match($log.stdout, "text_out='([^']+)'")
                if ($match.Success) {
                    Write-Host "  输出: $($match.Groups[1].Value)" -ForegroundColor White
                }
            }
            if ($log.decision) {
                Write-Host "  决策: $($log.decision)" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "  未找到语义修复日志" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # 3. NMT翻译
    Write-Host "--- NMT翻译 ---" -ForegroundColor Green
    $nmtLogs = $jobLogs | Where-Object { $_.msg -match "NMT|translation|Translation" }
    if ($nmtLogs) {
        foreach ($log in $nmtLogs) {
            if ($log.textToTranslate) {
                Write-Host "  输入: $($log.textToTranslate)" -ForegroundColor White
            }
            if ($log.contextText) {
                Write-Host "  Context: $($log.contextText)" -ForegroundColor Gray
            }
            if ($log.translatedText -or $log.nmtResultText) {
                $translated = $log.translatedText ?? $log.nmtResultText
                Write-Host "  输出: $translated" -ForegroundColor White
            }
        }
    } else {
        Write-Host "  未找到NMT日志" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # 4. 最终结果
    Write-Host "--- 最终结果 ---" -ForegroundColor Green
    $resultLogs = $jobLogs | Where-Object { $_.msg -match "Job processing completed|Sending job_result" }
    if ($resultLogs) {
        foreach ($log in $resultLogs) {
            if ($log.textAsr) {
                Write-Host "  最终ASR: $($log.textAsr)" -ForegroundColor White
            }
            if ($log.textTranslated) {
                Write-Host "  最终翻译: $($log.textTranslated.Substring(0, [Math]::Min(100, $log.textTranslated.Length)))..." -ForegroundColor White
            }
        }
    } else {
        Write-Host "  未找到最终结果" -ForegroundColor Yellow
    }
    Write-Host ""
}
