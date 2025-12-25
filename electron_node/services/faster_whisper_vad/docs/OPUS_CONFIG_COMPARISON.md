# Opus 编码/解码配置对比

**日期**: 2025-12-25  
**状态**: ✅ **配置已对比**

---

## 配置参数对比

### Web端（编码器）

**位置**: `webapp/web-client/src/websocket_client.ts` (第234-241行)

```typescript
const codecConfig: AudioCodecConfig = {
  codec: 'opus',
  sampleRate: 16000,        // ✅ 采样率
  channelCount: 1,          // ✅ 声道数（单声道）
  frameSizeMs: 20,          // ✅ 帧大小（20ms）
  application: 'voip',      // ✅ 应用类型（VOIP模式）
  bitrate: 24000,           // ✅ 比特率（24 kbps）
};
```

**编码器初始化**: `webapp/web-client/src/audio_codec.ts` (第159-162行)

```typescript
this.encoder = new OpusEncoder({
  sampleRate: this.config.sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
  application: application, // VOIP 或 AUDIO
});
```

**比特率设置**: (第169-185行)
- 尝试使用 `setBitrate()` 方法设置比特率
- 如果方法不存在，尝试直接设置 `bitrate` 属性
- 如果都不支持，使用默认比特率（可能警告）

### 节点端（解码器）

**位置**: `electron_node/services/faster_whisper_vad/opus_packet_decoder.py`

**全局配置** (第39-44行):
```python
SAMPLE_RATE = 16000        # ✅ 采样率
CHANNELS = 1              # ✅ 声道数（单声道）
FRAME_MS = 20             # ✅ 帧大小（20ms）
FRAME_SAMPLES = 320       # 16000 * 0.02 = 320 samples
```

**解码器初始化** (第149-154行):
```python
pipeline = OpusPacketDecodingPipeline(
    sample_rate=sample_rate,  # 从参数传入，默认16000
    channels=1,              # 固定为1（单声道）
    with_seq=False,          # 不使用序列号
    buffer_capacity_ms=240    # 缓冲区容量（240ms）
)
```

**OpusPacketDecoder初始化** (第201-222行):
```python
def __init__(self, sample_rate: int = SAMPLE_RATE, channels: int = CHANNELS):
    self.sample_rate = sample_rate
    self.channels = channels
    # 使用 pyogg.opus 创建解码器
    decoder = opus.opus_decoder_create(
        sample_rate,
        channels
    )
```

---

## 配置一致性检查

| 参数 | Web端（编码） | 节点端（解码） | 状态 |
|------|--------------|---------------|------|
| **采样率** | 16000 Hz | 16000 Hz | ✅ **一致** |
| **声道数** | 1 (单声道) | 1 (单声道) | ✅ **一致** |
| **帧大小** | 20ms | 20ms | ✅ **一致** |
| **应用类型** | VOIP | N/A (解码器不关心) | ✅ **兼容** |
| **比特率** | 24 kbps | N/A (解码器自动适应) | ✅ **兼容** |

---

## 潜在问题

### 1. 比特率设置可能失败 ⚠️

**问题**: Web端尝试设置比特率为24 kbps，但可能失败

**代码位置**: `webapp/web-client/src/audio_codec.ts` (第169-185行)

```typescript
if (this.config.bitrate) {
  try {
    if (typeof (this.encoder as any).setBitrate === 'function') {
      (this.encoder as any).setBitrate(this.config.bitrate);
      console.log('OpusEncoder bitrate set to', this.config.bitrate, 'bps');
    } else if (typeof (this.encoder as any).bitrate !== 'undefined') {
      (this.encoder as any).bitrate = this.config.bitrate;
      console.log('OpusEncoder bitrate set to', this.config.bitrate, 'bps');
    } else {
      console.warn('OpusEncoder does not support setting bitrate, using default');
    }
  } catch (error) {
    console.warn('Failed to set OpusEncoder bitrate:', error);
  }
}
```

**影响**: 
- 如果比特率设置失败，编码器可能使用默认比特率
- 默认比特率可能不适合VOIP应用（可能太高或太低）
- 可能导致编码质量下降

**检查方法**: 
- 查看浏览器控制台是否有 `OpusEncoder bitrate set to 24000 bps` 日志
- 如果没有，说明比特率设置失败

### 2. 编码器帧大小处理 ⚠️

**问题**: Web端编码器需要固定大小的帧（20ms = 320 samples）

**代码位置**: `webapp/web-client/src/audio_codec.ts` (第216-254行)

```typescript
const frameSizeMs = this.config.frameSizeMs || 20; // 默认 20ms
const frameSize = Math.floor(this.config.sampleRate * frameSizeMs / 1000); // 320 samples

// 如果数据长度小于帧大小，需要填充到帧大小
if (audioData.length < frameSize) {
  const paddedData = new Float32Array(frameSize);
  paddedData.set(audioData, 0);
  // 剩余部分填充为 0（静音）
  return this.encoder.encodeFrame(paddedData);
}
```

**影响**:
- 如果输入的音频数据不是20ms的整数倍，会被填充或分割
- 填充的静音部分可能导致解码后的音频质量下降
- 特别是对于很短的音频片段（如0.24秒），填充可能占很大比例

### 3. 解码器缓冲区配置 ⚠️

**问题**: 节点端解码器使用240ms的缓冲区

**代码位置**: `electron_node/services/faster_whisper_vad/audio_decoder.py` (第153行)

```python
buffer_capacity_ms=240  # 4 * 60ms
```

**影响**:
- 缓冲区较大，可能导致延迟
- 但对于处理jitter和packet丢失是有益的

---

## 建议修复

### 1. 验证比特率设置

在浏览器控制台检查是否有以下日志：
- ✅ `OpusEncoder bitrate set to 24000 bps` - 比特率设置成功
- ⚠️ `OpusEncoder does not support setting bitrate, using default` - 比特率设置失败

如果比特率设置失败，需要：
1. 检查 `@minceraftmc/opus-encoder` 库是否支持设置比特率
2. 如果不支持，考虑使用其他Opus编码库
3. 或者接受默认比特率（但需要确认默认值是否适合VOIP）

### 2. 优化帧大小处理

对于很短的音频片段，可以考虑：
1. 不强制填充到20ms，允许更小的帧
2. 或者累积多个小片段，直到达到20ms再编码
3. 但这需要修改编码器接口

### 3. 添加配置验证日志

在节点端解码时，记录实际解码参数：
- 采样率
- 声道数
- 解码出的音频长度
- 解码失败次数

---

## 总结

✅ **基本配置一致**: 采样率、声道数、帧大小都匹配

⚠️ **潜在问题**:
1. 比特率设置可能失败（需要验证）
2. 帧填充可能导致质量下降
3. 需要更多日志来诊断问题

**下一步**: 
1. 检查浏览器控制台，确认比特率是否设置成功
2. 如果比特率设置失败，考虑修复或使用其他方法
3. 添加更多诊断日志，帮助定位问题

