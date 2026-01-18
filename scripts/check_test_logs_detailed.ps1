# 详细检查测试日志，查找问题线索

param(
    [string]$NodeLogPath = "electron_node\electron-node\logs\electron-main.log",
    [string]$NmtLogPath = "electron_node\services\nmt_m2m100\logs\nmt-service.log",
    [string]$SemanticLogPath = "electron_node\services\semantic_repair_zh\logs\semantic-repair-zh.log",
    [string]$SessionId = "s-B9BEC010"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试日志详细检查" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 检查节点端日志 - Context传递
Write-Host "--- 1. 节点端日志 - Context传递检查 ---" -ForegroundColor Yellow
if (Test-Path $NodeLogPath) {
    Write-Host "检查语义修复后的context更新..." -ForegroundColor Gray
    $contextLogs = Get-Content $NodeLogPath -Encoding UTF8 -Tail 1000 | Select-String -Pattern "Updated recentCommittedText|contextText|getLastCommittedText" -Context 2
    if ($contextLogs) {
        $contextLogs | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到context相关日志" -ForegroundColor Yellow
    }
    Write-Host ""
    
    Write-Host "检查语义修复输入输出..." -ForegroundColor Gray
    $repairLogs = Get-Content $NodeLogPath -Encoding UTF8 -Tail 1000 | Select-String -Pattern "SEMANTIC_REPAIR.*INPUT|SEMANTIC_REPAIR.*OUTPUT|Semantic repair.*completed" -Context 1
    if ($repairLogs) {
        $repairLogs | Select-Object -First 30 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到语义修复日志" -ForegroundColor Yellow
    }
    Write-Host ""
    
    Write-Host "检查NMT翻译输入（查看context是否正确）..." -ForegroundColor Gray
    $nmtInputLogs = Get-Content $NodeLogPath -Encoding UTF8 -Tail 1000 | Select-String -Pattern "NMT INPUT.*contextText" -Context 3
    if ($nmtInputLogs) {
        $nmtInputLogs | Select-Object -First 15 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到NMT输入日志" -ForegroundColor Yellow
    }
    Write-Host ""
} else {
    Write-Host "节点端日志不存在: $NodeLogPath" -ForegroundColor Red
    Write-Host ""
}

# 2. 检查NMT服务日志 - 重复翻译问题
Write-Host "--- 2. NMT服务日志 - 重复翻译检查 ---" -ForegroundColor Yellow
if (Test-Path $NmtLogPath) {
    Write-Host "检查最近的NMT翻译请求..." -ForegroundColor Gray
    $nmtLogs = Get-Content $NmtLogPath -Encoding UTF8 -Tail 500 | Select-String -Pattern "Translation Request|Final output|Output.*full translation" -Context 2
    if ($nmtLogs) {
        $nmtLogs | Select-Object -Last 30 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到NMT翻译日志" -ForegroundColor Yellow
    }
    Write-Host ""
    
    Write-Host "检查extract_translation的提取结果..." -ForegroundColor Gray
    $extractLogs = Get-Content $NmtLogPath -Encoding UTF8 -Tail 500 | Select-String -Pattern "extraction|extract.*translation|提取" -Context 2
    if ($extractLogs) {
        $extractLogs | Select-Object -Last 20 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到提取相关日志" -ForegroundColor Yellow
    }
    Write-Host ""
} else {
    Write-Host "NMT服务日志不存在: $NmtLogPath" -ForegroundColor Red
    Write-Host ""
}

# 3. 检查语义修复服务日志
Write-Host "--- 3. 语义修复服务日志 ---" -ForegroundColor Yellow
if (Test-Path $SemanticLogPath) {
    Write-Host "检查最近的语义修复请求..." -ForegroundColor Gray
    $semanticLogs = Get-Content $SemanticLogPath -Encoding UTF8 -Tail 300 | Select-String -Pattern "INPUT|OUTPUT|Repair completed" -Context 1
    if ($semanticLogs) {
        $semanticLogs | Select-Object -Last 20 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到语义修复日志" -ForegroundColor Yellow
    }
    Write-Host ""
} else {
    Write-Host "语义修复服务日志不存在: $SemanticLogPath" -ForegroundColor Yellow
    Write-Host "  尝试查找其他位置..." -ForegroundColor Gray
    
    # 尝试查找其他可能的位置
    $altPaths = @(
        "electron_node\services\semantic_repair_zh\*.log",
        "electron_node\services\semantic_repair_en\*.log"
    )
    foreach ($path in $altPaths) {
        $files = Get-ChildItem -Path $path -ErrorAction SilentlyContinue
        if ($files) {
            Write-Host "  找到日志文件: $($files[0].FullName)" -ForegroundColor Green
            $semanticLogs = Get-Content $files[0].FullName -Encoding UTF8 -Tail 100 | Select-String -Pattern "INPUT|OUTPUT" -Context 1
            if ($semanticLogs) {
                $semanticLogs | Select-Object -Last 10 | ForEach-Object { Write-Host $_ }
            }
        }
    }
    Write-Host ""
}

# 4. 检查ASR原始输出
Write-Host "--- 4. ASR原始输出检查 ---" -ForegroundColor Yellow
if (Test-Path $NodeLogPath) {
    Write-Host "检查ASR识别结果..." -ForegroundColor Gray
    $asrLogs = Get-Content $NodeLogPath -Encoding UTF8 -Tail 1000 | Select-String -Pattern "asrText.*开始|asrText.*我会先读|asrText.*超过|asrText.*读起来|asrText.*这场剧|asrText.*还是需要" -Context 1
    if ($asrLogs) {
        $asrLogs | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到ASR文本日志（尝试其他模式）..." -ForegroundColor Yellow
        # 尝试查找ASR相关的其他日志
        $asrLogs2 = Get-Content $NodeLogPath -Encoding UTF8 -Tail 1000 | Select-String -Pattern "ASR.*completed|asrTextLength" -Context 2
        if ($asrLogs2) {
            $asrLogs2 | Select-Object -First 15 | ForEach-Object { Write-Host $_ }
        }
    }
    Write-Host ""
} else {
    Write-Host "节点端日志不存在" -ForegroundColor Red
    Write-Host ""
}

# 5. 检查音频切分日志
Write-Host "--- 5. 音频切分检查 ---" -ForegroundColor Yellow
if (Test-Path $NodeLogPath) {
    Write-Host "检查AudioAggregator的切分日志..." -ForegroundColor Gray
    $splitLogs = Get-Content $NodeLogPath -Encoding UTF8 -Tail 1000 | Select-String -Pattern "Audio processed.*streaming split|segmentCount|originalJobIds" -Context 2
    if ($splitLogs) {
        $splitLogs | Select-Object -First 20 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到音频切分日志" -ForegroundColor Yellow
    }
    Write-Host ""
} else {
    Write-Host "节点端日志不存在" -ForegroundColor Red
    Write-Host ""
}

# 6. 检查特定utterance的处理流程
Write-Host "--- 6. 特定Utterance处理流程（[8]） ---" -ForegroundColor Yellow
if (Test-Path $NodeLogPath) {
    Write-Host "检查utterance [8]的完整处理流程..." -ForegroundColor Gray
    $utterance8Logs = Get-Content $NodeLogPath -Encoding UTF8 -Tail 2000 | Select-String -Pattern "utteranceIndex.*8|utterance_index.*8" -Context 3 | Select-Object -Last 50
    if ($utterance8Logs) {
        Write-Host "找到 $($utterance8Logs.Count) 条相关日志" -ForegroundColor Green
        $utterance8Logs | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "  未找到utterance [8]的日志" -ForegroundColor Yellow
    }
    Write-Host ""
} else {
    Write-Host "节点端日志不存在" -ForegroundColor Red
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "日志检查完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
