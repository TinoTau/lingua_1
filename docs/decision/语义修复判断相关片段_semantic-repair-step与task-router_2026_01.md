# 语义修复判断相关片段：semantic-repair-step 与 task-router-semantic-repair

**用途**：供决策部门参考「何时跳过/执行语义修复」「PASS/REPAIR/REJECT 如何影响上下文」「服务不可用时的降级」等判断逻辑。  
**日期**：2026-01。

**涉及文件**：
- `electron_node/electron-node/main/src/pipeline/steps/semantic-repair-step.ts`
- `electron_node/electron-node/main/src/task-router/task-router-semantic-repair.ts`

---

## 一、semantic-repair-step.ts：步骤内判断与上下文更新

### 1.1 入口与输入校验

```typescript
// 文件: electron_node/electron-node/main/src/pipeline/steps/semantic-repair-step.ts

export async function runSemanticRepairStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  // 语义修复只读本 job 的本段（聚合步骤必填）；修完即为此 job 的 text_asr / NMT 输入
  const textToRepair = (ctx.segmentForJobResult ?? '').trim();
  if (textToRepair.length === 0) {
    ctx.repairedText = '';
    return;
  }

  // 设计：所有需发送的 ASR 结果必须经语义修复服务处理；不可用时不得透传原文，不发送该结果
  if (!services.servicesHandler || !services.semanticRepairInitializer) {
    logger.error(..., 'runSemanticRepairStep: semantic repair required but initializer missing, not sending result');
    ctx.repairedText = '';
    ctx.shouldSend = false;
    return;
  }

  if (!semanticRepairInitializer.isInitialized()) {
    try {
      await semanticRepairInitializer.initialize();
    } catch (error: any) {
      logger.error(..., 'runSemanticRepairStep: semantic repair required but initialization failed, not sending result');
      ctx.repairedText = '';
      ctx.shouldSend = false;
      return;
    }
  }

  const semanticRepairStage = semanticRepairInitializer.getSemanticRepairStage();
  if (!semanticRepairStage) {
    logger.error(..., 'runSemanticRepairStep: semantic repair required but stage not available, not sending result');
    ctx.repairedText = '';
    ctx.shouldSend = false;
    return;
  }
  // ... 准备 microContext、sourceLang、jobWithDetectedLang，然后调用 stage.process
}
```

**判断要点**：
- **空段**：`segmentForJobResult` 为空或仅空白 → 只设 `ctx.repairedText = ''`，不设 `shouldSend`，直接 return。
- **缺服务或未就绪**：缺 `servicesHandler` / `semanticRepairInitializer`、初始化失败、或 `getSemanticRepairStage()` 为 null → 设 `ctx.repairedText = ''`、**`ctx.shouldSend = false`**（不发送本 job 结果），return。

---

### 1.2 根据 decision 更新上下文（REPAIR / PASS / REJECT / 其他）

```typescript
// 执行语义修复
try {
  const repairResult = await semanticRepairStage.process(
    jobWithDetectedLang as any,
    textToRepair,
    ctx.qualityScore,
    {
      segments: ctx.asrSegments,
      language_probability: ctx.asrResult?.language_probability,
      micro_context: microContext,
    }
  );

  if (repairResult.decision === 'REPAIR' || repairResult.decision === 'PASS') {
    ctx.repairedText = repairResult.textOut;
    ctx.semanticDecision = repairResult.decision;
    ctx.semanticRepairApplied = repairResult.semanticRepairApplied || false;
    ctx.semanticRepairConfidence = repairResult.confidence;

    // committedText 的最终权威写点：仅语义修复阶段允许写回
    if (services.aggregatorManager) {
      services.aggregatorManager.updateLastCommittedTextAfterRepair(
        job.session_id,
        job.utterance_index,
        textToRepair,
        ctx.repairedText
      );
    }
    // ... 日志
  } else if (repairResult.decision === 'REJECT') {
    logger.warn(..., 'runSemanticRepairStep: Semantic repair rejected text');
    ctx.repairedText = textToRepair;   // 保留原文
    ctx.semanticDecision = 'REJECT';
  } else {
    ctx.repairedText = textToRepair;   // 未知 decision 时保留原文
  }
} catch (error: any) {
  logger.error(..., 'runSemanticRepairStep: Semantic repair failed, using original text');
  ctx.repairedText = textToRepair;
}
```

**判断要点**：
- **REPAIR 或 PASS**：用 `repairResult.textOut` 写 `ctx.repairedText`，写 `semanticDecision`、`semanticRepairApplied`、`semanticRepairConfidence`，并调用 `updateLastCommittedTextAfterRepair`（若有 aggregatorManager）。
- **REJECT**：`ctx.repairedText = textToRepair`（原文），`ctx.semanticDecision = 'REJECT'`。
- **其他 decision**：仅设 `ctx.repairedText = textToRepair`。
- **抛错**：catch 里只设 `ctx.repairedText = textToRepair`，不改 `shouldSend`（前面未置 false 则仍会发送）。

---

### 1.3 小结（semantic-repair-step）

| 情况 | ctx.repairedText | ctx.shouldSend | ctx.semanticDecision |
|------|------------------|----------------|----------------------|
| 空段 | `''` | 不变 | 不变 |
| 缺服务/未初始化/无 stage | `''` | **false** | 不变 |
| decision === REPAIR 或 PASS | repairResult.textOut | 不变 | repairResult.decision |
| decision === REJECT | textToRepair（原文） | 不变 | 'REJECT' |
| 其他 decision | textToRepair | 不变 | 不变 |
| process() 抛错 | textToRepair | 不变 | 不变 |

---

## 二、task-router-semantic-repair.ts：路由与调用层判断

### 2.1 缓存与端点查找

```typescript
// 文件: electron_node/electron-node/main/src/task-router/task-router-semantic-repair.ts

async routeSemanticRepairTask(task: SemanticRepairTask): Promise<SemanticRepairResult> {
  // P2-1: 检查缓存（命中则直接返回，不调用服务）
  const cachedResult = this.cache.get(task.lang, task.text_in);
  if (cachedResult) {
    return cachedResult;
  }

  // 统一服务优先，再回退到按语言的独立服务
  let serviceId = this.getServiceIdForLanguage(task.lang);
  let endpoint: ServiceEndpoint | null = null;
  if (this.getServiceEndpointById) {
    const unifiedEndpoint = this.getServiceEndpointById('semantic-repair-en-zh');
    if (unifiedEndpoint && unifiedEndpoint.status === 'running') {
      serviceId = 'semantic-repair-en-zh';
      endpoint = unifiedEndpoint;
    }
  }
  if (!endpoint) {
    // ... 按 serviceId 查找 endpoint（getServiceEndpointById 或 selectServiceEndpoint）
    this.endpointCache.set(task.lang, endpoint);
  }
```

**判断要点**：缓存命中则**不发起请求**，直接返回缓存中的 decision/text_out/confidence；端点查找先统一服务 `semantic-repair-en-zh`，再按语言回退。

---

### 2.2 无端点 → 返回 PASS

```typescript
  if (!endpoint) {
    logger.debug(..., 'Semantic repair service not available, returning PASS');
    return {
      decision: 'PASS',
      text_out: task.text_in,
      confidence: 1.0,
      reason_codes: ['SERVICE_NOT_AVAILABLE'],
    };
  }
```

---

### 2.3 健康检查未通过 → 返回 PASS

```typescript
  if (this.isServiceRunningCallback) {
    const healthResult = await this.healthChecker.checkServiceHealth(
      endpoint.serviceId,
      endpoint.baseUrl,
      isProcessRunning
    );
    if (!healthResult.isAvailable) {
      logger.warn(..., 'Semantic repair service not available (not warmed), returning PASS');
      return {
        decision: 'PASS',
        text_out: task.text_in,
        confidence: 1.0,
        reason_codes: [`SERVICE_NOT_${healthResult.status}`],
      };
    }
  }
```

---

### 2.4 并发许可获取超时 → 返回 PASS

```typescript
  try {
    await this.concurrencyManager.acquire(endpoint.serviceId, task.job_id, 5000);
  } catch (error: any) {
    logger.warn(..., 'Semantic repair concurrency timeout, returning PASS');
    return {
      decision: 'PASS',
      text_out: task.text_in,
      confidence: 1.0,
      reason_codes: ['CONCURRENCY_TIMEOUT'],
    };
  }
```

**判断要点**：等待并发许可超时（5 秒）即返回 PASS，不调用下游服务。

---

### 2.5 调用服务成功 → 返回服务结果；失败 → 返回 PASS

```typescript
  try {
    const result = await this.callSemanticRepairService(endpoint, task);
    this.cache.set(task.lang, task.text_in, result);  // 只缓存 REPAIR 决策（见 P2-1 设计）
    return result;
  } catch (error: any) {
    logger.error(..., 'Semantic repair service error, returning PASS');
    return {
      decision: 'PASS',
      text_out: task.text_in,
      confidence: 1.0,
      reason_codes: ['SERVICE_ERROR'],
    };
  } finally {
    this.concurrencyManager.release(endpoint.serviceId, task.job_id);
    this.updateConnections(endpoint.serviceId, -1);
  }
```

**判断要点**：只有 `callSemanticRepairService` 成功才返回服务端的 decision（PASS/REPAIR/REJECT）；任何异常（含超时、HTTP 错误、解析错误）都返回 **PASS**，保证主链路不阻塞。

---

### 2.6 实际 HTTP 调用与响应校验（callSemanticRepairService）

```typescript
  private async callSemanticRepairService(
    endpoint: ServiceEndpoint,
    task: SemanticRepairTask
  ): Promise<SemanticRepairResult> {
    const url = `${endpoint.baseUrl}/repair`;
    const timeout = 10000; // 10 秒超时

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: task.job_id,
        session_id: task.session_id,
        utterance_index: task.utterance_index,
        lang: task.lang,
        text_in: task.text_in,
        quality_score: task.quality_score,
        micro_context: task.micro_context,
        meta: task.meta,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as any;
    if (!data.decision || !data.text_out || typeof data.confidence !== 'number') {
      throw new Error('Invalid response format from semantic repair service');
    }

    return {
      decision: data.decision,
      text_out: data.text_out,
      confidence: data.confidence,
      diff: data.diff,
      reason_codes: data.reason_codes || [],
      repair_time_ms: data.repair_time_ms,
    };
  }
```

**判断要点**：超时 10 秒会 abort，上层 catch 后返回 PASS；响应必须包含 `decision`、`text_out`、`confidence`（number），否则抛错，同样在上层变为 PASS。

---

### 2.7 小结（task-router-semantic-repair）

| 情况 | 返回值 decision | text_out | reason_codes 示例 |
|------|-----------------|----------|--------------------|
| 缓存命中 | 缓存中的 decision | 缓存中的 text_out | 缓存中的 reason_codes |
| 无可用端点 | PASS | task.text_in | SERVICE_NOT_AVAILABLE |
| 健康检查不可用 | PASS | task.text_in | SERVICE_NOT_${status} |
| 并发许可超时（5s） | PASS | task.text_in | CONCURRENCY_TIMEOUT |
| 调用服务成功 | 服务返回的 decision | 服务返回的 text_out | 服务返回的 reason_codes |
| 调用超时/异常/格式错误 | PASS | task.text_in | SERVICE_ERROR |

---

## 三、两处逻辑的衔接关系

1. **谁调谁**：`semantic-repair-step` 调用 `SemanticRepairStage.process()`，stage 内部会通过 **TaskRouterSemanticRepairHandler.routeSemanticRepairTask()** 选端点并调用 `callSemanticRepairService()`；step 只根据 `repairResult.decision` 更新 ctx。
2. **PASS 的来源**：  
   - 服务端返回的 PASS（引擎认为无需修复）；  
   - 或 task-router 层因「无端点、未 warmed、并发超时、调用异常」而直接返回的 PASS。  
   两种情况下 step 都按「REPAIR 或 PASS」分支处理，用返回的 `textOut` 写 `ctx.repairedText`。
3. **不发送结果**：仅当 step 内**未调用到 stage.process**（空段、缺服务、未初始化、无 stage）时才会设 `ctx.shouldSend = false`；一旦调用了 `routeSemanticRepairTask`，即便路由层返回 PASS，step 也不会置 `shouldSend = false`。

以上即为 `semantic-repair-step.ts` 与 `task-router-semantic-repair.ts` 中与语义修复判断相关的片段整理，供决策部门参考。
