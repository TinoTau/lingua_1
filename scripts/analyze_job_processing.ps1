# 分析特定job的处理流程
# 检查每个服务（ASR、语义修复、NMT、TTS）的输入输出

param(
    [string[]]$UtteranceIndices = @("0", "1", "4", "7", "8", "11"),
    [string]$LogPath = "electron_node\electron-node\logs\electron-main.log"
)

if (-not (Test-Path $LogPath)) {
    Write-Host "错误: 日志文件不存在: $LogPath" -ForegroundColor Red
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Job处理流程分析" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "日志文件: $LogPath" -ForegroundColor Gray
Write-Host "分析Utterance Indices: $($UtteranceIndices -join ', ')" -ForegroundColor Gray
Write-Host ""

foreach ($index in $UtteranceIndices) {
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "Utterance [$index]" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    
    # 查找该utterance的所有相关日志
    $relevantLogs = Get-Content $LogPath | Select-String -Pattern "utterance_index.*$index|utteranceIndex.*$index" -Context 10
    
    if ($relevantLogs) {
        Write-Host "找到 $($relevantLogs.Count) 条相关日志" -ForegroundColor Green
        Write-Host ""
        
        # 提取关键信息
        Write-Host "--- ASR结果 ---" -ForegroundColor Cyan
        $asrLogs = $relevantLogs | Where-Object { $_.Line -match "ASR|asr.*text|routeASRTask" }
        if ($asrLogs) {
            $asrLogs | ForEach-Object { 
                Write-Host $_.Line -ForegroundColor Gray
                if ($_.Context.PreContext) { $_.Context.PreContext | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }
                if ($_.Context.PostContext) { $_.Context.PostContext | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }
            }
        } else {
            Write-Host "  未找到ASR相关日志" -ForegroundColor Yellow
        }
        Write-Host ""
        
        Write-Host "--- 语义修复结果 ---" -ForegroundColor Cyan
        $semanticLogs = $relevantLogs | Where-Object { $_.Line -match "semantic|repair|修复" }
        if ($semanticLogs) {
            $semanticLogs | ForEach-Object { 
                Write-Host $_.Line -ForegroundColor Gray
            }
        } else {
            Write-Host "  未找到语义修复相关日志" -ForegroundColor Yellow
        }
        Write-Host ""
        
        Write-Host "--- NMT结果 ---" -ForegroundColor Cyan
        $nmtLogs = $relevantLogs | Where-Object { $_.Line -match "NMT|nmt|translation|翻译" }
        if ($nmtLogs) {
            $nmtLogs | ForEach-Object { 
                Write-Host $_.Line -ForegroundColor Gray
            }
        } else {
            Write-Host "  未找到NMT相关日志" -ForegroundColor Yellow
        }
        Write-Host ""
        
        Write-Host "--- Job结果发送 ---" -ForegroundColor Cyan
        $resultLogs = $relevantLogs | Where-Object { $_.Line -match "job_result|sendJobResult|text_asr|text_translated" }
        if ($resultLogs) {
            $resultLogs | ForEach-Object { 
                Write-Host $_.Line -ForegroundColor Gray
            }
        } else {
            Write-Host "  未找到结果发送相关日志" -ForegroundColor Yellow
        }
        
    } else {
        Write-Host "未找到utterance [$index] 的相关日志" -ForegroundColor Yellow
    }
    
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "分析完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
