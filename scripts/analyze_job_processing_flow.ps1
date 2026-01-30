# 分析节点端job处理流程脚本
# 用于检查每个job在各服务里的处理过程，输入是什么输出是什么

param(
    [string]$SessionId = "",
    [string]$JobId = "",
    [int]$LastLines = 1000
)

$ErrorActionPreference = "Continue"

# 日志文件路径
$mainLogPath = "electron_node\electron-node\logs\electron-main.log"
$asrLogPath = "electron_node\services\node-inference\logs\node-inference.log"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "节点端Job处理流程分析工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查日志文件是否存在
if (-not (Test-Path $mainLogPath)) {
    Write-Host "错误: 主日志文件不存在: $mainLogPath" -ForegroundColor Red
    exit 1
}

Write-Host "正在分析日志文件..." -ForegroundColor Yellow
Write-Host "主进程日志: $mainLogPath" -ForegroundColor Gray
if (Test-Path $asrLogPath) {
    Write-Host "ASR服务日志: $asrLogPath" -ForegroundColor Gray
}
Write-Host ""

# 读取日志（如果是JSON格式，需要解析）
$mainLogContent = Get-Content $mainLogPath -Tail $LastLines -Encoding UTF8

# 如果提供了SessionId或JobId，过滤相关日志
if ($SessionId -or $JobId) {
    Write-Host "过滤条件:" -ForegroundColor Yellow
    if ($SessionId) {
        Write-Host "  SessionId: $SessionId" -ForegroundColor Gray
    }
    if ($JobId) {
        Write-Host "  JobId: $JobId" -ForegroundColor Gray
    }
    Write-Host ""
}

# 分析函数：提取job处理流程
function Analyze-JobFlow {
    param([string[]]$LogLines, [string]$FilterSessionId, [string]$FilterJobId)
    
    $jobs = @{}
    $currentJob = $null
    
    foreach ($line in $LogLines) {
        # 尝试解析JSON日志
        $jsonObj = $null
        try {
            $jsonObj = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
        } catch {
            # 不是JSON格式，跳过
        }
        
        if ($jsonObj) {
            $msg = $jsonObj.msg
            $level = $jsonObj.level
            $jobId = $jsonObj.jobId
            $sessionId = $jsonObj.sessionId
            $utteranceIndex = $jsonObj.utteranceIndex
            
            # 过滤条件
            if ($FilterSessionId -and $sessionId -ne $FilterSessionId) { continue }
            if ($FilterJobId -and $jobId -ne $FilterJobId) { continue }
            
            # 初始化job记录
            if ($jobId -and -not $jobs.ContainsKey($jobId)) {
                $jobs[$jobId] = @{
                    JobId = $jobId
                    SessionId = $sessionId
                    UtteranceIndex = $utteranceIndex
                    Steps = @()
                }
            }
            
            $job = $jobs[$jobId]
            if (-not $job) { continue }
            
            # 识别关键处理步骤
            $step = $null
            
            # ASR处理
            if ($msg -match "ASR.*completed|ASR.*result|runASRStep") {
                $step = @{
                    Stage = "ASR"
                    Message = $msg
                    Text = $jsonObj.text_asr
                    Level = $level
                    Time = $jsonObj.time
                }
            }
            # 聚合处理
            elseif ($msg -match "AggregationStage|runAggregationStep|aggregation") {
                $step = @{
                    Stage = "Aggregation"
                    Message = $msg
                    OriginalText = $jsonObj.originalText
                    AggregatedText = $jsonObj.aggregatedText
                    Action = $jsonObj.action
                    Level = $level
                    Time = $jsonObj.time
                }
            }
            # AggregatorState处理
            elseif ($msg -match "AggregatorState|processUtterance") {
                $step = @{
                    Stage = "AggregatorState"
                    Message = $msg
                    Text = $jsonObj.text
                    Action = $jsonObj.action
                    ShouldCommit = $jsonObj.shouldCommit
                    Level = $level
                    Time = $jsonObj.time
                }
            }
            # 去重处理
            elseif ($msg -match "DeduplicationHandler|Duplicate|dedup") {
                $step = @{
                    Stage = "Deduplication"
                    Message = $msg
                    IsDuplicate = $jsonObj.isDuplicate
                    Reason = $jsonObj.reason
                    Level = $level
                    Time = $jsonObj.time
                }
            }
            # 向前合并处理
            elseif ($msg -match "TextForwardMergeManager|forward.*merge") {
                $step = @{
                    Stage = "ForwardMerge"
                    Message = $msg
                    ProcessedText = $jsonObj.processedText
                    ShouldDiscard = $jsonObj.shouldDiscard
                    ShouldWaitForMerge = $jsonObj.shouldWaitForMerge
                    Level = $level
                    Time = $jsonObj.time
                }
            }
            # 语义修复处理
            elseif ($msg -match "semantic.*repair|SemanticRepair|runSemanticRepairStep") {
                $step = @{
                    Stage = "SemanticRepair"
                    Message = $msg
                    OriginalText = $jsonObj.originalText
                    RepairedText = $jsonObj.repairedText
                    Decision = $jsonObj.decision
                    Confidence = $jsonObj.confidence
                    Level = $level
                    Time = $jsonObj.time
                }
            }
            # 翻译处理
            elseif ($msg -match "Translation|NMT|runTranslationStep") {
                $step = @{
                    Stage = "Translation"
                    Message = $msg
                    TextIn = $jsonObj.text_in
                    TextOut = $jsonObj.text_out
                    Level = $level
                    Time = $jsonObj.time
                }
            }
            # TTS处理
            elseif ($msg -match "TTS|runTTSStep") {
                $step = @{
                    Stage = "TTS"
                    Message = $msg
                    Text = $jsonObj.text
                    Level = $level
                    Time = $jsonObj.time
                }
            }
            
            if ($step) {
                $job.Steps += $step
            }
        } else {
            # 处理非JSON格式的日志（可能是Python服务的日志）
            if ($line -match "SEMANTIC_REPAIR.*INPUT|SEMANTIC_REPAIR.*OUTPUT") {
                # 提取job_id
                if ($line -match "job_id=([^\s\|]+)") {
                    $extractedJobId = $matches[1]
                    if (-not $jobs.ContainsKey($extractedJobId)) {
                        $jobs[$extractedJobId] = @{
                            JobId = $extractedJobId
                            Steps = @()
                        }
                    }
                    $job = $jobs[$extractedJobId]
                    
                    if ($line -match "INPUT") {
                        $step = @{
                            Stage = "SemanticRepair_Input"
                            Message = $line
                            TextIn = if ($line -match "text_in=([^\|]+)") { $matches[1] } else { "" }
                        }
                    } elseif ($line -match "OUTPUT") {
                        $step = @{
                            Stage = "SemanticRepair_Output"
                            Message = $line
                            TextOut = if ($line -match "text_out=([^\|]+)") { $matches[1] } else { "" }
                            Decision = if ($line -match "decision=([^\s\|]+)") { $matches[1] } else { "" }
                        }
                    }
                    
                    if ($step) {
                        $job.Steps += $step
                    }
                }
            }
        }
    }
    
    return $jobs
}

# 分析日志
Write-Host "正在分析job处理流程..." -ForegroundColor Yellow
$jobs = Analyze-JobFlow -LogLines $mainLogContent -FilterSessionId $SessionId -FilterJobId $JobId

if ($jobs.Count -eq 0) {
    Write-Host "未找到匹配的job记录" -ForegroundColor Red
    Write-Host ""
    Write-Host "提示: 尝试使用以下参数之一:" -ForegroundColor Yellow
    Write-Host "  -SessionId <session_id>" -ForegroundColor Gray
    Write-Host "  -JobId <job_id>" -ForegroundColor Gray
    Write-Host "  -LastLines <number>  (默认: 1000)" -ForegroundColor Gray
    exit 0
}

Write-Host "找到 $($jobs.Count) 个job记录" -ForegroundColor Green
Write-Host ""

# 输出每个job的处理流程
foreach ($jobId in $jobs.Keys | Sort-Object) {
    $job = $jobs[$jobId]
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Job ID: $jobId" -ForegroundColor Cyan
    if ($job.SessionId) {
        Write-Host "Session ID: $($job.SessionId)" -ForegroundColor Gray
    }
    if ($job.UtteranceIndex -ne $null) {
        Write-Host "Utterance Index: $($job.UtteranceIndex)" -ForegroundColor Gray
    }
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    # 按阶段分组
    $stages = $job.Steps | Group-Object -Property Stage
    
    foreach ($stageGroup in $stages) {
        $stageName = $stageGroup.Name
        $stageSteps = $stageGroup.Group
        
        Write-Host "--- $stageName ---" -ForegroundColor Yellow
        
        foreach ($step in $stageSteps) {
            Write-Host "  时间: $($step.Time)" -ForegroundColor Gray
            Write-Host "  消息: $($step.Message)" -ForegroundColor Gray
            
            # 根据阶段显示不同的信息
            switch ($stageName) {
                "ASR" {
                    if ($step.Text) {
                        Write-Host "  ASR输出: $($step.Text)" -ForegroundColor Green
                    }
                }
                "Aggregation" {
                    if ($step.OriginalText) {
                        Write-Host "  原始文本: $($step.OriginalText)" -ForegroundColor White
                    }
                    if ($step.AggregatedText) {
                        Write-Host "  聚合文本: $($step.AggregatedText)" -ForegroundColor Green
                    }
                    if ($step.Action) {
                        Write-Host "  动作: $($step.Action)" -ForegroundColor Cyan
                    }
                }
                "AggregatorState" {
                    if ($step.Text) {
                        Write-Host "  文本: $($step.Text)" -ForegroundColor Green
                    }
                    if ($step.Action) {
                        Write-Host "  动作: $($step.Action)" -ForegroundColor Cyan
                    }
                    if ($step.ShouldCommit -ne $null) {
                        Write-Host "  是否提交: $($step.ShouldCommit)" -ForegroundColor Cyan
                    }
                }
                "Deduplication" {
                    if ($step.IsDuplicate) {
                        Write-Host "  是否重复: $($step.IsDuplicate)" -ForegroundColor Red
                        Write-Host "  原因: $($step.Reason)" -ForegroundColor Red
                    }
                }
                "ForwardMerge" {
                    if ($step.ProcessedText) {
                        Write-Host "  处理后文本: $($step.ProcessedText)" -ForegroundColor Green
                    }
                    if ($step.ShouldDiscard) {
                        Write-Host "  是否丢弃: $($step.ShouldDiscard)" -ForegroundColor Red
                    }
                    if ($step.ShouldWaitForMerge) {
                        Write-Host "  是否等待合并: $($step.ShouldWaitForMerge)" -ForegroundColor Yellow
                    }
                }
                "SemanticRepair" {
                    if ($step.OriginalText) {
                        Write-Host "  原始文本: $($step.OriginalText)" -ForegroundColor White
                    }
                    if ($step.RepairedText) {
                        Write-Host "  修复后文本: $($step.RepairedText)" -ForegroundColor Green
                    }
                    if ($step.Decision) {
                        Write-Host "  决策: $($step.Decision)" -ForegroundColor Cyan
                    }
                    if ($step.Confidence) {
                        Write-Host "  置信度: $($step.Confidence)" -ForegroundColor Cyan
                    }
                }
                "SemanticRepair_Input" {
                    if ($step.TextIn) {
                        Write-Host "  输入文本: $($step.TextIn)" -ForegroundColor White
                    }
                }
                "SemanticRepair_Output" {
                    if ($step.TextOut) {
                        Write-Host "  输出文本: $($step.TextOut)" -ForegroundColor Green
                    }
                    if ($step.Decision) {
                        Write-Host "  决策: $($step.Decision)" -ForegroundColor Cyan
                    }
                }
                "Translation" {
                    if ($step.TextIn) {
                        Write-Host "  输入文本: $($step.TextIn)" -ForegroundColor White
                    }
                    if ($step.TextOut) {
                        Write-Host "  输出文本: $($step.TextOut)" -ForegroundColor Green
                    }
                }
                "TTS" {
                    if ($step.Text) {
                        Write-Host "  文本: $($step.Text)" -ForegroundColor White
                    }
                }
            }
            
            Write-Host ""
        }
    }
    
    Write-Host ""
}

Write-Host "分析完成！" -ForegroundColor Green
