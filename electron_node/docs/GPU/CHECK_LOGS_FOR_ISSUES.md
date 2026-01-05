# 检查日志以分析集成测试问题

## 快速检查命令

### 1. 检查job7的完整处理流程

```powershell
# 查找job7的所有日志
$logDirs = @("$env:APPDATA\electron-node\logs", "$env:LOCALAPPDATA\electron-node\logs")
foreach ($dir in $logDirs) {
    if (Test-Path $dir) {
        $logs = Get-ChildItem -Path $dir -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($logs) {
            Write-Host "=== Job 7 Processing ===" -ForegroundColor Green
            Select-String -Path $logs.FullName -Pattern "job.*7|utterance.*7" -CaseSensitive:$false | Select-Object -Last 50
            break
        }
    }
}
```

### 2. 检查job14的完整处理流程

```powershell
# 查找job14的所有日志
$logDirs = @("$env:APPDATA\electron-node\logs", "$env:LOCALAPPDATA\electron-node\logs")
foreach ($dir in $logDirs) {
    if (Test-Path $dir) {
        $logs = Get-ChildItem -Path $dir -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($logs) {
            Write-Host "=== Job 14 Processing ===" -ForegroundColor Green
            Select-String -Path $logs.FullName -Pattern "job.*14|utterance.*14" -CaseSensitive:$false | Select-Object -Last 50
            break
        }
    }
}
```

### 3. 检查NMT的输入输出（包括context_text）

```powershell
# 查找NMT相关的日志
$logDirs = @("$env:APPDATA\electron-node\logs", "$env:LOCALAPPDATA\electron-node\logs")
foreach ($dir in $logDirs) {
    if (Test-Path $dir) {
        $logs = Get-ChildItem -Path $dir -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($logs) {
            Write-Host "=== NMT Input/Output ===" -ForegroundColor Green
            Select-String -Path $logs.FullName -Pattern "TranslationStage.*NMT|context_text|textToTranslate|NMT service returned" -CaseSensitive:$false | Select-Object -Last 100
            break
        }
    }
}
```

### 4. 检查文本聚合和合并

```powershell
# 查找聚合相关的日志
$logDirs = @("$env:APPDATA\electron-node\logs", "$env:LOCALAPPDATA\electron-node\logs")
foreach ($dir in $logDirs) {
    if (Test-Path $dir) {
        $logs = Get-ChildItem -Path $dir -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($logs) {
            Write-Host "=== Aggregation and Merge ===" -ForegroundColor Green
            Select-String -Path $logs.FullName -Pattern "MERGE|aggregatedText|isLastInMergedGroup|Text aggregated" -CaseSensitive:$false | Select-Object -Last 100
            break
        }
    }
}
```

### 5. 检查去重逻辑

```powershell
# 查找去重相关的日志
$logDirs = @("$env:APPDATA\electron-node\logs", "$env:LOCALAPPDATA\electron-node\logs")
foreach ($dir in $logDirs) {
    if (Test-Path $dir) {
        $logs = Get-ChildItem -Path $dir -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($logs) {
            Write-Host "=== Deduplication ===" -ForegroundColor Green
            Select-String -Path $logs.FullName -Pattern "DedupStage|duplicate|shouldSend" -CaseSensitive:$false | Select-Object -Last 50
            break
        }
    }
}
```

### 6. 检查顺序执行状态

```powershell
# 查找顺序执行相关的日志
$logDirs = @("$env:APPDATA\electron-node\logs", "$env:LOCALAPPDATA\electron-node\logs")
foreach ($dir in $logDirs) {
    if (Test-Path $dir) {
        $logs = Get-ChildItem -Path $dir -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($logs) {
            Write-Host "=== Sequential Execution ===" -ForegroundColor Green
            Select-String -Path $logs.FullName -Pattern "SequentialExecutor.*Starting|SequentialExecutor.*completed|SequentialExecutor.*enqueued" -CaseSensitive:$false | Select-Object -Last 100
            break
        }
    }
}
```

## 需要检查的关键信息

### 对于job7（翻译重复的问题）：

1. **ASR输出**：原始识别文本是什么？
2. **聚合结果**：是否被合并？合并后的文本是什么？
3. **语义修复**：修复后的文本是什么？
4. **NMT输入**：
   - `textToTranslate`：要翻译的文本
   - `context_text`：上下文文本（上一个utterance的原文）
5. **NMT输出**：翻译结果是什么？是否有重复？
6. **去重检查**：是否被过滤？

### 对于job14（"重复的翻译"的问题）：

1. **job_id**：是否被重复处理？
2. **去重检查**：DedupStage是否检测到重复？
3. **是否发送**：`shouldSend`的值是什么？

### 对于整体翻译质量差的问题：

1. **context_text**：每个NMT任务获取的context_text是什么？
2. **顺序执行**：任务是否按正确顺序执行？
3. **文本合并**：哪些job被合并了？合并后的文本是否连贯？

## 可能的问题点

1. **job7翻译重复**：
   - NMT服务返回了重复结果
   - 或者同一个文本被翻译了两次
   - 或者文本合并时包含了重复内容

2. **job14"重复的翻译"**：
   - DedupStage没有正确工作
   - 或者同一个job被处理了多次

3. **整体翻译质量差**：
   - context_text不正确（顺序执行导致）
   - 或者文本合并有问题
