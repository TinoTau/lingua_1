# 语义修复未调用问题 - 根本原因分析

**日期**: 2026-01-28  
**问题**: 虽然`shouldSendToSemanticRepair: true`，但语义修复步骤未被调用

---

## 一、问题确认

### 1.1 日志证据

**Utterance聚合结果**:
- Job0, Job1, Job2, Job4, Job5, Job7, Job8, Job9都显示`shouldSendToSemanticRepair: true`
- Job3显示`shouldSendToSemanticRepair: false`（因为`shouldWaitForMerge: true`，这是正常的设计行为）

**语义修复步骤执行**:
- ❌ 日志中**未找到**`runSemanticRepairStep`的调用
- ❌ 日志中**未找到**`Executing pipeline step: SEMANTIC_REPAIR`
- ❌ 日志中**未找到**`Skipping step SEMANTIC_REPAIR`（debug级别，可能被过滤）

**Pipeline执行顺序** (从日志看):
```
Job0: runAggregationStep → runDedupStep → runTranslationStep → runTtsStep
```
**注意**: 没有看到`runSemanticRepairStep`的执行

---

## 二、代码逻辑分析

### 2.1 Pipeline执行流程

**文件**: `pipeline/job-pipeline.ts`

**执行逻辑** (第72-99行):
```typescript
for (const step of mode.steps) {
  // 检查步骤是否应该执行
  if (!shouldExecuteStep(step, mode, job, ctx)) {
    logger.debug({ step, ... }, `Skipping step ${step} (condition not met)`);
    continue;  // 跳过步骤
  }
  
  // 执行步骤
  await executeStep(step, job, ctx, services, stepOptions);
}
```

**Pipeline步骤序列** (从`GENERAL_VOICE_TRANSLATION`模式):
```typescript
steps: ['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION', 'TTS']
```

### 2.2 语义修复步骤判断逻辑

**文件**: `pipeline/pipeline-mode-config.ts`

**判断逻辑** (第222-225行):
```typescript
case 'SEMANTIC_REPAIR':
    // 简化逻辑：只要 shouldSendToSemanticRepair 为 true，就执行语义修复
    // 不再需要显式设置 use_semantic，避免多层判断导致的问题
    return ctx?.shouldSendToSemanticRepair === true;
```

**关键点**:
- 语义修复步骤的执行条件**只依赖**`ctx.shouldSendToSemanticRepair === true`
- **不依赖**`pipeline.use_semantic`（虽然日志显示`use_semantic:false`，但这不影响执行）

### 2.3 ctx.shouldSendToSemanticRepair的设置

**文件**: `pipeline/steps/aggregation-step.ts`

**设置逻辑** (第93行):
```typescript
ctx.shouldSendToSemanticRepair = aggregationResult.shouldSendToSemanticRepair;
```

**时机**:
- 在`runAggregationStep`中设置
- AGGREGATION步骤在SEMANTIC_REPAIR步骤之前执行
- 理论上，`ctx.shouldSendToSemanticRepair`应该已经被设置

---

## 三、问题分析

### 3.1 可能的原因

#### 原因1: ctx参数类型不匹配

**问题**: `shouldExecuteStep`的`ctx`参数类型是部分类型

**代码** (`pipeline-mode-config.ts` 第196行):
```typescript
ctx?: { shouldSendToSemanticRepair?: boolean }  // 可选的上下文，用于检查语义修复标志
```

**分析**:
- 这是一个部分类型，只包含`shouldSendToSemanticRepair`字段
- 在`job-pipeline.ts`中调用时，传递的是完整的`ctx: JobContext`
- TypeScript应该可以正常访问，但需要确认运行时是否正确

#### 原因2: ctx.shouldSendToSemanticRepair在检查时为undefined

**可能原因**:
- `ctx.shouldSendToSemanticRepair`在`runAggregationStep`中设置
- 但在`shouldExecuteStep`检查时，可能还未被设置（时序问题）

**验证**: 需要检查执行顺序

#### 原因3: 日志级别问题

**问题**: `Skipping step`的日志是debug级别

**代码** (`job-pipeline.ts` 第89行):
```typescript
logger.debug({ step, ... }, `Skipping step ${step} (condition not met)`);
```

**分析**:
- 如果`shouldExecuteStep`返回`false`，会记录debug级别的日志
- 当前日志级别是30（info），debug日志可能被过滤
- 但如果是`true`，应该会执行`executeStep`，应该有info级别的日志

---

## 四、需要验证的点

### 4.1 检查ctx的传递

**需要确认**:
1. `shouldExecuteStep`被调用时，`ctx`参数是否正确传递
2. `ctx.shouldSendToSemanticRepair`的值是什么
3. 是否有其他代码修改了`ctx.shouldSendToSemanticRepair`

### 4.2 检查执行顺序

**需要确认**:
1. AGGREGATION步骤是否在SEMANTIC_REPAIR之前执行
2. `ctx.shouldSendToSemanticRepair`是否在检查前被设置
3. 是否有异步问题导致时序错误

### 4.3 检查日志级别

**需要确认**:
1. 当前日志级别配置
2. 是否有debug级别的日志被过滤
3. 是否有其他日志可以确认步骤执行状态

---

## 五、建议的调试方法

### 5.1 添加临时日志

**在`job-pipeline.ts`中添加**:
```typescript
if (step === 'SEMANTIC_REPAIR') {
  logger.info(
    {
      jobId: job.job_id,
      step,
      shouldSendToSemanticRepair: ctx.shouldSendToSemanticRepair,
      ctxKeys: Object.keys(ctx),
    },
    `[DEBUG] Checking SEMANTIC_REPAIR step execution`
  );
}
```

### 5.2 检查ctx的完整内容

**在`shouldExecuteStep`中添加**:
```typescript
if (step === 'SEMANTIC_REPAIR') {
  logger.info(
    {
      step,
      shouldSendToSemanticRepair: ctx?.shouldSendToSemanticRepair,
      ctxType: typeof ctx,
      ctxKeys: ctx ? Object.keys(ctx) : [],
    },
    `[DEBUG] shouldExecuteStep for SEMANTIC_REPAIR`
  );
}
```

---

## 六、初步结论

### 6.1 最可能的原因

**原因**: `ctx.shouldSendToSemanticRepair`在`shouldExecuteStep`检查时为`undefined`或`false`

**可能的情况**:
1. `ctx`参数传递不正确
2. `ctx.shouldSendToSemanticRepair`在检查时还未被设置（时序问题）
3. 有其他代码修改了`ctx.shouldSendToSemanticRepair`

### 6.2 需要进一步检查

1. **检查代码**: 确认`ctx`参数的传递和`shouldSendToSemanticRepair`的设置
2. **添加日志**: 在关键位置添加日志，确认执行流程
3. **检查时序**: 确认步骤执行顺序和`ctx.shouldSendToSemanticRepair`的设置时机

---

*需要进一步检查代码和添加调试日志，确认语义修复步骤未被调用的根本原因。*
