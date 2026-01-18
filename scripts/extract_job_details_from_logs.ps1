# 从JSON日志中提取job的详细信息

param(
    [string]$LogPath = "electron_node\electron-node\logs\electron-main.log",
    [string[]]$JobIds = @("s-B9BEC010:649", "s-B9BEC010:650", "s-B9BEC010:653", "s-B9BEC010:656", "s-B9BEC010:657", "s-B9BEC010:660"),
    [int[]]$UtteranceIndices = @(0, 1, 4, 7, 8, 11)
)

if (-not (Test-Path $LogPath)) {
    Write-Host "错误: 日志文件不存在: $LogPath" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Job详细日志提取" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 读取日志，逐行处理JSON
$allLogs = @()
$lineNum = 0

Get-Content $LogPath -Encoding UTF8 | ForEach-Object {
    $lineNum++
    $line = $_.Trim()
    if ($line -match '^\{.*\}$') {
        try {
            $log = $line | ConvertFrom-Json -ErrorAction Stop
            $log | Add-Member -NotePropertyName 'lineNumber' -NotePropertyValue $lineNum -Force
            $allLogs += $log
        } catch {
            # 忽略JSON解析错误
        }
    }
}

Write-Host "已加载 $($allLogs.Count) 条有效日志记录" -ForegroundColor Green
Write-Host ""

# 按utterance_index分组分析
foreach ($idx in $UtteranceIndices) {
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "Utterance [$idx]" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    
    $relevantLogs = $allLogs | Where-Object { 
        ($_.utteranceIndex -eq $idx -or $_.utterance_index -eq $idx) -and
        ($_.jobId -match "s-B9BEC010" -or $_.originalJobId -match "s-B9BEC010")
    }
    
    if (-not $relevantLogs) {
        Write-Host "未找到相关日志" -ForegroundColor Yellow
        Write-Host ""
        continue
    }
    
    # 找到对应的jobId
    $jobId = ($relevantLogs | Where-Object { $_.jobId } | Select-Object -First 1).jobId
    if (-not $jobId) {
        $jobId = ($relevantLogs | Where-Object { $_.originalJobId } | Select-Object -First 1).originalJobId
    }
    
    Write-Host "Job ID: $jobId" -ForegroundColor Cyan
    Write-Host ""
    
    # 1. ASR原始输出
    Write-Host "--- ASR原始输出 ---" -ForegroundColor Green
    $asrLogs = $relevantLogs | Where-Object { 
        $_.msg -match "ASR.*completed|asrText" -or 
        $_.asrText -or 
        ($_.stdout -match "ASR|asr")
    }
    
    if ($asrLogs) {
        foreach ($log in $asrLogs | Select-Object -First 5) {
            if ($log.asrText) {
                Write-Host "  ASR文本: $($log.asrText)" -ForegroundColor White
            }
            if ($log.asrTextLength) {
                Write-Host "  长度: $($log.asrTextLength) 字符" -ForegroundColor Gray
            }
            if ($log.stdout -match "text.*=") {
                $match = [regex]::Match($log.stdout, "text[=:]'?([^'\n]+)")
                if ($match.Success) {
                    Write-Host "  提取文本: $($match.Groups[1].Value.Substring(0, [Math]::Min(100, $match.Groups[1].Value.Length)))..." -ForegroundColor White
                }
            }
        }
    } else {
        Write-Host "  未找到ASR输出" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # 2. 语义修复
    Write-Host "--- 语义修复 ---" -ForegroundColor Green
    $semanticLogs = $relevantLogs | Where-Object { 
        $_.serviceId -match "semantic" -or 
        $_.msg -match "semantic|repair" -or
        ($_.stdout -match "SEMANTIC_REPAIR")
    }
    
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
    
    # 3. NMT输入输出
    Write-Host "--- NMT翻译 ---" -ForegroundColor Green
    $nmtInputLogs = $relevantLogs | Where-Object { $_.msg -match "NMT INPUT" }
    $nmtOutputLogs = $relevantLogs | Where-Object { $_.msg -match "NMT OUTPUT" }
    
    if ($nmtInputLogs) {
        $inputLog = $nmtInputLogs | Select-Object -First 1
        Write-Host "  输入文本: $($inputLog.text)" -ForegroundColor White
        if ($inputLog.contextText) {
            Write-Host "  Context: $($inputLog.contextText)" -ForegroundColor Gray
        }
    }
    
    if ($nmtOutputLogs) {
        $outputLog = $nmtOutputLogs | Select-Object -First 1
        if ($outputLog.translatedText) {
            $text = $outputLog.translatedText
            Write-Host "  输出: $($text.Substring(0, [Math]::Min(200, $text.Length)))..." -ForegroundColor White
            Write-Host "  长度: $($outputLog.translatedTextLength) 字符" -ForegroundColor Gray
        }
    }
    
    if (-not $nmtInputLogs -and -not $nmtOutputLogs) {
        Write-Host "  未找到NMT日志" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # 4. 最终发送的结果
    Write-Host "--- 最终结果 ---" -ForegroundColor Green
    $resultLogs = $relevantLogs | Where-Object { 
        $_.msg -match "Job processing completed|Sending job_result" 
    }
    
    if ($resultLogs) {
        $resultLog = $resultLogs | Select-Object -First 1
        if ($resultLog.textAsr) {
            Write-Host "  最终ASR: $($resultLog.textAsr)" -ForegroundColor White
        }
        if ($resultLog.textTranslated) {
            $text = $resultLog.textTranslated
            Write-Host "  最终翻译: $($text.Substring(0, [Math]::Min(150, $text.Length)))..." -ForegroundColor White
        }
    } else {
        Write-Host "  未找到最终结果" -ForegroundColor Yellow
    }
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "分析完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
