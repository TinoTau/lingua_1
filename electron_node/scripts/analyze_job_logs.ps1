# Job日志分析脚本
# 用于分析特定job在各服务中的处理过程

param(
    [Parameter(Mandatory=$true)]
    [string]$JobId,
    
    [Parameter(Mandatory=$false)]
    [string]$LogDir = "electron_node/electron-node/logs",
    
    [Parameter(Mandatory=$false)]
    [string]$SessionId = ""
)

$ErrorActionPreference = "Continue"

# 日志文件路径
$mainLog = Join-Path $LogDir "electron-main.log"
$asrLog = Join-Path $LogDir "../services/faster_whisper_vad/logs/asr-service.log"
$semanticRepairZhLog = Join-Path $LogDir "../services/semantic_repair_zh/logs/semantic-repair-zh.log"
$semanticRepairEnLog = Join-Path $LogDir "../services/semantic_repair_en/logs/semantic-repair-en.log"
$nmtLog = Join-Path $LogDir "../services/nmt_m2m100/logs/nmt-service.log"

Write-Host "=== Analyzing Job: $JobId ===" -ForegroundColor Green
Write-Host ""

# 搜索关键词（不区分大小写）
$searchPattern = $JobId

if ($SessionId) {
    $searchPattern = "$JobId|$SessionId"
}

# 函数：从日志文件中提取相关行
function Extract-LogLines {
    param(
        [string]$LogFile,
        [string]$Pattern,
        [string]$SectionName,
        [int]$MaxLines = 50
    )
    
    if (-not (Test-Path $LogFile)) {
        Write-Host "  [WARN] Log file not found: $LogFile" -ForegroundColor Yellow
        return
    }
    
    Write-Host "--- $SectionName ---" -ForegroundColor Cyan
    $lines = Select-String -Path $LogFile -Pattern $Pattern -CaseSensitive:$false | Select-Object -First $MaxLines
    
    if ($lines) {
        foreach ($line in $lines) {
            Write-Host $line.Line
        }
    } else {
        Write-Host "  [INFO] No matching lines found" -ForegroundColor Gray
    }
    Write-Host ""
}

# 1. ASR处理
Write-Host "=== 1. ASR Processing ===" -ForegroundColor Yellow
Extract-LogLines -LogFile $mainLog -Pattern "$searchPattern.*ASR|$searchPattern.*asrText|$searchPattern.*addASRSegment|$searchPattern.*finalize" -SectionName "ASR Processing (Main Log)" -MaxLines 30

if (Test-Path $asrLog) {
    Extract-LogLines -LogFile $asrLog -Pattern $searchPattern -SectionName "ASR Service Log" -MaxLines 20
}

# 2. ASR批次聚合
Write-Host "=== 2. ASR Batch Aggregation ===" -ForegroundColor Yellow
Extract-LogLines -LogFile $mainLog -Pattern "$searchPattern.*addASRSegment|$searchPattern.*accumulatedSegments|$searchPattern.*TextMerge|$searchPattern.*finalize" -SectionName "ASR Batch Aggregation" -MaxLines 30

# 3. 聚合阶段
Write-Host "=== 3. Aggregation Stage ===" -ForegroundColor Yellow
Extract-LogLines -LogFile $mainLog -Pattern "$searchPattern.*runAggregationStep|$searchPattern.*AggregationStage|$searchPattern.*aggregatedText|$searchPattern.*processUtterance|$searchPattern.*MERGE|$searchPattern.*NEW_STREAM" -SectionName "Aggregation Processing" -MaxLines 30

# 4. 语义修复
Write-Host "=== 4. Semantic Repair ===" -ForegroundColor Yellow
Extract-LogLines -LogFile $mainLog -Pattern "$searchPattern.*runSemanticRepairStep|$searchPattern.*routeSemanticRepairTask|$searchPattern.*repairedText|$searchPattern.*semanticDecision" -SectionName "Semantic Repair (Main Log)" -MaxLines 30

if (Test-Path $semanticRepairZhLog) {
    Extract-LogLines -LogFile $semanticRepairZhLog -Pattern "$searchPattern.*INPUT|$searchPattern.*OUTPUT" -SectionName "Semantic Repair ZH Service" -MaxLines 20
}

if (Test-Path $semanticRepairEnLog) {
    Extract-LogLines -LogFile $semanticRepairEnLog -Pattern "$searchPattern.*INPUT|$searchPattern.*OUTPUT" -SectionName "Semantic Repair EN Service" -MaxLines 20
}

# 5. 翻译
Write-Host "=== 5. Translation (NMT) ===" -ForegroundColor Yellow
Extract-LogLines -LogFile $mainLog -Pattern "$searchPattern.*NMT|$searchPattern.*translatedText|$searchPattern.*Translation" -SectionName "Translation (Main Log)" -MaxLines 20

if (Test-Path $nmtLog) {
    Extract-LogLines -LogFile $nmtLog -Pattern "$searchPattern.*INPUT|$searchPattern.*OUTPUT" -SectionName "NMT Service" -MaxLines 20
}

# 6. 最终结果
Write-Host "=== 6. Final Result ===" -ForegroundColor Yellow
Extract-LogLines -LogFile $mainLog -Pattern "$searchPattern.*sendJobResult|$searchPattern.*JobResult" -SectionName "Final Result" -MaxLines 20

Write-Host "=== Analysis Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Review the extracted log lines above"
Write-Host "2. Compare ASR input/output with final result"
Write-Host "3. Check for missing segments or batch processing issues"
Write-Host "4. Verify aggregation and semantic repair processing"
