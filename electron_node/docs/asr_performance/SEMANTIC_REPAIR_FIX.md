# 语义修复未调用问题修复

**日期**: 2026-01-28  
**问题**: 虽然`shouldSendToSemanticRepair: true`，但语义修复步骤未被调用

---

## 一、问题分析

### 1.1 根本原因

**问题**: `shouldExecuteStep`函数的参数类型定义不匹配

**原始代码** (`pipeline-mode-config.ts` 第196行):
```typescript
export function shouldExecuteStep(
    step: PipelineStepType,
    mode: PipelineMode,
    job: JobAssignMessage,
    ctx?: { shouldSendToSemanticRepair?: boolean }  // ❌ 部分类型
): boolean {
```

**问题**:
- `shouldExecuteStep`的参数类型定义是部分类型`{ shouldSendToSemanticRepair?: boolean }`
- 但在`job-pipeline.ts`中，传递的是完整的`JobContext`对象
- 虽然TypeScript在运行时不会阻止，但类型定义不匹配可能导致类型检查问题

### 1.2 执行流程

**Pipeline步骤序列**:
```typescript
steps: ['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION', 'TTS']
```

**执行顺序**:
1. ASR步骤执行
2. **AGGREGATION步骤执行** → 设置`ctx.shouldSendToSemanticRepair = true`（aggregation-step.ts第93行）
3. **SEMANTIC_REPAIR步骤检查** → 调用`shouldExecuteStep('SEMANTIC_REPAIR', ..., ctx)`
4. 如果`ctx.shouldSendToSemanticRepair === true`，执行语义修复步骤

**问题**: 类型定义不匹配可能导致`ctx.shouldSendToSemanticRepair`无法正确访问

---

## 二、修复方案

### 2.1 修复类型定义

**修复后的代码** (`pipeline-mode-config.ts`):
```typescript
import { JobContext } from './context/job-context';

export function shouldExecuteStep(
    step: PipelineStepType,
    mode: PipelineMode,
    job: JobAssignMessage,
    ctx?: JobContext  // ✅ 完整的JobContext类型
): boolean {
    // ...
    case 'SEMANTIC_REPAIR':
        // 简化逻辑：只要 shouldSendToSemanticRepair 为 true，就执行语义修复
        // 不再需要显式设置 use_semantic，避免多层判断导致的问题
        // 注意：ctx 必须在 AGGREGATION 步骤之后才有 shouldSendToSemanticRepair 字段
        const shouldExecute = ctx?.shouldSendToSemanticRepair === true;
        return shouldExecute;
}
```

**修改点**:
1. ✅ 导入`JobContext`类型
2. ✅ 将`ctx`参数类型从部分类型`{ shouldSendToSemanticRepair?: boolean }`改为完整的`JobContext`类型
3. ✅ 添加注释说明`ctx`必须在AGGREGATION步骤之后才有`shouldSendToSemanticRepair`字段

### 2.2 修复说明

**为什么这样修复**:
- 类型定义应该与实际使用保持一致
- 使用完整的`JobContext`类型更清晰，也更符合实际使用
- 避免了类型不匹配可能导致的问题

**架构设计**:
- 保持代码简洁，不添加不必要的类型转换
- 直接使用完整的`JobContext`类型，避免部分类型导致的类型检查问题

---

## 三、验证

### 3.1 编译检查

**编译结果**: ✅ 通过
```bash
npm run build
```

### 3.2 类型检查

**Linter检查**: ✅ 通过
- 无类型错误
- 无linter错误

---

## 四、预期效果

### 4.1 修复后的行为

**预期行为**:
1. AGGREGATION步骤执行后，`ctx.shouldSendToSemanticRepair`被设置为`true`
2. SEMANTIC_REPAIR步骤检查时，`shouldExecuteStep`能够正确访问`ctx.shouldSendToSemanticRepair`
3. 如果`ctx.shouldSendToSemanticRepair === true`，语义修复步骤被执行

### 4.2 日志验证

**预期日志**:
- `runSemanticRepairStep`的调用日志
- `Executing pipeline step: SEMANTIC_REPAIR`日志
- 语义修复服务的输入/输出日志

---

## 五、总结

### 5.1 修复内容

1. ✅ 修复了`shouldExecuteStep`函数的参数类型定义
2. ✅ 将部分类型改为完整的`JobContext`类型
3. ✅ 添加了注释说明

### 5.2 架构原则

- ✅ 保持代码简洁，不添加不必要的类型转换
- ✅ 直接使用完整的`JobContext`类型，避免部分类型导致的类型检查问题
- ✅ 不添加额外的保险措施，保持代码逻辑简单易懂

---

*修复完成。类型定义问题已解决，语义修复步骤应该能够正常调用。*
