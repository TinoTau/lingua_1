# 语义修复与 ASR 绑定实现说明

## 改动概述

将语义修复从 `PostProcessCoordinator` 移到 `PipelineOrchestrator` 中，与 ASR 绑定。语义修复现在在文本聚合、合并处理、文本过滤之后执行，修复后的文本通过 `JobResult` 传递给 `PostProcessCoordinator`。

**更新**：已完成迁移，现在所有 ASR 相关的处理（聚合、合并、过滤、语义修复、去重）都在 `PipelineOrchestrator` 中统一处理。

## 改动详情

### 1. ✅ 更新 JobResult 接口

**文件**：`electron_node/electron-node/main/src/inference/inference-service.ts`

**改动**：
- 添加 `semantic_repair_applied?: boolean` - 是否应用了语义修复
- 添加 `semantic_repair_confidence?: number` - 语义修复置信度
- 添加 `text_asr_repaired?: string` - 语义修复后的 ASR 文本（如果应用了修复）

### 2. ✅ PipelineOrchestrator 添加语义修复支持

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**改动**：
- 构造函数添加 `servicesHandler` 参数（用于语义修复服务发现）
- 添加 `SemanticRepairInitializer` 初始化
- 在 `processJob()` 中，ASR 完成后立即执行语义修复
- 如果 `use_asr === true`，必须执行语义修复
- 将修复后的文本放入 `result.text_asr` 和 `result.text_asr_repaired`

**关键代码**：
```typescript
// ========== Stage 1: 文本聚合 ==========
const aggregationResult = this.aggregationStage.process(job, tempResult);

// ========== 合并处理和文本过滤 ==========
const mergeResult = this.mergeHandler.process(job, aggregationResult);
const filterResult = this.textFilter.process(job, aggregationResult);

// ========== Stage 2: 语义修复（使用聚合和过滤后的文本）==========
const shouldUseSemanticRepair = job.pipeline?.use_asr !== false && textAfterDedup && textAfterDedup.trim().length > 0;

if (shouldUseSemanticRepair && this.semanticRepairInitializer) {
  // 执行语义修复
  const repairResult = await semanticRepairStage.process(job, textAfterDedup, ...);
  if (repairResult.decision === 'REPAIR' || repairResult.decision === 'PASS') {
    finalTextForNMT = repairResult.textOut;
    semanticRepairApplied = true;
    semanticRepairConfidence = repairResult.confidence;
  }
}

// ========== Stage 3: 去重检查 ==========
const dedupResult = this.dedupStage.process(job, finalTextForNMT, '');

// 构建结果（包含聚合、语义修复和去重后的文本）
const result = this.resultBuilder.buildResult(finalTextForNMT, asrResult, rerunCount);
result.should_send = dedupResult.shouldSend;
result.dedup_reason = dedupResult.reason;
if (semanticRepairApplied) {
  result.semantic_repair_applied = true;
  result.semantic_repair_confidence = semanticRepairConfidence;
  result.text_asr_repaired = finalTextForNMT;
}
```

### 3. ✅ InferenceService 传递 ServicesHandler

**文件**：`electron_node/electron-node/main/src/inference/inference-service.ts`

**改动**：
- 构造函数添加 `servicesHandler` 参数
- 添加 `setServicesHandler()` 方法
- 将 `servicesHandler` 传递给 `PipelineOrchestrator`

### 4. ✅ NodeAgent 传递 ServicesHandler

**文件**：`electron_node/electron-node/main/src/agent/node-agent.ts`

**改动**：
- 在构造函数中调用 `inferenceService.setServicesHandler(this.servicesHandler)`
- 将 `ServicesHandler` 传递给 `InferenceService`

### 5. ✅ PostProcessCoordinator 移除语义修复、聚合和去重

**文件**：`electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

**改动**：
- 移除 `SemanticRepairInitializer` 相关代码
- 移除 `AggregationStage` 相关代码
- 移除 `DedupStage` 相关代码
- 移除 `PostProcessMergeHandler` 相关代码
- 移除 `PostProcessTextFilter` 相关代码
- 移除 `reinitializeSemanticRepairStage()` 方法
- 移除语义修复处理逻辑
- 移除聚合处理逻辑
- 移除去重检查逻辑
- 使用 `JobResult` 中的聚合、语义修复和去重状态
- 检查 `result.should_send` 判断是否应该处理

**关键代码**：
```typescript
// 检查是否应该处理（聚合和去重已在 PipelineOrchestrator 中处理）
if (result.should_send === false) {
  return { shouldSend: false, ... };
}

// 使用 PipelineOrchestrator 处理后的文本（已经是聚合和修复后的文本）
let textForTranslation = result.text_asr;  // 已经是聚合和修复后的文本
let semanticRepairApplied = result.semantic_repair_applied || false;
let semanticRepairConfidence = result.semantic_repair_confidence || 0;
```

## 调用流程

### 修改前

```
NodeAgent.handleJob()
  → JobProcessor.processJob()
    → InferenceService.processJob() [ASR]
      → PipelineOrchestrator.processJob()
        → ASR 服务调用
    → PostProcessCoordinator.process()
      → AggregationStage [文本聚合]
      → SemanticRepairHandler [语义修复] ← 在这里执行
      → TranslationStage [NMT]
      → TTSStage [TTS]
      → TONEStage [TONE]
```

### 修改后

```
NodeAgent.handleJob()
  → JobProcessor.processJob()
    → InferenceService.processJob() [ASR]
      → PipelineOrchestrator.processJob()
        → ASR 服务调用
        → AggregationStage [文本聚合]
        → MergeHandler [合并处理]
        → TextFilter [文本过滤]
        → SemanticRepairStage [语义修复] ← 现在在这里执行（与 ASR 绑定）
        → DedupStage [去重检查]
    → PostProcessCoordinator.process()
      → 检查 should_send（如果 false，直接返回）
      → TranslationStage [NMT]（使用已聚合和修复的文本）
      → TTSStage [TTS]
      → TONEStage [TONE]
```

## 关键点

### 1. 语义修复与 ASR 绑定

- **位置**：`PipelineOrchestrator.processJob()` 中，ASR 完成后立即执行
- **条件**：如果 `use_asr === true`，必须执行语义修复
- **结果**：修复后的文本放入 `result.text_asr` 和 `result.text_asr_repaired`

### 2. 语义修复与 NMT 解绑

- **之前**：语义修复在 `PostProcessCoordinator` 中执行，在聚合之后、翻译之前
- **现在**：语义修复在 `PipelineOrchestrator` 中执行，在聚合、合并处理、文本过滤之后，去重检查之前
- **通信方式**：通过 `JobResult` 传递语义修复状态和文本

### 3. 文本流程

1. **ASR 阶段**：`PipelineOrchestrator` 执行 ASR，得到原始文本
2. **语义修复阶段**：`PipelineOrchestrator` 执行语义修复，得到修复后的文本
3. **结果构建**：将修复后的文本放入 `result.text_asr` 和 `result.text_asr_repaired`
4. **聚合阶段**：`PostProcessCoordinator` 使用 `result.text_asr`（已经是修复后的文本）进行聚合
5. **翻译阶段**：使用聚合后的文本（已经是修复后的文本）进行翻译

## 优势

1. **语义修复与 ASR 绑定**：语义修复现在与 ASR 紧密绑定，确保 ASR 输出立即得到修复
2. **解耦 NMT**：语义修复不再依赖 NMT，仅通过 `JobResult` 进行通信
3. **统一管理**：所有 ASR 相关处理（ASR + 语义修复）都在 `PipelineOrchestrator` 中统一管理
4. **清晰的职责**：`PostProcessCoordinator` 专注于后处理（聚合、翻译、TTS、TONE），不再处理语义修复

## 测试建议

1. **测试语义修复与 ASR 绑定**：
   - 验证 `use_asr === true` 时，语义修复是否执行
   - 验证 `use_asr === false` 时，语义修复是否跳过

2. **测试语义修复结果传递**：
   - 验证修复后的文本是否正确传递到 `PostProcessCoordinator`
   - 验证聚合阶段是否使用修复后的文本

3. **测试只选择 NMT 模式**：
   - 验证 `use_asr === false, use_nmt === true` 时，语义修复是否跳过
   - 验证文本翻译是否正常工作

## 注意事项

1. **向后兼容**：如果 `JobResult` 中没有语义修复相关字段，`PostProcessCoordinator` 会使用原始文本
2. **服务发现**：需要确保 `ServicesHandler` 正确传递给 `PipelineOrchestrator`
3. **错误处理**：如果语义修复失败，使用原始文本，不影响整体流程
