# AggregatorMiddleware vs AggregationStage 分析

## 概述

本文档分析备份文件中的 `AggregatorMiddleware` 和 `AggregationStage` 的作用，以及为什么移除 `AggregatorMiddleware` 会对翻译效果产生重大影响。

## 备份文件中的实现

### 1. AggregatorMiddleware（备份）

**位置**：`processASRResult()` 方法在 ASR 结果之后、NMT 之前被调用

**主要功能**：

1. **文本聚合**：
   - 调用 `AggregatorManager.processUtterance()` 进行聚合
   - 决定 MERGE / NEW_STREAM 动作
   - 处理 pending text 的提交

2. **去重处理**（关键功能）：
   - 使用 `DeduplicationHandler.isDuplicate()` 检查重复
   - 维护 `lastSentText` Map，记录每个 session 最后**实际发送**的文本
   - 去重逻辑包括：
     - **完全相同的文本**：直接过滤，返回空结果
     - **子串重复**：
       - 当前文本是上次文本的子串 → 过滤
       - 上次文本是当前文本的子串 → 过滤
     - **重叠检测**（hangover 导致的重复）：
       - 检测句子开头/结尾的重叠（最多50个字符）
       - 如果检测到重叠，返回去重后的文本（而不是完全过滤）
     - **高相似度文本**：相似度 > 0.95 → 过滤

3. **关键特性**：
   - `lastSentText` 是在**成功发送后**通过 `setLastSentText()` 更新的
   - 这意味着它记录的是**实际发送给调度服务器的文本**，而不是聚合后的文本
   - 去重是基于**实际发送的文本**进行的，确保不会重复发送相同的文本

### 2. AggregationStage（备份）

**位置**：在 `PostProcessCoordinator` 中，ASR 之后、语义修复之前

**主要功能**：

1. **文本聚合**：
   - 调用 `AggregatorManager.processUtterance()` 进行聚合
   - 决定 MERGE / NEW_STREAM 动作

2. **向前合并和去重**：
   - 使用 `TextForwardMergeManager.processText()` 进行向前合并
   - 获取 `previousText` 从 `aggregatorManager.getLastCommittedText()`
   - 使用 `dedupMergePrecise()` 进行去重（基于字符匹配）

3. **关键特性**：
   - `getLastCommittedText()` 返回的是 `recentCommittedText`，即**最近提交的文本**
   - 这个文本是聚合器内部的状态，不一定是实际发送的文本

## 当前实现

### AggregationStage（当前）

**主要功能**：

1. **文本聚合**：
   - 调用 `AggregatorManager.processUtterance()` 进行聚合
   - 决定 MERGE / NEW_STREAM 动作

2. **向前合并和去重**：
   - 使用 `TextForwardMergeManager.processText()` 进行向前合并
   - 获取 `previousText`：
     - 优先使用 `aggregatorMiddleware.getLastSentText()`（如果提供了 `AggregatorMiddleware`）
     - 否则使用 `aggregatorManager.getLastCommittedText()`
   - 使用 `dedupMergePrecise()` 进行去重

3. **关键问题**：
   - 如果没有 `AggregatorMiddleware`，`previousText` 来自 `getLastCommittedText()`
   - `getLastCommittedText()` 返回的是 `recentCommittedText`，这是聚合器内部状态
   - **问题**：`recentCommittedText` 可能不是实际发送的文本，导致去重不准确

## 为什么移除 AggregatorMiddleware 会影响翻译效果？

### 1. 去重逻辑的差异

**备份实现（AggregatorMiddleware）**：
- 基于**实际发送的文本**（`lastSentText`）进行去重
- 去重逻辑更全面：
  - 完全相同的文本 → 过滤
  - 子串重复 → 过滤
  - 重叠检测 → 返回去重后的文本
  - 高相似度 → 过滤

**当前实现（AggregationStage）**：
- 基于**最近提交的文本**（`recentCommittedText`）进行去重
- 去重逻辑较简单：
  - 使用 `dedupMergePrecise()` 进行边界重叠裁剪
  - 检测完全包含的情况
  - 但**缺少**子串重复检测和高相似度检测

### 2. 去重时机的问题

**备份实现**：
- 去重在 `processASRResult()` 中进行，在 NMT 之前
- 如果检测到重复，直接返回空结果，不进行 NMT/TTS
- `lastSentText` 在成功发送后更新，确保记录的是实际发送的文本

**当前实现**：
- 去重在 `AggregationStage` 中进行，在语义修复之前
- 如果检测到重复，可能仍然会进行后续处理（取决于 `TextForwardMergeManager` 的逻辑）
- `recentCommittedText` 在聚合器内部更新，可能不是实际发送的文本

### 3. 具体影响

1. **重复文本没有被正确过滤**：
   - 例如："这次任务能反复正确的结果" 重复出现
   - 备份实现会检测到这是重复文本并过滤
   - 当前实现可能没有检测到，导致重复翻译

2. **去重不准确**：
   - `recentCommittedText` 可能不是实际发送的文本
   - 导致去重基于错误的参考文本，无法正确检测重复

3. **缺少子串重复检测**：
   - 备份实现会检测子串重复（如 "继续" 是 "继续使用" 的子串）
   - 当前实现可能没有这个检测，导致短句重复

## 解决方案

### 方案1：恢复 AggregatorMiddleware 的去重逻辑

在 `AggregationStage` 中集成 `DeduplicationHandler` 的逻辑：

1. 维护 `lastSentText` Map，记录实际发送的文本
2. 在 `PostProcessCoordinator` 成功发送后，更新 `lastSentText`
3. 在 `AggregationStage` 中使用 `lastSentText` 进行去重

### 方案2：改进当前去重逻辑

1. 在 `TextForwardMergeManager` 或 `dedupMergePrecise` 中添加：
   - 子串重复检测
   - 高相似度检测
   - 完全相同的文本检测

2. 确保 `previousText` 来自实际发送的文本，而不是聚合器内部状态

### 方案3：混合方案

1. 保留 `AggregationStage` 的聚合逻辑
2. 添加 `DeduplicationHandler` 的去重逻辑
3. 在 `PostProcessCoordinator` 中维护 `lastSentText`
4. 在 `AggregationStage` 中使用 `lastSentText` 进行去重

## 建议

**推荐方案3（混合方案）**：
- 保留当前的架构（`AggregationStage` 在 `PipelineOrchestrator` 中）
- 添加 `DeduplicationHandler` 的去重逻辑
- 在 `PostProcessCoordinator` 中维护 `lastSentText`
- 在 `AggregationStage` 中使用 `lastSentText` 进行去重

这样可以：
1. 保持当前架构的清晰性
2. 恢复备份实现中有效的去重逻辑
3. 确保去重基于实际发送的文本，而不是聚合器内部状态
