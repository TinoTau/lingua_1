# 文档合并脚本
# 将相关文档合并到分类文件中，每个文件不超过500行

$docsPath = "electron_node\services\faster_whisper_vad\docs"
$organizedPath = "$docsPath\organized"

# 定义文档分类
$categories = @{
    "crash_analysis" = @(
        "CRASH_ANALYSIS_FINAL.md",
        "CRASH_ANALYSIS_OPUS_DECODER.md",
        "CRASH_ANALYSIS_PROCESS_ISOLATION.md",
        "CRASH_ANALYSIS_SEGMENTS_CONVERSION.md",
        "CRASH_DIAGNOSIS.md",
        "CRASH_ROOT_CAUSE_ANALYSIS.md",
        "CRASH_FIX_ENHANCED.md",
        "CRASH_FIX_OPUS_DECODING.md",
        "SERVICE_CRASH_ANALYSIS.md",
        "SERVICE_CRASH_ANALYSIS_OPUS.md",
        "ASR_CRASH_FIX.md",
        "ASR_CRASH_FIX_SUMMARY.md"
    )
    
    "opus_decoding" = @(
        "OPUS_CRASH_ROOT_CAUSE_ANALYSIS.md",
        "OPUS_CRASH_DEEP_ANALYSIS.md",
        "OPUS_CRASH_FIX_SUMMARY.md",
        "OPUS_DECODER_CRASH_FIX.md",
        "OPUS_DECODER_CONCURRENCY_FIX.md",
        "OPUS_DECODING_EXECUTIVE_SUMMARY.md",
        "OPUS_DECODING_ISSUE_REPORT.md",
        "OPUS_DECODE_QUALITY_ANALYSIS.md",
        "OPUS_DECODE_QUALITY_ROOT_CAUSE.md",
        "OPUS_CONFIG_COMPARISON.md",
        "OPUS_CONCURRENCY_TEST_RESULTS.md",
        "OPUS_TEST_SCRIPT_UPDATE.md"
    )
    
    "audio_processing" = @(
        "AUDIO_TRUNCATION_ROOT_CAUSE_ANALYSIS.md",
        "AUDIO_TRUNCATION_FIX.md",
        "AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md",
        "AUDIO_CHUNK_ACCUMULATION_MECHANISM.md",
        "AUDIO_CHUNK_CONCATENATION_ANALYSIS.md",
        "AUDIO_CONTEXT_ANALYSIS.md",
        "AUDIO_FORMAT_INVESTIGATION.md",
        "AUDIO_MESSAGE_ARCHITECTURE_ANALYSIS.md",
        "AUDIO_QUALITY_ANALYSIS.md",
        "BUFFER_CAPACITY_ANALYSIS.md",
        "BITRATE_CONFIGURATION.md",
        "BITRATE_FIX_SUMMARY.md",
        "FIX_AUDIO_CHUNK_FORMAT.md"
    )
    
    "context_and_deduplication" = @(
        "CONTEXT_REPEAT_ISSUE_ROOT_CAUSE.md",
        "CONTEXT_DUPLICATE_ISSUE_EXPLANATION.md",
        "DEDUPLICATION_ENHANCEMENT.md",
        "DEDUPLICATION_RESPONSE_FIX.md",
        "UTTERANCE_CONTEXT_AND_DEDUPLICATION.md",
        "UTTERANCE_CONTEXT_MECHANISM.md",
        "ASR_DUPLICATE_TEXT_ANALYSIS.md",
        "ASR_DUPLICATE_TEXT_FIX.md"
    )
    
    "queue_and_results" = @(
        "ASR_QUEUE_FIX_SUMMARY.md",
        "ASR_QUEUE_IMPLEMENTATION_SUMMARY.md",
        "ASR_QUEUE_TEST_RESULTS.md",
        "RESULT_QUEUE_AND_ASR_ENCODING_ISSUES.md",
        "RESULT_QUEUE_FIX_IMPLEMENTATION_SUMMARY.md",
        "RESULT_QUEUE_GAP_TOLERANCE_AND_ASR_UX_FIX_IMPLEMENTATION_GUIDE.md",
        "JOB_RESULT_QUEUE_FIX.md"
    )
    
    "error_analysis" = @(
        "ERROR_404_ANALYSIS.md",
        "ERROR_ANALYSIS_404_400.md",
        "ERROR_ANALYSIS_INTEGRATION_TEST.md",
        "ERROR_ROOT_CAUSE_ANALYSIS.md",
        "COMPREHENSIVE_404_INVESTIGATION.md",
        "NMT_404_ERROR_ANALYSIS.md",
        "NMT_404_FIX_SUMMARY.md",
        "SCHEDULER_404_ERROR_ANALYSIS.md",
        "NODE_CLIENT_404_INVESTIGATION.md"
    )
    
    "web_client_integration" = @(
        "WEB_CLIENT_AUDIO_BUFFER_AND_ASR_CONTEXT_ISSUES.md",
        "WEB_CLIENT_AUDIO_FORMAT_ANALYSIS.md",
        "WEB_CLIENT_NO_AUDIO_DIAGNOSIS.md",
        "WEB_CLIENT_SILENCE_FILTER_ISSUE.md"
    )
    
    "scheduler_integration" = @(
        "SCHEDULER_AUDIO_CHUNK_FINALIZE_MECHANISM.md",
        "SCHEDULER_TIMEOUT_ANALYSIS.md",
        "SCHEDULER_404_ERROR_ANALYSIS.md"
    )
}

# 合并函数
function Merge-Documents {
    param(
        [string]$Category,
        [string[]]$Files,
        [string]$OutputPath,
        [string]$Title
    )
    
    $content = "# $Title`n`n本文档合并了所有相关文档。`n`n---`n`n"
    $fileCount = 0
    
    foreach ($file in $Files) {
        $filePath = Join-Path $docsPath $file
        if (Test-Path $filePath) {
            $fileContent = Get-Content $filePath -Raw -Encoding UTF8
            if ($fileContent) {
                $content += "## $file`n`n$fileContent`n`n---`n`n"
                $fileCount++
            }
        }
    }
    
    # 计算行数
    $lines = ($content -split "`r?`n").Count
    
    if ($lines -gt 500) {
        # 需要分割
        $parts = [math]::Ceiling($lines / 500)
        $allLines = $content -split "`r?`n"
        
        for ($i = 0; $i -lt $parts; $i++) {
            $startIdx = $i * 500
            $endIdx = [math]::Min(($i + 1) * 500 - 1, $allLines.Count - 1)
            $partLines = $allLines[$startIdx..$endIdx]
            $partContent = $partLines -join "`n"
            
            if ($parts -gt 1) {
                $partFile = $OutputPath -replace "\.md$", "_part$($i+1).md"
                $partContent = "# $Title (Part $($i+1)/$parts)`n`n$partContent"
            } else {
                $partFile = $OutputPath
                $partContent = "# $Title`n`n$partContent"
            }
            
            Set-Content -Path $partFile -Value $partContent -Encoding UTF8
            Write-Host "  Created: $partFile ($($partLines.Count) lines)"
        }
    } else {
        Set-Content -Path $OutputPath -Value $content -Encoding UTF8
        Write-Host "  Created: $OutputPath ($lines lines, $fileCount files)"
    }
}

# 处理每个分类
foreach ($category in $categories.Keys) {
    $categoryPath = Join-Path $organizedPath $category
    if (-not (Test-Path $categoryPath)) {
        New-Item -ItemType Directory -Path $categoryPath -Force | Out-Null
    }
    
    $outputFile = Join-Path $categoryPath "$category.merged.md"
    $title = ($category -replace "_", " ").ToUpper()
    
    Write-Host "Processing category: $category"
    Merge-Documents -Category $category -Files $categories[$category] -OutputPath $outputFile -Title $title
}

Write-Host "`nDocument merging completed!"

