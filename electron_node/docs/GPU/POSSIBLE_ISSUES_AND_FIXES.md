# 可能的问题和修复方案

## 问题1: job7翻译重复

### 可能原因

1. **同音字修复导致的问题**：
   - 如果job7触发了同音字修复，会对多个候选进行翻译
   - 如果`selectBestCandidate`逻辑有问题，可能会返回包含多个翻译的结果
   - 或者，如果多个候选的翻译结果被错误地拼接在一起

2. **NMT服务返回重复结果**：
   - NMT服务本身可能返回了重复的翻译
   - 需要检查NMT服务的日志

3. **文本合并问题**：
   - 如果job7被合并了，合并后的文本可能包含了重复内容
   - 或者，合并逻辑有问题，导致文本重复

### 检查方法

```powershell
# 检查job7是否触发了同音字修复
Select-String -Path $logFile -Pattern "job.*7.*homophone|utterance.*7.*homophone" -CaseSensitive:$false

# 检查job7的NMT输入输出
Select-String -Path $logFile -Pattern "job.*7.*NMT|utterance.*7.*TranslationStage" -CaseSensitive:$false

# 检查job7是否被合并
Select-String -Path $logFile -Pattern "job.*7.*MERGE|utterance.*7.*merged" -CaseSensitive:$false
```

### 可能的修复

如果问题出在同音字修复，需要检查：
1. `selectBestCandidate`是否正确选择了最佳候选
2. 是否错误地拼接了多个翻译结果

## 问题2: job14"重复的翻译"

### 可能原因

1. **去重逻辑问题**：
   - DedupStage使用job_id进行去重
   - 但如果同一个job被处理了多次，可能会有问题
   - 或者，job_id记录时机有问题

2. **同一个job被重复提交**：
   - 调度服务器可能重复发送了同一个job
   - 或者，节点端重复处理了同一个job

### 检查方法

```powershell
# 检查job14是否被重复处理
Select-String -Path $logFile -Pattern "job.*14|utterance.*14" -CaseSensitive:$false | Group-Object Line

# 检查job14的去重检查
Select-String -Path $logFile -Pattern "job.*14.*DedupStage|job.*14.*duplicate|job.*14.*shouldSend" -CaseSensitive:$false
```

### 可能的修复

1. 确保DedupStage在正确的时候记录job_id
2. 检查是否有重复的job提交

## 问题3: 整体翻译质量差

### 可能原因

1. **context_text不正确**：
   - 如果顺序执行导致任务顺序混乱，context_text可能获取错误
   - 或者，`getLastCommittedText`返回了错误的文本

2. **文本合并问题**：
   - 合并后的文本可能不连贯
   - 或者，合并逻辑有问题

3. **顺序执行问题**：
   - 如果任务没有按正确顺序执行，可能导致context_text错误
   - 或者，任务被跳过或重复执行

### 检查方法

```powershell
# 检查每个NMT任务的context_text
Select-String -Path $logFile -Pattern "context_text|contextText" -CaseSensitive:$false | Select-Object -Last 50

# 检查顺序执行状态
Select-String -Path $logFile -Pattern "SequentialExecutor.*Starting|SequentialExecutor.*completed" -CaseSensitive:$false | Select-Object -Last 100

# 检查文本合并
Select-String -Path $logFile -Pattern "MERGE|aggregatedText|isLastInMergedGroup" -CaseSensitive:$false | Select-Object -Last 100
```

### 可能的修复

1. 确保顺序执行正确工作
2. 确保context_text正确获取
3. 检查文本合并逻辑

## 建议的修复步骤

1. **首先检查日志**：
   - 使用`CHECK_LOGS_FOR_ISSUES.md`中的命令检查日志
   - 确认每个服务的输入输出

2. **检查顺序执行**：
   - 确认任务是否按正确顺序执行
   - 检查是否有任务被跳过或重复执行

3. **检查context_text**：
   - 确认NMT获取的context_text是什么
   - 检查`getLastCommittedText`是否正确

4. **检查文本合并**：
   - 确认哪些job被合并了
   - 检查合并后的文本是否正确

5. **检查去重**：
   - 确认DedupStage是否正确工作
   - 检查是否有重复的job_id

6. **检查同音字修复**：
   - 如果job7触发了同音字修复，检查选择逻辑
   - 确认是否正确选择了最佳候选
