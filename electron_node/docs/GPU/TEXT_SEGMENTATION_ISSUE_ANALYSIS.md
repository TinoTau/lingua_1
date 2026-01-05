# 文本切分问题分析

## 问题描述

### Job10的问题
- **原文**："最后一句话被吃掉的问题,这个我们在"
- **译文**："the last phrase is eaten from the problem, this we are in"
- **问题**：文本被切分在"这个我们在"中间，导致句子不完整

### Job13的问题
- **原文**："开始没有去找原因,很感觉也不是特别严重"
- **译文**："The last phrase was eaten the problem, this we started not to look for the reason, it feels good and not especially serious."
- **问题**：job13的翻译包含了job10的内容（"The last phrase was eaten the problem, this we"），说明文本切分有问题

## 日志分析

### Job10的处理流程
1. `AudioAggregator: Merging pending second half with current audio` - 合并了之前保留的后半句
2. ASR识别结果："最后一句话被吃掉的问题,这个我们在"
3. 文本被标记为`MERGE`，但句子不完整

### Job13的处理流程
1. `AudioAggregator: Fallback split successful, second half saved to pendingSecondHalf` - 进行了fallback split
2. ASR识别结果："开始没有去找原因,很感觉也不是特别严重"
3. 但翻译结果包含了job10的内容

## 根本原因

### 问题1：pendingSecondHalf合并时机问题

从代码分析：
- `handlePendingSecondHalf`在合并时，将`pendingSecondHalf`放在当前音频**之前**
- 这可能导致文本顺序混乱

```typescript
// audio-aggregator-pending-handler.ts:92-95
const mergedAudio = Buffer.alloc(buffer.pendingSecondHalf.length + currentAudio.length);
buffer.pendingSecondHalf.copy(mergedAudio, 0);  // pendingSecondHalf在前
currentAudio.copy(mergedAudio, buffer.pendingSecondHalf.length);  // currentAudio在后
```

**问题**：如果`pendingSecondHalf`是job10的后半句，而`currentAudio`是job13的音频，合并后ASR识别可能会将job10的后半句和job13的内容混在一起。

### 问题2：Fallback Split切分位置不准确

从日志看，job13使用了fallback split（基于能量最低点），但切分位置可能不准确：
- 切分点可能在句子中间
- 导致前半句不完整，后半句包含下一句的内容

### 问题3：文本聚合阶段的处理

即使音频切分有问题，文本聚合阶段应该能够：
1. 检测到不完整的句子
2. 等待后续音频补全
3. 或者标记为需要修复

但从日志看，文本聚合阶段没有正确处理这种情况。

## 修复方案

### 方案1：改进pendingSecondHalf的合并逻辑

**问题**：当前逻辑将`pendingSecondHalf`放在当前音频之前，可能导致文本顺序混乱。

**修复**：
1. 检查`pendingSecondHalf`的创建时间
2. 如果`pendingSecondHalf`太旧（超过TTL），应该丢弃而不是合并
3. 或者，将`pendingSecondHalf`放在当前音频之后，而不是之前

### 方案2：改进Fallback Split的切分逻辑

**问题**：基于能量最低点的切分可能不准确。

**修复**：
1. 使用更智能的切分算法（如基于VAD的切分）
2. 检查切分后的前半句是否完整（基于ASR结果）
3. 如果前半句不完整，调整切分位置

### 方案3：在文本聚合阶段检测不完整句子

**问题**：文本聚合阶段没有检测到不完整的句子。

**修复**：
1. 检测句子是否以标点符号结尾
2. 如果句子不完整，等待后续音频补全
3. 或者，标记为需要修复的句子

### 方案4：改进ASR结果的去重逻辑

**问题**：如果音频切分有问题，ASR可能识别出重复或混乱的文本。

**修复**：
1. 检测ASR结果中是否包含之前已识别的文本片段
2. 如果包含，进行去重处理
3. 或者，标记为需要重新识别的音频

## 建议的修复步骤

1. **立即修复**：改进`handlePendingSecondHalf`的合并逻辑，确保`pendingSecondHalf`不会导致文本混乱
2. **短期优化**：改进fallback split的切分算法，提高切分准确性
3. **长期优化**：在文本聚合阶段添加不完整句子检测，提高文本质量

## 性能分析

### 各服务耗时（从日志提取）

- **Semantic Repair**: 180-438ms（平均约300ms）
- **NMT**: 需要从日志中提取（约1-2秒）
- **TTS**: 需要从日志中提取（约300-600ms）

### 整体耗时优化

由于使用了顺序执行和GPU仲裁，整体耗时应该有所优化：
- 避免了服务之间的冲突
- 提高了GPU利用率
- 减少了等待时间

但需要从完整日志中提取准确的耗时数据。
