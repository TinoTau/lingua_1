# 日志和诊断完整文档 (Part 2/3)


**日志**:
- 开始文本验证
- 检查空文本
- 检查无意义文本
- 返回空响应（如果文本为空或无意义）

### 4. 文本上下文更新阶段 (Step 11)

**位置**: `faster_whisper_vad_service.py` - 更新文本上下文缓存

**日志**:
- 开始文本上下文更新
- 分割句子
- 更新文本上下文
- 文本上下文更新完成

### 5. 上下文缓冲区更新阶段 (Step 12)

**位置**: `faster_whisper_vad_service.py` - 更新上下文缓冲区

**日志**:
- 开始上下文缓冲区更新
- VAD检测（用于上下文）
- 更新上下文缓冲区
- 上下文缓冲区更新完成

### 6. 响应构建阶段 (Step 13)

**位置**: `faster_whisper_vad_service.py` - 返回结果

**日志**:
- 开始响应构建
- 响应构建成功
- 返回响应

### 7. VAD检测函数

**位置**: `vad.py` - `detect_speech()`

**日志**:
- 开始VAD检测
- 帧处理计数
- VAD检测完成（帧数、段数）
- VAD检测失败（异常信息）

### 8. 上下文更新函数

**位置**: `context.py` - `update_context_buffer()` 和 `update_text_context()`

**日志**:
- 开始更新
- 更新完成（缓冲区长度）
- 更新失败（异常信息）

---

## 日志格式

所有日志都包含：
- `trace_id`: 用于追踪单个请求
- `Step X.Y`: 步骤编号，便于定位
- 操作描述和关键数据
- 异常信息（如果失败）

**示例**:
```
INFO:__main__:[concurrent_test_1766593570_4] Step 8.1: Starting to extract text from segments (count=1)
INFO:__main__:[concurrent_test_1766593570_4] Step 8.1: Successfully extracted text, segments=0, full_text_len=0
INFO:__main__:[concurrent_test_1766593570_4] Step 9: Starting ASR result processing
INFO:__main__:[concurrent_test_1766593570_4] Step 10: Starting text validation
INFO:__main__:[concurrent_test_1766593570_4] Step 10.1: Returning empty response (empty transcript)
```

---

## 使用方法

1. **运行测试**: 运行并发测试脚本
2. **查看日志**: 检查服务日志，找到最后一个成功的步骤
3. **定位崩溃**: 崩溃发生在最后一个成功步骤之后

---

## 预期效果

1. **精确定位**: 能够确定崩溃发生在哪个具体步骤
2. **问题诊断**: 通过日志了解崩溃前的状态
3. **修复指导**: 根据崩溃位置，有针对性地修复问题

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/OPUS_CONCURRENCY_TEST_RESULTS.md` - Opus并发测试结果
- `electron_node/services/faster_whisper_vad/docs/CRASH_ROOT_CAUSE_ANALYSIS.md` - 崩溃根本原因分析
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 主服务文件
- `electron_node/services/faster_whisper_vad/vad.py` - VAD模块
- `electron_node/services/faster_whisper_vad/context.py` - 上下文模块



---

## DIAGNOSTIC_LOGGING_SUMMARY.md

# 诊断日志增强总结

**日期**: 2025-12-25  
**状态**: ✅ **已添加详细诊断日志**

---

## 目的

在transcribe之后的关键步骤添加详细日志，帮助定位崩溃发生的具体位置。

---

## 添加的日志点

### 1. 文本提取阶段 (Step 8.1)

**位置**: `faster_whisper_vad_service.py` - 提取文本和分段

**日志**:
- `Step 8.1: Starting to extract text from segments`
- `Step 8.1: Successfully extracted text`
- `Step 8.1: Failed to extract text from segments` (异常)

### 2. ASR结果处理阶段 (Step 9)

**位置**: `faster_whisper_vad_service.py` - ASR识别完成

**日志**:
- `Step 9: Starting ASR result processing`
- `Step 9.1: Text trimmed`
- `Step 9.2: Failed to check brackets` (异常)
- `✅ ASR 识别完成`

### 3. 文本验证阶段 (Step 10)

**位置**: `faster_whisper_vad_service.py` - 检查文本是否为无意义

**日志**:
- `Step 10: Starting text validation`
- `Step 10.1: Returning empty response (empty transcript)`
- `Step 10.2: Checking if transcript is meaningless`
- `Step 10.3: Returning empty response (meaningless transcript)`

### 4. 文本上下文更新阶段 (Step 11)

**位置**: `faster_whisper_vad_service.py` - 更新文本上下文缓存

**日志**:
- `Step 11: Starting text context update`
- `Step 11.1: Splitting text into sentences`
- `Step 11.2: Updating text context with last sentence`
- `Step 11.3: Updating text context with full text`
- `Step 11: Text context update completed`
- `Step 11: Failed to update text context` (异常)

### 5. 上下文缓冲区更新阶段 (Step 12)

**位置**: `faster_whisper_vad_service.py` - 更新上下文缓冲区

**日志**:
- `Step 12: Starting context buffer update`
- `Step 12.1: Starting VAD detection for context buffer`
- `Step 12.1: VAD detection completed`
- `Step 12.2: Updating context buffer`
- `Step 12.2: Context buffer updated successfully`
- `Step 12: Context buffer update completed`
- `Step 12: Failed to update context buffer` (异常)

### 6. 响应构建阶段 (Step 13)

**位置**: `faster_whisper_vad_service.py` - 返回结果

**日志**:
- `Step 13: Starting response construction`
- `Step 13: Response constructed successfully, returning response`
- `Step 13: Failed to construct response` (异常)

### 7. VAD检测函数

**位置**: `vad.py` - `detect_speech()`

**日志**:
- `detect_speech: Starting VAD detection`
- `detect_speech: Failed to detect voice activity for frame X` (异常)
- `detect_speech: VAD detection completed`
- `detect_speech: VAD detection failed` (异常)

### 8. 上下文更新函数

**位置**: `context.py` - `update_context_buffer()` 和 `update_text_context()`

**日志**:
- `update_context_buffer: Starting`
- `update_context_buffer: Completed`
- `update_context_buffer: Failed to update context buffer` (异常)
- `update_text_context: Starting`
- `update_text_context: Completed`
- `update_text_context: Failed to update text context` (异常)

---

## 使用方法

1. **重启服务**: 重启服务以应用新的日志代码
2. **运行测试**: 运行并发测试脚本
3. **查看日志**: 检查服务日志，找到最后一个成功的步骤
4. **定位崩溃**: 崩溃发生在最后一个成功步骤之后

---

## 预期效果

1. **精确定位**: 能够确定崩溃发生在哪个具体步骤
2. **问题诊断**: 通过日志了解崩溃前的状态
3. **修复指导**: 根据崩溃位置，有针对性地修复问题

---

## 日志示例

```
INFO:__main__:[concurrent_test_1766593570_4] Step 8.1: Starting to extract text from segments (count=1)
INFO:__main__:[concurrent_test_1766593570_4] Step 8.1: Successfully extracted text, segments=0, full_text_len=0
INFO:__main__:[concurrent_test_1766593570_4] Step 9: Starting ASR result processing
INFO:__main__:[concurrent_test_1766593570_4] Step 9.1: Text trimmed, len=0
INFO:__main__:[concurrent_test_1766593570_4] Step 10: Starting text validation
INFO:__main__:[concurrent_test_1766593570_4] Step 10.1: Returning empty response (empty transcript)
```

如果崩溃发生在某个步骤，日志会显示：
- 最后一个成功的步骤
- 崩溃发生在哪个步骤之后
- 崩溃前的状态信息

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/OPUS_CONCURRENCY_TEST_RESULTS.md` - Opus并发测试结果
- `electron_node/services/faster_whisper_vad/docs/CRASH_ROOT_CAUSE_ANALYSIS.md` - 崩溃根本原因分析
- `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py` - 主服务文件
- `electron_node/services/faster_whisper_vad/vad.py` - VAD模块
- `electron_node/services/faster_whisper_vad/context.py` - 上下文模块



---

## DETAILED_LOGGING_ADDED.md

# 详细日志添加总结

**日期**: 2025-12-25  
**状态**: ✅ **已完成**

---

## 添加的日志位置

### 1. Web端编码器 (`webapp/web-client/src/audio_codec.ts`)

#### 比特率设置日志
- ✅ **成功**: `[OpusEncoder] ✅ Bitrate set to {bitrate} bps using {method}`
- ⚠️ **失败**: `[OpusEncoder] ⚠️ Does not support setting bitrate, using default`
- ⚠️ **错误**: `[OpusEncoder] ❌ Failed to set bitrate: {error}`
- ℹ️ **未配置**: `[OpusEncoder] ℹ️ No bitrate configured, using encoder default`

#### 编码器初始化日志
```typescript
[OpusEncoder] ✅ Initialized successfully {
  sampleRate: 16000,
  channelCount: 1,
  application: 'voip',
  frameSizeMs: 20,
  bitrate: 24000,
  bitrateSet: true/false,
  bitrateMethod: 'setBitrate()' | 'bitrate property' | 'error' | 'none'
}
```

#### 编码过程日志
- **输入信息**: `[OpusEncoder] 📊 Encoding audio: input_samples={n}, duration={ms}ms, frame_size={n} samples ({ms}ms)`
- **填充警告**: `[OpusEncoder] ⚠️ Input too short, padding: {n} samples ({ms}ms) of silence`
- **编码结果**: 
  - 单帧: `[OpusEncoder] ✅ Encoded: input={n} samples ({ms}ms) → output={n} bytes`
  - 多帧: `[OpusEncoder] ✅ Encoded: input={n} samples ({ms}ms) → {full} full frames + {padded} padded frames ({padding} samples/{ms}ms padding) → output={n} bytes ({packets} packets)`

#### Plan A格式打包日志 (`websocket_client.ts`)
```typescript
[OpusEncoder] 📦 Plan A format packaging: {
  input_samples: 24576,
  input_duration_ms: 1536.0,
  packetCount: 77,
  packetSizes: "60-80 bytes (avg: 69)",
  totalSize: 5325,
  overhead: 154,  // 长度前缀的开销
  compression_ratio: "9.23x"  // PCM16 vs Opus
}
```

---

### 2. 节点端解码器 (`electron_node/services/faster_whisper_vad/opus_packet_decoder.py`)

#### 解码器初始化日志
```python
OpusPacketDecoder initialized: sample_rate=16000 Hz, channels=1, decoder_size={n} bytes
```

#### Pipeline初始化日志
```python
OpusPacketDecodingPipeline initialized: 
  sample_rate=16000 Hz, 
  channels=1, 
  with_seq=False, 
  buffer_capacity=240ms (3840 samples)
```

#### 解码过程日志
- **输入数据**: `feed_data: input_size={n} bytes`
- **Packet解析**: `feed_data: popped packet #{n}, seq={seq}, packet_len={n}`
- **解码成功**: 
  ```python
  Opus decode success: packet_len={n} bytes → 
    {samples} samples ({ms}ms), 
    pcm16_len={n} bytes, 
    sample_range=[{min}, {max}], 
    dynamic_range={range}
  ```
- **批次统计**: 
  ```python
  feed_data completed: processed {n} packets, 
    decoded {n} samples, 
    decode_fails={n}, 
    total_buffer_samples={n}
  ```

#### 最终解码结果日志 (`audio_decoder.py`)
```python
[{trace_id}] ✅ Successfully decoded Opus packets: 
  {samples} samples ({ms}ms) at {sr}Hz, 
  estimated_packets={n}, 
  decode_fails={n}, 
  decode_success_rate={n}%, 
  audio_quality: rms={n}, std={n}, 
  dynamic_range={n}, 
  min={n}, max={n}
```

---

## 日志级别

### Web端（浏览器控制台）
- `console.log()` - 信息日志（绿色✅）
- `console.warn()` - 警告日志（黄色⚠️）
- `console.error()` - 错误日志（红色❌）

### 节点端（Python日志）
- `logger.info()` - 信息日志
- `logger.debug()` - 调试日志（详细过程）
- `logger.warning()` - 警告日志
- `logger.error()` - 错误日志
- `logger.critical()` - 严重错误日志

---

## 如何使用这些日志

### 1. 检查比特率设置

在浏览器控制台查找：
```
[OpusEncoder] ✅ Bitrate set to 24000 bps using setBitrate()
```
或
```
[OpusEncoder] ⚠️ Does not support setting bitrate, using default
```

### 2. 检查编码质量

查看编码日志：
```
[OpusEncoder] 📊 Encoding audio: input_samples=24576, duration=1536.00ms, frame_size=320 samples (20ms)
[OpusEncoder] ✅ Encoded: input=24576 samples (1536.00ms) → 77 full frames + 0 padded frames → output=5325 bytes (77 packets)
```

### 3. 检查解码质量

在节点端日志中查找：
```
✅ Successfully decoded Opus packets: 3840 samples (240.00ms) at 16000Hz, 
  estimated_packets=12, decode_fails=0, decode_success_rate=100.0%, 
  audio_quality: rms=0.1228, std=0.1228, dynamic_range=0.3980, min=-0.1757, max=0.2223
```

### 4. 诊断问题

如果看到：
- **高填充率**: `padding: {n} samples ({ms}ms) of silence` - 说明输入音频太短
- **解码失败**: `decode_fails={n}` - 说明Opus packet格式可能有问题
- **低质量音频**: `rms={low}, std={low}, dynamic_range={low}` - 说明解码后的音频质量差

---

## 下一步

1. **重启web端和节点端服务**以应用新日志
2. **进行测试**，对着web端说话
3. **查看日志**：
   - 浏览器控制台：查看编码日志
   - 节点端日志：查看解码日志
4. **对比数据**：
   - 编码输入 vs 解码输出
   - 比特率是否设置成功
   - 解码后的音频质量指标

---

## 预期日志输出示例

### Web端（浏览器控制台）
```
[OpusEncoder] ✅ Initialized successfully {sampleRate: 16000, channelCount: 1, application: 'voip', frameSizeMs: 20, bitrate: 24000, bitrateSet: true, bitrateMethod: 'setBitrate()'}
[OpusEncoder] 📊 Encoding audio: input_samples=24576, duration=1536.00ms, frame_size=320 samples (20ms)
[OpusEncoder] ✅ Encoded: input=24576 samples (1536.00ms) → 77 full frames + 0 padded frames (0 samples/0.00ms padding) → output=5325 bytes (77 packets)
[OpusEncoder] 📦 Plan A format packaging: {input_samples: 24576, input_duration_ms: 1536, packetCount: 77, packetSizes: "60-80 bytes (avg: 69)", totalSize: 5325, overhead: 154, compression_ratio: "9.23x"}
```

### 节点端（Python日志）
```
OpusPacketDecodingPipeline initialized: sample_rate=16000 Hz, channels=1, with_seq=False, buffer_capacity=240ms (3840 samples)
feed_data: input_size=5325 bytes
feed_data: popped packet #1, seq=None, packet_len=69
Opus decode success: packet_len=69 bytes → 320 samples (20.00ms), pcm16_len=640 bytes, sample_range=[-0.1757, 0.2223], dynamic_range=0.3980
feed_data completed: processed 77 packets, decoded 24640 samples, decode_fails=0, total_buffer_samples=24640
✅ Successfully decoded Opus packets: 24640 samples (1540.00ms) at 16000Hz, estimated_packets=77, decode_fails=0, decode_success_rate=100.0%, audio_quality: rms=0.1228, std=0.1228, dynamic_range=0.3980, min=-0.1757, max=0.2223
```

---

**完成时间**: 2025-12-25  
**状态**: ✅ **详细日志已添加，可以开始诊断问题**



---

## ASR_CONTEXT_AND_OUTPUT_LOGGING.md

# ASR 上下文和接口输出结果日志增强

**日期**: 2025-12-25  
**状态**: ✅ **已添加**

---

## 问题描述

用户要求：
1. **确认节点端语音识别的上下文端口有没有日志**
2. **能否将每一次识别的上下文，以及接口输出结果打印出来**
3. **看一下到底是上下文参数不对，还是接口输出结果不对**

---

## 修复方案

### 1. 添加 ASR 识别请求开始日志

**文件**: `electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`

**添加内容**：
```python
logger.info(f"[{trace_id}] ========== ASR 识别请求开始 ==========")
logger.info(
    f"[{trace_id}] ASR 参数: "
    f"language={asr_language}, "
    f"task={req.task}, "
    f"beam_size={req.beam_size}, "
    f"condition_on_previous_text={req.condition_on_previous_text}, "
    f"queue_depth={stats['queue_depth']}, "
    f"worker_state={stats['worker_state']}"
)
logger.info(
    f"[{trace_id}] ASR 上下文参数: "
    f"has_initial_prompt={text_context is not None and len(text_context) > 0}, "
    f"initial_prompt_length={len(text_context) if text_context else 0}, "
    f"initial_prompt_preview='{text_context[:100] if text_context else '(None)'}'"
)
logger.info(
    f"[{trace_id}] ASR 音频参数: "
