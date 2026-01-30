# 检查节点端日志：是否执行了语义修复、NMT、TTS
# 用法：在项目根目录运行，或指定 -LogPath
# 示例：.\scripts\check_semantic_nmt_tts_logs.ps1
#       .\scripts\check_semantic_nmt_tts_logs.ps1 -LogPath "D:\path\to\logs\electron-main.log"

param(
    [string]$LogPath = ""
)

$ErrorActionPreference = "Continue"

# 默认日志路径：electron_node/electron-node/logs/electron-main.log 或 当前目录 logs/electron-main.log
$scriptDir = $PSScriptRoot
$nodeLogs = Join-Path (Split-Path $scriptDir -Parent) "electron-node\logs\electron-main.log"
$cwdLogs = Join-Path $PWD "logs\electron-main.log"
$defaultLog = if (Test-Path $nodeLogs) { $nodeLogs } else { $cwdLogs }
$logFile = if ($LogPath) { $LogPath } else { $defaultLog }

if (-not (Test-Path $logFile)) {
    Write-Host "日志文件不存在: $logFile" -ForegroundColor Red
    Write-Host "请指定集成测试时产生的 electron-main.log 路径，例如:" -ForegroundColor Yellow
    Write-Host "  .\scripts\check_semantic_nmt_tts_logs.ps1 -LogPath 'C:\你的路径\logs\electron-main.log'" -ForegroundColor Yellow
    exit 1
}

Write-Host "=== 检查语义修复 / NMT / TTS 是否执行 ===" -ForegroundColor Green
Write-Host "日志文件: $logFile" -ForegroundColor Gray
Write-Host ""

# 语义修复
$semanticSkip = Select-String -Path $logFile -Pattern "runSemanticRepairStep: skipped|Semantic repair stage not available|no semantic repair initializer" -CaseSensitive:$false
$semanticDone = Select-String -Path $logFile -Pattern "runSemanticRepairStep:.*Semantic repair (completed|rejected|failed)" -CaseSensitive:$false
$semanticStep = Select-String -Path $logFile -Pattern "runSemanticRepairStep:" -CaseSensitive:$false

Write-Host "--- 语义修复 ---" -ForegroundColor Cyan
if ($semanticSkip) {
    Write-Host "  存在「跳过」记录: $($semanticSkip.Count) 处" -ForegroundColor Yellow
    $semanticSkip | Select-Object -First 3 | ForEach-Object { Write-Host "    $($_.Line.Substring(0, [Math]::Min(120, $_.Line.Length)))..." }
}
if ($semanticDone) {
    Write-Host "  存在「已执行」记录: $($semanticDone.Count) 处" -ForegroundColor Green
    $semanticDone | Select-Object -First 3 | ForEach-Object { Write-Host "    $($_.Line.Substring(0, [Math]::Min(120, $_.Line.Length)))..." }
}
if (-not $semanticStep) {
    Write-Host "  未找到 runSemanticRepairStep 相关日志（可能未走 pipeline 或日志级别过滤）" -ForegroundColor Gray
}
Write-Host ""

# NMT
$nmtSend = Select-String -Path $logFile -Pattern "Sending text to NMT|TranslationStage: Sending text to NMT" -CaseSensitive:$false
$nmtReturn = Select-String -Path $logFile -Pattern "NMT service returned result|TranslationStage: NMT service returned" -CaseSensitive:$false
$translationCompleted = Select-String -Path $logFile -Pattern "Translation completed|runTranslationStep: Translation completed" -CaseSensitive:$false
$translationSkip = Select-String -Path $logFile -Pattern "runTranslationStep:.*skip|TaskRouter not available|textToTranslate.*empty" -CaseSensitive:$false

Write-Host "--- NMT 翻译 ---" -ForegroundColor Cyan
if ($nmtSend) {
    Write-Host "  发送到 NMT: $($nmtSend.Count) 处" -ForegroundColor Green
    $nmtSend | Select-Object -First 2 | ForEach-Object { Write-Host "    $($_.Line.Substring(0, [Math]::Min(100, $_.Line.Length)))..." }
}
if ($nmtReturn) {
    Write-Host "  NMT 返回: $($nmtReturn.Count) 处" -ForegroundColor Green
}
if ($translationCompleted) {
    Write-Host "  Translation completed: $($translationCompleted.Count) 处" -ForegroundColor Green
}
if ($translationSkip) {
    Write-Host "  存在「跳过翻译」: $($translationSkip.Count) 处" -ForegroundColor Yellow
}
if (-not $nmtSend -and -not $translationCompleted) {
    Write-Host "  未找到 NMT/Translation 相关日志" -ForegroundColor Gray
}
Write-Host ""

# TTS
$ttsRoute = Select-String -Path $logFile -Pattern "routeTTSTask|tts-step" -CaseSensitive:$false
$ttsAudioLen = Select-String -Path $logFile -Pattern "ttsAudioLength|tts_audio.*length|Job processing completed successfully" -CaseSensitive:$false

Write-Host "--- TTS ---" -ForegroundColor Cyan
if ($ttsRoute) {
    Write-Host "  routeTTSTask/tts-step: $($ttsRoute.Count) 处" -ForegroundColor Green
}
if ($ttsAudioLen) {
    $withAudio = $ttsAudioLen | Where-Object { $_.Line -match "ttsAudioLength.*[1-9]|tts_audio.*[1-9]" }; 
    if ($withAudio) { Write-Host "  存在带 tts 音频长度的完成记录: $($withAudio.Count) 处" -ForegroundColor Green }
    else { Write-Host "  完成记录中 tts 音频长度为 0 或未出现（可能无 TTS 输出）" -ForegroundColor Yellow }
}
if (-not $ttsRoute -and -not $ttsAudioLen) {
    Write-Host "  未找到 TTS 相关日志" -ForegroundColor Gray
}
Write-Host ""

# 简要结论
Write-Host "=== 简要结论 ===" -ForegroundColor Green
$hasSemantic = ($semanticDone -and $semanticDone.Count -gt 0) -or ($semanticStep -and -not $semanticSkip)
$hasNMT = ($nmtSend -or $translationCompleted) -and ($nmtSend.Count -gt 0 -or $translationCompleted.Count -gt 0)
$hasTTS = $ttsRoute -and $ttsRoute.Count -gt 0
Write-Host "  语义修复: $(if ($semanticSkip -and $semanticSkip.Count -gt 0) { '可能未执行或已跳过' } elseif ($semanticDone) { '有执行记录' } else { '需结合上文判断' })"
Write-Host "  NMT:       $(if ($hasNMT) { '有调用/完成记录' } else { '未发现或未执行' })"
Write-Host "  TTS:       $(if ($hasTTS) { '有调用记录' } else { '未发现或未执行' })"
