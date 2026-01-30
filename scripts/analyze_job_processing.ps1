# 分析每个 Job 在各服务中的处理过程
# 用于诊断前半句丢失问题

param(
    [string]$SessionId = "",
    [int[]]$UtteranceIndices = @(0, 2, 5, 7, 9),
    [string]$NodeLogPath = "electron_node\electron-node\logs\electron-main.log",
    [int]$Lines = 5000
)

$ErrorActionPreference = "Continue"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Job 处理过程分析" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir

$nodeLog = Join-Path $projectRoot $NodeLogPath
if (-not (Test-Path $nodeLog)) {
    Write-Host "节点端日志文件不存在: $nodeLog" -ForegroundColor Red
    exit 1
}

$nodeContent = Get-Content $nodeLog -Tail $Lines

foreach ($utteranceIndex in $UtteranceIndices) {
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "UtteranceIndex: $utteranceIndex" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    
    # 提取该 utteranceIndex 的所有日志
    $relevantLogs = $nodeContent | Select-String -Pattern "utteranceIndex.*$utteranceIndex" | Select-Object -Last 50
    
    if (-not $relevantLogs) {
        Write-Host "未找到 utteranceIndex $utteranceIndex 的日志" -ForegroundColor Red
        Write-Host ""
        continue
    }
    
    # 1. AudioAggregator 处理
    Write-Host "[1. AudioAggregator 处理]" -ForegroundColor Green
    $audioAggregatorLogs = $relevantLogs | Select-String -Pattern "AudioAggregator|Buffer not found|hasMergedPendingAudio|inputAudioDurationMs|segmentCount"
    if ($audioAggregatorLogs) {
        $audioAggregatorLogs | ForEach-Object {
            $logLine = $_.Line
            # 提取关键信息
            if ($logLine -match '"inputAudioDurationMs":(\d+)') {
                Write-Host "  输入音频时长: $($matches[1])ms" -ForegroundColor White
            }
            if ($logLine -match '"outputSegmentCount":(\d+)') {
                Write-Host "  输出段数: $($matches[1])" -ForegroundColor White
            }
            if ($logLine -match '"hasMergedPendingAudio":(true|false)') {
                Write-Host "  是否合并pending音频: $($matches[1])" -ForegroundColor $(if ($matches[1] -eq "true") { "Green" } else { "Yellow" })
            }
            if ($logLine -match "Buffer not found") {
                Write-Host "  ⚠️ Buffer not found, creating new buffer" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "  未找到 AudioAggregator 处理日志" -ForegroundColor Red
    }
    Write-Host ""
    
    # 2. 音频质量检查
    Write-Host "[2. 音频质量检查]" -ForegroundColor Green
    $qualityLogs = $relevantLogs | Select-String -Pattern "Audio input quality|Audio quality too low|rms.*below|minRmsThreshold"
    if ($qualityLogs) {
        $qualityLogs | ForEach-Object {
            $logLine = $_.Line
            if ($logLine -match '"rms":"([\d.]+)"') {
                Write-Host "  RMS值: $($matches[1])" -ForegroundColor White
            }
            if ($logLine -match '"minRmsThreshold":([\d.]+)') {
                Write-Host "  阈值: $($matches[1])" -ForegroundColor White
            }
            if ($logLine -match "Audio quality too low") {
                Write-Host "  ❌ 音频质量太低，被拒绝" -ForegroundColor Red
            } else {
                Write-Host "  ✅ 音频质量检查通过" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "  未找到音频质量检查日志" -ForegroundColor Gray
    }
    Write-Host ""
    
    # 3. ASR 服务处理
    Write-Host "[3. ASR 服务处理]" -ForegroundColor Green
    $asrInputLogs = $relevantLogs | Select-String -Pattern "ASR INPUT|Calling ASR service"
    $asrOutputLogs = $relevantLogs | Select-String -Pattern "ASR OUTPUT|ASR service returned|asrText"
    
    if ($asrInputLogs) {
        $asrInputLogs | ForEach-Object {
            $logLine = $_.Line
            if ($logLine -match '"audioSizeBytes":(\d+)') {
                Write-Host "  输入音频大小: $($matches[1]) bytes" -ForegroundColor White
            }
            if ($logLine -match '"audioDurationMs":(\d+)') {
                Write-Host "  输入音频时长: $($matches[1])ms" -ForegroundColor White
            }
        }
    }
    
    if ($asrOutputLogs) {
        $asrOutputLogs | ForEach-Object {
            $logLine = $_.Line
            if ($logLine -match '"asrText":"([^"]+)"') {
                $asrText = $matches[1]
                Write-Host "  ASR输出: $asrText" -ForegroundColor White
            }
            if ($logLine -match '"asrTextLength":(\d+)') {
                Write-Host "  ASR输出长度: $($matches[1]) 字符" -ForegroundColor White
            }
            if ($logLine -match '"segmentsCount":(\d+)') {
                Write-Host "  段数: $($matches[1])" -ForegroundColor White
            }
        }
    } else {
        Write-Host "  ❌ 未找到 ASR 输出日志（可能被拒绝或失败）" -ForegroundColor Red
    }
    Write-Host ""
    
    # 4. Aggregation 处理
    Write-Host "[4. Aggregation 处理]" -ForegroundColor Green
    $aggLogs = $relevantLogs | Select-String -Pattern "AggregationStage|aggregatedText|action.*NEW_STREAM|action.*MERGE"
    if ($aggLogs) {
        $aggLogs | ForEach-Object {
            $logLine = $_.Line
            if ($logLine -match '"action":"([^"]+)"') {
                Write-Host "  动作: $($matches[1])" -ForegroundColor White
            }
            if ($logLine -match '"aggregatedText":"([^"]+)"') {
                $aggText = $matches[1]
                if ($aggText.Length -gt 50) {
                    $aggText = $aggText.Substring(0, 50) + "..."
                }
                Write-Host "  聚合后文本: $aggText" -ForegroundColor White
            }
        }
    } else {
        Write-Host "  未找到 Aggregation 处理日志" -ForegroundColor Gray
    }
    Write-Host ""
    
    # 5. NMT 服务处理
    Write-Host "[5. NMT 服务处理]" -ForegroundColor Green
    $nmtInputLogs = $relevantLogs | Select-String -Pattern "NMT INPUT"
    $nmtOutputLogs = $relevantLogs | Select-String -Pattern "NMT OUTPUT|translatedText"
    
    if ($nmtInputLogs) {
        $nmtInputLogs | ForEach-Object {
            $logLine = $_.Line
            if ($logLine -match '"text":"([^"]+)"') {
                $nmtInput = $matches[1]
                if ($nmtInput.Length -gt 50) {
                    $nmtInput = $nmtInput.Substring(0, 50) + "..."
                }
                Write-Host "  输入文本: $nmtInput" -ForegroundColor White
            }
        }
    }
    
    if ($nmtOutputLogs) {
        $nmtOutputLogs | ForEach-Object {
            $logLine = $_.Line
            if ($logLine -match '"translatedText":"([^"]+)"') {
                $nmtOutput = $matches[1]
                if ($nmtOutput.Length -gt 80) {
                    $nmtOutput = $nmtOutput.Substring(0, 80) + "..."
                }
                Write-Host "  翻译输出: $nmtOutput" -ForegroundColor White
            }
        }
    } else {
        Write-Host "  ❌ 未找到 NMT 输出日志" -ForegroundColor Red
    }
    Write-Host ""
    
    # 6. 最终结果
    Write-Host "[6. 最终结果]" -ForegroundColor Green
    $resultLogs = $relevantLogs | Select-String -Pattern "Job processing completed|Sending job_result|textAsr.*textTranslated"
    if ($resultLogs) {
        $resultLogs | ForEach-Object {
            $logLine = $_.Line
            if ($logLine -match '"textAsr":"([^"]+)"') {
                $finalAsr = $matches[1]
                Write-Host "  最终ASR: $finalAsr" -ForegroundColor White
            }
            if ($logLine -match '"textTranslated":"([^"]+)"') {
                $finalTrans = $matches[1]
                if ($finalTrans.Length -gt 80) {
                    $finalTrans = $finalTrans.Substring(0, 80) + "..."
                }
                Write-Host "  最终翻译: $finalTrans" -ForegroundColor White
            }
        }
    }
    Write-Host ""
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "分析完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
