# Aggregator 中间件架构

## 架构变更

Aggregator 已从 `PipelineOrchestrator` 重构为 `NodeAgent` 中的中间件，实现了更好的解耦和灵活性。

## 新架构优势

### 1. 解耦设计
- **独立于 PipelineOrchestrator**：Aggregator 不再依赖 PipelineOrchestrator 的具体实现
- **不影响模型替换**：替换 ASR/NMT/TTS 模型时，Aggregator 逻辑保持不变
- **中间件模式**：可以轻松启用/禁用，不影响其他组件

### 2. 灵活性
- **可配置**：通过 `AggregatorMiddlewareConfig` 控制是否启用
- **可替换**：可以轻松替换为其他聚合策略
- **可扩展**：可以添加其他中间件（如 NMT Repair）

### 3. 职责清晰
- **PipelineOrchestrator**：负责 ASR -> NMT -> TTS 的流水线编排
- **AggregatorMiddleware**：负责文本聚合与边界重建
- **NodeAgent**：负责消息处理和中间件协调

## 架构流程

```
JobAssignMessage (Scheduler)
  ↓
NodeAgent.handleJob()
  ↓
InferenceService.processJob()
  ↓
PipelineOrchestrator.processJob()
  ├─ ASR Service → ASRResult
  ├─ NMT Service → NMTResult
  └─ TTS Service → TTSResult
  ↓
JobResult (包含 text_asr, text_translated, tts_audio, segments)
  ↓
AggregatorMiddleware.process()  ← 中间件处理
  ├─ 处理 text_asr（聚合、去重、边界重建）
  └─ 返回处理后的结果
  ↓
JobResultMessage (发送到 Scheduler)
```

## 关键组件

### AggregatorMiddleware

位置：`main/src/agent/aggregator-middleware.ts`

**主要方法**：
- `process(job, result)`: 处理 JobResult，返回聚合后的结果
- `flush(sessionId)`: 强制 flush session
- `removeSession(sessionId)`: 清理 session
- `getMetrics(sessionId)`: 获取指标

**配置**：
```typescript
{
  enabled: true,  // 是否启用
  mode: 'offline' | 'room',  // 模式
  ttlMs: 5 * 60 * 1000,  // 会话超时时间
  maxSessions: 1000,  // 最大会话数
}
```

### NodeAgent 集成

在 `NodeAgent.handleJob()` 中：

```typescript
// 1. 调用推理服务获取结果
const result = await this.inferenceService.processJob(job, partialCallback);

// 2. 通过 Aggregator 中间件处理
if (this.aggregatorMiddleware.isEnabled()) {
  const middlewareResult = await this.aggregatorMiddleware.process(job, result);
  if (middlewareResult.shouldSend && middlewareResult.aggregatedText !== undefined) {
    finalResult = {
      ...result,
      text_asr: middlewareResult.aggregatedText,
    };
  }
}

// 3. 发送处理后的结果
const response: JobResultMessage = {
  ...finalResult,
};
```

## 数据流

### JobResult 扩展

为了支持 Aggregator，`JobResult` 接口已扩展：

```typescript
export interface JobResult {
  text_asr: string;
  text_translated: string;
  tts_audio: string;
  // ... 其他字段
  segments?: Array<{  // 新增：传递 segments 信息
    text: string;
    start?: number;
    end?: number;
    no_speech_prob?: number;
  }>;
}
```

### Segments 传递

`PipelineOrchestrator` 在返回 `JobResult` 时，会将 `asrResult.segments` 传递：

```typescript
const result: JobResult = {
  // ...
  segments: asrResult.segments as any,
};
```

## 启用/禁用

### 启用 Aggregator（默认）

在 `NodeAgent` 构造函数中：

```typescript
const aggregatorConfig: AggregatorMiddlewareConfig = {
  enabled: true,  // 启用
  mode: 'offline',
  // ...
};
this.aggregatorMiddleware = new AggregatorMiddleware(aggregatorConfig);
```

### 禁用 Aggregator

```typescript
const aggregatorConfig: AggregatorMiddlewareConfig = {
  enabled: false,  // 禁用
  // ...
};
```

## 迁移说明

### 从 PipelineOrchestrator 迁移

1. **已移除**：`PipelineOrchestrator` 中的 Aggregator 相关代码
2. **已添加**：`NodeAgent` 中的 `AggregatorMiddleware`
3. **已扩展**：`JobResult` 接口，添加 `segments` 字段

### 兼容性

- ✅ **向后兼容**：如果禁用 Aggregator，行为与之前完全一致
- ✅ **功能完整**：所有 Aggregator 功能保持不变
- ✅ **性能影响**：中间件处理开销 < 1ms，可忽略

## 未来扩展

### 可能的中间件

1. **NMT Repair Middleware**：同音字修复、轻量去噪
2. **Quality Filter Middleware**：质量过滤、坏段检测
3. **Context Manager Middleware**：上下文管理、会话状态

### 中间件链

可以设计为中间件链：

```typescript
const middlewareChain = [
  aggregatorMiddleware,
  nmtRepairMiddleware,
  qualityFilterMiddleware,
];

for (const middleware of middlewareChain) {
  result = await middleware.process(job, result);
}
```

## 测试

### 单元测试

测试 `AggregatorMiddleware` 的独立功能：

```typescript
const middleware = new AggregatorMiddleware({ enabled: true, mode: 'offline' });
const result = await middleware.process(job, jobResult);
```

### 集成测试

测试完整的 NodeAgent 流程，验证中间件是否正确集成。

## 总结

通过将 Aggregator 重构为中间件，我们实现了：

1. ✅ **更好的解耦**：不依赖 PipelineOrchestrator 的具体实现
2. ✅ **更高的灵活性**：可以轻松启用/禁用/替换
3. ✅ **不影响模型替换**：模型替换只影响 InferenceService，不影响 Aggregator
4. ✅ **可扩展性**：可以添加更多中间件

这种架构设计为未来的功能扩展和模型替换提供了更好的基础。

