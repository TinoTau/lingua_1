# 语义修复步骤执行条件：shouldExecuteStep 与相关逻辑

**用途**：供决策部门审议「何时执行语义修复步骤」时参考。  
**日期**：2026-01。

---

## 一、shouldExecuteStep 是什么

Pipeline 在按模式执行每一步前，会调用 `shouldExecuteStep(step, mode, job, ctx)` 判断**是否执行该步骤**。若返回 `false`，该步骤被跳过（不调用 `runSemanticRepairStep` 等）。

**代码位置**：`electron_node/electron-node/main/src/pipeline/pipeline-mode-config.ts`  
**调用位置**：`electron_node/electron-node/main/src/pipeline/job-pipeline.ts`（约 87 行）

```typescript
// job-pipeline.ts 中
for (const step of mode.steps) {
  if (!shouldExecuteStep(step, mode, job, ctx)) {
    logger.debug(..., `Skipping step ${step} (condition not met)`);
    continue;
  }
  await executeStep(step, job, ctx, services, stepOptions);
  ...
}
```

---

## 二、shouldExecuteStep 完整逻辑（代码片段）

```typescript
// 文件: electron_node/electron-node/main/src/pipeline/pipeline-mode-config.ts

export function shouldExecuteStep(
  step: PipelineStepType,
  mode: PipelineMode,
  job: JobAssignMessage,
  ctx?: JobContext  // 可选的上下文，用于检查语义修复标志
): boolean {
  // 1. 步骤是否在模式的步骤列表中
  if (!mode.steps.includes(step)) {
    return false;
  }

  // 2. 是否有该步骤的自定义条件（如 YOURTTS 的 use_tone）
  if (mode.conditions?.[step]) {
    return mode.conditions[step](job);
  }

  // 3. 根据 pipeline 配置与步骤类型判断
  const pipeline = job.pipeline || {};
  const use_asr = pipeline.use_asr ?? true;
  const use_nmt = pipeline.use_nmt ?? true;
  const use_tts = pipeline.use_tts ?? true;
  const use_tone = pipeline.use_tone ?? false;
  const use_semantic = 'use_semantic' in pipeline ? (pipeline as any).use_semantic : false;

  switch (step) {
    case 'ASR':
    case 'AGGREGATION':
    case 'DEDUP':
      return use_asr !== false;
    case 'SEMANTIC_REPAIR':
      // 由 AGGREGATION 步骤写入 ctx.shouldSendToSemanticRepair，无聚合器时 aggregation-step 也会设为 true
      return ctx?.shouldSendToSemanticRepair === true;
    case 'TRANSLATION':
      return use_nmt !== false;
    case 'TTS':
      return use_tts !== false && use_tone !== true;
    case 'YOURTTS':
      return use_tone === true;
    default:
      return true;
  }
}
```

**要点**：

- **SEMANTIC_REPAIR** 是否执行**只**看 `ctx?.shouldSendToSemanticRepair === true`。
- `job.pipeline.use_semantic` 当前未参与 SEMANTIC_REPAIR 的判定（仅被读取，未在 switch 里使用）。
- 其他步骤（ASR/AGGREGATION/DEDUP/TRANSLATION/TTS/YOURTTS）依赖 `job.pipeline` 的 use_asr / use_nmt / use_tts / use_tone 或 mode.conditions。

---

## 三、ctx.shouldSendToSemanticRepair 由谁写入

`ctx.shouldSendToSemanticRepair` 只在 **AGGREGATION 步骤** 被写入；SEMANTIC_REPAIR 步骤执行时只读该字段。

### 3.1 写入位置：aggregation-step.ts

```typescript
// 文件: electron_node/electron-node/main/src/pipeline/steps/aggregation-step.ts

// 无聚合器：ASR 文本即本段，直接送语义修复
if (!services.aggregatorManager) {
  ctx.segmentForJobResult = ctx.asrText;
  ctx.aggregationChanged = false;
  ctx.shouldSendToSemanticRepair = true;
  return;
}

// 有聚合器：由 AggregationStage.process 的返回值决定
const aggregationResult = aggregationStage.process(...);
ctx.segmentForJobResult = aggregationResult.segmentForJobResult;
ctx.shouldSendToSemanticRepair = aggregationResult.shouldSendToSemanticRepair;
if (aggregationResult.shouldSendToSemanticRepair === false) {
  ctx.repairedText = '';
}
```

- **无 aggregatorManager**：固定设为 `true`，本段会走语义修复。
- **有 aggregatorManager**：完全由 `aggregationResult.shouldSendToSemanticRepair` 决定。

### 3.2 aggregationResult.shouldSendToSemanticRepair 的来源

来自 **AggregationStage** 内部调用的 **TextForwardMergeManager.processText()** 的返回值里的 `shouldSendToSemanticRepair`。即：  
「是否送语义修复」由**聚合阶段的 Gate 决策**决定，规则见下一节。

---

## 四、Gate 决策：何时为 true / false（TextForwardMergeManager）

TextForwardMergeManager 按**合并后文本长度**和**是否手动截断**做 SEND/HOLD/DROP，并设置 `shouldSendToSemanticRepair`。

**代码位置**：`electron_node/electron-node/main/src/agent/postprocess/text-forward-merge-manager.ts`  
**配置**：`node-config` 的 `textLength`（默认见下），在构造函数中加载。

| 配置项 | 默认值 | 含义 |
|--------|--------|------|
| minLengthToKeep | 6 | 低于此长度视为过短，可丢弃 |
| minLengthToSend | 20 | 达到此长度才可能直接 SEND（或 6–20 手动发送） |
| maxLengthToWait | 40 | 超过此长度本批直接 SEND，不再等待 |
| waitTimeoutMs | 3000 | HOLD 等待合并/确认的超时（毫秒） |

**Gate 规则摘要**（`decideGateAction`）：

| 合并后长度 | 手动截断 (isManualCut) | 行为 | shouldSendToSemanticRepair |
|------------|------------------------|------|----------------------------|
| &lt; 6      | 任意 | DROP（丢弃） | **false** |
| 6–20       | true | SEND（直接送语义修复） | **true** |
| 6–20       | false | HOLD（等待与下一句合并，超时后若仅 flush pending 则 SEND） | **false**（本次）；超时 flush 时为 **true** |
| 20–40      | true | SEND | **true** |
| 20–40      | false | HOLD（等待 3 秒确认是否有后续输入，超时后 SEND） | **false**（本次）；超时后 SEND 时为 **true** |
| &gt; 40      | 任意 | SEND（本批直接送语义修复） | **true** |

此外：

- **Pending 超时且无新 currentText**：flush pending 时返回 `shouldSendToSemanticRepair: true`。
- **完全被上一句包含且合并后过短**：返回 `shouldSendToSemanticRepair: false`（DROP）。

因此：**只有 AGGREGATION 步骤里 Gate 输出「本段要 SEND」时，ctx.shouldSendToSemanticRepair 才会为 true，SEMANTIC_REPAIR 步骤才会执行。**

---

## 五、与 semantic-repair-step 的关系

- **semantic-repair-step.ts** 内**没有** `shouldExecuteStep`。  
- 是否执行语义修复步骤由 **job-pipeline** 在循环里用 `shouldExecuteStep('SEMANTIC_REPAIR', mode, job, ctx)` 决定；为 `false` 时**不会**调用 `runSemanticRepairStep`。
- 若通过 `shouldExecuteStep`（即 `ctx.shouldSendToSemanticRepair === true`），才会进入 `runSemanticRepairStep`；其内部再检查 `segmentForJobResult`、initializer、stage 等，不满足时会设 `ctx.repairedText = ''`、`ctx.shouldSend = false` 等，但不改变「本步是否被调用」的决策。

---

## 六、单元测试要点（供复核逻辑）

- **pipeline-mode-config.semantic-repair.test.ts**：  
  - `ctx.shouldSendToSemanticRepair === true` → 执行 SEMANTIC_REPAIR；  
  - `undefined` / `false` / `ctx` 为 undefined → 跳过 SEMANTIC_REPAIR。  
- **aggregation-step.test.ts**：无 aggregatorManager 时仍设置 `ctx.shouldSendToSemanticRepair = true`，保证在无聚合器场景下也会执行语义修复步骤。

---

## 七、小结（供决策参考）

1. **SEMANTIC_REPAIR 是否执行**：仅由 `ctx.shouldSendToSemanticRepair === true` 决定，该值由 **AGGREGATION 步骤**写入。
2. **有聚合器时**：`shouldSendToSemanticRepair` 来自 **TextForwardMergeManager** 的 Gate 决策（长度 6/20/40、是否手动截断、是否 HOLD 超时等）。
3. **无聚合器时**：聚合步骤固定设 `shouldSendToSemanticRepair = true`，本段必走语义修复。
4. 若需「按 job 配置关闭语义修复」，需要在现有逻辑上**新增**对 `job.pipeline.use_semantic`（或类似字段）的判断，例如在 `shouldExecuteStep` 的 `SEMANTIC_REPAIR` 分支中与 `ctx?.shouldSendToSemanticRepair === true` 一起考虑。
