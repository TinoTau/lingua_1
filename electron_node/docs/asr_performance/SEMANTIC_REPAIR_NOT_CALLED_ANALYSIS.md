# 语义修复未调用问题分析

**日期**: 2026-01-28  
**问题**: 虽然`shouldSendToSemanticRepair: true`，但语义修复步骤未被调用

---

## 一、问题发现

### 1.1 日志证据

**所有job的pipeline配置**:
```json
"pipeline":{"use_asr":true,"use_nmt":true,"use_tts":true,"use_semantic":false,"use_tone":false}
```

**Utterance聚合结果**:
- 大部分job显示`shouldSendToSemanticRepair: true`
- Job3显示`shouldSendToSemanticRepair: false`（因为`shouldWaitForMerge: true`）

**语义修复步骤执行**:
- ❌ 日志中**未找到**`runSemanticRepairStep`的调用
- ❌ 日志中**未找到**`Executing pipeline step: SEMANTIC_REPAIR`
- ❌ 日志中**未找到**`Skipping step SEMANTIC_REPAIR`

---

## 二、代码逻辑分析

### 2.1 Pipeline执行逻辑

**文件**: `pipeline/job-pipeline.ts`

**执行流程**:
```typescript
for (const step of mode.steps) {
  // 检查步骤是否应该执行
  if (!shouldExecuteStep(step, mode, job, ctx)) {
    logger.debug({ step, ... }, `Skipping step ${step} (condition not met)`);
    continue;
  }
  
  // 执行步骤
  await executeStep(step, job, ctx, services, stepOptions);
}
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

---

## 三、问题分析

### 3.1 为什么语义修复未被调用？

**可能原因1**: `ctx.shouldSendToSemanticRepair`在检查时不是`true`

**分析**:
- 日志显示`shouldSendToSemanticRepair: true`（在AggregationStage中）
- 但`shouldExecuteStep`检查时，`ctx.shouldSendToSemanticRepair`可能还没有被设置

**时间线**:
1. `runAggregationStep`执行，设置`ctx.shouldSendToSemanticRepair = true`
2. `shouldExecuteStep('SEMANTIC_REPAIR', ...)`检查`ctx.shouldSendToSemanticRepair`
3. 如果检查时`ctx.shouldSendToSemanticRepair`还未设置，则返回`false`

**验证**: 需要检查`shouldExecuteStep`被调用的时机和`ctx.shouldSendToSemanticRepair`的设置时机

### 3.2 代码执行顺序

**Pipeline步骤序列** (从`GENERAL_VOICE_TRANSLATION`模式):
```typescript
steps: ['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION', 'TTS']
```

**执行顺序**:
1. ASR步骤
2. **AGGREGATION步骤** → 设置`ctx.shouldSendToSemanticRepair`
3. **SEMANTIC_REPAIR步骤** → 检查`ctx.shouldSendToSemanticRepair`
4. DEDUP步骤
5. TRANSLATION步骤
6. TTS步骤

**理论上**: AGGREGATION在SEMANTIC_REPAIR之前执行，所以`ctx.shouldSendToSemanticRepair`应该已经被设置

---

## 四、需要进一步检查

### 4.1 检查日志中的执行顺序

**需要查找**:
1. `runAggregationStep`的执行日志
2. `shouldExecuteStep('SEMANTIC_REPAIR', ...)`的调用日志
3. `Skipping step SEMANTIC_REPAIR`或`Executing pipeline step: SEMANTIC_REPAIR`的日志

### 4.2 检查ctx.shouldSendToSemanticRepair的设置

**需要确认**:
1. `runAggregationStep`是否真的设置了`ctx.shouldSendToSemanticRepair`
2. 设置的值是什么（`true`还是`false`）
3. 设置后是否被其他代码修改

### 4.3 检查shouldExecuteStep的实现

**需要确认**:
1. `shouldExecuteStep`是否正确接收了`ctx`参数
2. `ctx.shouldSendToSemanticRepair`的检查逻辑是否正确

---

## 五、Job3的特殊情况

**Job3的Utterance聚合结果**:
```json
"shouldSendToSemanticRepair":false,
"shouldWaitForMerge":true,
"action":"NEW_STREAM"
```

**分析**:
- Job3的`shouldSendToSemanticRepair: false`是**设计行为**
- 因为`shouldWaitForMerge: true`，所以不立即发送到语义修复
- 这是正常的，因为Job3需要等待与Job4合并

**但其他job**:
- Job0, Job1, Job2, Job4, Job5, Job7, Job8, Job9都显示`shouldSendToSemanticRepair: true`
- 这些job的语义修复步骤应该被执行，但日志中未找到执行记录

---

## 六、可能的问题

### 6.1 问题1: ctx.shouldSendToSemanticRepair未正确传递

**可能原因**:
- `shouldExecuteStep`函数接收的`ctx`参数可能不包含`shouldSendToSemanticRepair`字段
- 或者`ctx`参数在传递过程中丢失了该字段

### 6.2 问题2: shouldExecuteStep的ctx参数类型不匹配

**可能原因**:
- `shouldExecuteStep`的`ctx`参数类型定义可能不包含`shouldSendToSemanticRepair`
- TypeScript类型检查可能阻止了该字段的访问

### 6.3 问题3: 日志级别问题

**可能原因**:
- `Skipping step SEMANTIC_REPAIR`的日志级别可能是`debug`，而当前日志级别可能更高
- 导致日志中看不到跳过信息

---

## 七、建议检查

### 7.1 立即检查

1. **检查日志级别**: 确认是否有`debug`级别的日志被过滤
2. **检查ctx传递**: 确认`ctx.shouldSendToSemanticRepair`是否正确传递到`shouldExecuteStep`
3. **检查类型定义**: 确认`shouldExecuteStep`的`ctx`参数类型是否包含`shouldSendToSemanticRepair`

### 7.2 代码检查

1. **检查`pipeline-mode-config.ts`**: 确认`shouldExecuteStep`的实现
2. **检查`job-pipeline.ts`**: 确认`ctx`参数的传递
3. **检查`aggregation-step.ts`**: 确认`ctx.shouldSendToSemanticRepair`的设置

---

*需要进一步检查代码和日志，确认语义修复步骤未被调用的根本原因。*
