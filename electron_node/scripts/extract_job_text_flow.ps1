# 提取Job文本流转脚本
# 用于提取特定job在各阶段的文本内容

param(
    [Parameter(Mandatory=$true)]
    [string]$JobId,
    
    [Parameter(Mandatory=$false)]
    [string]$LogDir = "electron_node/electron-node/logs"
)

$ErrorActionPreference = "Continue"

$mainLog = Join-Path $LogDir "electron-main.log"

if (-not (Test-Path $mainLog)) {
    Write-Host "[ERROR] Log file not found: $mainLog" -ForegroundColor Red
    exit 1
}

Write-Host "=== Extracting Text Flow for Job: $JobId ===" -ForegroundColor Green
Write-Host ""

# 提取ASR文本
Write-Host "--- ASR Text (asrText/text_asr) ---" -ForegroundColor Cyan
$asrTexts = Select-String -Path $mainLog -Pattern "$JobId.*asrText|$JobId.*text_asr" -CaseSensitive:$false | 
    ForEach-Object {
        if ($_.Line -match "asrText['\""]?\s*[:=]\s*['\""]?([^'\""]+)['\""]?|text_asr['\""]?\s*[:=]\s*['\""]?([^'\""]+)['\""]?") {
            $text = if ($matches[1]) { $matches[1] } else { $matches[2] }
            [PSCustomObject]@{
                Time = $_.Line -replace '.*"time":(\d+).*', '$1'
                Text = $text
                FullLine = $_.Line
            }
        }
    }

if ($asrTexts) {
    foreach ($item in $asrTexts) {
        Write-Host "  [$($item.Time)] $($item.Text)" -ForegroundColor White
    }
} else {
    Write-Host "  [INFO] No ASR text found" -ForegroundColor Gray
}
Write-Host ""

# 提取聚合文本
Write-Host "--- Aggregated Text (aggregatedText) ---" -ForegroundColor Cyan
$aggTexts = Select-String -Path $mainLog -Pattern "$JobId.*aggregatedText" -CaseSensitive:$false | 
    ForEach-Object {
        if ($_.Line -match "aggregatedText['\""]?\s*[:=]\s*['\""]?([^'\""]+)['\""]?") {
            [PSCustomObject]@{
                Time = $_.Line -replace '.*"time":(\d+).*', '$1'
                Text = $matches[1]
                FullLine = $_.Line
            }
        }
    }

if ($aggTexts) {
    foreach ($item in $aggTexts) {
        Write-Host "  [$($item.Time)] $($item.Text)" -ForegroundColor White
    }
} else {
    Write-Host "  [INFO] No aggregated text found" -ForegroundColor Gray
}
Write-Host ""

# 提取语义修复文本
Write-Host "--- Repaired Text (repairedText) ---" -ForegroundColor Cyan
$repairTexts = Select-String -Path $mainLog -Pattern "$JobId.*repairedText" -CaseSensitive:$false | 
    ForEach-Object {
        if ($_.Line -match "repairedText['\""]?\s*[:=]\s*['\""]?([^'\""]+)['\""]?") {
            [PSCustomObject]@{
                Time = $_.Line -replace '.*"time":(\d+).*', '$1'
                Text = $matches[1]
                FullLine = $_.Line
            }
        }
    }

if ($repairTexts) {
    foreach ($item in $repairTexts) {
        Write-Host "  [$($item.Time)] $($item.Text)" -ForegroundColor White
    }
} else {
    Write-Host "  [INFO] No repaired text found" -ForegroundColor Gray
}
Write-Host ""

# 提取最终发送的文本
Write-Host "--- Final Sent Text (sendJobResult) ---" -ForegroundColor Cyan
$finalTexts = Select-String -Path $mainLog -Pattern "$JobId.*sendJobResult" -CaseSensitive:$false | 
    Select-Object -First 5

if ($finalTexts) {
    foreach ($item in $finalTexts) {
        Write-Host "  $($item.Line)" -ForegroundColor White
    }
} else {
    Write-Host "  [INFO] No final result found" -ForegroundColor Gray
}
Write-Host ""

# 提取ASR批次信息
Write-Host "--- ASR Batch Information ---" -ForegroundColor Cyan
$batchInfo = Select-String -Path $mainLog -Pattern "$JobId.*addASRSegment|$JobId.*ASR batch|$JobId.*TextMerge" -CaseSensitive:$false | 
    Select-Object -First 10

if ($batchInfo) {
    foreach ($item in $batchInfo) {
        Write-Host "  $($item.Line)" -ForegroundColor White
    }
} else {
    Write-Host "  [INFO] No batch information found" -ForegroundColor Gray
}
Write-Host ""

Write-Host "=== Extraction Complete ===" -ForegroundColor Green
