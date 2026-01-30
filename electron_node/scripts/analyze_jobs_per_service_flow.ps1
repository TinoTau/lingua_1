# 按 Job 分析各服务处理过程：ASR / 聚合 / 语义修复 / NMT / TTS
# 用法：在 electron_node 目录运行，或指定 -LogPath
# 示例：.\scripts\analyze_jobs_per_service_flow.ps1
#       .\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "D:\path\to\logs\electron-main.log"

param(
    [string]$LogPath = "",
    [string]$SessionId = ""
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = $PSScriptRoot
$nodeLogs = Join-Path (Split-Path $scriptDir -Parent) "electron-node\logs\electron-main.log"
$cwdLogs = Join-Path $PWD "logs\electron-main.log"
$defaultLog = if (Test-Path $nodeLogs) { $nodeLogs } else { $cwdLogs }
$logFile = if ($LogPath) { $LogPath } else { $defaultLog }

if (-not (Test-Path $logFile)) {
    Write-Host "日志文件不存在: $logFile" -ForegroundColor Red
    Write-Host "请指定集成测试时产生的 electron-main.log 路径，例如:" -ForegroundColor Yellow
    Write-Host "  .\scripts\analyze_jobs_per_service_flow.ps1 -LogPath 'C:\你的路径\logs\electron-main.log'" -ForegroundColor Yellow
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "按 Job 分析：ASR → 聚合 → 语义修复 → NMT → TTS" -ForegroundColor Cyan
Write-Host "日志文件: $logFile" -ForegroundColor Gray
if ($SessionId) { Write-Host "仅 Session: $SessionId" -ForegroundColor Gray }
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 收集所有包含 jobId 的 JSON 行，按 jobId 分组（同一 job 可能多行）
$lines = Get-Content $logFile -Encoding UTF8 -ErrorAction SilentlyContinue
if (-not $lines) {
    Write-Host "无法读取日志文件或文件为空" -ForegroundColor Red
    exit 1
}

# 提取所有 job_id（从 msg 或 jobId 字段）；用双引号内 "" 表示字面量双引号，避免 [ ] 被解析
# 用 .{0,80} 代替 [^"]* 避免 PowerShell 解析 [ ] 报错
$jobIdPat1 = 'jobId.{0,80}"([-a-f0-9]+)"'
$jobIdPat2 = 'job_id.{0,80}"([-a-f0-9]+)"'
$jobIds = [ordered]@{}
foreach ($line in $lines) {
    if ($line -notmatch $jobIdPat1 -and $line -notmatch $jobIdPat2) { continue }
    $jid = $null
    if ($line -match $jobIdPat1) { $jid = $matches[1] }
    elseif ($line -match $jobIdPat2) { $jid = $matches[1] }
    if (-not $jid) { continue }
    if (-not $jobIds[$jid]) { $jobIds[$jid] = @() }
    $jobIds[$jid] += $line
}

# 若指定了 SessionId，只保留该 session 的 job
if ($SessionId) {
    $filtered = [ordered]@{}
    foreach ($jid in $jobIds.Keys) {
        $hasSession = $jobIds[$jid] | Where-Object { $_ -match "sessionId.*$SessionId" -or $_ -match "session_id.*$SessionId" }
        if ($hasSession) { $filtered[$jid] = $jobIds[$jid] }
    }
    $jobIds = $filtered
}

$jobList = @($jobIds.Keys)
if ($jobList.Count -eq 0) {
    Write-Host "未找到包含 jobId 的日志行" -ForegroundColor Yellow
    exit 0
}

# 按 utterance_index 排序（若有）
function Get-UtteranceIndex($logLines) {
    foreach ($l in $logLines) {
        if ($l -match 'utteranceIndex.*?(\d+)') { return [int]$matches[1] }
        if ($l -match 'utterance_index.*?(\d+)') { return [int]$matches[1] }
    }
    return -1
}

$sortedJobs = $jobList | ForEach-Object {
    [PSCustomObject]@{ JobId = $_; UtteranceIndex = (Get-UtteranceIndex $jobIds[$_]) }
} | Sort-Object { $_.UtteranceIndex }, { $_.JobId }

foreach ($entry in $sortedJobs) {
    $jobId = $entry.JobId
    $utteranceIndex = $entry.UtteranceIndex
    $jobLines = $jobIds[$jobId]

    Write-Host "----------------------------------------" -ForegroundColor Cyan
    Write-Host "Job: $jobId  (utterance_index: $utteranceIndex)" -ForegroundColor Cyan
    Write-Host "----------------------------------------" -ForegroundColor Cyan

    # ASR
    $asrOut = $jobLines | Select-String -Pattern 'asrText|ASR batch.*completed|ASR completed' | ForEach-Object { $_.Line }
    $asrText = $null
    foreach ($l in $asrOut) {
        if ($l -match 'asrText.*?"(.*?)"') { $asrText = $matches[1]; break }
        if ($l -match 'asrTextPreview.*?"(.*?)"') { $asrText = $matches[1] + "..."; break }
    }
    $asrPreview = if ($asrText) { $asrText.Substring(0, [Math]::Min(80, $asrText.Length)) + $(if ($asrText.Length -gt 80) { '...' } else { '' }) } else { '(未找到或为空)' }
    Write-Host "  [ASR] 输出: $asrPreview" -ForegroundColor White

    # Aggregation（本段送 NMT/text_asr = segmentForJobResult）
    $aggOut = $jobLines | Select-String -Pattern 'runAggregationStep|Aggregation completed|segmentForJobResult|shouldSendToSemanticRepair' | ForEach-Object { $_.Line }
    $segmentForJob = $null
    $shouldSend = $null
    foreach ($l in $aggOut) {
        if ($l -match 'segmentForJobResultPreview.*?"(.*?)"') { $segmentForJob = $matches[1] }
        if ($l -match 'segmentForJobResult.*?"(.{1,200})"') { if (-not $segmentForJob) { $segmentForJob = $matches[1] } }
        if ($l -match 'shouldSendToSemanticRepair.*?(true|false)') { $shouldSend = $matches[1] }
    }
    $segPreview = if ($segmentForJob) { $segmentForJob.Substring(0, [Math]::Min(80, $segmentForJob.Length)) + $(if ($segmentForJob.Length -gt 80) { '...' } else { '' }) } else { '(未找到)' }
    Write-Host "  [聚合] segmentForJobResult: $segPreview" -ForegroundColor White
    Write-Host "  [聚合] shouldSendToSemanticRepair: $(if ($null -ne $shouldSend) { $shouldSend } else { '?' })" -ForegroundColor $(if ($shouldSend -eq "true") { "Green" } else { "Yellow" })

    # Semantic Repair
    $semOut = $jobLines | Select-String -Pattern 'runSemanticRepairStep|Semantic repair completed|Semantic repair rejected|repairedText|Updated recentCommittedText' | ForEach-Object { $_.Line }
    $repaired = $null
    $semDone = $false
    foreach ($l in $semOut) {
        if ($l -match 'Semantic repair (completed|rejected|failed)') { $semDone = $true }
        if ($l -match 'repairedText.*?"(.*?)"') { $repaired = $matches[1] }
    }
    $skipPat = "skipped|no semantic repair initializer|stage not available"
    $semSkipped = ($semOut | Select-String -Pattern $skipPat -Quiet)
    if ($semSkipped) {
        Write-Host "  [语义修复] 未执行（跳过/无 initializer）" -ForegroundColor Yellow
    }
    else {
        $repPreview = if ($repaired) { $repaired.Substring(0, [Math]::Min(60, $repaired.Length)) + $(if ($repaired.Length -gt 60) { '...' } else { '' }) } else { '?' }
        $semYn = if ($semDone) { 'Y' } else { '?' }
        Write-Host "  [语义修复] 已执行: $semYn; repairedText: $repPreview" -ForegroundColor $(if ($semDone) { 'Green' } else { 'Gray' })
    }

    # NMT / Translation
    $nmtOut = $jobLines | Select-String -Pattern 'runTranslationStep|Translation completed|Translation failed|translatedText|NMT service returned|skip.*translation|shouldSendToSemanticRepair.*false' | ForEach-Object { $_.Line }
    $translated = $null
    $nmtDone = $false
    $nmtSkip = $false
    # NMT / Translation（NMT 输入 = segmentForJobResult；输出 = translatedText）
    $nmtIn = $jobLines | Select-String -Pattern 'NMT INPUT: Sending NMT request' | ForEach-Object { $_.Line }
    $nmtOut = $jobLines | Select-String -Pattern 'runTranslationStep|Translation completed|Translation failed|translatedText|NMT OUTPUT|NMT service returned|skip.*translation|shouldSendToSemanticRepair.*false' | ForEach-Object { $_.Line }
    $nmtTextIn = $null
    $nmtContextLen = $null
    foreach ($l in $nmtIn) {
        if ($l -match 'textPreview.*?"(.*?)"') { $nmtTextIn = $matches[1] }
        if ($l -match 'text.*?"(.{1,200})"') { if (-not $nmtTextIn) { $nmtTextIn = $matches[1] } }
        if ($l -match 'contextTextLength.*?(\d+)') { $nmtContextLen = [int]$matches[1] }
    }
    if ($nmtTextIn) {
        $nmtInPreview = $nmtTextIn.Substring(0, [Math]::Min(100, $nmtTextIn.Length)) + $(if ($nmtTextIn.Length -gt 100) { '...' } else { '' })
        Write-Host "  [NMT 输入] text: $nmtInPreview" -ForegroundColor Gray
        if ($null -ne $nmtContextLen -and $nmtContextLen -gt 0) { Write-Host "  [NMT 输入] contextTextLength: $nmtContextLen" -ForegroundColor Gray }
    }
    $translated = $null
    $translatedPreview = $null
    $nmtDone = $false
    $nmtSkip = $false
    foreach ($l in $nmtOut) {
        if ($l -match 'Translation completed') { $nmtDone = $true }
        if ($l -match 'Translation failed|skip|shouldSendToSemanticRepair.*false') { $nmtSkip = $true }
        if ($l -match 'translatedText.*?"(.*?)"') { $translated = $matches[1] }
        if ($l -match 'translatedTextPreview.*?"(.*?)"') { $translatedPreview = $matches[1] }
        if ($l -match 'translatedTextLength.*?(\d+)') { if ([int]$matches[1] -eq 0) { $translated = '' } }
    }
    if ($nmtSkip -and -not $nmtDone) {
        Write-Host "  [NMT] 未执行或跳过（如未走语义修复则跳过）" -ForegroundColor Yellow
    }
    else {
        $nmtYn = if ($nmtDone) { 'Y' } else { '?' }
        $nmtLenStr = if ($null -ne $translated) { $translated.Length } else { '?' }
        Write-Host "  [NMT] 已执行: $nmtYn; translatedText 长度: $nmtLenStr" -ForegroundColor $(if ($nmtDone) { 'Green' } else { 'Gray' })
        if ($translatedPreview) {
            $outPreview = $translatedPreview.Substring(0, [Math]::Min(100, $translatedPreview.Length)) + $(if ($translatedPreview.Length -gt 100) { '...' } else { '' })
            Write-Host "  [NMT 输出] translatedTextPreview: $outPreview" -ForegroundColor Gray
        }
        # TTS
        $ttsOut = $jobLines | Select-String -Pattern 'routeTTSTask|tts-step|tts_audio|ttsAudioLength|TTS completed' | ForEach-Object { $_.Line }
        $ttsLen = $null
        foreach ($l in $ttsOut) {
            if ($l -match 'ttsAudioLength.*?(\d+)') { $ttsLen = [int]$matches[1]; break }
            if ($l -match 'tts_audio.*length') { $ttsLen = 1; break }
            if ($l -match 'base64.*length') { $ttsLen = 1; break }
        }
        if ($ttsOut.Count -eq 0) {
            Write-Host "  [TTS] 未找到 TTS 相关日志" -ForegroundColor Gray
        }
        else {
            Write-Host "  [TTS] $(if ($ttsLen -and $ttsLen -gt 0) { "有音频 (length: $ttsLen)" } else { "无音频或长度为 0 -> 客户端会显示 [音频丢失]" })" -ForegroundColor $(if ($ttsLen -and $ttsLen -gt 0) { "Green" } else { "Red" })
        }

        Write-Host ""
    }

    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "说明: segmentForJobResult = 本段送 NMT 与 text_asr（客户端原文）" -ForegroundColor Yellow
Write-Host "      若 NMT 译文为空或 TTS 无音频，客户端会显示 [音频丢失]" -ForegroundColor Yellow
Write-Host "      仅当 shouldSendToSemanticRepair=true 的 job 才会走语义修复和 NMT/TTS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
rite-Host "========================================" -ForegroundColor Cyan   Write-Host "========================================" -ForegroundColor Cyanrite-Host "========================================" -ForegroundColor Cyan
