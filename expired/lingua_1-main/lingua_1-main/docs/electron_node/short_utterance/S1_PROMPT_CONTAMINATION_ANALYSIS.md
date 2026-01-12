# S1 Prompt 污染问题分析

## 问题发现

通过日志分析，发现 **S1 正在工作，但 Prompt 内容包含了大量错误的识别结果**，这些错误结果被用作上下文，导致后续识别也被误导。

## 日志分析结果

### ✅ S1 状态
- **初始化**: ✅ 正常
- **Prompt 构建**: ✅ 正常（7 次成功，0 次失败）
- **Prompt 应用**: ✅ 正常

### ❌ Prompt 内容问题

从日志中看到的 Prompt 内容：

```
[CONTEXT]
Recent:
那么能正常把云反归了
这个我们可以单结不讨论
但是在实际运动中用户说的关键词可能是要返回来的 投 一两句小时也就消失了
来 感觉都可以去看一下日治了完全没有语音产生可能还是 泡泡的问题
[/CONTEXT]
```

**问题**：
1. **"云反归了"** - 明显是识别错误（可能是"能正常把语音返回了"）
2. **"单结不讨论"** - 明显是识别错误（可能是"单独讨论"）
3. **"投 一两句小时也就消失了"** - 明显是识别错误
4. **"日治了完全没有语音产生"** - 明显是识别错误（可能是"日志"）
5. **"泡泡的问题"** - 可能是识别错误（被提取为关键词）

## 根本原因

### 1. 质量门控不够严格

**当前逻辑**：
```typescript
// prompt-builder.ts 第 52-54 行
const enableRecent = this.config.enableRecentContext && 
  (ctx.qualityScore === undefined || ctx.qualityScore >= 0.4);
```

**问题**：
- 如果 `qualityScore >= 0.4`，就会使用 `recentCommittedText`
- 但 `qualityScore >= 0.4` 仍然可能是低质量识别（比如 0.45）
- 低质量的识别结果被用作上下文，误导后续识别

### 2. 没有验证 recentCommittedText 的质量

**当前逻辑**：
- 直接使用 `recentCommittedText`，没有验证其质量
- 如果之前的识别结果都是错误的，这些错误结果会被累积使用

### 3. 关键词提取可能包含错误

**当前逻辑**：
- 从 `recentCommittedText` 中提取关键词（高频词、专名）
- 如果识别结果错误，提取的关键词也可能是错误的
- 例如："泡泡的问题" 被提取为关键词，但可能是识别错误

## 解决方案

### 方案 1: 增强质量门控（推荐）

**修改 `prompt-builder.ts`**：
```typescript
// 提高质量阈值，只使用高质量的结果作为上下文
const enableRecent = this.config.enableRecentContext && 
  (ctx.qualityScore !== undefined && ctx.qualityScore >= 0.6);  // 从 0.4 提高到 0.6

// 同时，只使用高质量的关键词
const enableKeywords = ctx.qualityScore === undefined || ctx.qualityScore >= 0.5;
```

**优点**：
- 简单有效
- 只使用高质量结果作为上下文
- 减少错误传播

**缺点**：
- 可能在某些情况下没有上下文可用

### 方案 2: 验证 recentCommittedText 质量

**修改 `AggregatorState`**：
- 在存储 `recentCommittedText` 时，同时存储对应的 `qualityScore`
- 在构建 prompt 时，只使用 `qualityScore >= 0.6` 的文本

**优点**：
- 更精确的质量控制
- 可以针对每条文本单独判断

**缺点**：
- 需要修改 `AggregatorState` 的数据结构

### 方案 3: 添加 Prompt 验证

**修改 `prompt-builder.ts`**：
- 在构建 prompt 前，验证 `recentCommittedText` 是否包含明显错误
- 如果包含错误特征（如乱码、明显不合理的文本），不使用该文本

**优点**：
- 可以过滤明显错误的文本
- 不需要依赖 qualityScore

**缺点**：
- 实现复杂，需要定义错误特征

### 方案 4: 临时禁用 S1 Recent Context（快速修复）

**修改 `prompt-builder.ts`**：
```typescript
// 临时禁用 recent context，只使用 keywords
const enableRecent = false;  // 临时禁用
```

**优点**：
- 立即生效
- 避免错误传播

**缺点**：
- 失去了 recent context 的好处
- 只是临时方案

## 推荐方案

**立即实施**：方案 4（临时禁用 Recent Context）

**后续优化**：方案 1（增强质量门控）+ 方案 2（验证 recentCommittedText 质量）

## 实施步骤

### 步骤 1: 临时禁用 Recent Context

修改 `prompt-builder.ts`：
```typescript
// 第 52-54 行
// 临时禁用 recent context，避免错误传播
const enableRecent = false;  // 临时禁用，只使用 keywords
```

### 步骤 2: 增强质量门控

修改 `prompt-builder.ts`：
```typescript
// 提高质量阈值
const enableRecent = this.config.enableRecentContext && 
  (ctx.qualityScore !== undefined && ctx.qualityScore >= 0.6);

// 关键词也需要质量检查
const enableKeywords = ctx.qualityScore === undefined || ctx.qualityScore >= 0.5;
```

### 步骤 3: 验证效果

重新测试，检查：
1. Prompt 内容是否不再包含明显错误
2. 识别准确率是否提升
3. 是否还有错误传播

## 总结

**问题**：S1 正在工作，但 Prompt 内容包含了大量错误的识别结果，导致错误传播。

**根本原因**：质量门控不够严格，低质量的识别结果被用作上下文。

**解决方案**：
1. 临时禁用 Recent Context（立即生效）
2. 增强质量门控（后续优化）

**预期效果**：
- 避免错误传播
- 提升识别准确率
- 保持 S1 的关键词功能（如果 keywords 质量高）

