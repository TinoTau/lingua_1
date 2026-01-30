# Utterance 聚合流程完整调用链分析报告

## 文档信息

- **文档目的**: 详细分析从 ASR 返回结果到发送给语义修复服务的完整调用链，识别重复调用和潜在开销问题
- **执行日期**: 2026年1月26日
- **目标受众**: 决策部门审议
- **文档版本**: v1.0

---

## 一、执行摘要

### 1.1 核心发现

1. ✅ **已优化的重复调用**:
   - `dedupMergePrecise()` 调用从 3-5次 优化为 1-3次（减少 2次）
   - `getLastCommittedText()` 调用从 2-3次 优化为 1次（减少 1-2次）

2. ⚠️ **仍存在的调用（非重复，职责分离）**:
   - `dedupMergePrecise()` 在 TextProcessor 中调用 0-2次（组内尾部整形，必要）
   - `getLastSentText()` 调用 2次（职责不同：Drop 判定和日志输出）

3. ✅ **架构优化状态**:
   - v3 改造已完成，重复调用已显著减少
   - 职责分离清晰，无逻辑冲突

### 1.2 性能开销总结

| 方法 | 调用次数 | 开销类型 | 优化状态 |
|------|---------|---------|---------|
| `dedupMergePrecise()` (forward-merge) | 1次 | CPU（字符串处理） | ✅ 已优化（从 3次 降为 1次） |
| `dedupMergePrecise()` (TextProcessor) | 0-2次 | CPU（字符串处理） | ✅ 必要调用（组内整形） |
| `getLastCommittedText()` | 1次 | 内存查找 | ✅ 已优化（从 2-3次 降为 1次） |
| `getLastSentText()` | 2次 | 内存查找 | ⚠️ 职责不同（Drop 判定和日志） |

**总体优化效果**: 减少 3-4 次重复调用

---

## 二、完整调用链（逐方法级别）

### 2.1 Pipeline 入口

```
runJobPipeline()
  └─> executeStep('AGGREGATION', ...)
      └─> runAggregationStep()
          ├─> aggregatorManager.getLastCommittedText()  【1次，缓存到 ctx.lastCommittedText】
          └─> aggregationStage.process(job, result, lastCommittedText)
```

**文件**: 
- `pipeline/job-pipeline.ts` (line 43-156)
- `pipeline/steps/aggregation-step.ts` (line 13-108)

**关键操作**:
- 检查 `ctx.asrText` 是否为空
- 获取 `lastCommittedText` 并缓存到 `ctx.lastCommittedText`（**v3 优化：避免重复获取**）
- 创建 `AggregationStage` 实例
- 调用 `AggregationStage.process()`

---

### 2.2 AggregationStage 处理

```
AggregationStage.process()
  ├─> 检查 session_id 和 ASR 文本
  ├─> 提取语言概率信息
  ├─> aggregatorManager.processUtterance()  【核心聚合逻辑】
  │   └─> AggregatorState.processUtterance()
  │       ├─> utteranceProcessor.processUtterance()  【预处理】
  │       │   └─> detectInternalRepetition()  【内部重复检测】
  │       ├─> actionDecider.decideAction()  【MERGE/NEW_STREAM 决策】
  │       ├─> textProcessor.processText()  【文本合并和去重】
  │       │   ├─> dedupMergePrecise(tailBuffer, text)  【0-1次，组内尾部整形】
  │       │   └─> dedupMergePrecise(lastTail, text)  【0-1次，组内尾部整形】
  │       ├─> pendingManager.handleMerge() / handleNewStream()  【pending 管理】
  │       ├─> commitHandler.decideCommit()  【提交决策】
  │       └─> commitExecutor.executeCommit()  【执行提交】
  │           └─> contextManager.addCommittedText()  【更新 lastCommittedText】
  ├─> deduplicationHandler.isDuplicate()  【Drop 判定】
  │   └─> getLastSentText()  【1次，获取 lastSentText】
  └─> forwardMergeManager.processText()  【Trim + Gate 决策】
      └─> mergeByTrim()  【统一 Trim 逻辑】
          └─> dedupMergePrecise(base, incoming)  【1次，Trim】
```

**文件**: 
- `agent/postprocess/aggregation-stage.ts` (line 45-422)
- `aggregator/aggregator-state.ts` (line 144-604)
- `aggregator/aggregator-state-text-processor.ts` (line 42-167)
- `agent/postprocess/text-forward-merge-manager.ts` (line 90-334)

**关键操作**:
- 调用 `aggregatorManager.processUtterance()` 进行核心聚合
- 使用 `DeduplicationHandler.isDuplicate()` 进行 Drop 判定
- 使用 `TextForwardMergeManager.processText()` 进行 Trim 和 Gate 决策

---

### 2.3 AggregatorState 核心处理

```
AggregatorState.processUtterance()
  ├─> utteranceProcessor.processUtterance()
  │   ├─> detectInternalRepetition()  【检测内部重复】
  │   └─> 计算时间戳和 gap
  ├─> actionDecider.decideAction()  【MERGE/NEW_STREAM 决策】
  ├─> textProcessor.processText()  【文本合并和去重】
  │   ├─> 如果有 tailBuffer:
  │   │   └─> dedupMergePrecise(tailBuffer, text)  【0-1次，组内尾部整形】
  │   └─> 否则:
  │       └─> dedupMergePrecise(lastTail, text)  【0-1次，组内尾部整形】
  ├─> pendingManager.handleMerge() / handleNewStream()
  ├─> commitHandler.decideCommit()  【提交决策】
  └─> commitExecutor.executeCommit()  【执行提交】
      └─> contextManager.addCommittedText()  【更新 lastCommittedText】
```

**文件**: `aggregator/aggregator-state.ts` (line 144-604)

**关键操作**:
- 文本预处理和动作决策
- 文本合并和去重（**v3 改造：只做组内尾部整形，不做丢弃决策**）
- 提交决策和执行

---

### 2.4 TextForwardMergeManager 处理（Trim + Gate）

```
TextForwardMergeManager.processText()
  ├─> 检查 pending 文本
  ├─> 如果 pending 超时/手动截断:
  │   └─> mergeByTrim(pending.text, currentText)  【统一 Trim】
  │       └─> dedupMergePrecise(pending.text, currentText)  【1次】
  ├─> 如果 pending 未超时:
  │   └─> mergeByTrim(pending.text, currentText)  【统一 Trim】
  │       └─> dedupMergePrecise(pending.text, currentText)  【1次】
  └─> 如果没有 pending:
      └─> mergeByTrim(previousText || '', currentText)  【统一 Trim】
          └─> dedupMergePrecise(previousText || '', currentText)  【1次】
  └─> decideGateAction(mergedText, ...)  【Gate 决策：SEND/HOLD/DROP】
```

**文件**: `agent/postprocess/text-forward-merge-manager.ts` (line 90-334)

**关键操作**:
- **v3 改造：统一 Trim 逻辑，只调用一次 `dedupMergePrecise()`**
- **v3 改造：统一输出语义为完整 `mergedText`**
- Gate 决策（SEND/HOLD/DROP）

---

### 2.5 语义修复服务调用

```
runJobPipeline()
  └─> executeStep('SEMANTIC_REPAIR')
      └─> runSemanticRepairStep()
          ├─> 检查 shouldSendToSemanticRepair 标志
          ├─> 获取 lastCommittedText（优先使用 ctx.lastCommittedText）  【v3 优化】
          ├─> 创建 SemanticRepairStage 实例
          └─> semanticRepairStage.process()
              ├─> getMicroContext()  【获取微上下文】
              ├─> scorer.score()  【评分】
              ├─> SequentialExecutor.execute()  【顺序执行保证】
              └─> taskRouter.routeSemanticRepairTask()  【路由到服务】
                  └─> TaskRouterSemanticRepairHandler.routeSemanticRepairTask()
                      └─> callSemanticRepairService()  【HTTP 调用】
                          └─> POST /repair  【语义修复服务 API】
```

**文件**: 
- `pipeline/steps/semantic-repair-step.ts` (line 12-174)
- `agent/postprocess/semantic-repair-stage-zh.ts` (line 41-215)
- `task-router/task-router-semantic-repair.ts` (line 303-361)

**关键操作**:
- 检查 `shouldSendToSemanticRepair` 标志
- 获取微上下文（**v3 优化：优先使用 `ctx.lastCommittedText`**）
- 调用语义修复服务

---

## 三、关键方法调用统计

### 3.1 dedupMergePrecise() 调用次数

**v3 改造后**:

| 调用位置 | 调用次数 | 说明 |
|---------|---------|------|
| `AggregatorStateTextProcessor.processText()` | 0-2次 | tailBuffer 分支或 lastTail 分支（组内尾部整形） |
| `TextForwardMergeManager.mergeByTrim()` | **1次** | **v3 改造：统一 Trim 逻辑，单次调用** |
| **总计** | **1-3次** | **v3 改造前：3-5次，v3 改造后：1-3次** |

**分析**:
- ✅ **v3 改造后，forward-merge 的 Trim 只调用一次**（在 `mergeByTrim` 内）
- ⚠️ **TextProcessor 仍可能调用 0-2次**（组内尾部整形，这是必要的）

**职责分离**:
- **TextProcessor**: 做组内尾部整形（hangover），处理 MERGE 组内的重复
- **forward-merge**: 做跨 committed 的 Trim，处理与 `lastCommittedText` 的边界重叠

---

### 3.2 getLastCommittedText() 调用次数

**v3 改造后**:

| 调用位置 | 调用次数 | 说明 |
|---------|---------|------|
| `runAggregationStep()` | **1次** | **v3 优化：缓存到 ctx.lastCommittedText** |
| `AggregationStage.process()` | 0次 | **v3 优化：使用传入的 lastCommittedText 参数** |
| `runSemanticRepairStep()` | 0次 | **v3 优化：优先使用 ctx.lastCommittedText** |
| **总计** | **1次** | **v3 改造前：2-3次，v3 改造后：1次** |

**分析**:
- ✅ **v3 改造后，`getLastCommittedText()` 只调用一次**（在 `runAggregationStep()` 中）
- ✅ **后续步骤从 `ctx.lastCommittedText` 读取，避免重复获取**

---

### 3.3 getLastSentText() 调用次数

| 调用位置 | 调用次数 | 说明 |
|---------|---------|------|
| `DeduplicationHandler.isDuplicate()` | 1次 | 内部调用，用于 Drop 判定 |
| `AggregationStage.process()` | 1次 | 用于日志输出 |
| **总计** | **2次** | 职责不同，无重复调用 |

**分析**:
- ⚠️ **2次调用职责不同**：
  - 第1次：`DeduplicationHandler.isDuplicate()` 内部调用，用于 Drop 判定
  - 第2次：`AggregationStage.process()` 中调用，用于日志输出
- ✅ **无逻辑冲突**：两次调用用途不同，不是重复调用

---

## 四、重复调用分析

### 4.1 已优化的重复调用 ✅

#### 4.1.1 getLastCommittedText() 重复调用（已优化）

**v3 改造前**:
- `runAggregationStep()`: 1次
- `AggregationStage.process()`: 1次（如果未传入参数）
- `runSemanticRepairStep()`: 1次
- **总计**: 2-3次

**v3 改造后**:
- `runAggregationStep()`: 1次（缓存到 ctx）
- `AggregationStage.process()`: 0次（使用传入参数）
- `runSemanticRepairStep()`: 0次（使用 ctx.lastCommittedText）
- **总计**: **1次** ✅

**优化效果**: 减少 1-2 次重复调用

**代码位置**:
- `pipeline/steps/aggregation-step.ts` (line 68-76): 获取并缓存
- `agent/postprocess/aggregation-stage.ts` (line 257-265): 使用传入参数
- `pipeline/steps/semantic-repair-step.ts` (line 63-65): 优先使用 ctx.lastCommittedText

---

#### 4.1.2 dedupMergePrecise() 在 forward-merge 中的重复调用（已优化）

**v3 改造前**:
- pending 超时分支: 1次
- pending 未超时分支: 1次
- previousText 分支: 1次
- **总计**: 3次（可能同时存在）

**v3 改造后**:
- 所有分支统一调用 `mergeByTrim()`: **1次**
- **总计**: **1次** ✅

**优化效果**: 减少 2 次重复调用

**代码位置**:
- `agent/postprocess/text-forward-merge-manager.ts` (line 65-78): 统一 Trim 逻辑

---

### 4.2 仍存在的调用（非重复，职责分离）

#### 4.2.1 dedupMergePrecise() 在 TextProcessor 中的调用

**调用位置**: `AggregatorStateTextProcessor.processText()`

**调用次数**: 0-2次（tailBuffer 分支或 lastTail 分支）

**分析**:
- ✅ **非重复调用**：这是组内尾部整形（hangover），与 forward-merge 的 Trim 职责不同
- ✅ **v3 改造后**：TextProcessor 不再输出空字符串，只做内部 Trim
- ✅ **职责分离**：TextProcessor 做组内整形，forward-merge 做跨 committed 的 Trim

**代码位置**:
- `aggregator/aggregator-state-text-processor.ts` (line 57, 109)

**结论**: 无问题，职责分离合理

---

#### 4.2.2 getLastSentText() 调用

**调用位置**:
1. `DeduplicationHandler.isDuplicate()` 内部 (line 61)
2. `AggregationStage.process()` 中用于日志输出 (line 285)

**调用次数**: 2次

**分析**:
- ⚠️ **2次调用职责不同**：
  - 第1次：Drop 判定（检查是否与上次发送的文本重复）
  - 第2次：日志输出（记录 lastSentText 用于调试）
- ✅ **无逻辑冲突**：两次调用用途不同，不是重复调用
- 💡 **潜在优化**：可以缓存第1次调用的结果，避免第2次调用

**代码位置**:
- `agent/aggregator-middleware-deduplication.ts` (line 61): Drop 判定
- `agent/postprocess/aggregation-stage.ts` (line 285): 日志输出

**建议**: 可以考虑缓存第1次调用的结果，但当前实现合理，优先级较低

---

## 五、潜在问题分析

### 5.1 未使用的代码（已清理）✅

1. **TextForwardMergeDedupProcessor** - ✅ 已删除
2. **TextForwardMergeLengthDecider** - ✅ 已删除（类已删除，接口保留）
3. **handleMergedText()** - ✅ 已删除

---

### 5.2 可能的性能问题

#### 5.2.1 TextProcessor 的 dedupMergePrecise 调用

**当前情况**:
- TextProcessor 可能调用 0-2次 `dedupMergePrecise()`
- 这是组内尾部整形，与 forward-merge 的 Trim 职责不同

**分析**:
- ✅ **这是必要的**：组内尾部整形需要在聚合阶段完成
- ✅ **职责分离清晰**：TextProcessor 做组内整形，forward-merge 做跨 committed 的 Trim
- ⚠️ **潜在优化**：如果 tailBuffer 和 lastTail 都不存在，可以跳过 dedupMergePrecise 调用

**建议**:
- 当前实现合理，无需优化
- 如果未来需要进一步优化，可以考虑在 TextProcessor 中缓存去重结果

---

#### 5.2.2 getLastSentText() 的重复调用

**当前情况**:
- `getLastSentText()` 被调用 2次
- 第1次：Drop 判定
- 第2次：日志输出

**分析**:
- ⚠️ **潜在优化**：可以缓存第1次调用的结果，避免第2次调用
- ✅ **当前实现合理**：两次调用用途不同，不是重复调用

**建议**:
- 优先级：低
- 可以考虑在 `AggregationStage.process()` 中缓存 `isDuplicate()` 的结果，避免重复调用 `getLastSentText()`

---

### 5.3 数据一致性检查

#### 5.3.1 lastCommittedText 和 lastSentText 的一致性

**当前情况**:
- `lastCommittedText`: 用于 Trim（边界重叠裁剪）
- `lastSentText`: 用于 Drop（完全重复/子串重复/高相似度）

**分析**:
- ✅ **职责分离清晰**：Trim 使用 `lastCommittedText`，Drop 使用 `lastSentText`
- ✅ **数据来源明确**：`lastCommittedText` 在 commit 时更新，`lastSentText` 在 send 成功时更新
- ⚠️ **潜在问题**：如果 commit 和 send 不同步，可能导致数据不一致

**建议**:
- 当前实现合理，但需要确保 commit 和 send 的同步性
- 建议添加监控，检测 commit 和 send 的时间差

---

## 六、性能开销分析

### 6.1 方法调用开销

| 方法 | 调用次数 | 开销类型 | 优化状态 |
|------|---------|---------|---------|
| `dedupMergePrecise()` (forward-merge) | 1次 | CPU（字符串处理） | ✅ 已优化（从 3次 降为 1次） |
| `dedupMergePrecise()` (TextProcessor) | 0-2次 | CPU（字符串处理） | ✅ 必要调用（组内整形） |
| `getLastCommittedText()` | 1次 | 内存查找 | ✅ 已优化（从 2-3次 降为 1次） |
| `getLastSentText()` | 2次 | 内存查找 | ⚠️ 职责不同（Drop 判定和日志） |

---

### 6.2 优化效果总结

**v3 改造前**:
- `dedupMergePrecise()`: 3-5次
- `getLastCommittedText()`: 2-3次

**v3 改造后**:
- `dedupMergePrecise()`: 1-3次（**减少 2次**）
- `getLastCommittedText()`: 1次（**减少 1-2次**）

**总体优化**: 减少 3-4 次重复调用

---

## 七、错误调用分析

### 7.1 已修复的错误调用 ✅

1. **TextForwardMergeDedupProcessor 未使用** - ✅ 已删除
2. **TextForwardMergeLengthDecider 未使用** - ✅ 已删除
3. **handleMergedText() 已废弃** - ✅ 已删除

---

### 7.2 潜在的逻辑问题

#### 7.2.1 TextProcessor 和 forward-merge 的职责重叠

**当前情况**:
- TextProcessor 调用 `dedupMergePrecise()` 进行组内尾部整形
- forward-merge 调用 `dedupMergePrecise()` 进行跨 committed 的 Trim

**分析**:
- ✅ **职责分离清晰**：TextProcessor 做组内整形，forward-merge 做跨 committed 的 Trim
- ✅ **v3 改造后**：TextProcessor 不再输出空字符串，只做内部 Trim
- ✅ **无逻辑冲突**：两个阶段的职责不同，数据来源不同

**结论**: 无问题，职责分离合理

---

#### 7.2.2 previousText 分支的输出语义

**v3 改造前**:
- `processedText = dedupResult.text`（只返回裁剪片段）

**v3 改造后**:
- `mergedText = previousText + dedupResult.text`（完整合并文本）

**分析**:
- ✅ **已修复**：现在返回完整 mergedText，不是裁剪片段
- ✅ **语义统一**：所有分支都返回完整 mergedText

**结论**: 已修复，无问题

---

## 八、v3 改造效果验证

### 8.1 代码简化

| 指标 | v3 改造前 | v3 改造后 | 改进 |
|------|----------|----------|------|
| `dedupMergePrecise()` 调用（forward-merge） | 3次 | 1次 | ✅ 减少 2次 |
| `getLastCommittedText()` 调用 | 2-3次 | 1次 | ✅ 减少 1-2次 |
| 未使用代码 | 3个类/方法 | 0个 | ✅ 已清理 |
| 输出语义 | 不统一 | 统一 | ✅ 已统一 |

---

### 8.2 逻辑清晰度

| 方面 | v3 改造前 | v3 改造后 | 改进 |
|------|----------|----------|------|
| Trim 调用点 | 3处 | 1处 | ✅ 单一调用点 |
| Gate 决策点 | 分散 | 集中 | ✅ 单一决策点 |
| 输出语义 | 不统一 | 统一 | ✅ 语义统一 |
| 职责分离 | 模糊 | 清晰 | ✅ 职责明确 |

---

## 九、建议和结论

### 9.1 当前状态 ✅

1. ✅ **重复调用已优化**：`dedupMergePrecise()` 和 `getLastCommittedText()` 的重复调用已减少
2. ✅ **未使用代码已清理**：过期代码已删除
3. ✅ **职责分离清晰**：TextProcessor 和 forward-merge 的职责明确
4. ✅ **输出语义统一**：所有分支都返回完整 mergedText

---

### 9.2 无需进一步优化

1. **TextProcessor 的 dedupMergePrecise 调用**：这是必要的组内尾部整形，与 forward-merge 的 Trim 职责不同
2. **getLastSentText() 调用**：2次调用职责不同（Drop 判定和日志输出），无重复
3. **数据一致性**：当前实现合理，但建议添加监控

---

### 9.3 建议的监控指标

1. **性能监控**:
   - `dedupMergePrecise()` 的调用次数（应该显著减少）
   - `getLastCommittedText()` 的调用次数（应该减少）
   - Gate 决策的延迟（应该保持或改善）

2. **数据一致性监控**:
   - commit 和 send 的时间差
   - `lastCommittedText` 和 `lastSentText` 的一致性

---

### 9.4 潜在优化建议（优先级：低）

1. **getLastSentText() 缓存**:
   - 在 `AggregationStage.process()` 中缓存 `isDuplicate()` 的结果
   - 避免重复调用 `getLastSentText()` 用于日志输出
   - **优先级**: 低（当前实现合理）

2. **TextProcessor 去重结果缓存**:
   - 如果 tailBuffer 和 lastTail 都不存在，可以跳过 dedupMergePrecise 调用
   - **优先级**: 低（当前实现合理）

---

## 十、调用链总结

### 10.1 核心流程

```
ASR 结果
  └─> runAggregationStep()
      ├─> getLastCommittedText()  【1次，缓存到 ctx】
      └─> AggregationStage.process()
          ├─> AggregatorState.processUtterance()
          │   └─> TextProcessor.processText()  【组内尾部整形，0-2次 dedupMergePrecise】
          ├─> DeduplicationHandler.isDuplicate()  【Drop 判定，1次 getLastSentText】
          └─> TextForwardMergeManager.processText()
              └─> mergeByTrim()  【Trim，1次 dedupMergePrecise】
                  └─> decideGateAction()  【Gate 决策：SEND/HOLD/DROP】
  └─> runSemanticRepairStep()
      ├─> 使用 ctx.lastCommittedText  【使用缓存的上下文】
      └─> SemanticRepairStage.process()
          └─> TaskRouter.routeSemanticRepairTask()
              └─> POST /repair  【语义修复服务 API】
```

---

### 10.2 关键优化点

1. ✅ **getLastCommittedText() 缓存**：从 2-3次 降为 1次
2. ✅ **forward-merge Trim 统一**：从 3次 降为 1次
3. ✅ **输出语义统一**：所有分支都返回完整 mergedText
4. ✅ **职责分离清晰**：TextProcessor 和 forward-merge 的职责明确

---

## 十一、决策建议

### 11.1 当前架构状态

✅ **v3 改造已完成，架构优化到位**

- 重复调用已显著减少（减少 3-4 次）
- 职责分离清晰，无逻辑冲突
- 代码质量良好，无未使用代码

---

### 11.2 无需进一步优化

以下调用虽然存在，但都是必要的，无需优化：

1. **TextProcessor 的 dedupMergePrecise 调用（0-2次）**：
   - 职责：组内尾部整形（hangover）
   - 与 forward-merge 的 Trim 职责不同
   - 这是必要的调用

2. **getLastSentText() 调用（2次）**：
   - 第1次：Drop 判定（必要）
   - 第2次：日志输出（可以优化，但优先级低）

---

### 11.3 建议的后续工作

1. **监控指标**（优先级：中）:
   - 添加性能监控，跟踪 `dedupMergePrecise()` 和 `getLastCommittedText()` 的调用次数
   - 添加数据一致性监控，检测 commit 和 send 的时间差

2. **潜在优化**（优先级：低）:
   - 考虑缓存 `getLastSentText()` 的结果，避免重复调用
   - 如果 tailBuffer 和 lastTail 都不存在，可以跳过 dedupMergePrecise 调用

---

## 十二、附录

### 12.1 关键文件清单

| 文件 | 职责 | 关键方法 |
|------|------|---------|
| `pipeline/job-pipeline.ts` | Pipeline 编排 | `runJobPipeline()` |
| `pipeline/steps/aggregation-step.ts` | 聚合步骤 | `runAggregationStep()` |
| `agent/postprocess/aggregation-stage.ts` | 聚合阶段 | `process()` |
| `aggregator/aggregator-state.ts` | 聚合状态 | `processUtterance()` |
| `aggregator/aggregator-state-text-processor.ts` | 文本处理 | `processText()` |
| `agent/postprocess/text-forward-merge-manager.ts` | 向前合并 | `processText()`, `mergeByTrim()` |
| `agent/aggregator-middleware-deduplication.ts` | 去重处理 | `isDuplicate()`, `getLastSentText()` |
| `pipeline/steps/semantic-repair-step.ts` | 语义修复步骤 | `runSemanticRepairStep()` |
| `agent/postprocess/semantic-repair-stage-zh.ts` | 语义修复阶段 | `process()` |
| `task-router/task-router-semantic-repair.ts` | 语义修复路由 | `routeSemanticRepairTask()` |

---

### 12.2 关键方法签名

```typescript
// dedupMergePrecise
function dedupMergePrecise(
  base: string,
  incoming: string,
  config?: DedupConfig
): DedupResult

// getLastCommittedText
function getLastCommittedText(
  sessionId: string,
  utteranceIndex: number
): string | null

// getLastSentText
function getLastSentText(sessionId: string): string | undefined
```

---

**文档结束**
