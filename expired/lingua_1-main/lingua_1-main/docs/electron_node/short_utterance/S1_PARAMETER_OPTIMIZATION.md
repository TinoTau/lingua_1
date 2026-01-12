# S1 Prompt 参数优化总结

## 优化日期
2025-01-XX

## 问题分析

通过日志分析发现，S1 Prompt 包含了大量错误的识别结果，这些错误结果被用作上下文，导致后续识别也被误导，形成错误传播的恶性循环。

**发现的错误示例**：
- "云反归了" → 可能是"语音返回了"
- "单结不讨论" → 可能是"单独讨论"
- "投 一两句小时也就消失了" → 明显错误
- "日治了完全没有语音产生" → 可能是"日志"
- "泡泡的问题" → 可能是识别错误，还被提取为关键词

## 优化方案

### 1. 增强质量门控（三级阈值）

**优化前**：
```typescript
const enableRecent = ctx.qualityScore === undefined || ctx.qualityScore >= 0.4;
```

**优化后**：
```typescript
const QUALITY_THRESHOLD_HIGH = 0.65;    // 高质量阈值（用于 recent context）
const QUALITY_THRESHOLD_MEDIUM = 0.50;  // 中等质量阈值（用于 keywords from recent）
const QUALITY_THRESHOLD_LOW = 0.40;     // 低质量阈值（完全禁用）

const enableRecent = currentQuality >= QUALITY_THRESHOLD_HIGH;  // 只在高质量时使用 recent context
const enableKeywordsFromRecent = currentQuality >= QUALITY_THRESHOLD_MEDIUM;  // 中等质量以上才从 recent 提取 keywords
```

**策略**：
- **质量 < 0.4**：完全禁用 recent context 和从 recent 提取的 keywords（只使用用户配置的 keywords）
- **质量 0.4-0.65**：只使用 keywords（用户配置的），不使用 recent context
- **质量 >= 0.65**：使用 keywords + recent context

### 2. 添加文本错误检测

**新增方法**：`isTextLikelyErroneous()`

**检测规则**：
1. **错误模式匹配**：检测已知的错误模式
   - `云反归` → 可能是"语音返回"的错误
   - `单结` → 可能是"单独"的错误
   - `投.*小时` → 明显错误
   - `日治` → 可能是"日志"的错误
   - `泡泡的问题` → 可能是识别错误

2. **异常字符组合**：检测中英混杂且过短的文本

**应用位置**：
- 在提取 recent context 时过滤错误文本
- 在从 recent 提取 keywords 时过滤错误文本

### 3. 优化关键词提取

**优化前**：
- 直接从所有 `recentCommittedText` 中提取关键词

**优化后**：
- 只从高质量文本（`quality >= 0.5`）中提取关键词
- 过滤明显错误的文本
- 如果提供了 `recentTextQualityScores`，使用更精确的质量控制

### 4. 增强 Recent Context 提取

**优化前**：
- 直接使用所有 `recentCommittedText`

**优化后**：
- 使用 `extractRecentLinesWithQualityCheck()` 方法
- 质量检查：只使用 `quality >= 0.65` 的文本
- 错误过滤：过滤明显错误的文本
- 如果提供了 `recentTextQualityScores`，使用更精确的质量控制

## 参数配置

### 质量阈值

```typescript
const QUALITY_THRESHOLD_HIGH = 0.65;    // 高质量阈值（用于 recent context）
const QUALITY_THRESHOLD_MEDIUM = 0.50;  // 中等质量阈值（用于 keywords from recent）
const QUALITY_THRESHOLD_LOW = 0.40;     // 低质量阈值（完全禁用）
```

### 错误模式

```typescript
const errorPatterns = [
  /云反归/,      // "云反归" 可能是 "语音返回" 的错误
  /单结/,        // "单结" 可能是 "单独" 的错误
  /投.*小时/,    // "投 一两句小时" 明显错误
  /日治/,        // "日治" 可能是 "日志" 的错误
  /泡泡的问题/,  // "泡泡的问题" 可能是识别错误
];
```

## 预期效果

### 1. 避免错误传播

- 低质量结果不再被用作上下文
- 明显错误的文本被过滤
- 减少错误传播的恶性循环

### 2. 保持高质量上下文

- 只在高质量时使用 recent context
- 保持上下文的有益作用
- 提升识别准确率

### 3. 平衡效果和安全性

- 高质量时：使用完整的 prompt（keywords + recent context）
- 中等质量时：只使用 keywords（避免错误传播）
- 低质量时：完全禁用（避免误导）

## 验证方法

### 1. 检查日志

搜索以下关键字：
- `S1: Prompt built and applied to ASR task`
- 查看 `hasRecent` 字段（应该只在高质量时为 `true`）
- 查看 `promptPreview` 字段（不应该包含明显错误的文本）

### 2. 对比测试

1. 记录优化前的识别结果
2. 应用优化后重新测试
3. 对比识别准确率

### 3. 质量分布

检查日志中的 `qualityScore` 分布：
- 如果大部分 `qualityScore < 0.65`，recent context 会被禁用（这是正常的）
- 如果大部分 `qualityScore >= 0.65`，recent context 会被使用

## 后续优化建议

### 1. 存储每条文本的质量分数

**当前**：只存储 `lastCommitQuality`（最后一条的质量）

**建议**：存储每条 `recentCommittedText` 对应的质量分数

**实现**：
```typescript
// aggregator-state.ts
private recentCommittedText: string[] = [];
private recentTextQualityScores: number[] = [];  // 新增

// 在 updateRecentCommittedText 时同时存储质量分数
private updateRecentCommittedText(text: string, qualityScore?: number): void {
  this.recentCommittedText.push(text.trim());
  this.recentTextQualityScores.push(qualityScore ?? 1.0);
  // ...
}
```

### 2. 动态调整阈值

**建议**：根据实际效果动态调整阈值
- 如果识别准确率仍然低，可以进一步提高阈值
- 如果识别准确率提升明显，可以适当降低阈值

### 3. 扩展错误模式

**建议**：根据实际错误案例扩展错误模式
- 收集更多错误案例
- 添加到 `errorPatterns` 中

## 总结

✅ **已优化**：
- 增强质量门控（三级阈值）
- 添加文本错误检测
- 优化关键词提取（只从高质量文本提取）
- 增强 Recent Context 提取（质量检查 + 错误过滤）

**预期效果**：
- 避免错误传播
- 保持高质量上下文
- 提升识别准确率

**下一步**：
- 验证优化效果
- 根据实际效果调整参数
- 考虑存储每条文本的质量分数（更精确的质量控制）

