# ASR 识别问题分析报告

## 问题描述

用户反馈：
1. **识别被掐头去尾**：一句话只识别了一半，或者一大半都没有识别到
2. **翻译速度非常慢**：整体流程耗时过长

## 日志分析

### 1. 识别被掐头去尾的问题

从 ASR 服务日志看，大量音频被判定为质量太差，直接跳过 ASR 处理：

```
[job-19DDE7D4] Audio quality too poor (likely silence, noise, or decoding issue), skipping ASR and returning empty response
  - audio_rms=0.0007 < 0.002
  - audio_std=0.0007 < 0.002
  - audio_dynamic_range=0.0423
  - audio_duration=2.840s

[job-52DD99DF] Audio quality too poor
  - audio_rms=0.0004 < 0.002
  - audio_std=0.0004 < 0.002
  - audio_dynamic_range=0.0058 < 0.01
  - audio_duration=1.320s

[job-CC3DAB45] Audio quality too poor
  - audio_rms=0.0003 < 0.002
  - audio_std=0.0003 < 0.002
  - audio_dynamic_range=0.0039 < 0.01
  - audio_duration=0.540s
```

**问题根源**：
- 音频质量检测阈值过于严格（`MIN_AUDIO_RMS = 0.002`, `MIN_AUDIO_STD = 0.002`）
- Opus 编码后的音频 RMS/STD 值通常较低（0.0003-0.0007），但仍然是有效音频
- 这些阈值导致大量有效音频被误判为静音或低质量音频

### 2. 翻译速度慢的问题

从调度服务器日志看：

**流程耗时分析**：
- `job-0632C21F`: 
  - 节点处理时间：`processingTimeMs=1700` (1.7秒)
  - ASR: 成功识别
  - NMT: 成功翻译
  - TTS: 121.61ms
  - **总耗时：1.7秒** ✅

- `job-B12C6D02`:
  - 节点处理时间：`processingTimeMs=1826` (1.8秒)
  - ASR: 成功识别（但被截断："在动以后前几句话都会被丢起呢我也不"）
  - NMT: 成功翻译
  - TTS: 163.11ms
  - **总耗时：1.8秒** ✅

- `job-19DDE7D4`, `job-52DD99DF`, `job-CC3DAB45`, `job-3138217D`:
  - 节点处理时间：`processingTimeMs=265-150ms` (很快)
  - ASR: 返回空结果（音频质量检查失败）
  - NMT: 跳过
  - TTS: 跳过
  - **总耗时：0.15-0.27秒** ✅

**但是**，调度服务器需要等待 `gap_timeout_ms=10秒` 才能创建 `MissingResult`：

```
Gap timeout, creating Missing result
  - utterance_index=48, elapsed_ms=16474, gap_timeout_ms=10000
  - utterance_index=49, elapsed_ms=10005, gap_timeout_ms=10000
  - utterance_index=50, elapsed_ms=10007, gap_timeout_ms=10000
```

**问题根源**：
1. **音频质量检测过于严格**：大量有效音频被过滤，导致很多 `utterance_index` 没有结果
2. **Gap timeout 太长**：调度服务器需要等待 10 秒才能创建 `MissingResult`，导致整体流程变慢
3. **识别结果被截断**：即使通过质量检查的音频，识别结果也不完整（例如："在动以后前几句话都会被丢起呢我也不"）

### 3. 识别结果被截断的问题

从日志看，即使通过质量检查的音频，识别结果也不完整：

```
[job-B12C6D02] textAsr="在动以后前几句话都会被丢起呢我也不"
```

**可能原因**：
1. **音频被客户端 VAD 截断**：客户端 VAD 可能过早地检测到静音，导致音频被截断
2. **音频解码问题**：Opus 解码可能丢失了部分音频数据
3. **ASR 模型问题**：Faster Whisper 可能无法识别完整的句子

## 解决方案

### 1. 降低音频质量检测阈值

**当前阈值**：
- `MIN_AUDIO_RMS = 0.002`
- `MIN_AUDIO_STD = 0.002`
- `MIN_AUDIO_DYNAMIC_RANGE = 0.01`

**建议阈值**（针对 Opus 编码音频）：
- `MIN_AUDIO_RMS = 0.0005` (降低 4 倍)
- `MIN_AUDIO_STD = 0.0005` (降低 4 倍)
- `MIN_AUDIO_DYNAMIC_RANGE = 0.005` (降低 2 倍)

**理由**：
- Opus 编码后的音频 RMS/STD 值通常较低，但仍然有效
- 从日志看，RMS=0.0003-0.0007 的音频可能仍然包含有效语音
- 应该让 ASR 模型来判断音频是否有有效内容，而不是提前过滤

### 2. 缩短 Gap Timeout

**当前设置**：`gap_timeout_ms = 10 * 1000` (10秒)

**建议设置**：`gap_timeout_ms = 5 * 1000` (5秒)

**理由**：
- 如果节点在 5 秒内没有返回结果，很可能是因为音频被过滤或处理失败
- 缩短 timeout 可以更快地创建 `MissingResult`，提高整体响应速度

### 3. 检查客户端 VAD 配置

需要检查客户端 VAD 是否过于激进，导致音频被过早截断。

### 4. 检查音频解码流程

需要确认 Opus 解码是否完整，没有丢失音频数据。

## 修复内容

### 1. 降低音频质量检测阈值 ✅

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**修改**:
- `MIN_AUDIO_RMS`: 0.002 → 0.0005 (降低 4 倍)
- `MIN_AUDIO_STD`: 0.002 → 0.0005 (降低 4 倍)
- `MIN_AUDIO_DYNAMIC_RANGE`: 0.01 → 0.005 (降低 2 倍)
- `MIN_AUDIO_DURATION`: 0.5 → 0.3 (降低到 0.3 秒)

**理由**:
- Opus 编码后的音频 RMS/STD 值通常较低（0.0003-0.0007），但仍然有效
- 应该让 ASR 模型来判断音频是否有有效内容，而不是提前过滤
- 降低阈值可以减少误判，让更多有效音频进入 ASR

### 2. 缩短 Gap Timeout ✅

**文件**: `central_server/scheduler/src/managers/result_queue.rs`

**修改**:
- `gap_timeout_ms`: 10 * 1000 → 5 * 1000 (从 10 秒降低到 5 秒)

**理由**:
- 正常 ASR 处理时间在 1-2 秒之间，5 秒足够
- 缩短 timeout 可以更快地创建 `MissingResult`，提高整体响应速度
- 如果任务真的需要更长时间，可以通过其他机制来处理（比如增加重试机制）

### 3. 客户端 VAD 配置检查 ✅

**文件**: `webapp/web-client/src/types.ts`

**当前配置**:
- `attackThreshold: 0.01` (进入语音)
- `releaseThreshold: 0.003` (退出语音)
- `releaseFrames: 20` (200ms)

**结论**: 配置已经比较宽松，应该不是主要问题。

## 下一步行动

1. **重新测试**：验证修复效果
   - 检查识别是否完整（不再被掐头去尾）
   - 检查翻译速度是否改善
   - 检查是否还有大量音频被误判为静音

2. **监控日志**：
   - 检查 ASR 服务日志，确认音频质量检查是否正常
   - 检查调度服务器日志，确认 gap timeout 是否正常
   - 检查识别结果是否完整

3. **如果问题仍然存在**：
   - 检查音频解码流程：确认 Opus 解码是否完整
   - 检查 ASR 模型：确认 Faster Whisper 是否能识别完整句子
   - 进一步调整客户端 VAD 配置（如果需要）

