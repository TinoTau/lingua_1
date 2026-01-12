# Pipeline NMT 禁用与 AggregatorMiddleware 重构总结

## 改造完成日期
2025-01-XX

## 改造目标

根据 `disable_pipeline_nmt_and_refactor_aggregator_plan.md` 的技术方案，完成以下改造：

1. **停用 PipelineOrchestrator 中的 NMT 调用**，避免 ASR 后的临时翻译在文本被聚合时被废弃
2. **拆分 AggregatorMiddleware 的职责**，将"文本聚合 / 翻译决策 / 去重 / 发送决策"拆解为清晰的处理阶段（Stage）

## 已完成的改造

### 1. Feature Flag 配置

**文件**: `electron_node/electron-node/main/src/node-config.ts`

添加了 Feature Flag 配置：
```typescript
features?: {
  enablePipelineNMT?: boolean;  // 默认 false，已迁移到 PostProcess
  enablePostProcessTranslation?: boolean;  // 默认 true
}
```

### 2. PipelineOrchestrator 改造

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

- ✅ 添加 `enablePipelineNMT` Feature Flag 检查
- ✅ 默认禁用 Pipeline NMT（`enablePipelineNMT: false`）
- ✅ 当禁用时，返回空 `text_translated`，由 PostProcess 处理
- ✅ 保留 TTS 逻辑（仅在 Pipeline NMT 启用时执行）

**关键变更**:
```typescript
// 读取 Feature Flag
const config = loadNodeConfig();
this.enablePipelineNMT = config.features?.enablePipelineNMT ?? false;

// 根据 Feature Flag 决定是否执行 NMT
if (this.enablePipelineNMT) {
  // 执行 NMT（旧逻辑）
} else {
  // 返回空翻译，由 PostProcess 处理
  return {
    text_asr: asrResult.text,
    text_translated: '',  // 空翻译，由 PostProcess 填充
    // ...
  };
}
```

### 3. 新的 Stage 架构

#### 3.1 AggregationStage

**文件**: `electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`

**职责**:
- 调用 `AggregatorManager.processUtterance()`
- 决定 MERGE / NEW_STREAM / COMMIT
- 输出 `aggregatedText` 与 `aggregationChanged`

**不包含任何翻译逻辑**。

#### 3.2 TranslationStage

**文件**: `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

**职责**:
- TranslationCache 查询
- NMT 调用（唯一 NMT 入口）
- 可选 NMT Repair（低质量分数 / 同音字检测）

**触发条件**:
- `aggregatedText` 非空
- `src_lang` / `tgt_lang` 有效
- 文本被聚合或 Pipeline NMT 已禁用

#### 3.3 DedupStage

**文件**: `electron_node/electron-node/main/src/agent/postprocess/dedup-stage.ts`

**职责**:
- 基于最终文本决定是否发送
- 维护 `lastSentText`

**去重 Key**:
```
normalize(aggregatedText) + '|' + normalize(translatedText || '')
```

### 4. PostProcessCoordinator

**文件**: `electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

**职责**:
- 串联各 Stage
- 管理 session / trace / context
- 汇总最终输出

**处理流程**:
```
AggregationStage → TranslationStage → DedupStage
```

### 5. NodeAgent 集成

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

- ✅ 初始化 `PostProcessCoordinator`（通过 Feature Flag 控制）
- ✅ 优先使用 `PostProcessCoordinator`（新架构）
- ✅ 保留 `AggregatorMiddleware`（旧架构，向后兼容）

**关键变更**:
```typescript
// 优先使用 PostProcessCoordinator（新架构）
if (enablePostProcessTranslation && this.postProcessCoordinator) {
  const postProcessResult = await this.postProcessCoordinator.process(job, result);
  // ...
} else if (this.aggregatorMiddleware.isEnabled()) {
  // 使用旧架构：AggregatorMiddleware
  const middlewareResult = await this.aggregatorMiddleware.process(job, result);
  // ...
}
```

## 新流程总览

```
NodeAgent
  → InferenceService
    → PipelineOrchestrator
        - ASR（带 S1 Prompt）
        - 不再执行 NMT（默认）
        - 不再执行 TTS（默认）
  → PostProcessCoordinator（新架构）
        → AggregationStage（文本聚合）
        → TranslationStage（唯一 NMT 入口）
        → DedupStage（去重检查）
  → NodeAgent 发送 job_result
```

## Feature Flag 控制

### 默认配置（推荐）

```json
{
  "features": {
    "enablePipelineNMT": false,  // 禁用 Pipeline NMT
    "enablePostProcessTranslation": true  // 启用 PostProcess 翻译
  }
}
```

### 回滚配置（如果需要）

```json
{
  "features": {
    "enablePipelineNMT": true,  // 启用 Pipeline NMT（旧架构）
    "enablePostProcessTranslation": false  // 禁用 PostProcess 翻译
  }
}
```

## 预期效果

### 性能优化

1. **减少重复 NMT 调用**:
   - 之前：Pipeline NMT + PostProcess NMT（如果文本被聚合）
   - 之后：仅 PostProcess NMT（唯一入口）
   - **减少约 50% 的 NMT 调用**（在聚合场景下）

2. **GPU 占用降低**:
   - 避免临时翻译的 GPU 计算
   - 仅在最终文本确定后才进行翻译

### 架构优化

1. **职责清晰**:
   - AggregationStage：文本聚合
   - TranslationStage：翻译（唯一入口）
   - DedupStage：去重检查

2. **可维护性提升**:
   - 各 Stage 独立，易于测试和维护
   - 清晰的接口和职责边界

3. **可扩展性提升**:
   - 易于添加新的 Stage
   - 易于调整 Stage 顺序

## 向后兼容

- ✅ 保留 `AggregatorMiddleware`（旧架构）
- ✅ 通过 Feature Flag 控制使用哪个架构
- ✅ 默认使用新架构，但可以回滚到旧架构

## 验证方法

1. **检查日志**:
   - 查看是否有 "PostProcessCoordinator initialized" 日志
   - 查看是否有 "Pipeline NMT disabled" 日志
   - 确认没有重复的 NMT 调用

2. **监控指标**:
   - NMT 调用次数应该显著下降（在聚合场景下）
   - GPU 占用应该降低
   - 最终发送文本与当前行为一致

3. **功能验证**:
   - 文本聚合功能正常
   - 翻译功能正常
   - 去重功能正常
   - 无重复发送、无漏发送

## 后续优化建议

1. **TTS 位置调整**:
   - 当前 TTS 仍在 Pipeline 中（如果 Pipeline NMT 启用）
   - 建议将 TTS 下沉到 TranslationStage 之后（使用最终翻译文本）

2. **清理旧代码**:
   - 在验证新架构稳定后，可以删除 `AggregatorMiddleware` 中的翻译逻辑
   - 简化代码结构

3. **指标收集**:
   - 添加各 Stage 的处理时间指标
   - 添加 NMT 调用次数对比指标

## 总结

✅ **已完成所有改造任务**：
1. ✅ PipelineOrchestrator 中禁用 NMT（通过 Feature Flag）
2. ✅ 创建 PostProcessCoordinator 和各个 Stage
3. ✅ 更新 NodeAgent 使用新架构
4. ✅ 保持向后兼容（可通过 Feature Flag 回滚）

**预期收益**：
- 减少约 50% 的 NMT 调用（在聚合场景下）
- GPU 占用降低
- 架构更清晰、可维护性提升
- 可扩展性提升

**下一步**：
- 验证新架构的功能和性能
- 收集指标对比数据
- 根据实际情况调整配置

