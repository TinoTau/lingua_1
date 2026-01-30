# 会话日志分析脚本
# 用于分析整个会话中所有job的处理过程

param(
    [Parameter(Mandatory=$true)]
    [string]$SessionId,
    
    [Parameter(Mandatory=$false)]
    [string]$LogDir = "electron_node/electron-node/logs"
)

$ErrorActionPreference = "Continue"

# 日志文件路径
$mainLog = Join-Path $LogDir "electron-main.log"

Write-Host "=== Analyzing Session: $SessionId ===" -ForegroundColor Green
Write-Host ""

# 搜索关键词
$searchPattern = $SessionId

# 提取所有job ID
Write-Host "=== Extracting Job IDs ===" -ForegroundColor Yellow
$jobIds = Select-String -Path $mainLog -Pattern "$searchPattern.*job_id|$searchPattern.*jobId" -CaseSensitive:$false | 
    ForEach-Object { 
        if ($_.Line -match "job_id['\""]?\s*[:=]\s*['\""]?([^'\""\s]+)['\""]?") {
            $matches[1]
        } elseif ($_.Line -match "jobId['\""]?\s*[:=]\s*['\""]?([^'\""\s]+)['\""]?") {
            $matches[1]
        }
    } | Sort-Object -Unique

if ($jobIds) {
    Write-Host "Found Job IDs:" -ForegroundColor Cyan
    foreach ($jobId in $jobIds) {
        Write-Host "  - $jobId"
    }
    Write-Host ""
    
    # 分析每个job
    foreach ($jobId in $jobIds) {
        Write-Host "=== Analyzing Job: $jobId ===" -ForegroundColor Yellow
        
        # ASR结果
        $asrResults = Select-String -Path $mainLog -Pattern "$searchPattern.*$jobId.*asrText|$searchPattern.*$jobId.*text_asr" -CaseSensitive:$false | Select-Object -First 5
        if ($asrResults) {
            Write-Host "ASR Results:" -ForegroundColor Cyan
            foreach ($result in $asrResults) {
                if ($result.Line -match "asrText['\""]?\s*[:=]\s*['\""]?([^'\""]+)['\""]?|text_asr['\""]?\s*[:=]\s*['\""]?([^'\""]+)['\""]?") {
                    $text = if ($matches[1]) { $matches[1] } else { $matches[2] }
                    Write-Host "  $text" -ForegroundColor White
                }
            }
        }
        
        # 聚合结果
        $aggResults = Select-String -Path $mainLog -Pattern "$searchPattern.*$jobId.*aggregatedText" -CaseSensitive:$false | Select-Object -First 5
        if ($aggResults) {
            Write-Host "Aggregated Results:" -ForegroundColor Cyan
            foreach ($result in $aggResults) {
                if ($result.Line -match "aggregatedText['\""]?\s*[:=]\s*['\""]?([^'\""]+)['\""]?") {
                    Write-Host "  $($matches[1])" -ForegroundColor White
                }
            }
        }
        
        # 语义修复结果
        $repairResults = Select-String -Path $mainLog -Pattern "$searchPattern.*$jobId.*repairedText" -CaseSensitive:$false | Select-Object -First 5
        if ($repairResults) {
            Write-Host "Repaired Results:" -ForegroundColor Cyan
            foreach ($result in $repairResults) {
                if ($result.Line -match "repairedText['\""]?\s*[:=]\s*['\""]?([^'\""]+)['\""]?") {
                    Write-Host "  $($matches[1])" -ForegroundColor White
                }
            }
        }
        
        # 最终结果
        $finalResults = Select-String -Path $mainLog -Pattern "$searchPattern.*$jobId.*sendJobResult" -CaseSensitive:$false | Select-Object -First 3
        if ($finalResults) {
            Write-Host "Final Results:" -ForegroundColor Cyan
            foreach ($result in $finalResults) {
                Write-Host "  $($result.Line)" -ForegroundColor White
            }
        }
        
        Write-Host ""
    }
} else {
    Write-Host "[WARN] No job IDs found for session: $SessionId" -ForegroundColor Yellow
}

Write-Host "=== Analysis Complete ===" -ForegroundColor Green
