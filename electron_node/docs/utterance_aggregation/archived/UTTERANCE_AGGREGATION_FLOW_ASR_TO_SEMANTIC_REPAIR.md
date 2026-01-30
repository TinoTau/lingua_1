# 节点端ASR处理后到语义修复之间的Utterance聚合流程技术文档

## ⚠️ 文档状态：已归档

**归档日期**: 2026-01-24  
**归档原因**: 部分内容已过期（shouldCommit 相关逻辑）  
**当前有效文档**: `../SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

**注意**: 流程说明仍然有效，但 shouldCommit 相关逻辑已移除。

---

## 文档信息
- **文档版本**: v1.0
- **创建日期**: 2026-01-24
- **归档日期**: 2026-01-24
- **适用范围**: 节点端（electron-node）utterance聚合处理流程
- **审核状态**: 待决策部门审议

---

## 1. 概述

本文档详细描述节点端从ASR（自动语音识别）处理完成后，到语义修复（Semantic Repair）服务之间的完整utterance聚合流程和代码逻辑。该流程负责将ASR识别的文本片段进行智能聚合、去重和合并，确保最终发送给语义修复服务的文本完整、准确且无重复。

### 1.1 流程范围

- **起点**: ASR处理完成，获得`text_asr`结果
- **终点**: 语义修复服务接收聚合后的文本
- **主要组件**: 
  - `AggregationStage` - 文本聚合阶段
  - `AggregatorManager` / `AggregatorState` - 聚合状态管理
  - `DeduplicationHandler` - 去重处理器
  - `TextForwardMergeManager` - 向前合并管理器
  - `PostProcessSemanticRepairHandler` - 语义修复处理器

---

## 2. 整体架构与调用链

### 2.1 主流程调用链

```
PipelineOrchestrator (job-pipeline.ts)
  └─> runAggregationStep (aggregation-step.ts)
      └─> AggregationStage.process()
          ├─> AggregatorManager.processUtterance()
          │   └─> AggregatorState.processUtterance()
          │       ├─> UtteranceProcessor.processUtterance()
          │       ├─> ActionDecider.decideAction()
          │       ├─> TextProcessor.processText()
          │       ├─> PendingManager.handleMerge() / handleNewStream()
          │       └─> CommitHandler.decideCommit()
          ├─> DeduplicationHandler.isDuplicate()
          └─> TextForwardMergeManager.processText()
  └─> runSemanticRepairStep (semantic-repair-step.ts)
      └─> SemanticRepairStage.process()
```

### 2.2 关键文件位置

| 组件 | 文件路径 | 职责 |
|------|---------|------|
| 聚合步骤入口 | `pipeline/steps/aggregation-step.ts` | 调用AggregationStage |
| 聚合阶段 | `agent/postprocess/aggregation-stage.ts` | 协调聚合、去重、合并逻辑 |
| 聚合管理器 | `aggregator/aggregator-manager.ts` | 管理多个session的聚合状态 |
| 聚合状态 | `aggregator/aggregator-state.ts` | 单个session的聚合状态和逻辑 |
| 去重处理器 | `agent/aggregator-middleware-deduplication.ts` | 检测和过滤重复文本 |
| 向前合并管理器 | `agent/postprocess/text-forward-merge-manager.ts` | 处理短文本合并和长度判断 |
| 语义修复步骤 | `pipeline/steps/semantic-repair-step.ts` | 调用语义修复服务 |

---

## 3. 详细流程分析

### 3.1 阶段一：AggregationStage处理（aggregation-stage.ts）

#### 3.1.1 入口方法：`AggregationStage.process()`

**方法签名**:
```typescript
process(job: JobAssignMessage, result: JobResult): AggregationStageResult
```

**处理步骤**:

1. **前置检查** (行44-86)
   - 检查`aggregatorManager`是否存在，不存在则直接返回原始ASR文本
   - 检查`session_id`是否有效
   - 检查ASR文本是否为空，为空则返回空结果（避免从pending text中返回之前缓存的文本）

2. **提取元数据** (行88-121)
   - 提取`segments`（用于计算时间戳）
   - 提取语言概率信息（`language_probabilities`）
   - 确定源语言（双向模式下使用检测到的语言或`lang_a`）

3. **调用AggregatorManager** (行133-143)
   ```typescript
   const aggregatorResult = this.aggregatorManager.processUtterance(
     job.session_id,
     asrTextTrimmed,
     segments,
     langProbs,
     result.quality_score,
     true,  // isFinal: P0 只处理 final 结果
     isManualCut,
     mode,
     isTimeoutTriggered
   );
   ```

4. **处理聚合结果** (行145-216)
   - **MERGE操作**: 
     - 如果是合并组中的最后一个utterance（`isLastInMergedGroup === true`）且触发提交，返回聚合后的文本
     - 否则返回空文本（将被发送给调度服务器核销）
   - **NEW_STREAM操作**: 
     - 返回原始ASR文本（不包含之前被合并的文本）

5. **去重处理** (行218-277)
   - 使用`DeduplicationHandler.isDuplicate()`检查：
     - 完全重复：返回空文本
     - 重叠去重：使用去重后的文本
     - 子串重复：过滤掉

6. **向前合并处理** (行313-340)
   - 使用`TextForwardMergeManager.processText()`处理：
     - 边界重叠裁剪
     - 长度判断（< 6字符丢弃，6-20字符等待合并，> 10字符发送给语义修复）

#### 3.1.2 关键逻辑点

- **空ASR结果处理** (行69-86): 如果ASR文本为空，直接返回空结果，不调用aggregatorManager，避免从pending text中返回之前缓存的文本导致重复输出
- **合并组逻辑** (行152-191): 只有合并组中的最后一个utterance才返回聚合后的文本，其他被合并的utterance返回空文本
- **去重优先级** (行280-290): 优先使用`DeduplicationHandler.getLastSentText()`，其次使用`AggregatorMiddleware.getLastSentText()`，最后使用`AggregatorManager.getLastCommittedText()`

---

### 3.2 阶段二：AggregatorManager处理（aggregator-manager.ts）

#### 3.2.1 入口方法：`AggregatorManager.processUtterance()`

**方法签名**:
```typescript
processUtterance(
  sessionId: string,
  text: string,
  segments: SegmentInfo[] | undefined,
  langProbs: { top1: string; p1: number; top2?: string; p2?: number },
  qualityScore: number | undefined,
  isFinal: boolean = false,
  isManualCut: boolean = false,
  mode: Mode = 'offline',
  isTimeoutTriggered: boolean = false
): AggregatorCommitResult
```

**处理步骤**:

1. **获取或创建AggregatorState** (行86)
   ```typescript
   const state = this.getOrCreateState(sessionId, mode);
   ```
   - 每个`sessionId`都有独立的`AggregatorState`实例
   - 支持TTL和LRU回收过期会话

2. **委托给AggregatorState处理** (行87-95)
   ```typescript
   return state.processUtterance(
     text, segments, langProbs, qualityScore,
     isFinal, isManualCut, isTimeoutTriggered
   );
   ```

---

### 3.3 阶段三：AggregatorState处理（aggregator-state.ts）

#### 3.3.1 入口方法：`AggregatorState.processUtterance()`

**方法签名**:
```typescript
processUtterance(
  text: string,
  segments: SegmentInfo[] | undefined,
  langProbs: { top1: string; p1: number; top2?: string; p2?: number },
  qualityScore: number | undefined,
  isFinal: boolean = false,
  isManualCut: boolean = false,
  isTimeoutTriggered: boolean = false
): AggregatorCommitResult
```

**处理步骤**:

1. **Utterance预处理** (行157-167)
   ```typescript
   const utteranceResult = this.utteranceProcessor.processUtterance(
     text, segments, langProbs, qualityScore,
     isFinal, isManualCut, isTimeoutTriggered,
     this.sessionStartTimeMs, this.lastUtteranceEndTimeMs
   );
   ```
   - 计算utterance的时间戳（startMs, endMs, gapMs）
   - 构建`UtteranceInfo`对象

2. **动作决策** (行185)
   ```typescript
   const action = this.actionDecider.decideAction(this.lastUtterance, curr);
   ```
   - 决定是`MERGE`（合并）还是`NEW_STREAM`（新流）
   - 基于时间间隔、文本相似度等判断

3. **文本处理** (行218-236)
   ```typescript
   const textProcessResult = this.textProcessor.processText(
     action, utteranceResult.processedText,
     this.lastUtterance, this.tailBuffer
   );
   ```
   - 处理文本合并和去重
   - 更新tail buffer（用于处理句子边界）

4. **Pending文本管理** (行238-315)
   - **MERGE操作**: 
     ```typescript
     pendingUpdateResult = this.pendingManager.handleMerge(
       processedText, this.pendingText, curr,
       startMs, endMs, isFirstInMergedGroup
     );
     ```
   - **NEW_STREAM操作**: 
     ```typescript
     pendingUpdateResult = this.pendingManager.handleNewStream(
       processedText, this.pendingText, this.tailBuffer
     );
     ```
     - 如果之前的pendingText存在，先提交之前的文本（用于去重）

5. **提交决策** (行324-365)
   ```typescript
   const commitDecision = this.commitHandler.decideCommit(
     action, this.pendingText, this.lastCommitTsMs, nowMs,
     mergeGroupState.mergeGroupStartTimeMs,
     isFinal, isManualCut, isTimeoutTriggered
   );
   ```
   - 判断是否需要提交pending文本
   - 触发条件：
     - 手动发送（`isManualCut`）
     - 10秒超时（`isTimeoutTriggered`）
     - 原有提交条件（文本长度、时间间隔等）
     - `isFinal`（最终结果）

6. **执行提交** (行372-430)
   ```typescript
   if (shouldCommitNow && this.pendingText) {
     const commitResult = this.commitExecutor.executeCommit(
       this.pendingText, this.tailBuffer, isFinal,
       isManualCut, qualityScore, gapMs,
       commitByManualCut, commitByTimeout
     );
     commitText = commitResult.commitText;
     // 清空pendingText
     this.pendingText = '';
   }
   ```

#### 3.3.2 关键逻辑点

- **合并组管理** (行195-200): 使用`MergeGroupManager`判断是否是合并组中的第一个utterance
- **NEW_STREAM时提交之前的pendingText** (行259-302): 确保之前的文本被记录到`recentCommittedText`中，用于去重
- **强制提交final结果** (行400-430): 如果是final但没有触发commit，强制提交pending文本

---

### 3.4 阶段四：去重处理（aggregator-middleware-deduplication.ts）

#### 3.4.1 入口方法：`DeduplicationHandler.isDuplicate()`

**方法签名**:
```typescript
isDuplicate(
  sessionId: string,
  text: string,
  jobId?: string,
  utteranceIndex?: number
): { isDuplicate: boolean; reason?: string; deduplicatedText?: string }
```

**检查类型**:

1. **完全重复** (行119-133)
   - 规范化后文本完全相同
   - 返回`{ isDuplicate: true, reason: 'same_as_last_sent' }`

2. **子串重复** (行136-150)
   - 当前文本是前一个utterance的子串（长度>=3）
   - 返回`{ isDuplicate: true, reason: 'substring_of_last_sent' }`

3. **重叠检测** (行54-99)
   - 检测句子开头/结尾的重叠（由于hangover导致的重复）
   - 返回去重后的文本：`{ deduplicatedText: string }`

4. **高相似度检测** (行152-178)
   - 相似度>=0.9且长度差异<=20%
   - 返回`{ isDuplicate: true, reason: 'high_similarity' }`

#### 3.4.2 关键逻辑点

- **文本规范化** (行17-19): 去除所有空白字符，统一格式
- **重叠检测算法** (行54-99): 从最长匹配开始，逐步缩短，最多检查50个字符
- **lastSentText管理** (行9-12): 使用Map存储每个session的最后发送文本，支持TTL清理

---

### 3.5 阶段五：向前合并处理（text-forward-merge-manager.ts）

#### 3.5.1 入口方法：`TextForwardMergeManager.processText()`

**方法签名**:
```typescript
processText(
  sessionId: string,
  currentText: string,
  previousText: string | null,
  jobId: string,
  utteranceIndex: number,
  isManualCut: boolean = false
): ForwardMergeResult
```

**处理步骤**:

1. **检查待合并文本** (行84-128)
   - 如果存在pending文本且（手动截断或超时），处理pending文本
   - 如果有currentText，先尝试与pending文本合并

2. **去重合并** (行133-150)
   ```typescript
   const dedupResult = dedupMergePrecise(
     pending.text, currentText, this.dedupConfig
   );
   const mergedText = dedupResult.deduped 
     ? pending.text + dedupResult.text
     : pending.text + currentText;
   ```

3. **长度判断** (行152-200)
   - 使用`TextForwardMergeLengthDecider`判断：
     - **< 6字符**: `shouldDiscard = true`（丢弃）
     - **6-20字符**: `shouldWaitForMerge = true`（等待合并，3秒超时）
     - **20-40字符**: 等待3秒确认是否有后续输入
     - **> 40字符**: `shouldSendToSemanticRepair = true`（强制发送）

4. **边界重叠裁剪** (行202-250)
   - 如果提供了`previousText`，使用`dedupMergePrecise`进行边界重叠裁剪
   - 移除与上一句重复的部分

#### 3.5.2 关键逻辑点

- **手动截断处理** (行107-128): 当`isManualCut=true`时，无论pending是否超时，都立即处理pending文本
- **长度配置** (行39-54): 从配置文件加载，支持动态调整
- **pending文本管理** (行32-37): 使用Map存储每个session的pending文本，包含超时时间

---

### 3.6 阶段六：语义修复处理（semantic-repair-step.ts）

#### 3.6.1 入口方法：`runSemanticRepairStep()`

**方法签名**:
```typescript
runSemanticRepairStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void>
```

**处理步骤**:

1. **前置检查** (行17-58)
   - 检查文本是否为空
   - 检查`SemanticRepairInitializer`是否存在
   - 初始化语义修复Stage（如果尚未初始化）

2. **获取微上下文** (行60-74)
   ```typescript
   const lastCommittedText = services.aggregatorManager.getLastCommittedText(
     job.session_id, job.utterance_index
   );
   // 限制长度：取最后150个字符
   microContext = trimmedContext.length > 150 
     ? trimmedContext.substring(trimmedContext.length - 150)
     : trimmedContext;
   ```

3. **执行语义修复** (行98-162)
   ```typescript
   const repairResult = await semanticRepairStage.process(
     jobWithDetectedLang, textToRepair, ctx.qualityScore,
     { segments, language_probability, micro_context }
   );
   ```

4. **更新committed text** (行116-138)
   ```typescript
   if (services.aggregatorManager) {
     services.aggregatorManager.updateLastCommittedTextAfterRepair(
       job.session_id, job.utterance_index,
       textToRepair, ctx.repairedText
     );
   }
   ```
   - 无论文本是否改变（PASS或REPAIR），都更新`recentCommittedText`
   - 确保后续job能正确获取上下文

#### 3.6.2 关键逻辑点

- **版本一致性检查**: 在`PostProcessSemanticRepairHandler`中检查版本是否一致（热插拔支持）
- **微上下文限制**: 限制为最后150个字符，避免上下文过长
- **更新committed text**: 语义修复后必须更新，确保后续去重和上下文正确

---

## 4. 数据流与状态管理

### 4.1 数据流转

```
ASR结果 (text_asr)
  ↓
AggregationStage.process()
  ↓
AggregatorManager.processUtterance()
  ↓
AggregatorState.processUtterance()
  ├─> 动作决策 (MERGE / NEW_STREAM)
  ├─> 文本处理 (合并、去重)
  ├─> Pending文本管理
  └─> 提交决策和执行
  ↓
DeduplicationHandler.isDuplicate()
  ├─> 完全重复 → 返回空文本
  ├─> 子串重复 → 返回空文本
  ├─> 重叠去重 → 返回去重后文本
  └─> 高相似度 → 返回空文本
  ↓
TextForwardMergeManager.processText()
  ├─> 边界重叠裁剪
  ├─> 长度判断
  └─> 待合并文本管理
  ↓
SemanticRepairStage.process()
  └─> 更新committed text
```

### 4.2 状态管理

#### 4.2.1 AggregatorState状态

- **pendingText**: 待提交的聚合文本
- **lastUtterance**: 上一个utterance信息
- **tailBuffer**: 句子边界缓冲区
- **mergeGroupState**: 合并组状态（起始utterance、时间、累计时长）

#### 4.2.2 TextForwardMergeManager状态

- **pendingTexts**: Map<sessionId, { text, waitUntil, jobId, utteranceIndex }>
  - 存储等待合并的短文本（6-20字符）
  - 3秒超时或手动截断时处理

#### 4.2.3 DeduplicationHandler状态

- **lastSentText**: Map<sessionId, string>
  - 存储每个session最后发送的文本
  - 用于去重检查
  - 10分钟TTL

---

## 5. 关键决策点与逻辑验证

### 5.1 聚合决策逻辑

#### 5.1.1 MERGE vs NEW_STREAM

**决策位置**: `AggregatorStateActionDecider.decideAction()`

**判断条件**:
- 时间间隔 < 阈值（默认3秒）
- 文本相似度 > 阈值
- 语言一致

**验证**: ✅ 逻辑清晰，无重复判断

#### 5.1.2 提交决策

**决策位置**: `AggregatorStateCommitHandler.decideCommit()`

**触发条件**:
1. 手动发送（`isManualCut = true`）
2. 10秒超时（`isTimeoutTriggered = true`）
3. 文本长度 >= 阈值
4. 时间间隔 >= 阈值
5. `isFinal = true`

**验证**: ✅ 条件明确，优先级清晰

### 5.2 去重逻辑验证

#### 5.2.1 去重检查顺序

1. **AggregationStage** (行228-277): 使用`DeduplicationHandler.isDuplicate()`
2. **TextForwardMergeManager** (行202-250): 使用`dedupMergePrecise()`进行边界重叠裁剪

**潜在问题**: ⚠️ 存在两处去重逻辑，但作用不同：
- `DeduplicationHandler`: 检查完全重复、子串重复、高相似度
- `TextForwardMergeManager`: 处理边界重叠裁剪

**验证结果**: ✅ 逻辑不重复，作用互补

#### 5.2.2 lastSentText更新时机

1. **语义修复后更新** (semantic-repair-step.ts:119-138)
   ```typescript
   services.aggregatorManager.updateLastCommittedTextAfterRepair(
     job.session_id, job.utterance_index,
     textToRepair, ctx.repairedText
   );
   ```

2. **DeduplicationHandler更新** (在结果发送后，不在本文档范围内)

**验证**: ✅ 更新时机正确，语义修复后更新确保后续去重使用修复后的文本

### 5.3 合并组逻辑验证

#### 5.3.1 合并组判断

**位置**: `AggregationStage.process()` (行152-191)

**逻辑**:
- `MERGE`操作且`isLastInMergedGroup === true`且`shouldCommit === true`: 返回聚合后的文本
- 否则: 返回空文本

**验证**: ✅ 逻辑清晰，确保只有合并组的最后一个utterance返回聚合文本

#### 5.3.2 NEW_STREAM时pendingText处理

**位置**: `AggregatorState.processUtterance()` (行259-302)

**逻辑**:
- 在NEW_STREAM时，如果之前的pendingText存在，先提交之前的文本
- 确保之前的文本被记录到`recentCommittedText`中，用于去重

**验证**: ✅ 逻辑正确，避免pendingText丢失

### 5.4 长度判断逻辑验证

#### 5.4.1 TextForwardMergeManager长度判断

**位置**: `TextForwardMergeManager.processText()` (行152-200)

**判断标准**:
- < 6字符: 丢弃
- 6-20字符: 等待合并（3秒超时）
- 20-40字符: 等待3秒确认
- > 40字符: 强制发送

**验证**: ✅ 逻辑清晰，配置可调

#### 5.4.2 手动截断处理

**位置**: `TextForwardMergeManager.processText()` (行107-128)

**逻辑**:
- 当`isManualCut=true`时，无论pending是否超时，都立即处理pending文本
- 如果有currentText，先尝试与pending文本合并

**验证**: ✅ 逻辑正确，确保手动截断时pending文本被处理

---

## 6. 潜在问题与改进建议

### 6.1 已发现的问题

#### 6.1.1 空ASR结果处理 ✅ 已修复

**问题**: 如果ASR文本为空，可能从pending text中返回之前缓存的文本，导致重复输出

**修复位置**: `AggregationStage.process()` (行69-86)

**修复逻辑**: 如果ASR文本为空，直接返回空结果，不调用aggregatorManager

#### 6.1.2 NEW_STREAM时pendingText处理 ✅ 已修复

**问题**: NEW_STREAM时，之前的pendingText可能丢失，导致去重失效

**修复位置**: `AggregatorState.processUtterance()` (行259-302)

**修复逻辑**: 在NEW_STREAM时，先提交之前的pendingText，确保被记录到recentCommittedText中

### 6.2 代码逻辑一致性验证

#### 6.2.1 去重逻辑一致性 ✅

- `DeduplicationHandler`: 处理完全重复、子串重复、高相似度
- `TextForwardMergeManager`: 处理边界重叠裁剪
- **结论**: 逻辑不重复，作用互补

#### 6.2.2 合并组逻辑一致性 ✅

- `AggregationStage`: 只有合并组的最后一个utterance返回聚合文本
- `AggregatorState`: 正确设置`isLastInMergedGroup`标志
- **结论**: 逻辑一致，无矛盾

#### 6.2.3 提交决策一致性 ✅

- `AggregatorState`: 根据多个条件判断是否提交
- `TextForwardMergeManager`: 根据长度判断是否发送给语义修复
- **结论**: 逻辑一致，无冲突

---

## 7. 方法调用链详细清单

### 7.1 完整调用链

```
1. runJobPipeline (job-pipeline.ts:43)
   └─> 2. runAggregationStep (aggregation-step.ts:13)
       └─> 3. AggregationStage.process() (aggregation-stage.ts:44)
           ├─> 4. AggregatorManager.processUtterance() (aggregator-manager.ts:75)
           │   └─> 5. AggregatorState.processUtterance() (aggregator-state.ts:145)
           │       ├─> 6. UtteranceProcessor.processUtterance() (aggregator-state.ts:157)
           │       ├─> 7. ActionDecider.decideAction() (aggregator-state.ts:185)
           │       ├─> 8. TextProcessor.processText() (aggregator-state.ts:218)
           │       ├─> 9. PendingManager.handleMerge() / handleNewStream() (aggregator-state.ts:244/253)
           │       ├─> 10. CommitHandler.decideCommit() (aggregator-state.ts:326)
           │       └─> 11. CommitExecutor.executeCommit() (aggregator-state.ts:375)
           ├─> 12. DeduplicationHandler.isDuplicate() (aggregation-stage.ts:229)
           │   ├─> 13. normalizeText() (aggregator-middleware-deduplication.ts:17)
           │   ├─> 14. detectAndRemoveOverlap() (aggregator-middleware-deduplication.ts:54)
           │   └─> 15. calculateTextSimilarity() (aggregator-middleware-deduplication.ts:24)
           └─> 16. TextForwardMergeManager.processText() (aggregation-stage.ts:314)
               ├─> 17. dedupMergePrecise() (text-forward-merge-manager.ts:133)
               └─> 18. TextForwardMergeLengthDecider.decide() (text-forward-merge-manager.ts:152)
   └─> 19. runSemanticRepairStep (semantic-repair-step.ts:12)
       └─> 20. SemanticRepairStage.process() (semantic-repair-step.ts:99)
           └─> 21. AggregatorManager.updateLastCommittedTextAfterRepair() (semantic-repair-step.ts:119)
```

### 7.2 关键方法参数与返回值

#### 7.2.1 AggregationStage.process()

**输入**:
- `job: JobAssignMessage` - 任务消息
- `result: JobResult` - ASR结果

**输出**:
- `AggregationStageResult`:
  - `aggregatedText: string` - 聚合后的文本
  - `aggregationChanged: boolean` - 文本是否被聚合
  - `action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT'` - 聚合动作
  - `shouldSendToSemanticRepair?: boolean` - 是否应该发送给语义修复

#### 7.2.2 AggregatorState.processUtterance()

**输入**:
- `text: string` - ASR文本
- `segments: SegmentInfo[]` - 时间戳信息
- `langProbs: { top1, p1, top2?, p2? }` - 语言概率
- `qualityScore: number` - 质量分数
- `isFinal: boolean` - 是否为final
- `isManualCut: boolean` - 是否为手动截断
- `isTimeoutTriggered: boolean` - 是否为超时触发

**输出**:
- `AggregatorCommitResult`:
  - `text: string` - 提交的文本
  - `shouldCommit: boolean` - 是否应该提交
  - `action: 'MERGE' | 'NEW_STREAM'` - 动作
  - `isLastInMergedGroup?: boolean` - 是否是合并组的最后一个

#### 7.2.3 DeduplicationHandler.isDuplicate()

**输入**:
- `sessionId: string` - 会话ID
- `text: string` - 待检查文本
- `jobId?: string` - 任务ID
- `utteranceIndex?: number` - Utterance索引

**输出**:
- `{ isDuplicate: boolean, reason?: string, deduplicatedText?: string }`

#### 7.2.4 TextForwardMergeManager.processText()

**输入**:
- `sessionId: string` - 会话ID
- `currentText: string` - 当前文本
- `previousText: string | null` - 上一个已提交文本
- `jobId: string` - 任务ID
- `utteranceIndex: number` - Utterance索引
- `isManualCut: boolean` - 是否为手动截断

**输出**:
- `ForwardMergeResult`:
  - `processedText: string` - 处理后的文本
  - `shouldDiscard: boolean` - 是否应该丢弃
  - `shouldWaitForMerge: boolean` - 是否应该等待合并
  - `shouldSendToSemanticRepair: boolean` - 是否应该发送给语义修复

---

## 8. 配置参数

### 8.1 AggregatorState配置

- **时间间隔阈值**: 默认3秒（用于判断MERGE vs NEW_STREAM）
- **提交条件**: 文本长度、时间间隔等（在`AggregatorTuning`中配置）

### 8.2 TextForwardMergeManager配置

- **minLengthToKeep**: 6字符（最小保留长度）
- **minLengthToSend**: 20字符（最小发送长度）
- **maxLengthToWait**: 40字符（最大等待长度）
- **waitTimeoutMs**: 3000ms（等待超时时间）

### 8.3 DeduplicationHandler配置

- **LAST_SENT_TEXT_TTL_MS**: 10分钟（最后发送文本的TTL）
- **相似度阈值**: 0.9（高相似度判断）
- **重叠检测最大长度**: 50字符

---

## 9. 日志与调试

### 9.1 关键日志点

1. **AggregationStage**:
   - `AggregationStage: MERGE action, last in merged group, returning aggregated text`
   - `AggregationStage: Duplicate text detected by DeduplicationHandler, filtering`
   - `AggregationStage: Processing completed with forward merge`

2. **AggregatorState**:
   - `AggregatorState: MERGE action, checking isFirstInMergedGroup`
   - `AggregatorState: MERGE action, isLastInMergedGroup determination`

3. **TextForwardMergeManager**:
   - `TextForwardMergeManager: Checking pending text`
   - `TextForwardMergeManager: Manual cut detected, will merge pending text`

4. **SemanticRepairStep**:
   - `runSemanticRepairStep: Semantic repair completed`
   - `runSemanticRepairStep: Updated recentCommittedText with repaired text`

---

## 10. 总结

### 10.1 流程完整性 ✅

从ASR处理完成后到语义修复服务之间的utterance聚合流程完整，包含：
1. 聚合决策（MERGE / NEW_STREAM）
2. 文本合并和去重
3. 长度判断和待合并文本管理
4. 边界重叠裁剪
5. 语义修复前的最终处理

### 10.2 代码逻辑一致性 ✅

经过详细分析，代码逻辑无重复或矛盾：
- 去重逻辑：`DeduplicationHandler`和`TextForwardMergeManager`作用互补
- 合并组逻辑：`AggregationStage`和`AggregatorState`逻辑一致
- 提交决策：条件明确，优先级清晰

### 10.3 潜在问题 ✅

已发现的问题均已修复：
- 空ASR结果处理
- NEW_STREAM时pendingText处理
- 语义修复后committed text更新

### 10.4 建议

1. **性能优化**: 考虑缓存`DeduplicationHandler`的规范化文本结果
2. **配置灵活性**: 所有阈值参数应从配置文件加载，支持动态调整
3. **监控指标**: 增加聚合、去重、合并的统计指标，便于监控和优化

---

## 附录：相关文件清单

### 核心文件
- `pipeline/steps/aggregation-step.ts` - 聚合步骤入口
- `agent/postprocess/aggregation-stage.ts` - 聚合阶段主逻辑
- `aggregator/aggregator-manager.ts` - 聚合管理器
- `aggregator/aggregator-state.ts` - 聚合状态管理
- `agent/aggregator-middleware-deduplication.ts` - 去重处理器
- `agent/postprocess/text-forward-merge-manager.ts` - 向前合并管理器
- `pipeline/steps/semantic-repair-step.ts` - 语义修复步骤

### 辅助文件
- `aggregator/aggregator-state-utterance-processor.ts` - Utterance预处理
- `aggregator/aggregator-state-action-decider.ts` - 动作决策器
- `aggregator/aggregator-state-text-processor.ts` - 文本处理器
- `aggregator/aggregator-state-pending-manager.ts` - Pending文本管理器
- `aggregator/aggregator-state-commit-handler.ts` - 提交决策处理器
- `aggregator/aggregator-state-commit-executor.ts` - 提交执行器

---

**文档结束**
