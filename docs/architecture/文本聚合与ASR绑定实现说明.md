# 文本聚合与 ASR 绑定实现说明

## 改动概述

将文本聚合（AggregationStage）从 `PostProcessCoordinator` 移到 `PipelineOrchestrator` 中，放在 ASR 之后、语义修复之前，与 ASR 绑定，与 NMT 解绑。

## 改动详情

### 1. ✅ PipelineOrchestrator 添加文本聚合支持

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**改动**：
- 添加 `AggregationStage` 初始化
- 在 `processJob()` 中，ASR 之后、语义修复之前执行聚合
- 使用聚合后的文本进行语义修复

**关键代码**：
```typescript
// ========== Stage 1: 文本聚合（ASR 之后、语义修复之前）==========
const tempResult = this.resultBuilder.buildResult(textForNMT, asrResult, rerunCount);
const aggregationResult = this.aggregationStage.process(job, tempResult);

// 修复：在语义修复之前检测并移除文本内部重复
let textAfterDedup = aggregationResult.aggregatedText;
textAfterDedup = detectInternalRepetition(textAfterDedup);

// ========== Stage 2: 语义修复（使用聚合和去重后的文本）==========
const repairResult = await semanticRepairStage.process(job, textAfterDedup, ...);
```

### 2. ✅ 更新 JobResult 接口

**文件**：`electron_node/electron-node/main/src/inference/inference-service.ts`

**改动**：
- 添加 `aggregation_applied?: boolean` - 是否应用了文本聚合
- 添加 `aggregation_action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT'` - 聚合动作
- 添加 `is_last_in_merged_group?: boolean` - 是否是合并组中的最后一个 utterance
- 添加 `aggregation_metrics?: { dedupCount?: number; dedupCharsRemoved?: number }` - 聚合指标

### 3. ✅ PostProcessCoordinator 移除聚合相关代码

**文件**：`electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

**改动**：
- 移除 `AggregationStage` 初始化
- 移除聚合处理逻辑
- 移除内部重复检测（现在在 PipelineOrchestrator 中处理）
- 直接使用 `JobResult` 中的聚合后文本

**关键代码**：
```typescript
// 使用 PipelineOrchestrator 处理后的文本（已经是聚合和修复后的文本）
let textForTranslation = result.text_asr;  // 已经是聚合和修复后的文本

// 构建聚合结果（用于后续处理）
const aggregationResult: AggregationStageResult = {
  aggregatedText: textForTranslation,
  aggregationChanged: result.aggregation_applied || false,
  action: result.aggregation_action,
  isLastInMergedGroup: result.is_last_in_merged_group,
  metrics: result.aggregation_metrics,
};
```

## 调用流程

### 修改前

```
PipelineOrchestrator.processJob()
  → ASR 服务调用
  → 语义修复

PostProcessCoordinator.process()
  → AggregationStage [文本聚合] ← 在这里执行
  → 语义修复（已移除）
  → TranslationStage [NMT]
  → TTSStage [TTS]
  → TONEStage [TONE]
```

### 修改后

```
PipelineOrchestrator.processJob()
  → ASR 服务调用
  → AggregationStage [文本聚合] ← 现在在这里执行（与 ASR 绑定）
  → 内部重复检测
  → SemanticRepairStage [语义修复] ← 使用聚合后的文本
  → 构建 JobResult（包含聚合和修复后的文本）

PostProcessCoordinator.process()
  → 使用 JobResult 中的聚合后文本
  → TranslationStage [NMT]
  → TTSStage [TTS]
  → TONEStage [TONE]
```

## 关键点

### 1. 文本聚合与 ASR 绑定

- **位置**：`PipelineOrchestrator.processJob()` 中，ASR 之后、语义修复之前
- **输入**：ASR 原始文本
- **输出**：聚合后的文本（用于语义修复）

### 2. 语义修复使用聚合后的文本

- **输入**：聚合和去重后的文本
- **输出**：修复后的文本（放入 `result.text_asr` 和 `result.text_asr_repaired`）

### 3. 文本聚合与 NMT 解绑

- **之前**：文本聚合在 `PostProcessCoordinator` 中执行（聚合之后、翻译之前）
- **现在**：文本聚合在 `PipelineOrchestrator` 中执行（ASR 之后、语义修复之前）
- **通信方式**：通过 `JobResult` 传递聚合状态和文本

### 4. 文本流程

1. **ASR 阶段**：`PipelineOrchestrator` 执行 ASR，得到原始文本
2. **聚合阶段**：`PipelineOrchestrator` 执行文本聚合，得到聚合后的文本
3. **去重阶段**：`PipelineOrchestrator` 检测并移除文本内部重复
4. **语义修复阶段**：`PipelineOrchestrator` 执行语义修复，得到修复后的文本
5. **结果构建**：将聚合和修复后的文本放入 `result.text_asr` 和 `result.text_asr_repaired`
6. **翻译阶段**：`PostProcessCoordinator` 使用 `result.text_asr`（已经是聚合和修复后的文本）进行翻译

## 优势

1. **文本聚合与 ASR 绑定**：文本聚合现在与 ASR 紧密绑定，确保 ASR 输出立即得到聚合
2. **语义修复使用聚合后的文本**：语义修复现在使用聚合后的文本，提高修复准确性
3. **解耦 NMT**：文本聚合不再依赖 NMT，仅通过 `JobResult` 进行通信
4. **统一管理**：所有 ASR 相关处理（ASR + 聚合 + 语义修复）都在 `PipelineOrchestrator` 中统一管理
5. **清晰的职责**：`PostProcessCoordinator` 专注于后处理（翻译、TTS、TONE），不再处理聚合

## 测试建议

1. **测试文本聚合与 ASR 绑定**：
   - 验证聚合是否在 ASR 之后、语义修复之前执行
   - 验证聚合后的文本是否正确用于语义修复

2. **测试聚合结果传递**：
   - 验证聚合状态是否正确传递到 `PostProcessCoordinator`
   - 验证翻译阶段是否使用聚合后的文本

3. **测试合并逻辑**：
   - 验证 `MERGE` 动作是否正确处理
   - 验证 `is_last_in_merged_group` 是否正确传递

## 注意事项

1. **向后兼容**：如果 `JobResult` 中没有聚合相关字段，`PostProcessCoordinator` 会使用原始文本
2. **聚合状态**：需要确保 `aggregationResult` 包含所有必要的字段（`shouldDiscard`、`shouldWaitForMerge` 等）
3. **错误处理**：如果聚合失败，使用原始文本，不影响整体流程
