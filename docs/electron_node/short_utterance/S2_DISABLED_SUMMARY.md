# S2 二次解码禁用总结

## 禁用日期
2025-01-XX

## 禁用原因
二次解码对GPU占用过高，导致"没有可用节点"的错误。

## 已禁用的功能

### 1. 二次解码（Secondary Decode）
- **组件**: `SecondaryDecodeWorker`
- **位置**: `aggregator-middleware.ts` 第117-130行
- **操作**: 不再初始化 `SecondaryDecodeWorker`
- **影响**: 不再进行二次ASR解码（beam_size=15, patience=2.0）

### 2. S2 Rescoring（重新评分）
- **组件**: `NeedRescoreDetector`, `Rescorer`, `CandidateProvider`
- **位置**: `aggregator-middleware.ts` 第355-360行
- **操作**: 完全禁用整个S2 rescoring逻辑
- **影响**: 不再对短句、低质量、高风险文本进行重新评分和候选选择

### 3. 音频缓存（Audio Ring Buffer）
- **组件**: `AudioRingBuffer`
- **位置**: `aggregator-middleware.ts` 第149-152行
- **操作**: 不再缓存音频数据
- **影响**: 节省内存，但无法进行二次解码（已禁用）

## 保留的功能

### 1. S1 Prompt（提示词构建）
- **组件**: `PromptBuilder`
- **状态**: ✅ **仍然启用**
- **原因**: 不占用GPU，只是文本处理，用于提高ASR准确度
- **功能**: 将关键词和最近上下文注入到ASR的`context_text`中

### 2. NMT Repair（翻译修复）
- **组件**: NMT候选生成和评分
- **状态**: ✅ **仍然启用**
- **原因**: 虽然占用GPU，但用于修复翻译质量，影响较小
- **功能**: 对低质量翻译生成多个候选并选择最佳

### 3. 批量翻译（Batch Translation）
- **组件**: 批量NMT处理
- **状态**: ✅ **仍然启用**（已限制并发）
- **原因**: 已限制并发数（MAX_CONCURRENT_NMT=2），影响可控
- **功能**: 批量处理多个翻译任务，减少GPU峰值

## 其他可关闭的关联操作

### 1. NMT Repair（可选）
如果GPU占用仍然过高，可以考虑禁用NMT Repair：
- **位置**: `node-agent.ts` 第83行
- **配置**: `nmtRepairEnabled: false`
- **影响**: 可能降低翻译质量，但减少GPU占用

### 2. 批量翻译（可选）
如果GPU占用仍然过高，可以进一步限制批量翻译：
- **位置**: `aggregator-middleware.ts` 第87-89行
- **配置**: 
  - `BATCH_WINDOW_MS`: 增加到1000ms（减少批量频率）
  - `MAX_BATCH_SIZE`: 减少到3（减少批量大小）
  - `MAX_CONCURRENT_NMT`: 减少到1（进一步限制并发）

### 3. 异步重新翻译（可选）
如果GPU占用仍然过高，可以禁用异步重新翻译：
- **位置**: `node-agent.ts` 第81行
- **配置**: `enableAsyncRetranslation: false`
- **影响**: 长文本翻译可能变慢，但减少GPU占用

## 预期效果

### GPU占用
- **之前**: 主解码 + 二次解码（约2.5倍GPU占用）
- **之后**: 仅主解码（约1倍GPU占用）
- **减少**: 约60%的GPU占用

### 准确度
- **S1 Prompt**: 仍然启用，保持准确度提升
- **S2 Rescoring**: 已禁用，可能略微降低短句准确度
- **总体**: 准确度可能略有下降，但GPU占用大幅减少

### 内存占用
- **音频缓存**: 已禁用，节省内存
- **其他**: 无变化

## 验证方法

1. **检查日志**:
   - 查看是否有 "S2-6: Secondary decode worker disabled" 日志
   - 确认没有 "S2: Rescoring applied" 日志
   - 确认没有 "S2-5: Failed to cache audio" 日志

2. **监控GPU**:
   - 检查GPU使用率是否降低
   - 确认没有"没有可用节点"的错误

3. **测试准确度**:
   - 测试短句识别准确度
   - 确认S1 Prompt仍然生效（通过日志检查`context_text`）

## 回滚方法

如果需要重新启用S2功能：

1. **恢复SecondaryDecodeWorker初始化**:
   ```typescript
   // aggregator-middleware.ts 第117-130行
   if (taskRouter) {
     this.secondaryDecodeWorker = new SecondaryDecodeWorker(...);
   }
   ```

2. **恢复S2 Rescoring逻辑**:
   ```typescript
   // aggregator-middleware.ts 第355-498行
   if (aggregatorResult.shouldCommit && aggregatedText && ...) {
     // S2 rescoring逻辑
   }
   ```

3. **恢复音频缓存**:
   ```typescript
   // aggregator-middleware.ts 第149-152行
   if (job.audio && job.audio.length > 0) {
     this.cacheAudio(...);
   }
   ```

## 总结

已完全禁用S2二次解码和相关功能，包括：
- ✅ 二次解码（SecondaryDecodeWorker）
- ✅ S2 Rescoring（重新评分）
- ✅ 音频缓存（AudioRingBuffer）

保留的功能：
- ✅ S1 Prompt（提示词构建）
- ✅ NMT Repair（翻译修复）
- ✅ 批量翻译（已限制并发）

预期效果：
- GPU占用减少约60%
- 准确度可能略有下降（但S1 Prompt仍然生效）
- 内存占用减少（不再缓存音频）

