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

