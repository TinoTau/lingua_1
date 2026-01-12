# 文本合并和去重机制说明

## 处理流程

### 阶段1：ASR之前的音频合并（AudioAggregator）

**位置**：`pipeline-orchestrator/audio-aggregator.ts`

**功能**：对音频进行合并，基于：
- **手动控制**：`is_manual_cut`（用户点击发送按钮）
- **自然停顿**：`is_pause_triggered`（检测到3秒静音）

**作用**：
- 将多个音频块聚合成完整句子
- 避免ASR识别不完整的短句
- 减少NMT翻译次数

**示例**：
```
音频块1 + 音频块2 + 音频块3 -> 合并后的音频 -> ASR
```

### 阶段2：ASR之后的文本合并（AggregationStage）

**位置**：`agent/postprocess/aggregation-stage.ts`

**功能**：对文本内容进行合并，基于上下文判断

**机制**：
1. **跨utterance的去重**（基于上下文）：
   - 使用`dedupMergePrecise`检测当前utterance和上一个utterance之间的重叠
   - 例如：上一个utterance="我们 我们可以"，当前utterance="我们可以继续"
   - 检测到重叠"我们可以"，去除当前utterance中的重复部分

2. **文本聚合**：
   - 将多个utterance的文本合并成一个完整的句子
   - 例如：job0="我们"，job1="可以"，job2="继续" -> 合并为"我们可以继续"

**作用**：
- 解决跨utterance的边界重复问题
- 将碎片化的utterance合并成完整句子

### 阶段3：内部重复检测（新增）

**位置**：`agent/postprocess/postprocess-coordinator.ts`（在AggregationStage之后、SemanticRepairStage之前）

**功能**：检测单个文本内部的重复（**不基于上下文**）

**机制**：
- 使用`detectInternalRepetition`检测单个文本内部的重复
- 例如：`"再提高了一点速度 再提高了一点速度"` -> `"再提高了一点速度"`
- 检测方法：
  1. 完全重复（50%重复）
  2. 末尾重复（叠字叠词）
  3. 部分重复（60%-90%重复）

**作用**：
- 去除ASR识别错误导致的内部重复
- 避免将重复文本传递给NMT

## 两种去重机制的区别

### 1. 跨utterance去重（基于上下文）

**函数**：`dedupMergePrecise(prevTail, currHead)`

**输入**：
- `prevTail`：上一个utterance的尾部文本
- `currHead`：当前utterance的开头文本

**判断**：基于上下文（上一个utterance和当前utterance的关系）

**示例**：
```
上一个utterance: "我们 我们可以"
当前utterance: "我们可以继续"
检测到重叠: "我们可以"
去重后: "继续"
```

**位置**：在`AggregationStage`中，由`AggregatorStateTextProcessor`调用

### 2. 内部重复检测（不基于上下文）

**函数**：`detectInternalRepetition(text)`

**输入**：
- `text`：单个文本（不依赖上下文）

**判断**：不基于上下文，只检测文本内部的重复模式

**示例**：
```
输入: "再提高了一点速度 再提高了一点速度"
检测到末尾重复: "再提高了一点速度"
去重后: "再提高了一点速度"
```

**位置**：在`PostProcessCoordinator`中，在`AggregationStage`之后、`SemanticRepairStage`之前

## 完整处理流程

```
音频块1,2,3
  ↓
[AudioAggregator] - 音频合并（基于手动控制和自然停顿）
  ↓
合并后的音频
  ↓
[ASR服务] - 语音识别
  ↓
ASR文本1,2,3
  ↓
[AggregationStage] - 文本合并和跨utterance去重（基于上下文）
  ├─ dedupMergePrecise: 检测当前utterance和上一个utterance的重叠
  └─ 合并多个utterance的文本
  ↓
聚合后的文本
  ↓
[detectInternalRepetition] - 内部重复检测（不基于上下文）
  └─ 检测单个文本内部的重复（如"再提高了一点速度 再提高了一点速度"）
  ↓
去重后的文本
  ↓
[SemanticRepairStage] - 语义修复
  ↓
[TranslationStage] - 翻译
```

## 总结

1. **ASR之前的合并**：✅ 正确 - AudioAggregator对音频进行合并，基于手动控制和自然停顿

2. **ASR之后的合并**：✅ 正确 - AggregationStage对文本内容进行合并，基于上下文判断（跨utterance去重）

3. **新增的去重功能**：❌ **不是基于上下文的判断**
   - `detectInternalRepetition`只检测单个文本内部的重复
   - 不依赖上一个utterance或上下文
   - 只分析当前文本自身的重复模式

## 为什么需要两种去重？

1. **跨utterance去重**（基于上下文）：
   - 解决音频切分导致的边界重复
   - 例如："我们 我们可以" -> "我们可以"

2. **内部重复检测**（不基于上下文）：
   - 解决ASR识别错误导致的内部重复
   - 例如："再提高了一点速度 再提高了一点速度" -> "再提高了一点速度"
   - 避免将重复文本传递给NMT，减少NMT负担
