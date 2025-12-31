# 重新触发 NMT 功能详细说明

**功能名称**：Aggregator 重新触发 NMT 翻译  
**目标**：当文本被聚合时，重新翻译聚合后的文本，确保翻译与聚合后的文本匹配

---

## 功能概述

### 问题背景

当前流程：
```
ASR → NMT → TTS → Aggregator（聚合文本）→ 发送结果
```

问题：
- Aggregator 聚合了 `text_asr`（例如："我们" + "今天" → "我们今天"）
- 但 `text_translated` 仍然是原始翻译（"we"）
- 导致翻译与聚合后的文本不匹配

### 解决方案

在 Aggregator 中间件中，当检测到文本被聚合时，重新调用 NMT 服务翻译聚合后的文本。

---

## 具体功能清单

### 1. 文本变化检测

**功能**：检测文本是否被聚合

**实现位置**：`aggregator-middleware.ts` 的 `process()` 方法

**逻辑**：
```typescript
// 比较聚合后的文本和原始文本
const textChanged = aggregatedText !== asrTextTrimmed;

// 或者更精确的比较（去除空白字符）
const textChanged = aggregatedText.trim() !== asrTextTrimmed.trim();
```

**触发条件**：
- `aggregatedText` 与 `asrTextTrimmed` 不同
- 可能的原因：
  - MERGE 操作：多个 utterance 合并
  - Dedup 操作：去重后文本变化
  - Tail Carry：尾部文本被合并

---

### 2. NMT 任务构建

**功能**：构建 NMT 翻译任务

**实现位置**：`aggregator-middleware.ts`

**任务参数**：
```typescript
const nmtTask: NMTTask = {
  text: aggregatedText,        // 聚合后的文本（需要翻译的文本）
  src_lang: job.src_lang,      // 源语言（从 job 中获取）
  tgt_lang: job.tgt_lang,      // 目标语言（从 job 中获取）
  context_text: undefined,     // 上下文（可选，暂时不传递）
  job_id: job.job_id,          // 任务 ID（用于任务管理和取消）
};
```

**参数说明**：
- `text`: 聚合后的完整文本
- `src_lang`: 源语言代码（如 "zh", "en"）
- `tgt_lang`: 目标语言代码（如 "en", "zh"）
- `context_text`: 上下文文本（可选，用于提升翻译质量）
- `job_id`: 任务 ID（用于任务管理和取消）

---

### 3. NMT 服务调用

**功能**：调用 NMT 服务进行翻译

**实现位置**：通过 `TaskRouter.routeNMTTask()` 调用

**调用流程**：
```
AggregatorMiddleware
  ↓
TaskRouter.routeNMTTask()
  ↓
选择 NMT 服务端点
  ↓
HTTP POST /v1/translate
  ↓
NMT 服务处理
  ↓
返回翻译结果
```

**HTTP 请求**：
```typescript
POST http://127.0.0.1:5008/v1/translate
Content-Type: application/json

{
  "text": "我们今天讨论一下",
  "src_lang": "zh",
  "tgt_lang": "en",
  "context_text": null
}
```

**HTTP 响应**：
```typescript
{
  "text": "Let's discuss today",
  "confidence": 0.95
}
```

**返回结果**：
```typescript
interface NMTResult {
  text: string;           // 翻译后的文本
  confidence?: number;    // 翻译置信度（可选）
}
```

---

### 4. 翻译结果更新

**功能**：更新 `text_translated` 字段

**实现位置**：`aggregator-middleware.ts` 和 `node-agent.ts`

**更新流程**：
```typescript
// 1. 在 aggregator-middleware.ts 中
const middlewareResult = await this.aggregatorMiddleware.process(job, result);

// middlewareResult 包含：
{
  shouldSend: true,
  aggregatedText: "我们今天讨论一下",
  translatedText: "Let's discuss today",  // 新增：重新翻译的文本
  action: "MERGE",
  metrics: { ... }
}

// 2. 在 node-agent.ts 中
finalResult = {
  ...result,
  text_asr: middlewareResult.aggregatedText,
  text_translated: middlewareResult.translatedText || result.text_translated,  // 使用新翻译或降级到原始翻译
};
```

---

### 5. 错误处理和降级策略

**功能**：处理 NMT 调用失败的情况

**实现位置**：`aggregator-middleware.ts`

**错误场景**：
1. NMT 服务不可用
2. NMT 服务超时（60秒）
3. NMT 服务返回错误
4. 网络错误

**降级策略**：
```typescript
try {
  const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
  translatedText = nmtResult.text;
} catch (error) {
  // 降级：使用原始翻译
  logger.error(
    { error, jobId: job.job_id, sessionId: job.session_id },
    'Failed to re-trigger NMT, using original translation'
  );
  translatedText = result.text_translated;  // 使用原始翻译
}
```

**降级逻辑**：
- 如果 NMT 调用失败，使用原始翻译（`result.text_translated`）
- 记录错误日志，便于排查问题
- 不影响整体流程（不会导致任务失败）

---

### 6. 性能优化

**功能**：优化重新翻译的性能

**优化策略**：

#### 6.1 条件判断优化
```typescript
// 只在文本真正变化时才重新翻译
if (aggregatedText.trim() !== asrTextTrimmed.trim()) {
  // 重新翻译
}
```

#### 6.2 缓存机制（可选）
```typescript
// 缓存最近翻译的文本（避免重复翻译）
const cacheKey = `${aggregatedText}_${job.src_lang}_${job.tgt_lang}`;
if (this.translationCache.has(cacheKey)) {
  translatedText = this.translationCache.get(cacheKey);
} else {
  const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
  translatedText = nmtResult.text;
  this.translationCache.set(cacheKey, translatedText);
}
```

#### 6.3 异步处理（可选）
```typescript
// 如果延迟要求不高，可以异步处理
if (textChanged) {
  // 先返回结果，异步重新翻译
  this.reTranslateAsync(job, aggregatedText, result.text_translated);
}
```

---

### 7. 日志和监控

**功能**：记录重新翻译的日志和指标

**日志内容**：
```typescript
logger.debug(
  {
    jobId: job.job_id,
    sessionId: job.session_id,
    originalText: asrTextTrimmed,
    aggregatedText,
    originalTranslation: result.text_translated,
    newTranslation: translatedText,
    translationTimeMs: translationTimeMs,  // 翻译耗时
  },
  'Re-triggered NMT for aggregated text'
);
```

**监控指标**：
- `nmtRetranslationCount`: 重新翻译次数
- `nmtRetranslationLatencyMs`: 重新翻译延迟
- `nmtRetranslationErrorCount`: 重新翻译失败次数
- `nmtRetranslationCacheHitRate`: 缓存命中率（如果实现缓存）

---

### 8. 接口扩展

**功能**：扩展中间件接口以支持重新翻译

**接口变更**：

#### 8.1 AggregatorMiddlewareResult
```typescript
export interface AggregatorMiddlewareResult {
  shouldSend: boolean;
  aggregatedText?: string;
  translatedText?: string;  // 新增：重新翻译的文本
  action?: 'MERGE' | 'NEW_STREAM';
  metrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
    nmtRetranslationTimeMs?: number;  // 新增：重新翻译耗时
  };
}
```

#### 8.2 AggregatorMiddleware 构造函数
```typescript
export class AggregatorMiddleware {
  private taskRouter: TaskRouter;  // 新增：需要访问 TaskRouter

  constructor(
    config: AggregatorMiddlewareConfig,
    taskRouter: TaskRouter  // 新增：通过依赖注入传递
  ) {
    this.config = config;
    this.taskRouter = taskRouter;  // 保存引用
    // ...
  }
}
```

---

## 完整工作流程

### 流程图

```
1. NodeAgent.handleJob()
   ↓
2. InferenceService.processJob()
   ├─ ASR → "我们"
   ├─ NMT → "we"
   └─ TTS → audio
   ↓
3. AggregatorMiddleware.process()
   ├─ 检测文本变化
   ├─ 聚合文本："我们" + "今天" → "我们今天"
   ├─ 检测到文本变化
   ├─ 构建 NMT 任务
   ├─ 调用 TaskRouter.routeNMTTask()
   │   ├─ 选择 NMT 服务端点
   │   ├─ HTTP POST /v1/translate
   │   └─ 返回翻译结果："Let's discuss today"
   └─ 返回结果（包含新翻译）
   ↓
4. NodeAgent.handleJob() (继续)
   ├─ 更新 finalResult.text_asr = "我们今天"
   ├─ 更新 finalResult.text_translated = "Let's discuss today"
   └─ 发送结果到 Scheduler
```

### 代码示例

#### aggregator-middleware.ts
```typescript
async process(
  job: JobAssignMessage,
  result: JobResult
): Promise<AggregatorMiddlewareResult> {
  // ... 现有聚合逻辑 ...
  
  let aggregatedText = asrTextTrimmed;
  let translatedText = result.text_translated;
  let nmtRetranslationTimeMs: number | undefined;
  
  if (aggregatorResult.shouldCommit && aggregatorResult.text) {
    aggregatedText = aggregatorResult.text;
    
    // 检测文本是否被聚合
    if (aggregatedText.trim() !== asrTextTrimmed.trim()) {
      // 文本被聚合，重新触发 NMT
      const nmtStartTime = Date.now();
      
      try {
        const nmtTask: NMTTask = {
          text: aggregatedText,
          src_lang: job.src_lang,
          tgt_lang: job.tgt_lang,
          context_text: undefined,
          job_id: job.job_id,
        };
        
        const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
        translatedText = nmtResult.text;
        nmtRetranslationTimeMs = Date.now() - nmtStartTime;
        
        logger.debug(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            originalText: asrTextTrimmed,
            aggregatedText,
            originalTranslation: result.text_translated,
            newTranslation: translatedText,
            translationTimeMs: nmtRetranslationTimeMs,
          },
          'Re-triggered NMT for aggregated text'
        );
      } catch (error) {
        // 降级：使用原始翻译
        logger.error(
          { error, jobId: job.job_id, sessionId: job.session_id },
          'Failed to re-trigger NMT, using original translation'
        );
        translatedText = result.text_translated;
      }
    }
  }
  
  return {
    shouldSend: true,
    aggregatedText,
    translatedText,  // 新增
    action: aggregatorResult.action,
    metrics: {
      ...aggregatorResult.metrics,
      nmtRetranslationTimeMs,  // 新增
    },
  };
}
```

#### node-agent.ts
```typescript
const middlewareResult = await this.aggregatorMiddleware.process(job, result);

if (middlewareResult.shouldSend && middlewareResult.aggregatedText !== undefined) {
  finalResult = {
    ...result,
    text_asr: middlewareResult.aggregatedText,
    text_translated: middlewareResult.translatedText || result.text_translated,  // 使用新翻译或降级
  };
}
```

---

## 功能影响

### 正面影响

1. ✅ **翻译质量提升**：翻译与聚合后的文本匹配
2. ✅ **用户体验改善**：避免翻译错误
3. ✅ **功能完整性**：Aggregator 功能更加完整

### 负面影响

1. ⚠️ **延迟增加**：NMT 调用增加延迟（通常 100-500ms）
2. ⚠️ **资源消耗**：额外的 NMT 服务调用
3. ⚠️ **复杂度增加**：需要处理错误和降级

### 性能影响

- **延迟增加**：每次文本聚合时增加 NMT 调用时间（100-500ms）
- **资源消耗**：额外的 GPU/CPU 资源用于翻译
- **吞吐量影响**：可能影响整体吞吐量（取决于 NMT 服务容量）

---

## 验收标准

### 功能验收

1. ✅ **文本聚合时自动重新翻译**
   - 当 MERGE 操作发生时，自动重新翻译
   - 当 Dedup 操作导致文本变化时，自动重新翻译

2. ✅ **翻译结果正确**
   - 翻译与聚合后的文本匹配
   - 翻译质量不低于原始翻译

3. ✅ **错误处理正常**
   - NMT 失败时降级到原始翻译
   - 不影响整体流程

### 性能验收

1. ✅ **延迟可控**
   - 重新翻译延迟 < 500ms（目标）
   - 不影响整体处理流程

2. ✅ **资源消耗合理**
   - 不显著增加系统负载
   - 不影响其他任务处理

### 可观测性验收

1. ✅ **日志完整**
   - 记录重新翻译的详细信息
   - 记录错误和降级情况

2. ✅ **指标监控**
   - 监控重新翻译次数
   - 监控重新翻译延迟
   - 监控重新翻译失败率

---

## 总结

重新触发 NMT 功能主要包括：

1. **文本变化检测**：检测文本是否被聚合
2. **NMT 任务构建**：构建翻译任务参数
3. **NMT 服务调用**：调用 NMT 服务进行翻译
4. **翻译结果更新**：更新 `text_translated` 字段
5. **错误处理**：处理失败情况，降级到原始翻译
6. **性能优化**：条件判断、缓存等优化
7. **日志监控**：记录日志和指标
8. **接口扩展**：扩展中间件接口

**预计工作量**：3-5 天  
**复杂度**：中等  
**优先级**：中等

