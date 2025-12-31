# ASR 服务返回空文本问题分析

## 问题描述

从日志分析，节点端收到的音频数据不是空的（有 `audioLength: 7617, 7895, 6157, 7033` 等），但 ASR 服务返回了空文本，导致最终结果为空。

## ASR 服务处理流程

### 1. ASR 服务调用
- 位置：`electron_node/electron-node/main/src/task-router/task-router.ts`
- 方法：`routeASRTask()`
- ASR 服务返回：`response.data.text || ''`

### 2. 质量检查
- 位置：`electron_node/electron-node/main/src/task-router/bad-segment-detector.ts`
- 方法：`detectBadSegment()`
- 检查项：
  - **SEGMENT_GAP_LARGE**: 相邻 segments 之间时间间隔 > 1.0 秒
  - **AVG_SEGMENT_DURATION_LONG**: 平均 segment 时长 > 5.0 秒
  - **LONG_AUDIO_FEW_SEGMENTS**: 音频时长 >= 1.5 秒但 segments 数 <= 1
  - **LOW_LANGUAGE_CONFIDENCE**: 语言置信度 < 0.70
  - **HIGH_GARBAGE_RATIO**: 乱码字符比例 > 10%
  - **HIGH_OVERLAP_WITH_PREVIOUS**: 与上一段文本重叠度 > 80%

### 3. 质量检查失败的处理
- **重要**：质量检查失败**不会**将文本设置为空
- 质量检查失败只会：
  - 记录警告日志
  - 禁用上下文 prompt（如果 `qualityScore < 0.4`）
  - 触发重跑（如果满足重跑条件）

### 4. 空文本的来源
从代码分析，ASR 文本为空的原因：

1. **ASR 服务本身返回空文本**
   - `response.data.text || ''` 为空
   - 这通常发生在：
     - 音频完全是静音
     - 音频质量太差，ASR 无法识别
     - VAD（语音活动检测）过滤了所有音频

2. **聚合阶段返回空文本**
   - 位置：`electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`
   - 如果 utterance 被合并但不是第一个，返回空文本

## 从日志分析的问题

### 日志示例
```
utterance_index: 1
reasonCodes: ["AVG_SEGMENT_DURATION_LONG_7.7s", "LONG_AUDIO_FEW_SEGMENTS", "LOW_LANGUAGE_CONFIDENCE_0%"]
qualityScore: 0
segmentCount: 1
audioDurationMs: 7680
languageProbability: 0
```

### 问题分析

1. **音频时长 7.68 秒，但只有 1 个 segment**
   - 说明 ASR 服务识别出的有效语音片段很少
   - 可能是：
     - 音频大部分是静音
     - 音频质量差，ASR 无法正确分段
     - VAD 过滤过于严格

2. **语言置信度为 0%**
   - 说明 ASR 服务无法确定音频的语言
   - 可能是：
     - 音频完全是噪音
     - 音频质量太差
     - 音频太短或太模糊

3. **平均 segment 时长 7.7 秒**
   - 说明整个音频被识别为一个 segment
   - 这通常表示：
     - 音频质量差，ASR 无法正确分段
     - 或者音频确实是连续的，但质量不好

## 可能的原因

### 1. 音频质量问题
- Web 端发送的音频可能包含大量静音或噪音
- Opus 编码/解码可能有问题
- 音频采样率转换可能有问题

### 2. VAD 过滤过于严格
- faster-whisper-vad 的 VAD 可能过滤了有效语音
- 静音阈值设置可能不合适

### 3. ASR 服务配置问题
- ASR 服务的参数可能不适合当前音频
- 语言检测可能有问题

## 建议的解决方案

### 1. 检查音频质量
- 在节点端记录接收到的音频数据
- 检查音频的 RMS（均方根）值
- 检查音频是否包含有效语音

### 2. 调整质量检查阈值
- 对于短音频（< 2 秒），放宽 `LONG_AUDIO_FEW_SEGMENTS` 检查
- 对于低置信度音频，考虑重跑而不是直接丢弃

### 3. 改进日志
- 记录 ASR 服务返回的原始 segments 信息
- 记录音频的统计信息（RMS、峰值等）
- 记录 VAD 的过滤结果

### 4. 检查 Web 端音频输入
- 确认 Web 端是否正确采集音频
- 确认 Opus 编码是否正确
- 确认音频是否包含有效语音

## 相关文件

- `electron_node/electron-node/main/src/task-router/task-router.ts` - ASR 任务路由
- `electron_node/electron-node/main/src/task-router/bad-segment-detector.ts` - 质量检查
- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` - Pipeline 处理
- `electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts` - 后处理协调器

