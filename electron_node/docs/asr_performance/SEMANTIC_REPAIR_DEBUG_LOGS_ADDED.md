# 语义修复调试日志添加

**日期**: 2026-01-28  
**目的**: 添加调试日志以确认语义修复步骤是否被调用

---

## 一、问题

从最新集成测试的日志看，语义修复步骤没有被调用，但也没有看到跳过日志（可能是debug级别被过滤）。

**执行顺序** (从日志看):
```
runAggregationStep → runDedupStep → runTranslationStep → runTtsStep
```

**缺少**: `runSemanticRepairStep`的调用

---

## 二、修复方案

### 2.1 添加Info级别日志

**修改文件**: `job-pipeline.ts`

**修改内容**:
1. 对于`SEMANTIC_REPAIR`步骤，将跳过日志从`debug`级别改为`info`级别
2. 对于`SEMANTIC_REPAIR`步骤，将完成日志从`debug`级别改为`info`级别

**代码**:
```typescript
// 对于 SEMANTIC_REPAIR 步骤，使用 info 级别日志以便调试
if (step === 'SEMANTIC_REPAIR') {
  logger.info(
    {
      jobId: job.job_id,
      step,
      modeName: mode.name,
      shouldSendToSemanticRepair: ctx.shouldSendToSemanticRepair,
      ctxKeys: ctx ? Object.keys(ctx) : [],
    },
    `Skipping step ${step} (condition not met)`
  );
}
```

### 2.2 添加入口日志

**修改文件**: `semantic-repair-step.ts`

**修改内容**:
1. 在函数入口添加info级别日志，记录关键信息
2. 在早期返回处添加info级别日志，说明跳过原因

**代码**:
```typescript
logger.info(
  {
    jobId: job.job_id,
    sessionId: job.session_id,
    utteranceIndex: job.utterance_index,
    hasServicesHandler: !!services.servicesHandler,
    hasSemanticRepairInitializer: !!services.semanticRepairInitializer,
    shouldSendToSemanticRepair: ctx.shouldSendToSemanticRepair,
    aggregatedText: ctx.aggregatedText?.substring(0, 50),
    asrText: ctx.asrText?.substring(0, 50),
  },
  'runSemanticRepairStep: Entry point check'
);
```

### 2.3 添加调试日志

**修改文件**: `pipeline-mode-config.ts`

**修改内容**:
1. 在`shouldExecuteStep`的`SEMANTIC_REPAIR`分支添加`console.log`调试日志
2. 记录`ctx.shouldSendToSemanticRepair`的值和`shouldExecute`的结果

**代码**:
```typescript
const shouldExecute = ctx?.shouldSendToSemanticRepair === true;
// 添加调试日志（仅在开发时使用，生产环境可以移除）
if (!shouldExecute && ctx) {
  console.log(`[SEMANTIC_REPAIR] shouldExecuteStep check: ctx.shouldSendToSemanticRepair=${ctx.shouldSendToSemanticRepair}, shouldExecute=${shouldExecute}`);
}
```

---

## 三、预期效果

### 3.1 日志输出

**如果语义修复步骤被跳过**:
- 会看到`Skipping step SEMANTIC_REPAIR (condition not met)`的info级别日志
- 会看到`ctx.shouldSendToSemanticRepair`的值
- 会看到`console.log`的调试信息

**如果语义修复步骤被执行**:
- 会看到`runSemanticRepairStep: Entry point check`的info级别日志
- 会看到`Step SEMANTIC_REPAIR completed`的info级别日志
- 会看到语义修复服务的输入/输出日志

### 3.2 问题诊断

通过这些日志，可以确认：
1. `ctx.shouldSendToSemanticRepair`的值是什么
2. `shouldExecuteStep`返回了什么
3. 语义修复步骤是否被调用
4. 如果被调用，为什么没有生效

---

## 四、下一步

1. **重新运行集成测试**: 查看新的日志输出
2. **分析日志**: 确认语义修复步骤是否被调用
3. **根据日志结果**: 进一步修复问题

---

*调试日志已添加，可以在下次集成测试中查看详细的执行流程。*
