# 分析所有Job的处理流程
# 提取每个Job在ASR、聚合、语义修复、去重、翻译、TTS阶段的输入输出

param(
    [string]$LogPath = "electron_node\electron-node\logs\electron-main.log",
    [string]$SessionId = "s-648A01EE"
)

Write-Host "开始分析所有Job的处理流程..." -ForegroundColor Green

# 读取日志
if (-not (Test-Path $LogPath)) {
    Write-Host "日志文件不存在: $LogPath" -ForegroundColor Red
    exit 1
}

Write-Host "读取日志文件: $LogPath" -ForegroundColor Yellow
$content = Get-Content $LogPath -Encoding UTF8 -Tail 500000

# 提取所有jobId和utteranceIndex
Write-Host "提取所有Job ID和utterance_index..." -ForegroundColor Yellow
$jobIds = @{}
$content | Select-String -Pattern "`"jobId`":\s*`"($SessionId:\d+)`"" | ForEach-Object {
    $match = [regex]::Match($_.Line, "`"jobId`":\s*`"($SessionId:\d+)`"")
    if ($match.Success) {
        $jobId = $match.Groups[1].Value
        if (-not $jobIds.ContainsKey($jobId)) {
            # 提取utteranceIndex
            $utteranceMatch = [regex]::Match($_.Line, "`"utteranceIndex`":\s*(\d+)")
            $utteranceIndex = if ($utteranceMatch.Success) { [int]$utteranceMatch.Groups[1].Value } else { -1 }
            $jobIds[$jobId] = @{
                jobId = $jobId
                utteranceIndex = $utteranceIndex
            }
        }
    }
}

Write-Host "找到 $($jobIds.Count) 个Job" -ForegroundColor Green

# 分析每个Job的处理流程
$results = @()

foreach ($jobEntry in $jobIds.GetEnumerator() | Sort-Object { [int]($_.Value.utteranceIndex) }) {
    $jobId = $jobEntry.Value.jobId
    $utteranceIndex = $jobEntry.Value.utteranceIndex
    
    Write-Host "`n分析 Job: $jobId (utterance_index=$utteranceIndex)" -ForegroundColor Cyan
    
    $jobInfo = @{
        jobId = $jobId
        utteranceIndex = $utteranceIndex
        stages = @{}
    }
    
    # 提取ASR阶段信息
    Write-Host "  提取ASR阶段..." -ForegroundColor Gray
    $asrLines = $content | Select-String -Pattern "`"jobId`":\s*`"$jobId`"" -Context 5 | 
                Select-String -Pattern "(ASR OUTPUT|asrText|segments|OriginalJobResultDispatcher.*Added)" | 
                Select-Object -First 10
    
    if ($asrLines) {
        $asrOutput = ""
        $asrLength = 0
        $segmentCount = 0
        
        foreach ($line in $asrLines) {
            if ($line -match '"asrText":"([^"]+)"') {
                $asrOutput = $matches[1]
            }
            if ($line -match '"asrTextLength":(\d+)') {
                $asrLength = [int]$matches[1]
            }
            if ($line -match '"segmentsCount":(\d+)') {
                $segmentCount = [int]$matches[1]
            }
        }
        
        $jobInfo.stages['ASR'] = @{
            output = $asrOutput
            length = $asrLength
            segmentCount = $segmentCount
        }
    }
    
    # 提取聚合阶段信息
    Write-Host "  提取聚合阶段..." -ForegroundColor Gray
    $aggLines = $content | Select-String -Pattern "`"jobId`":\s*`"$jobId`"" -Context 3 | 
                Select-String -Pattern "(aggregatedText|AggregationStage.*completed)" | 
                Select-Object -First 10
    
    if ($aggLines) {
        $aggOutput = ""
        $aggLength = 0
        
        foreach ($line in $aggLines) {
            if ($line -match '"aggregatedText":"([^"]+)"') {
                $aggOutput = $matches[1]
            }
            if ($line -match '"aggregatedTextLength":(\d+)') {
                $aggLength = [int]$matches[1]
            }
        }
        
        $jobInfo.stages['AGGREGATION'] = @{
            output = $aggOutput
            length = $aggLength
        }
    }
    
    # 提取翻译阶段信息
    Write-Host "  提取翻译阶段..." -ForegroundColor Gray
    $nmtLines = $content | Select-String -Pattern "`"jobId`":\s*`"$jobId`"" -Context 3 | 
                Select-String -Pattern "(textToTranslate|NMT INPUT|NMT OUTPUT|translatedText)" | 
                Select-Object -First 10
    
    if ($nmtLines) {
        $textToTranslate = ""
        $textToTranslateLength = 0
        $contextText = ""
        $contextTextLength = 0
        $translatedOutput = ""
        $translatedLength = 0
        
        foreach ($line in $nmtLines) {
            if ($line -match '"textToTranslate":"([^"]+)"') {
                $textToTranslate = $matches[1]
            }
            if ($line -match '"textToTranslateLength":(\d+)') {
                $textToTranslateLength = [int]$matches[1]
            }
            if ($line -match '"contextText":"([^"]+)"') {
                $contextText = $matches[1]
            }
            if ($line -match '"contextTextLength":(\d+)') {
                $contextTextLength = [int]$matches[1]
            }
            if ($line -match '"translatedText":"([^"]+)"') {
                $translatedOutput = $matches[1]
            }
            if ($line -match '"translatedTextLength":(\d+)') {
                $translatedLength = [int]$matches[1]
            }
        }
        
        $jobInfo.stages['TRANSLATION'] = @{
            input = $textToTranslate
            inputLength = $textToTranslateLength
            contextText = $contextText
            contextTextLength = $contextTextLength
            output = $translatedOutput
            outputLength = $translatedLength
        }
    }
    
    # 提取最终结果
    Write-Host "  提取最终结果..." -ForegroundColor Gray
    $resultLines = $content | Select-String -Pattern "`"jobId`":\s*`"$jobId`"" -Context 3 | 
                   Select-String -Pattern "(Job processing completed|textAsr|textTranslated)" | 
                   Select-Object -First 5
    
    if ($resultLines) {
        $finalAsr = ""
        $finalAsrLength = 0
        $finalTranslated = ""
        $finalTranslatedLength = 0
        
        foreach ($line in $resultLines) {
            if ($line -match '"textAsr":"([^"]+)"') {
                $finalAsr = $matches[1]
            }
            if ($line -match '"textAsrLength":(\d+)') {
                $finalAsrLength = [int]$matches[1]
            }
            if ($line -match '"textTranslated":"([^"]+)"') {
                $finalTranslated = $matches[1]
            }
            if ($line -match '"textTranslatedLength":(\d+)') {
                $finalTranslatedLength = [int]$matches[1]
            }
        }
        
        $jobInfo.stages['FINAL'] = @{
            textAsr = $finalAsr
            textAsrLength = $finalAsrLength
            textTranslated = $finalTranslated
            textTranslatedLength = $finalTranslatedLength
        }
    }
    
    $results += $jobInfo
}

# 生成报告
Write-Host "`n生成报告..." -ForegroundColor Green
$reportPath = "docs\electron_node\ALL_JOBS_PIPELINE_ANALYSIS.md"
$report = @"
# 所有Job处理流程分析

## 分析日期
$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

## 会话ID
$SessionId

---

"@

foreach ($jobInfo in $results | Sort-Object { $_.utteranceIndex }) {
    $report += @"

## Job $($jobInfo.jobId) (utterance_index=$($jobInfo.utteranceIndex))

### ASR阶段
"@
    if ($jobInfo.stages.ContainsKey('ASR')) {
        $asr = $jobInfo.stages['ASR']
        $report += @"
- **输出**: "$($asr.output)"
- **长度**: $($asr.length) 字符
- **片段数**: $($asr.segmentCount)
"@
    } else {
        $report += "- ❌ 未找到ASR输出`n"
    }
    
    $report += @"

### 聚合阶段
"@
    if ($jobInfo.stages.ContainsKey('AGGREGATION')) {
        $agg = $jobInfo.stages['AGGREGATION']
        $report += @"
- **输出**: "$($agg.output)"
- **长度**: $($agg.length) 字符
"@
        
        # 检查是否有变化
        if ($jobInfo.stages.ContainsKey('ASR')) {
            $asrLen = $jobInfo.stages['ASR'].length
            if ($agg.length -ne $asrLen) {
                $report += @"
- ⚠️ **长度变化**: ASR($asrLen) → 聚合($($agg.length))
"@
            }
        }
    } else {
        $report += "- ❌ 未找到聚合输出`n"
    }
    
    $report += @"

### 翻译阶段
"@
    if ($jobInfo.stages.ContainsKey('TRANSLATION')) {
        $trans = $jobInfo.stages['TRANSLATION']
        $report += @"
- **输入**: "$($trans.input)" ($($trans.inputLength) 字符)
- **Context**: "$($trans.contextText.Substring(0, [Math]::Min(50, $trans.contextTextLength)))..." ($($trans.contextTextLength) 字符)
- **输出**: "$($trans.output.Substring(0, [Math]::Min(100, $trans.outputLength)))..." ($($trans.outputLength) 字符)
"@
        
        # 检查输入输出长度比例
        if ($trans.inputLength -gt 0) {
            $ratio = [Math]::Round($trans.outputLength / $trans.inputLength, 2)
            $report += @"
- **长度比例**: $ratio (输出/输入)
"@
            
            # 检查是否使用了context
            if ($trans.contextTextLength -gt $trans.inputLength) {
                $report += @"
- ⚠️ **可能使用了Context**: Context长度($($trans.contextTextLength)) > 输入长度($($trans.inputLength))
"@
            }
        }
    } else {
        $report += "- ❌ 未找到翻译输出`n"
    }
    
    $report += @"

### 最终结果
"@
    if ($jobInfo.stages.ContainsKey('FINAL')) {
        $final = $jobInfo.stages['FINAL']
        $report += @"
- **textAsr**: "$($final.textAsr)" ($($final.textAsrLength) 字符)
- **textTranslated**: "$($final.textTranslated.Substring(0, [Math]::Min(100, $final.textTranslatedLength)))..." ($($final.textTranslatedLength) 字符)
"@
        
        # 检查问题
        $issues = @()
        if ($final.textAsrLength -lt 10 -and $final.textTranslatedLength -gt 100) {
            $issues += "⚠️ 原文太短但译文很长"
        }
        if ($final.textAsrLength -eq 0 -and $final.textTranslatedLength -gt 0) {
            $issues += "⚠️ 原文为空但译文不为空"
        }
        
        if ($issues.Count -gt 0) {
            $report += "`n- **问题**: " + ($issues -join ", ")
        }
    } else {
        $report += "- ❌ 未找到最终结果`n"
    }
    
    $report += "`n---`n"
}

$report | Out-File -FilePath $reportPath -Encoding UTF8
Write-Host "报告已生成: $reportPath" -ForegroundColor Green
