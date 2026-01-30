# 语义修复未调用 - 服务缺失分析

**日期**: 2026-01-28  
**问题**: 语义修复步骤未被调用，可能是服务缺失

---

## 一、问题分析

### 1.1 runSemanticRepairStep的早期返回条件

**文件**: `pipeline/steps/semantic-repair-step.ts`

**早期返回条件** (第17-28行):
```typescript
// 如果文本为空，跳过语义修复
const textToRepair = ctx.aggregatedText || ctx.asrText || '';
if (!textToRepair || textToRepair.trim().length === 0) {
  ctx.repairedText = '';
  return;  // 早期返回，无日志
}

// 如果没有 SemanticRepairInitializer，跳过语义修复
if (!services.servicesHandler || !services.semanticRepairInitializer) {
  ctx.repairedText = textToRepair;
  return;  // 早期返回，无日志
}
```

**关键发现**:
- 如果`services.semanticRepairInitializer`不存在，会直接返回，**不会记录日志**
- 这可能是语义修复未调用的原因

### 1.2 需要检查

**需要确认**:
1. `services.semanticRepairInitializer`是否被正确传递到`ServicesBundle`
2. `services.semanticRepairInitializer`是否被正确初始化
3. 是否有日志记录`semanticRepairInitializer`的创建或传递

---

## 二、可能的原因

### 2.1 原因1: semanticRepairInitializer未传递

**问题**: `ServicesBundle`中可能没有`semanticRepairInitializer`

**影响**: 
- `runSemanticRepairStep`会在第25行早期返回
- 不会记录任何日志
- 语义修复步骤被静默跳过

### 2.2 原因2: shouldExecuteStep返回false

**问题**: `shouldExecuteStep('SEMANTIC_REPAIR', ...)`可能返回`false`

**可能原因**:
- `ctx.shouldSendToSemanticRepair`在检查时为`undefined`或`false`
- `ctx`参数传递不正确

**影响**:
- 会记录debug级别的日志（可能被过滤）
- 语义修复步骤被跳过

---

## 三、建议的检查方法

### 3.1 添加调试日志

**在`runSemanticRepairStep`开头添加**:
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
  },
  'runSemanticRepairStep: Entry point check'
);
```

**在`job-pipeline.ts`的步骤检查处添加**:
```typescript
if (step === 'SEMANTIC_REPAIR') {
  logger.info(
    {
      jobId: job.job_id,
      step,
      shouldSendToSemanticRepair: ctx.shouldSendToSemanticRepair,
      shouldExecute: shouldExecuteStep(step, mode, job, ctx),
    },
    `[DEBUG] SEMANTIC_REPAIR step execution check`
  );
}
```

### 3.2 检查ServicesBundle的创建

**需要检查**:
1. `ServicesBundle`在哪里创建
2. `semanticRepairInitializer`是否被添加到`ServicesBundle`
3. 是否有日志记录`semanticRepairInitializer`的创建

---

## 四、初步结论

### 4.1 最可能的原因

**原因**: `services.semanticRepairInitializer`未传递或未初始化

**证据**:
- `runSemanticRepairStep`的早期返回条件（第25行）会静默跳过，不记录日志
- 如果`shouldExecuteStep`返回`false`，会记录debug级别的日志（可能被过滤）

**需要验证**:
- 检查`ServicesBundle`的创建和`semanticRepairInitializer`的传递
- 添加调试日志，确认执行流程

---

*需要进一步检查代码，确认`semanticRepairInitializer`是否被正确传递和初始化。*
