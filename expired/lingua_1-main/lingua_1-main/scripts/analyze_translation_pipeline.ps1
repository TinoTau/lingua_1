# 分析三端日志：检查语音翻译和音频播放的完整性
# 用于诊断：半句话被丢弃、最后一句话无法及时返回等问题

param(
    [string]$SchedulerLog = "central_server\scheduler\logs\scheduler.log",
    [string]$NodeLog = "electron_node\electron-node\logs\electron-main.log",
    [string]$TraceId = ""  # 可选：指定 trace_id 进行过滤
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "三端日志分析：翻译管道完整性检查" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查日志文件是否存在
if (-not (Test-Path $SchedulerLog)) {
    Write-Host "❌ 调度服务器日志不存在: $SchedulerLog" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $NodeLog)) {
    Write-Host "⚠️  节点端日志不存在: $NodeLog" -ForegroundColor Yellow
    Write-Host "   将只分析调度服务器日志" -ForegroundColor Yellow
    Write-Host ""
}

# 1. 分析调度服务器日志：Web端发送的音频块
Write-Host "[1/4] 分析 Web端 -> 调度服务器：音频块接收" -ForegroundColor Yellow
Write-Host ""

$audioChunks = @()
if (Test-Path $SchedulerLog) {
    $logContent = Get-Content $SchedulerLog -Tail 10000 -Encoding UTF8
    foreach ($line in $logContent) {
        if ($line -match '"message":"Received audio_chunk"' -or $line -match '"message":"处理 audio_chunk"') {
            # 尝试解析 JSON
            try {
                $json = $line | ConvertFrom-Json
                if ($json.message -match "audio_chunk" -and $json.session_id) {
                    $audioChunks += @{
                        timestamp = $json.timestamp
                        session_id = $json.session_id
                        utterance_index = $json.utterance_index
                        trace_id = $json.trace_id
                        is_final = $json.is_final
                    }
                }
            } catch {
                # 如果不是 JSON 格式，尝试正则提取
                if ($line -match 'session_id[=:]"?([^",\s]+)"?' -and $line -match 'utterance_index[=:]"?(\d+)"?') {
                    $sessionId = $matches[1]
                    $utteranceIndex = [int]$matches[2]
                    $audioChunks += @{
                        timestamp = "N/A"
                        session_id = $sessionId
                        utterance_index = $utteranceIndex
                        trace_id = "N/A"
                        is_final = $false
                    }
                }
            }
        }
    }
}

Write-Host "  找到 $($audioChunks.Count) 个音频块" -ForegroundColor $(if ($audioChunks.Count -gt 0) { "Green" } else { "Yellow" })
if ($audioChunks.Count -gt 0) {
    $groupedBySession = $audioChunks | Group-Object -Property session_id
    foreach ($group in $groupedBySession) {
        Write-Host "  会话 $($group.Name): $($group.Count) 个音频块" -ForegroundColor Gray
        $utteranceIndices = $group.Group | ForEach-Object { $_.utterance_index } | Sort-Object -Unique
        Write-Host "    utterance_index range: $($utteranceIndices -join ', ')" -ForegroundColor Gray
    }
}
Write-Host ""

# 2. 分析调度服务器日志：发送给节点端的 job_assign
Write-Host "[2/4] 分析 调度服务器 -> 节点端：任务分配" -ForegroundColor Yellow
Write-Host ""

$jobAssigns = @()
if (Test-Path $SchedulerLog) {
    $logContent = Get-Content $SchedulerLog -Tail 10000 -Encoding UTF8
    foreach ($line in $logContent) {
        if ($line -match '"message":"Sending job_assign"' -or $line -match '"message":"Job assigned"' -or $line -match 'job_assign') {
            try {
                $json = $line | ConvertFrom-Json
                if ($json.message -match "job_assign" -and $json.job_id) {
                    $jobAssigns += @{
                        timestamp = $json.timestamp
                        job_id = $json.job_id
                        session_id = $json.session_id
                        utterance_index = $json.utterance_index
                        trace_id = $json.trace_id
                    }
                }
            } catch {
                if ($line -match 'job_id[=:]"?([^",\s]+)"?' -and $line -match 'utterance_index[=:]"?(\d+)"?') {
                    $jobId = $matches[1]
                    $utteranceIndex = [int]$matches[2]
                    $jobAssigns += @{
                        timestamp = "N/A"
                        job_id = $jobId
                        session_id = "N/A"
                        utterance_index = $utteranceIndex
                        trace_id = "N/A"
                    }
                }
            }
        }
    }
}

Write-Host "  找到 $($jobAssigns.Count) 个任务分配" -ForegroundColor $(if ($jobAssigns.Count -gt 0) { "Green" } else { "Yellow" })
if ($jobAssigns.Count -gt 0) {
    $groupedBySession = $jobAssigns | Group-Object -Property session_id
    foreach ($group in $groupedBySession) {
        Write-Host "  会话 $($group.Name): $($group.Count) 个任务" -ForegroundColor Gray
        $utteranceIndices = $group.Group | ForEach-Object { $_.utterance_index } | Sort-Object -Unique
        Write-Host "    utterance_index range: $($utteranceIndices -join ', ')" -ForegroundColor Gray
    }
}
Write-Host ""

# 3. 分析调度服务器日志：节点端返回的 job_result
Write-Host "[3/4] 分析 节点端 -> 调度服务器：任务结果" -ForegroundColor Yellow
Write-Host ""

$jobResults = @()
if (Test-Path $SchedulerLog) {
    $logContent = Get-Content $SchedulerLog -Tail 10000 -Encoding UTF8
    foreach ($line in $logContent) {
        if ($line -match '"message":"Received JobResult"' -or $line -match '"message":"JobResult received"' -or $line -match 'job_result') {
            try {
                $json = $line | ConvertFrom-Json
                if ($json.message -match "JobResult" -and $json.job_id) {
                    $hasText = $json.text_asr -or $json.text_translated
                    $hasAudio = $json.tts_audio -or ($json.tts_audio_len -and $json.tts_audio_len -gt 0)
                    $jobResults += @{
                        timestamp = $json.timestamp
                        job_id = $json.job_id
                        session_id = $json.session_id
                        utterance_index = $json.utterance_index
                        trace_id = $json.trace_id
                        has_text = $hasText
                        has_audio = $hasAudio
                        text_asr = $json.text_asr
                        text_translated = $json.text_translated
                        tts_audio_len = $json.tts_audio_len
                    }
                }
            } catch {
                if ($line -match 'job_id[=:]"?([^",\s]+)"?' -and $line -match 'utterance_index[=:]"?(\d+)"?') {
                    $jobId = $matches[1]
                    $utteranceIndex = [int]$matches[2]
                    $jobResults += @{
                        timestamp = "N/A"
                        job_id = $jobId
                        session_id = "N/A"
                        utterance_index = $utteranceIndex
                        trace_id = "N/A"
                        has_text = $false
                        has_audio = $false
                        text_asr = ""
                        text_translated = ""
                        tts_audio_len = 0
                    }
                }
            }
        }
    }
}

Write-Host "  找到 $($jobResults.Count) 个任务结果" -ForegroundColor $(if ($jobResults.Count -gt 0) { "Green" } else { "Yellow" })
if ($jobResults.Count -gt 0) {
    $groupedBySession = $jobResults | Group-Object -Property session_id
    foreach ($group in $groupedBySession) {
        Write-Host "  会话 $($group.Name): $($group.Count) 个结果" -ForegroundColor Gray
        $utteranceIndices = $group.Group | ForEach-Object { $_.utterance_index } | Sort-Object -Unique
        Write-Host "    utterance_index range: $($utteranceIndices -join ', ')" -ForegroundColor Gray
        
        # 检查每个结果是否有文本和音频
        $emptyResults = $group.Group | Where-Object { -not $_.has_text -and -not $_.has_audio }
        if ($emptyResults.Count -gt 0) {
            Write-Host "    ⚠️  发现 $($emptyResults.Count) 个空结果（无文本无音频）" -ForegroundColor Yellow
        }
    }
}
Write-Host ""

# 4. 分析调度服务器日志：发送给Web端的 translation_result
Write-Host "[4/4] 分析 调度服务器 -> Web端：翻译结果发送" -ForegroundColor Yellow
Write-Host ""

$translationResults = @()
if (Test-Path $SchedulerLog) {
    $logContent = Get-Content $SchedulerLog -Tail 10000 -Encoding UTF8
    foreach ($line in $logContent) {
        if ($line -match '"message":"Sending translation result"' -or $line -match '"message":"translation_result sent"' -or $line -match 'translation_result') {
            try {
                $json = $line | ConvertFrom-Json
                if ($json.message -match "translation result" -and $json.session_id) {
                    $hasAudio = $json.tts_audio_len -and $json.tts_audio_len -gt 0
                    $translationResults += @{
                        timestamp = $json.timestamp
                        session_id = $json.session_id
                        utterance_index = $json.utterance_index
                        trace_id = $json.trace_id
                        has_audio = $hasAudio
                        tts_audio_len = $json.tts_audio_len
                        text_asr = $json.text_asr
                        text_translated = $json.text_translated
                    }
                }
            } catch {
                if ($line -match 'session_id[=:]"?([^",\s]+)"?' -and $line -match 'utterance_index[=:]"?(\d+)"?') {
                    $sessionId = $matches[1]
                    $utteranceIndex = [int]$matches[2]
                    $translationResults += @{
                        timestamp = "N/A"
                        session_id = $sessionId
                        utterance_index = $utteranceIndex
                        trace_id = "N/A"
                        has_audio = $false
                        tts_audio_len = 0
                        text_asr = ""
                        text_translated = ""
                    }
                }
            }
        }
    }
}

Write-Host "  找到 $($translationResults.Count) 个翻译结果发送" -ForegroundColor $(if ($translationResults.Count -gt 0) { "Green" } else { "Yellow" })
if ($translationResults.Count -gt 0) {
    $groupedBySession = $translationResults | Group-Object -Property session_id
    foreach ($group in $groupedBySession) {
        Write-Host "  会话 $($group.Name): $($group.Count) 个结果" -ForegroundColor Gray
        $utteranceIndices = $group.Group | ForEach-Object { $_.utterance_index } | Sort-Object -Unique
        Write-Host "    utterance_index range: $($utteranceIndices -join ', ')" -ForegroundColor Gray
        
        # 检查每个结果是否有音频
        $noAudioResults = $group.Group | Where-Object { -not $_.has_audio }
        if ($noAudioResults.Count -gt 0) {
            Write-Host "    ⚠️  发现 $($noAudioResults.Count) 个结果无音频" -ForegroundColor Yellow
            foreach ($result in $noAudioResults) {
                Write-Host "      utterance_index=$($result.utterance_index), text_asr='$($result.text_asr)'" -ForegroundColor Gray
            }
        }
    }
}
Write-Host ""

# 5. 对比分析：检查数据流完整性
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "数据流完整性分析" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 对比 job_assign 和 job_result
if ($jobAssigns.Count -gt 0 -and $jobResults.Count -gt 0) {
    $assignedJobIds = $jobAssigns | ForEach-Object { $_.job_id } | Sort-Object -Unique
    $resultJobIds = $jobResults | ForEach-Object { $_.job_id } | Sort-Object -Unique
    
    $missingResults = $assignedJobIds | Where-Object { $_ -notin $resultJobIds }
    if ($missingResults.Count -gt 0) {
        Write-Host "❌ 发现 $($missingResults.Count) 个任务未返回结果:" -ForegroundColor Red
        foreach ($jobId in $missingResults) {
            $job = $jobAssigns | Where-Object { $_.job_id -eq $jobId } | Select-Object -First 1
            Write-Host "   job_id=$jobId, utterance_index=$($job.utterance_index)" -ForegroundColor Red
        }
    } else {
        Write-Host "✅ 所有任务都有返回结果" -ForegroundColor Green
    }
    
    # 对比 utterance_index
    $assignedIndices = $jobAssigns | ForEach-Object { $_.utterance_index } | Sort-Object -Unique
    $resultIndices = $jobResults | ForEach-Object { $_.utterance_index } | Sort-Object -Unique
    
    $missingIndices = $assignedIndices | Where-Object { $_ -notin $resultIndices }
    if ($missingIndices.Count -gt 0) {
        Write-Host "⚠️  发现 utterance_index 不匹配:" -ForegroundColor Yellow
        Write-Host "   分配的: $($assignedIndices -join ', ')" -ForegroundColor Gray
        Write-Host "   返回的: $($resultIndices -join ', ')" -ForegroundColor Gray
        Write-Host "   缺失的: $($missingIndices -join ', ')" -ForegroundColor Yellow
    }
}

# 对比 job_result 和 translation_result
if ($jobResults.Count -gt 0 -and $translationResults.Count -gt 0) {
    $resultIndices = $jobResults | ForEach-Object { $_.utterance_index } | Sort-Object -Unique
    $sentIndices = $translationResults | ForEach-Object { $_.utterance_index } | Sort-Object -Unique
    
    $missingSent = $resultIndices | Where-Object { $_ -notin $sentIndices }
    if ($missingSent.Count -gt 0) {
        Write-Host "⚠️  发现 $($missingSent.Count) 个结果未发送到Web端:" -ForegroundColor Yellow
        Write-Host "   utterance_index: $($missingSent -join ', ')" -ForegroundColor Yellow
    } else {
        Write-Host "✅ 所有结果都已发送到Web端" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "提示：查看浏览器控制台（F12）检查Web端是否收到并播放了所有 translation_result" -ForegroundColor Cyan
Write-Host ""

