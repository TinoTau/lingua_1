# Job11 合并流程分析

## 问题描述

用户反馈：job11使用了手动发送进行截断，但结果还是被合并在一起返回。用户认为如果手动截断，说明这句话完整，不需要等待合并。

## 可能的合并场景

### 场景1：AudioAggregator向后合并（ASR之前）

**流程**：
1. 用户连续发送多段音频（例如：音频块A、音频块B、音频块C）
2. AudioAggregator将这些音频块向后合并（合并到最后一个）
3. 合并后的音频发送给ASR
4. ASR输出一个完整的文本（job11的ASR结果）

**日志关键词**：
- `AudioAggregator: Audio chunk added to buffer`
- `AudioAggregator: Aggregated audio ready for ASR`
- `PipelineOrchestrator: Aggregated audio ready for ASR`

**如何确认**：
- 查看日志中是否有多个音频块被添加到同一个buffer
- 查看`totalDurationMs`是否累积增加
- 查看最终发送给ASR的音频是否包含多个chunk

### 场景2：TextForwardMergeManager向前合并（ASR之后）

**流程**：
1. job11的ASR文本长度在6-16字符之间
2. TextForwardMergeManager将其标记为`shouldWaitForMerge=true`
3. job11的文本被保存到`pendingTexts`中，等待3秒
4. 下一个utterance（例如job12）到达
5. TextForwardMergeManager检测到有pending text，将其与job12的文本合并
6. 合并后的文本长度>16字符，发送给语义修复

**日志关键词**：
- `TextForwardMergeManager: Processed text length 6-16, waiting for merge`
- `TextForwardMergeManager: Merged pending text with current text`
- `AggregationStage: Processing completed with forward merge`

**如何确认**：
- 查看job11的ASR文本长度
- 查看是否有`shouldWaitForMerge: true`的日志
- 查看是否有`Merged pending text with current text`的日志
- 查看`pendingUtteranceIndex`和`currentUtteranceIndex`

## 查看日志的方法

### 1. 查找job11的ASR处理日志

```bash
# 查找job11相关的ASR日志
grep -i "job.*11\|utterance.*11" node.log | grep -i "asr\|aggregation"
```

**关键信息**：
- job11的ASR文本内容
- job11的ASR文本长度
- `aggregatedTextLength`
- `shouldWaitForMerge`
- `shouldSendToSemanticRepair`

### 2. 查找AudioAggregator的合并日志

```bash
# 查找job11相关的音频聚合日志
grep -i "job.*11\|utterance.*11" node.log | grep -i "AudioAggregator"
```

**关键信息**：
- 有多少个音频块被添加到buffer
- `totalDurationMs`的变化
- `isManualCut`的值
- 是否触发了短句延迟合并

### 3. 查找TextForwardMergeManager的合并日志

```bash
# 查找job11相关的文本合并日志
grep -i "job.*11\|utterance.*11" node.log | grep -i "TextForwardMergeManager\|Merged pending"
```

**关键信息**：
- `pendingText`的内容和长度
- `currentText`的内容和长度
- `mergedText`的内容和长度
- `pendingUtteranceIndex`和`currentUtteranceIndex`

### 4. 查找AggregationStage的处理日志

```bash
# 查找job11相关的聚合阶段日志
grep -i "job.*11\|utterance.*11" node.log | grep -i "AggregationStage"
```

**关键信息**：
- `aggregatedText`的内容
- `forwardMergeResult`的各个标志
- `finalAggregatedText`的内容

## 分析步骤

### 步骤1：确认job11的ASR文本长度

查看日志中job11的ASR结果：
- 如果`aggregatedTextLength`在6-16字符之间，会被标记为`shouldWaitForMerge=true`
- 如果`aggregatedTextLength`>16字符，会直接发送给语义修复

### 步骤2：确认是否有pending text

查看日志中是否有：
- `TextForwardMergeManager: Processed text length 6-16, waiting for merge`
- 如果有，说明job11的文本被保存为pending text

### 步骤3：确认是否与下一个utterance合并

查看日志中是否有：
- `TextForwardMergeManager: Merged pending text with current text`
- 查看`pendingUtteranceIndex`是否为11
- 查看`currentUtteranceIndex`是否为下一个utterance的索引

### 步骤4：确认AudioAggregator的合并

查看日志中是否有：
- 多个音频块被添加到同一个buffer
- `totalDurationMs`累积增加
- 最终发送给ASR的音频包含多个chunk

## 可能的解决方案

### 方案1：在TextForwardMergeManager中检查isManualCut

如果job11使用了手动截断（`isManualCut=true`），即使文本长度在6-16字符之间，也应该直接发送给语义修复，不等待合并。

**修改位置**：
- `TextForwardMergeManager.processText`：添加`isManualCut`参数
- `AggregationStage.process`：传递`isManualCut`给`TextForwardMergeManager`

### 方案2：在AudioAggregator中检查isManualCut

如果job11使用了手动截断，AudioAggregator应该立即处理，不等待后续音频块。

**当前逻辑**：
- AudioAggregator已经检查`isManualCut`，如果为true会立即处理
- 但短句延迟合并逻辑可能会覆盖这个行为

## 建议的日志查询命令

```bash
# 1. 查找job11的所有相关日志
grep -i "job.*11\|utterance.*11" node.log

# 2. 查找job11的ASR处理
grep -i "job.*11" node.log | grep -i "ASR\|aggregation"

# 3. 查找job11的文本合并
grep -i "job.*11\|utterance.*11" node.log | grep -i "TextForwardMergeManager\|Merged pending"

# 4. 查找job11的音频聚合
grep -i "job.*11\|utterance.*11" node.log | grep -i "AudioAggregator"

# 5. 查找job11的手动截断标志
grep -i "job.*11" node.log | grep -i "manual.*cut\|isManualCut"
```

## 关键日志字段

### AggregationStage日志
- `jobId`: job的ID
- `utteranceIndex`: utterance的索引
- `aggregatedTextLength`: 聚合后的文本长度
- `shouldWaitForMerge`: 是否等待合并
- `shouldSendToSemanticRepair`: 是否发送给语义修复

### TextForwardMergeManager日志
- `pendingText`: 待合并的文本
- `currentText`: 当前文本
- `mergedText`: 合并后的文本
- `pendingUtteranceIndex`: 待合并文本的utterance索引
- `currentUtteranceIndex`: 当前文本的utterance索引

### AudioAggregator日志
- `totalDurationMs`: 总音频时长
- `chunkCount`: 音频块数量
- `isManualCut`: 是否手动截断
- `shortUtteranceWaitUntil`: 短句等待截止时间
