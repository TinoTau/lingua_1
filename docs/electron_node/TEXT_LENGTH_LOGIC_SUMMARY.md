# 节点端文本长度相关逻辑总结

## 代码中实际存在的文本长度判断逻辑

### 1. `text-forward-merge-manager.ts` - 文本向前合并管理器

**作用**: 决定文本是否应该等待与下一句合并，还是直接发送给语义修复

**配置** (`node-config.ts`):
- `minLengthToKeep: 6` - 最小保留长度：<6字符直接丢弃
- `minLengthToSend: 20` - 最小发送长度：6-20字符之间的文本等待合并
- `maxLengthToWait: 40` - 最大等待长度：20-40字符之间的文本等待3秒确认
- `waitTimeoutMs: 3000` - 等待超时：3秒

**逻辑**:
- **< 6字符**: 直接丢弃
- **6-20字符**: 
  - 如果是手动发送 (`isManualCut=true`): 直接发送给语义修复
  - 否则: 等待与下一句合并（3秒超时）
- **20-40字符**: 
  - 如果是手动发送: 直接发送给语义修复
  - 否则: 等待3秒确认是否有后续输入，如果没有则发送给语义修复
- **> 40字符**: 强制截断，直接发送给语义修复

**位置**: `electron_node/electron-node/main/src/agent/postprocess/text-forward-merge-manager.ts`

### 2. `postprocess-text-filter.ts` - 后处理文本过滤器

**作用**: 过滤太短的文本，决定是否等待合并

**逻辑**:
- **< 6字符**: 丢弃（日志提示：`>= 20 chars will be sent to semantic repair`）
- **6-20字符**: 如果 `shouldWaitForMerge=true`，返回空结果，等待合并

**位置**: `electron_node/electron-node/main/src/agent/postprocess/postprocess-text-filter.ts`

### 3. `aggregator-manager.ts` - 聚合管理器（我修复的部分）

**作用**: 获取上一个utterance的文本作为NMT的context_text

**原始逻辑**:
- 如果历史文本包含当前文本，且长度差异很大（超过50%），跳过历史文本

**我添加的修复逻辑**:
- 如果当前文本很短（<10字符），即使历史文本包含它，也不跳过历史文本
- 因为短文本可能是ASR批次拆分导致的片段，历史文本仍然是上一句

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-manager.ts` (行281-294)

### 4. 其他地方的20字符判断

**`semantic-repair-stage-zh.ts`**:
- `SHORT_SENTENCE_LENGTH = 20` - 短句长度阈值（用于决定是否发送给语义修复）

**`semantic-repair-stage-en.ts`**:
- `MIN_LENGTH_FOR_REPAIR = 20` - 最小修复长度

**`translation-stage.ts`**:
- 如果文本较短（<20字符）且不以标点符号结尾，可能是不完整句子

**`aggregation-stage.ts`**:
- 如果文本较短（<20字符）且不以标点符号结尾，可能是不完整句子

**`aggregator-state-text-processor.ts`**:
- 如果文本长度 <= 20字符，可能是误判，保留原始文本

**`bad-segment-detector.ts`**:
- 如果音频时长 > 2秒但文本 < 20字符，可能是异常

## 问题

用户质疑：
1. **这些"长文本短文本"的概念是什么时候定义的？**
   - 这些逻辑确实存在于代码中，主要在 `text-forward-merge-manager.ts` 和 `postprocess-text-filter.ts`
   - 配置在 `node-config.ts` 中定义

2. **20字符的规则应该已经移除了，但为什么代码中还有？**
   - 代码中确实还有多处20字符的判断
   - 需要确认这些逻辑是否应该移除

3. **我在修复中添加的"<10字符"判断是否合理？**
   - 这是我为了解决Job 7的contextText错误而添加的修复
   - 但用户可能认为这个逻辑不应该存在

## 建议

1. **确认是否需要保留这些文本长度判断逻辑**
2. **如果不需要，应该移除这些逻辑**
3. **如果需要，应该统一这些逻辑的阈值和用途**
