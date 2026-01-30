# Utterance聚合完整流程文档（ASR到语义修复）

## ⚠️ 文档状态：已归档

**归档日期**: 2026-01-24  
**归档原因**: 部分内容已过期（shouldCommit 相关逻辑已移除）  
**当前有效文档**: `../SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

---

## 文档信息
- **文档版本**: v2.0
- **创建日期**: 2026-01-24
- **归档日期**: 2026-01-24
- **适用范围**: 节点端（electron-node）utterance聚合处理流程
- **审核状态**: 待决策部门审议

## ⚠️ 过期内容说明

以下内容已过期，请勿参考：
- **第4.2节：提交决策（shouldCommit）** - shouldCommit 已完全移除
- **第5.2节：提交逻辑与等待合并逻辑不一致** - 已解决（shouldCommit 已移除）
- **第8.2节：提交决策参数** - shouldCommit 相关参数已移除

**保留内容**: 其他流程说明仍然有效，但建议参考新文档。

---

## 1. 概述

本文档详细描述节点端从ASR（自动语音识别）处理完成后，到语义修复（Semantic Repair）服务之间的完整utterance聚合流程。该流程负责将ASR识别的文本片段进行智能聚合、去重和合并，确保最终发送给语义修复服务的文本完整、准确且无重复。

### 1.1 流程范围

- **起点**: ASR处理完成，获得`ASRResult`（包含`text_asr`）
- **终点**: 语义修复服务接收聚合后的文本
- **主要阶段**:
  1. **聚合阶段**（AggregationStage）：决策MERGE/NEW_STREAM，合并多个utterance
  2. **去重阶段**（DeduplicationHandler）：检测和过滤重复文本
  3. **向前合并阶段**（TextForwardMergeManager）：处理短文本合并和长度判断
  4. **语义修复阶段**（SemanticRepairStage）：调用语义修复服务

---

## 2. 完整调用链

```
PipelineOrchestrator (job-pipeline.ts)
  └─> runAggregationStep (aggregation-step.ts)
      └─> AggregationStage.process()
          ├─> AggregatorManager.processUtterance()
          │   └─> AggregatorState.processUtterance()
          │       ├─> UtteranceProcessor.processUtterance()  // 预处理
          │       ├─> ActionDecider.decideAction()            // 决策MERGE/NEW_STREAM
          │       ├─> TextProcessor.processText()            // 文本处理和去重
          │       ├─> PendingManager.handleMerge() / handleNewStream()  // 状态管理
          │       └─> CommitHandler.decideCommit()           // 提交决策
          ├─> DeduplicationHandler.isDuplicate()            // 去重检查
          └─> TextForwardMergeManager.processText()          // 向前合并和长度判断
  └─> runSemanticRepairStep (semantic-repair-step.ts)
      └─> SemanticRepairStage.process()
          └─> 调用语义修复服务
```

---

## 3. 详细流程分析

### 3.1 阶段一：AggregationStage处理

#### 3.1.1 入口方法：`AggregationStage.process()`

**输入**:
- `job: JobAssignMessage` - 任务信息
- `result: JobResult` - ASR结果（包含`text_asr`、`segments`等）

**处理步骤**:

1. **前置检查** (行44-86)
   - 检查`aggregatorManager`是否存在
   - 检查`session_id`是否有效
   - 检查ASR文本是否为空

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
   - 如果`action === 'MERGE'`且`isLastInMergedGroup === true`：返回聚合后的文本
   - 如果`action === 'MERGE'`但`isLastInMergedGroup === false`：返回空文本（被合并的utterance）
   - 如果`action === 'NEW_STREAM'`：返回原始ASR文本

5. **去重检查** (行218-277)
   - 使用`DeduplicationHandler.isDuplicate()`检查重复
   - 如果完全重复：返回空文本
   - 如果重叠：使用去重后的文本

6. **向前合并** (行313-340)
   - 使用`TextForwardMergeManager.processText()`处理
   - 根据长度判断：丢弃、等待合并、或发送给语义修复

**输出**: `AggregationStageResult`

---

### 3.2 阶段二：AggregatorState处理（核心聚合逻辑）

#### 3.2.1 入口方法：`AggregatorState.processUtterance()`

**处理步骤**:

1. **预处理** (行157-172)
   - `UtteranceProcessor.processUtterance()`：计算时间戳、间隔等

2. **决策动作** (行185)
   - `ActionDecider.decideAction()`：决定MERGE或NEW_STREAM
   - 基于：
     - 时间间隔（gapMs）
     - 文本不完整分数（textIncompletenessScore）
     - 语言稳定性
     - 手动切分标志

3. **文本处理** (行218-236)
   - `TextProcessor.processText()`：处理文本合并和去重
   - 检测边界重叠并裁剪

4. **状态管理** (行242-303)
   - `PendingManager.handleMerge()` / `handleNewStream()`：更新`pendingText`

5. **提交决策** (行326-365)
   - `CommitHandler.decideCommit()`：判断是否应该提交
   - 基于：
     - 时间间隔（`commitIntervalMs`: 900ms）
     - 文本长度（`commitLenCjk`: 25字符）

**输出**: `AggregatorCommitResult`

---

### 3.3 阶段三：去重处理（DeduplicationHandler）

#### 3.3.1 方法：`DeduplicationHandler.isDuplicate()`

**检查类型**:

1. **完全重复** (行119-133)
   - 与上次发送的文本完全相同 → 返回`isDuplicate: true`

2. **子串重复** (行136-170)
   - 当前文本是上次文本的子串 → 返回`isDuplicate: true`
   - 上次文本是当前文本的子串 → 返回`isDuplicate: true`

3. **重叠去重** (行172-214)
   - 检测句子开头/结尾的重叠（hangover导致）
   - 返回去重后的文本（`deduplicatedText`）

4. **高相似度** (行217-231)
   - 相似度 > 0.95 → 返回`isDuplicate: true`

**输出**: `{ isDuplicate: boolean, reason?: string, deduplicatedText?: string }`

---

### 3.4 阶段四：向前合并处理（TextForwardMergeManager）

#### 3.4.1 方法：`TextForwardMergeManager.processText()`

**处理逻辑**:

1. **检查待合并文本** (行84-272)
   - 如果有待合并的文本（`pendingText`）且超时或手动切分：
     - 与当前文本去重合并
     - 判断合并后的长度

2. **处理当前文本** (行405-598)
   - 如果有`previousText`，进行去重（使用`dedupMergePrecise`）
   - 根据长度判断：
     - **< 6字符**：丢弃（`shouldDiscard: true`）
     - **6-20字符**：等待合并（`shouldWaitForMerge: true`），除非`isManualCut=true`
     - **20-40字符**：等待3秒确认是否有后续输入（`shouldWaitForMerge: true`），除非`isManualCut=true`
     - **> 40字符**：直接发送给语义修复（`shouldSendToSemanticRepair: true`）

**输出**: `ForwardMergeResult`

---

### 3.5 阶段五：语义修复处理

#### 3.5.1 入口方法：`SemanticRepairStage.process()`

**处理步骤**:

1. 获取聚合后的文本（`ctx.aggregatedText`）
2. 如果文本为空或`shouldSendToSemanticRepair=false`，跳过
3. 调用语义修复服务
4. 更新`ctx.repairedText`

---

## 4. 关键决策点

### 4.1 MERGE vs NEW_STREAM决策

**决策逻辑**（`decideStreamAction`）:

1. **强制NEW_STREAM**:
   - 没有前一个utterance
   - 手动切分（`isManualCut=true`）
   - 间隔 >= `hardGapMs`（1500ms）
   - 检测到语言切换

2. **强制MERGE**:
   - 间隔 <= `strongMergeMs`（800ms）

3. **条件MERGE**:
   - 文本不完整分数 >= 2.5 且间隔 <= `softGapMs`（1000ms）

4. **默认**: NEW_STREAM

### 4.2 提交决策（shouldCommit）

**决策逻辑**（`shouldCommit`）:

1. **时间条件**: 距离上次提交 >= `commitIntervalMs`（900ms）
2. **长度条件**: 
   - CJK文本 >= `commitLenCjk`（25字符）
   - 英文文本 >= `commitLenEnWords`（10词）

**问题**: 如果文本长度超过阈值，会立即提交，即使`shouldWaitForMerge=true`。

### 4.3 长度判断（shouldWaitForMerge）

**判断逻辑**（`TextForwardMergeManager`）:

- **< 6字符**: `shouldDiscard: true`
- **6-20字符**: `shouldWaitForMerge: true`（除非`isManualCut=true`）
- **20-40字符**: `shouldWaitForMerge: true`（等待3秒，除非`isManualCut=true`）
- **> 40字符**: `shouldSendToSemanticRepair: true`

**问题**: 与`shouldCommit`的判断可能不一致。

---

## 5. 冗余和重复分析

### 5.1 去重逻辑重复

#### 问题1：多处去重检查

**位置1**: `AggregatorState.TextProcessor.processText()` (行218-236)
- 处理边界重叠和去重
- 使用`dedupMergePrecise`函数

**位置2**: `DeduplicationHandler.isDuplicate()` (行104-235)
- 检查完全重复、子串重复、重叠、高相似度

**位置3**: `TextForwardMergeManager.processText()` (行415-451)
- 使用`dedupMergePrecise`进行去重

**分析**:
- **冗余**: 三个位置都在做去重，但检查的类型不同
- **TextProcessor**: 主要处理边界重叠（hangover导致）
- **DeduplicationHandler**: 检查完全重复、子串重复、重叠、高相似度
- **TextForwardMergeManager**: 使用`dedupMergePrecise`进行精确去重

**建议**: 
- 统一去重逻辑，避免重复检查
- 或者明确各处的职责，避免功能重叠

---

### 5.2 提交逻辑与等待合并逻辑不一致

#### 问题2：shouldCommit vs shouldWaitForMerge

**场景**: 
- Job 1（38字符）被标记为`shouldWaitForMerge=true`（38字符在6-40字符范围内）
- 但同时因为38字符 > 25字符（`commitLenCjk`），触发`shouldCommit=true`
- 导致Job 1被立即提交，无法与Job 2合并

**根本原因**:
- `shouldCommit`的判断基于**字符数量**（25字符）
- `shouldWaitForMerge`的判断基于**字符数量范围**（6-40字符）
- 两者**没有协调**，可能产生矛盾

**建议**:
- 如果`shouldWaitForMerge=true`，不应该立即触发`shouldCommit=true`
- 或者，在`shouldCommit`判断中考虑`shouldWaitForMerge`状态

---

### 5.3 文本不完整分数计算可能不够准确

#### 问题3：中等长度文本分数不够

**场景**:
- Job 2（13字符）和Job 6（11字符）的文本不完整分数可能不够高
- 因为11-13字符：
  - 不是`veryShort`（< 4字符）→ 不加3分
  - 不是`short`（< 9字符）→ 不加2分
  - 只能依靠其他因素加分（间隔、标点、连接词等）

**建议**:
- 为中等长度文本（10-15字符）增加额外的分数
- 或者降低`scoreThreshold`（2.5）

---

### 5.4 间隔阈值可能过短

#### 问题4：softGapMs（1000ms）可能过短

**场景**:
- 如果两个job之间的间隔 > 1000ms，即使文本不完整分数足够，也不会触发MERGE
- 实际语音中，自然停顿可能超过1秒

**建议**:
- 提高`softGapMs`（1000ms）或`hardGapMs`（1500ms）
- 或者，根据文本不完整分数动态调整间隔阈值

---

## 6. 矛盾点分析

### 6.1 矛盾1：提交时机与等待合并

**矛盾**:
- `shouldWaitForMerge=true`表示应该等待合并
- `shouldCommit=true`会立即提交，清空`pendingText`
- 两者可能同时为`true`，导致矛盾

**影响**:
- Job 1（38字符）被标记为`shouldWaitForMerge=true`，但被立即提交
- 后续的Job 2无法与Job 1合并

**建议**:
- 统一逻辑：如果`shouldWaitForMerge=true`，不应该立即提交
- 或者，在提交前检查`shouldWaitForMerge`状态

---

### 6.2 矛盾2：去重检查的优先级

**矛盾**:
- `DeduplicationHandler`在`AggregationStage`中检查
- `TextForwardMergeManager`也进行去重检查
- 两者的检查顺序和逻辑可能不一致

**影响**:
- 可能导致某些重复文本没有被正确过滤
- 或者，某些非重复文本被错误过滤

**建议**:
- 明确去重检查的优先级和顺序
- 统一去重逻辑，避免重复检查

---

## 7. 数据流转图

```
ASRResult {
  text: "原始ASR文本",
  segments: [...],
  ...
}
  ↓
AggregationStage.process()
  ↓
AggregatorState.processUtterance()
  ├─> 决策: MERGE / NEW_STREAM
  ├─> 文本合并和去重（TextProcessor）
  └─> 提交决策: shouldCommit
  ↓
AggregationStageResult {
  aggregatedText: "聚合后的文本",
  action: "MERGE" | "NEW_STREAM",
  ...
}
  ↓
DeduplicationHandler.isDuplicate()
  ├─> 完全重复? → 返回空文本
  ├─> 子串重复? → 返回空文本
  ├─> 重叠? → 返回去重后的文本
  └─> 高相似度? → 返回空文本
  ↓
TextForwardMergeManager.processText()
  ├─> 检查待合并文本（pendingText）
  ├─> 与previousText去重
  └─> 长度判断: shouldDiscard / shouldWaitForMerge / shouldSendToSemanticRepair
  ↓
最终文本
  ↓
SemanticRepairStage.process()
  └─> 调用语义修复服务
```

---

## 8. 关键参数总结

### 8.1 聚合决策参数（room/two_way模式）

| 参数 | 值 | 说明 |
|------|-----|------|
| `strongMergeMs` | 800ms | 强合并阈值（间隔 <= 800ms 强制MERGE） |
| `softGapMs` | 1000ms | 软合并最大间隔（间隔 <= 1000ms 可MERGE） |
| `hardGapMs` | 1500ms | 硬间隔（间隔 >= 1500ms 强制NEW_STREAM） |
| `scoreThreshold` | 2.5 | 文本不完整分数阈值 |

### 8.2 提交决策参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `commitIntervalMs` | 900ms | 提交时间间隔 |
| `commitLenCjk` | 25字符 | CJK文本提交长度阈值 |
| `commitLenEnWords` | 10词 | 英文文本提交长度阈值 |

### 8.3 长度判断参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `minLengthToKeep` | 6字符 | 最小保留长度（< 6字符丢弃） |
| `minLengthToSend` | 20字符 | 最小发送长度（6-20字符等待合并） |
| `maxLengthToWait` | 40字符 | 最大等待长度（20-40字符等待3秒） |
| `waitTimeoutMs` | 3000ms | 等待超时时间 |

---

## 9. 问题总结

### 9.1 冗余问题

1. **去重逻辑重复**：
   - `TextProcessor`、`DeduplicationHandler`、`TextForwardMergeManager`都在做去重
   - 建议：统一去重逻辑，明确各处的职责

### 9.2 矛盾问题

1. **提交时机与等待合并矛盾**：
   - `shouldWaitForMerge=true`但`shouldCommit=true`导致立即提交
   - 建议：统一逻辑，如果`shouldWaitForMerge=true`，不应该立即提交

2. **去重检查优先级不明确**：
   - 多个地方进行去重检查，优先级不明确
   - 建议：明确去重检查的优先级和顺序

### 9.3 设计问题

1. **提交判断过于死板**：
   - 仅基于字符数量判断，不考虑语义完整性
   - 建议：考虑语义完整性，或与`shouldWaitForMerge`协调

2. **间隔阈值可能过短**：
   - `softGapMs`（1000ms）可能过短，无法处理自然停顿
   - 建议：提高间隔阈值，或根据文本不完整分数动态调整

3. **文本不完整分数阈值可能过高**：
   - 中等长度文本（11-13字符）的分数可能不够
   - 建议：为中等长度文本增加额外分数，或降低阈值

---

## 10. 建议的改进方向

### 10.1 统一去重逻辑

- 创建一个统一的去重服务
- 明确各处的职责，避免功能重叠

### 10.2 协调提交和等待合并逻辑

- 如果`shouldWaitForMerge=true`，不应该立即触发`shouldCommit=true`
- 或者，在`shouldCommit`判断中考虑`shouldWaitForMerge`状态

### 10.3 优化参数

- 提高`softGapMs`（1000ms）或`hardGapMs`（1500ms）
- 降低`scoreThreshold`（2.5）
- 为中等长度文本（10-15字符）增加额外的分数

### 10.4 改进提交判断

- 考虑语义完整性，而不仅仅是字符数量
- 与`shouldWaitForMerge`状态协调

---

**文档结束**
