# 重复输出问题修复

## 问题总结

从集成测试中发现两个重复输出问题：

1. **Job 18, 19, 20 的重复**：
   - ASR重复识别了相同文本 "来解冬天"
   - AggregatorMiddleware检测到重复，但PostProcessCoordinator仍然输出了文本

2. **Job 2 和 4 的重复**：
   - 需要进一步检查ASR服务为什么重复识别相同文本

## 根本原因

### 问题1: 双重聚合机制导致状态不同步

**流程问题**：
1. PipelineOrchestrator的AggregatorMiddleware检测到重复，返回 `{ aggregatedText: '', shouldProcess: false }`
2. PipelineOrchestrator设置 `shouldProcessNMT = false`，`textForNMT = ''`
3. **但是**，PipelineOrchestrator仍然返回了result，其中 `text_asr: ''`（空字符串）
4. PostProcessCoordinator的AggregationStage处理了这个空result
5. 即使text_asr为空，AggregationStage可能从pending text中返回了之前缓存的文本

## 修复方案

### 修复1: PipelineOrchestrator - 确保textForNMT为空

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

**修改**（第476-500行）：
- 当`shouldProcessNMT = false`时，明确设置 `textForNMT = ''`
- 确保返回的result中`text_asr`为空字符串

```typescript
if (!shouldProcessNMT) {
  // 修复：确保textForNMT为空，避免PostProcess处理
  textForNMT = '';
  logger.info(...);
}
```

### 修复2: PostProcessCoordinator - 提前检查空文本

**文件**：`electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

**修改**（第99-115行）：
- 在处理前就检查`text_asr`是否为空
- 如果为空，直接返回`shouldSend: false`，不进行后续处理

```typescript
// 修复：如果text_asr为空，直接返回空结果，不进行后续处理
const asrTextTrimmed = (result.text_asr || '').trim();
if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
  return {
    shouldSend: false,
    aggregatedText: '',
    translatedText: '',
    reason: 'ASR result is empty (filtered by AggregatorMiddleware or empty ASR)',
  };
}
```

### 修复3: AggregationStage - 明确跳过aggregator处理

**文件**：`electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`

**修改**（第54-66行）：
- 如果text_asr为空，直接返回空结果，不调用`aggregatorManager.processUtterance()`
- 避免从pending text中返回之前缓存的文本

```typescript
// 修复：如果text_asr为空，直接返回空结果，不调用aggregatorManager.processUtterance()
// 避免从pending text中返回之前缓存的文本，导致重复输出
const asrTextTrimmed = (result.text_asr || '').trim();
if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
  logger.info(..., 'AggregationStage: ASR result is empty, skipping aggregator processing');
  return {
    aggregatedText: '',
    aggregationChanged: false,
  };
}
```

### 修复4: PostProcessCoordinator - 空文本时返回shouldSend=false

**文件**：`electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

**修改**（第127-145行）：
- 如果聚合后的文本为空，返回`shouldSend: false`
- 避免发送空结果导致重复输出

```typescript
// 修复：如果聚合后的文本为空，不发送结果，避免重复输出
if (!aggregationResult.aggregatedText || aggregationResult.aggregatedText.trim().length === 0) {
  return {
    shouldSend: false,  // 修复：不发送空结果
    aggregatedText: '',
    translatedText: '',
    reason: 'Aggregated text is empty (filtered by AggregatorMiddleware or empty ASR)',
  };
}
```

### 修复5: NodeAgent - 空结果时不发送job_result

**文件**：`electron_node/electron-node/main/src/agent/node-agent.ts`

**修改**（第1005-1015行和第976-1000行）：
- 如果最终result的`text_asr`为空，不发送job_result
- 如果PostProcessCoordinator返回`shouldSend: false`且aggregatedText为空，不发送job_result

```typescript
// 修复：如果ASR结果为空，不发送job_result，避免重复输出
const asrTextTrimmed = (finalResult.text_asr || '').trim();
const isEmpty = !asrTextTrimmed || asrTextTrimmed.length === 0;

if (isEmpty) {
  logger.info(..., 'ASR result is empty, skipping job_result send (no duplicate output)');
  return;  // 不发送空结果
}

// 修复：如果PostProcessCoordinator决定不发送且aggregatedText为空，不发送job_result
if (!postProcessResult.shouldSend) {
  const aggregatedTextTrimmed = (postProcessResult.aggregatedText || '').trim();
  if (!aggregatedTextTrimmed || aggregatedTextTrimmed.length === 0) {
    logger.info(..., 'PostProcessCoordinator filtered result (empty), skipping job_result send');
    return;  // 不发送空结果
  }
}
```

## 修复效果

### 预期结果

- ✅ 当AggregatorMiddleware检测到重复时，不会输出重复内容
- ✅ 当ASR结果为空时，不会发送空job_result
- ✅ 当PostProcessCoordinator返回空结果时，不会发送job_result
- ✅ 避免从pending text中返回之前缓存的文本

### 测试验证

1. **重复文本测试**：
   - 输入重复的ASR文本
   - 验证不会输出重复内容
   - 验证不会发送空job_result

2. **空ASR结果测试**：
   - 输入空的ASR结果
   - 验证不会发送job_result
   - 验证不会从pending text中返回文本

## 相关文件

- **PipelineOrchestrator**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`
- **PostProcessCoordinator**: `electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`
- **AggregationStage**: `electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`
- **NodeAgent**: `electron_node/electron-node/main/src/agent/node-agent.ts`
- **分析文档**: `electron_node/docs/short_utterance/DUPLICATE_OUTPUT_ANALYSIS.md`

---

**修复日期**：2025-12-30  
**修复人员**：AI Assistant  
**状态**：✅ 已修复，待测试验证

