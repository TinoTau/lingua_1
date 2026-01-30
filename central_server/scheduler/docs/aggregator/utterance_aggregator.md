# UtteranceAggregator 配置对比

**日期**: 2026-01-24  
**目的**: 对比备份代码和当前代码的 UtteranceAggregator 配置，分析启用状态

---

## 一、关键发现

### 1.1 备份代码配置

**文件**: `expired/lingua_1-main/electron_node/electron-node/main/src/agent/node-agent.ts`

```typescript
// 第109-119行
const aggregatorConfig: AggregatorMiddlewareConfig = {
  enabled: true,  // ✅ 启用 AggregatorMiddleware
  mode: 'offline',
  ttlMs: 5 * 60 * 1000,
  maxSessions: 500,
  translationCacheSize: 200,
  translationCacheTtlMs: 10 * 60 * 1000,
  enableAsyncRetranslation: true,
  asyncRetranslationThreshold: 50,
};
this.aggregatorMiddleware = new AggregatorMiddleware(aggregatorConfig, taskRouter);

// 第131-135行：提取 AggregatorManager 并传递给 InferenceService
const aggregatorManager = (this.aggregatorMiddleware as any).manager;
if (aggregatorManager && this.inferenceService) {
  (this.inferenceService as any).setAggregatorManager(aggregatorManager);
  logger.info({}, 'S1: AggregatorManager passed to InferenceService for prompt building');
}
```

**结果**:
- `AggregatorMiddleware` **启用**（`enabled: true`）
- `AggregatorManager` 被创建（在 `AggregatorMiddleware` 构造函数中）
- `AggregatorManager` 被传递给 `InferenceService`
- `hasAggregatorManager: true`

### 1.2 当前代码配置（修复前）

**文件**: `electron_node/electron-node/main/src/agent/node-agent-simple.ts`

```typescript
// 第116-122行
const aggregatorMiddleware = new AggregatorMiddleware({ 
  enabled: false,  // ❌ 禁用 AggregatorMiddleware
  mode: 'offline',
  ttlMs: 300000,
  maxSessions: 1000
});
this.resultSender = new ResultSender(aggregatorMiddleware);
```

**结果**:
- `AggregatorMiddleware` **禁用**（`enabled: false`）
- `AggregatorManager` **未被创建**（因为 `enabled: false`）
- `AggregatorManager` **未被传递**给 `InferenceService`
- `hasAggregatorManager: false`

### 1.3 当前代码配置（修复后）

**文件**: `electron_node/electron-node/main/src/agent/node-agent-simple.ts`

```typescript
const aggregatorMiddleware = new AggregatorMiddleware({ 
  enabled: true,  // ✅ 启用 AggregatorMiddleware（与备份代码一致）
  mode: 'offline',
  ttlMs: 5 * 60 * 1000,  // 5分钟（与备份代码一致）
  maxSessions: 500,  // 降低最大会话数（与备份代码一致）
  translationCacheSize: 200,  // 翻译缓存大小（与备份代码一致）
  translationCacheTtlMs: 10 * 60 * 1000,  // 翻译缓存过期时间（与备份代码一致）
  enableAsyncRetranslation: true,  // 异步重新翻译（与备份代码一致）
  asyncRetranslationThreshold: 50,  // 异步重新翻译阈值（与备份代码一致）
});
this.resultSender = new ResultSender(aggregatorMiddleware);

// ✅ 新增：提取 AggregatorManager 并传递给 InferenceService（与备份代码一致）
const aggregatorManager = (aggregatorMiddleware as any).manager;
if (aggregatorManager && this.inferenceService) {
  this.inferenceService.setAggregatorManager(aggregatorManager);
  logger.info({}, 'S1: AggregatorManager passed to InferenceService for prompt building');
}

// ✅ 新增：将 AggregatorMiddleware 传递给 InferenceService（与备份代码一致）
if (aggregatorMiddleware && this.inferenceService) {
  this.inferenceService.setAggregatorMiddleware(aggregatorMiddleware);
  logger.info({}, 'AggregatorMiddleware passed to InferenceService for pre-NMT aggregation');
}
```

**结果**:
- `AggregatorMiddleware` **启用**（`enabled: true`）
- `AggregatorManager` **被创建**
- `AggregatorManager` **被传递**给 `InferenceService`
- `hasAggregatorManager: true`

---

## 二、问题根源

### 2.1 为什么当前代码禁用了 AggregatorMiddleware？

从代码注释看：
```typescript
// 初始化结果发送器（不需要 AggregatorMiddleware，它已经在 JobPipeline 中处理了）
const aggregatorMiddleware = new AggregatorMiddleware({ 
  enabled: false,  // ...
});
```

**说明**: 开发者认为文本聚合已经在 `JobPipeline` 中处理了，所以禁用了 `AggregatorMiddleware`。

### 2.2 但实际上文本聚合需要 AggregatorManager

从 `aggregation-step.ts` 看：
```typescript
// 第25行
if (!services.aggregatorManager) {
  // 如果没有 AggregatorManager，直接使用 ASR 文本
  return {
    aggregatedText: result.text_asr || '',
    aggregationChanged: false,
  };
}
```

**问题**: 如果 `aggregatorManager` 为 `null`，`AggregationStage` 不会进行文本聚合，直接返回原始 ASR 文本。

---

## 三、修复方案

### 3.1 修复步骤

1. ✅ **启用 AggregatorMiddleware**：将 `enabled: false` 改为 `enabled: true`
2. ✅ **提取并传递 AggregatorManager**：从 `aggregatorMiddleware` 中提取 `aggregatorManager`，调用 `inferenceService.setAggregatorManager(aggregatorManager)`
3. ✅ **确保 AggregatorManager 被传递到 servicesBundle**：`InferenceService` 会将 `aggregatorManager` 添加到 `servicesBundle`，`servicesBundle.aggregatorManager` 会被传递给 `PipelineOrchestratorASRHandler` 和 `AggregationStage`
4. ✅ **配置与备份代码一致**：所有配置参数与备份代码保持一致

### 3.2 修复效果

修复后：
1. ✅ `AggregatorMiddleware` 启用（`enabled: true`）
2. ✅ `AggregatorManager` 被创建
3. ✅ `AggregatorManager` 被传递给 `InferenceService` 和 `servicesBundle`
4. ✅ `hasAggregatorManager: true`
5. ✅ `AggregationStage` 能够进行文本聚合，将多个 job 的文本结果合并

---

## 四、验证方法

修复后，检查日志：
1. ✅ 应该看到：`"S1: AggregatorManager passed to InferenceService for prompt building"`
2. ✅ 应该看到：`"AggregatorMiddleware passed to InferenceService for pre-NMT aggregation"`
3. ✅ 应该看到：`hasAggregatorManager: true`（在 ASR 处理日志中）
4. ✅ 应该看到：`AggregationStage` 的聚合日志（如果多个 job 的文本被合并）

---

## 五、总结

### 5.1 根本原因

- 当前代码中 `AggregatorMiddleware` 被禁用（`enabled: false`）
- 导致 `AggregatorManager` 未被创建
- 导致 `hasAggregatorManager: false`
- 导致 `AggregationStage` 无法进行文本聚合

### 5.2 修复方案

- ✅ 启用 `AggregatorMiddleware`（`enabled: true`）
- ✅ 提取并传递 `AggregatorManager` 给 `InferenceService`
- ✅ 确保配置与备份代码一致

### 5.3 修复状态

✅ **已修复**：当前代码中已启用 AggregatorMiddleware（`enabled: true`），配置与备份代码一致

---

## 六、相关文档

- [AggregatorMiddleware 功能说明](./aggregator_middleware.md)
- [任务管理](../job/README.md)
- [音频处理](../audio/README.md)

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24
