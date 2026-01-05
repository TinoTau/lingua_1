# Job7和Job8去重问题分析

## 问题描述

**Web端输出**：
- Job7: "所以要这个语音阶段正常来我们就可以继续使用"
- Job8: "这个语音阶段正常来我们就可以使用这个语音阶段正常来我们可以使用"

**问题**：
1. Job8明显包含了Job7的内容（"这个语音阶段正常来我们就可以使用"）
2. Job8内部有重复（"这个语音阶段正常来我们可以使用"出现了两次）
3. 去重没有生效

## 去重流程分析

### 1. 跨utterance去重（Job7 vs Job8）

**流程**：
1. `AggregationStage.process()` 调用 `getLastCommittedText()` 获取上一个已提交的文本
2. 将 `previousText` 传递给 `TextForwardMergeManager.processText()`
3. `TextForwardMergeManager` 调用 `dedupMergePrecise(previousText, currentText)` 进行去重

**可能的问题**：
- **问题1**：Job7的文本可能还没有被commit到`recentCommittedText`
  - `updateRecentCommittedText`在`AggregatorStateCommitExecutor.executeCommit`中调用
  - 如果Job7在`AggregationStage`处理时还没有commit，`getLastCommittedText`会返回null
  - **需要检查**：Job7的commit时机和Job8的`AggregationStage`处理时机

- **问题2**：`dedupMergePrecise`没有检测到重叠
  - Job7结尾："我们就可以继续使用"
  - Job8开头："这个语音阶段正常来我们就可以使用"
  - 重叠部分："我们就可以使用"（但Job7是"继续使用"，Job8是"使用"）
  - **需要检查**：`dedupMergePrecise`的`minOverlap`配置（当前是2字符）

### 2. 内部重复检测（Job8内部重复）

**流程**：
1. `PostProcessCoordinator.process()` 在语义修复之前调用 `detectInternalRepetition()`
2. `detectInternalRepetition`检测文本内部的重复（如"再提高了一点速度 再提高了一点速度"）

**Job8的文本**：
- "这个语音阶段正常来我们就可以使用这个语音阶段正常来我们可以使用"
- 重复部分："这个语音阶段正常来我们可以使用"（出现了两次）

**可能的问题**：
- **问题1**：`detectInternalRepetition`的方法2（检测末尾重复）可能没有检测到
  - 方法2检测的是"末尾重复"（如"再提高了一点速度 再提高了一点速度"）
  - 但Job8的重复是在中间，不是末尾
  - **需要检查**：`detectInternalRepetition`的方法1（检测完全重复）是否检测到

- **问题2**：重复检测的阈值可能不合适
  - 方法1检查的是"后半部分是否以前半部分开头"
  - Job8的前半部分："这个语音阶段正常来我们就可以使用"
  - Job8的后半部分："这个语音阶段正常来我们可以使用"
  - 应该能检测到，但可能没有

## 需要检查的日志

### 1. Job7的处理流程

**关键词**：
- `job.*7|utterance.*7`
- `AggregationStage.*job.*7`
- `TextForwardMergeManager.*job.*7`
- `updateRecentCommittedText.*job.*7`

**需要确认**：
1. Job7的文本是什么？
2. Job7是否被commit到`recentCommittedText`？
3. Job7的`finalAggregatedText`是什么？

### 2. Job8的处理流程

**关键词**：
- `job.*8|utterance.*8`
- `AggregationStage.*job.*8`
- `TextForwardMergeManager.*job.*8`
- `getLastCommittedText.*job.*8`
- `dedupMergePrecise.*job.*8`
- `detectInternalRepetition.*job.*8`

**需要确认**：
1. Job8的ASR原始文本是什么？
2. `getLastCommittedText`返回了什么？（应该是Job7的文本）
3. `dedupMergePrecise`是否检测到重叠？
4. `detectInternalRepetition`是否检测到内部重复？
5. Job8的`finalAggregatedText`是什么？

## 可能的原因

### 原因1：Job7的文本还没有被commit

**场景**：
- Job7和Job8几乎同时到达`AggregationStage`
- Job7的commit发生在Job8的`getLastCommittedText`之后
- 导致`getLastCommittedText`返回null

**解决方案**：
- 确保commit在`AggregationStage`处理之前完成
- 或者在`getLastCommittedText`中考虑pending的文本

### 原因2：`dedupMergePrecise`没有检测到重叠

**场景**：
- Job7结尾："我们就可以继续使用"
- Job8开头："这个语音阶段正常来我们就可以使用"
- 重叠部分："我们就可以使用"（但Job7是"继续使用"，Job8是"使用"）
- `dedupMergePrecise`的`normalize`会移除空格，但"继续使用"和"使用"的normalize结果不同

**解决方案**：
- 改进`dedupMergePrecise`，支持部分匹配（如"继续使用"和"使用"）

### 原因3：`detectInternalRepetition`没有检测到重复

**场景**：
- Job8的文本："这个语音阶段正常来我们就可以使用这个语音阶段正常来我们可以使用"
- 前半部分："这个语音阶段正常来我们就可以使用"
- 后半部分："这个语音阶段正常来我们可以使用"
- 后半部分不完全等于前半部分（"可以" vs "可以"）

**解决方案**：
- 改进`detectInternalRepetition`，支持相似度匹配（允许少量差异）

## 建议的修复方案

### 方案1：改进`dedupMergePrecise`，支持部分匹配

**实现**：
- 不仅检测完全匹配，还检测部分匹配（如"继续使用"包含"使用"）
- 如果`prevTail`的末尾包含`currHead`的开头，或者`currHead`的开头包含`prevTail`的末尾，也认为是重叠

### 方案2：改进`detectInternalRepetition`，支持相似度匹配

**实现**：
- 不仅检测完全重复，还检测相似重复（允许少量差异）
- 使用编辑距离或相似度算法（如Levenshtein距离）

### 方案3：确保commit时机正确

**实现**：
- 确保在`AggregationStage`处理之前，上一个utterance的文本已经被commit
- 或者在`getLastCommittedText`中考虑pending的文本

## 下一步

1. **查看节点端日志**，确认Job7和Job8的处理流程
2. **分析`dedupMergePrecise`和`detectInternalRepetition`的日志**，确认是否检测到重复
3. **根据日志结果**，实施相应的修复方案
