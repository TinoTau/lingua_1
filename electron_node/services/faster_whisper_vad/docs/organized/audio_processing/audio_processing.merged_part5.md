# Audio Processing (Part 5/6)

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

用户持续说了30秒，但节点端收到的音频只有0.24秒（3840 samples）。

---

## 问题分析

### 1. 为什么会调用 `read_pcm16` 方法？

虽然输入数据格式是 Opus，但解码流程需要转换为 PCM16：

```
Opus packets (输入)
  ↓
OpusPacketDecodingPipeline.feed_data()  (解码 Opus packets)
  ↓
PCM16RingBuffer.write()  (存储解码后的 PCM16 数据)
  ↓
OpusPacketDecodingPipeline.read_pcm16()  (读取 PCM16 数据)
  ↓
numpy array (float32)  (转换为 ASR 模型需要的格式)
```

**原因**：
- Opus 是压缩格式，ASR 模型需要的是 PCM16 格式的音频
- `read_pcm16` 是从 ring buffer 中读取已解码的 PCM16 数据，这是正常的解码流程

---

### 2. 调度服务器是否通过将音频数据切碎来提高传输速度？

**不是**。调度服务器的工作机制：

1. **累积 audio_chunk**：
   - Web 端每 100ms 发送一个 `audio_chunk`
   - 调度服务器将所有 `audio_chunk` 累积到同一个 `utterance_index` 的 buffer 中

2. **Finalize 触发条件**：
   - **Pause 超时**：如果 `pause_ms` 时间内（默认 2000ms）没有收到新的 `audio_chunk`，触发 finalize
   - **IsFinal 标志**：如果收到 `is_final=true` 的 `audio_chunk`，立即 finalize
   - **MaxLength 保护**：如果累积的音频超过 500KB，自动 finalize（异常保护）

3. **Finalize 执行**：
   - 调用 `take_combined()` 合并所有累积的 `audio_chunk`
   - 创建 job 并发送给节点端

**结论**：调度服务器不是主动切碎音频，而是根据 pause 超时机制来 finalize。这样可以：
- 等待用户说话结束（pause 超时）
- 一次性发送完整的 utterance，避免频繁创建 job

---

### 3. 如果把缓冲区提高到30秒，会不会造成调度服务器也发送30秒的长音频？

**不会**。原因：

1. **调度服务器的 finalize 机制是独立的**：
   - 调度服务器根据 `pause_ms` 超时来 finalize（默认 2000ms = 2秒）
   - 不受节点端缓冲区大小影响

2. **实际流程**：
   ```
   Web 端持续说话 30 秒
     ↓
   调度服务器累积 audio_chunk（每 100ms 一个）
     ↓
   用户停止说话，pause_ms 超时（2秒后）
     ↓
   调度服务器 finalize，合并所有 audio_chunk（可能是 30 秒的音频）
     ↓
   发送给节点端（一次性发送完整的 30 秒音频）
     ↓
   节点端 OpusPacketDecodingPipeline 解码所有 packets
     ↓
   如果节点端缓冲区容量足够（30秒），可以完整保存所有解码后的音频
   ```

3. **节点端缓冲区的作用**：
   - **不是**限制调度服务器发送的音频长度
   - **而是**限制节点端解码后可以保存的音频长度
   - 如果缓冲区太小（240ms），解码后的长音频会被丢弃（高水位策略）

---

## 修复方案

### 问题根源

节点端的 `PCM16RingBuffer` 容量只有 240ms（3840 samples），导致：
- 虽然解码了 40960 samples（2.56秒）
- 但缓冲区容量只有 3840 samples（240ms）
- 超出的数据被高水位策略丢弃

### 修复

1. **增加 `OpusPacketDecodingPipeline` 的默认缓冲区容量**：
   - 从 `240ms` 增加到 `30000ms`（30秒）
   - 文件：`opus_packet_decoder.py`

2. **同步更新 `audio_decoder.py` 中的硬编码值**：
   - 从 `240ms` 增加到 `30000ms`
   - 确保两个地方的值一致

### 修改文件

1. `electron_node/services/faster_whisper_vad/opus_packet_decoder.py`:
   ```python
   buffer_capacity_ms: int = 30000  # 30秒容量，足够容纳长音频
   ```

2. `electron_node/services/faster_whisper_vad/audio_decoder.py`:
   ```python
   buffer_capacity_ms=30000  # 30秒容量，与 opus_packet_decoder.py 保持一致
   ```

---

## 验证

修复后，节点端应该能够：
1. 接收调度服务器发送的长音频（例如 30 秒）
2. 完整解码所有 Opus packets
3. 保存所有解码后的 PCM16 数据（最多 30 秒）
4. 将完整的音频传递给 ASR 模型处理

---

## 注意事项

1. **内存使用**：
   - 30 秒的 PCM16 音频（16kHz, 单声道）≈ 30 * 16000 * 2 = 960KB
   - 这是可接受的内存开销

2. **调度服务器的 pause_ms**：
   - 默认是 2000ms（2秒）
   - 如果用户说话过程中有超过 2 秒的停顿，调度服务器会提前 finalize
   - 这是正常的行为，不是 bug

3. **高水位策略**：
   - `PCM16RingBuffer` 的高水位策略仍然有效
   - 如果解码后的音频超过 30 秒，仍然会被丢弃
   - 但正常情况下，调度服务器会在 pause 超时后 finalize，不会累积超过 30 秒的音频



---

## BITRATE_CONFIGURATION.md

# Opus 比特率配置

**日期**: 2025-12-25  
**状态**: ✅ **已配置推荐比特率**

---

## 配置总结

### Web 端 ✅

**文件**: `webapp/web-client/src/websocket_client.ts`

**配置**:
```typescript
const codecConfig: AudioCodecConfig = {
  codec: 'opus',
  sampleRate: 16000,
  channelCount: 1,
  frameSizeMs: 20,
  application: 'voip',
  bitrate: 24000, // ✅ 24 kbps for VOIP（推荐值）
};
```

**实现**: `webapp/web-client/src/audio_codec.ts`
- 在编码器初始化后尝试设置比特率
- 支持通过 `setBitrate()` 方法或 `bitrate` 属性设置
- 如果库不支持，会记录警告但继续使用默认值

### 节点端（测试代码）✅

**文件**: `electron_node/services/faster_whisper_vad/test_integration_wav.py`

**配置**:
```python
# 设置比特率为 24 kbps（与 Web 端一致）
bitrate = 24000  # 24 kbps
error = opus.opus_encoder_ctl(
    opus.cast(opus.pointer(encoder_state), opus.oe_p),
    opus.OPUS_SET_BITRATE_REQUEST,
    bitrate
)
```

**注意**: 
- 节点端的解码器不需要设置比特率（自动从 packet 读取）
- 只有测试代码中的编码器需要设置，确保与 Web 端一致

---

## 比特率选择

### 推荐值：24 kbps

**原因**:
- ✅ **平衡质量和带宽**: 16-32 kbps 是 VOIP 的推荐范围
- ✅ **适合短音频**: 对于 0.24 秒的短音频，24 kbps 提供更好的质量
- ✅ **网络友好**: 不会占用过多带宽
- ✅ **质量保证**: 足够支持清晰的语音识别

### 其他选项

- **16 kbps**: 最低推荐值，带宽更省，但质量略低
- **32 kbps**: 更高质量，但带宽占用更高
- **默认（64 kbps）**: 对短音频可能不友好，导致质量下降

---

## 验证

### Web 端

1. **检查控制台日志**:
   ```
   OpusEncoder initialized { sampleRate: 16000, application: 'voip', bitrate: 24000 }
   OpusEncoder bitrate set to 24000 bps
   ```

2. **如果库不支持设置比特率**:
   ```
   OpusEncoder initialized { sampleRate: 16000, application: 'voip', bitrate: 'default' }
   OpusEncoder does not support setting bitrate, using default
   ```

### 节点端（测试）

1. **检查日志**:
   ```
   Opus encoder bitrate set to 24000 bps (24 kbps for VOIP)
   ```

2. **如果设置失败**:
   ```
   Failed to set Opus encoder bitrate to 24000 bps: [error message]
   ```

---

## 预期效果

### 修复前

- 音频质量差（std: 0.0121-0.0898）
- ASR 无法识别，返回空文本
- 节点端继续调用 NMT/TTS，生成 "The" 语音

### 修复后

- ✅ 音频质量改善（std 应该 > 0.1）
- ✅ ASR 能够识别，返回有意义的文本
- ✅ 不再生成 "The" 语音

---

## 下一步

1. ✅ **重新编译 Web 端**
   ```bash
   cd webapp/web-client
   npm run build
   ```

2. ✅ **重启 Web 端服务**
   - 应用新的比特率配置

3. ✅ **测试验证**
   - 验证音频质量是否改善
   - 验证 ASR 识别率是否提高
   - 验证不再生成 "The" 语音

---

**配置完成时间**: 2025-12-25  
**状态**: ✅ **已配置推荐比特率（24 kbps for VOIP）**



---

## BITRATE_FIX_SUMMARY.md

# Opus 比特率配置修复总结

**日期**: 2025-12-25  
**状态**: ✅ **已配置推荐比特率（24 kbps for VOIP）**

---

## 修复内容

### 1. Web 端 ✅

**文件**: `webapp/web-client/src/websocket_client.ts`

**修改**:
```typescript
bitrate: 24000, // ✅ 设置 24 kbps for VOIP（推荐值，平衡质量和带宽）
```

**文件**: `webapp/web-client/src/audio_codec.ts`

**修改**:
- 在编码器初始化后尝试设置比特率
- 支持通过 `setBitrate()` 方法或 `bitrate` 属性设置
- 如果库不支持，会记录警告但继续使用默认值

### 2. 节点端（测试代码）✅

**更新的文件**:
1. `test_integration_wav.py` - 集成测试
2. `test_service_unit.py` - 单元测试
3. `test_plan_a_e2e.py` - 端到端测试
4. `test_opus_quick.py` - 快速测试

**修改**:
```python
# 设置比特率为 24 kbps（与 Web 端一致）
bitrate = 24000  # 24 kbps
error = opus.opus_encoder_ctl(
    opus.cast(opus.pointer(encoder_state), opus.oe_p),
    opus.OPUS_SET_BITRATE_REQUEST,
    bitrate
)
```

---

## 比特率选择

### 推荐值：24 kbps

**原因**:
- ✅ **平衡质量和带宽**: 16-32 kbps 是 VOIP 的推荐范围
- ✅ **适合短音频**: 对于 0.24 秒的短音频，24 kbps 提供更好的质量
- ✅ **网络友好**: 不会占用过多带宽
- ✅ **质量保证**: 足够支持清晰的语音识别

### 对比

| 比特率 | 质量 | 带宽 | 适用场景 |
|--------|------|------|----------|
| 16 kbps | 中等 | 低 | 最低推荐值 |
| **24 kbps** | **良好** | **中等** | **推荐值（已配置）** |
| 32 kbps | 高 | 较高 | 更高质量 |
| 64 kbps（默认） | 高 | 高 | 对短音频不友好 |

---

## 预期效果

### 修复前

- ❌ 使用默认比特率（64 kbps）
- ❌ 音频质量差（std: 0.0121-0.0898）
- ❌ ASR 无法识别，返回空文本
- ❌ 节点端继续调用 NMT/TTS，生成 "The" 语音

### 修复后

- ✅ 使用推荐比特率（24 kbps）
- ✅ 音频质量改善（std 应该 > 0.1）
- ✅ ASR 能够识别，返回有意义的文本
- ✅ 不再生成 "The" 语音

---

## 验证步骤

### 1. Web 端

**检查控制台日志**:
```
OpusEncoder initialized { sampleRate: 16000, application: 'voip', bitrate: 24000 }
OpusEncoder bitrate set to 24000 bps
```

**如果库不支持**:
```
OpusEncoder initialized { sampleRate: 16000, application: 'voip', bitrate: 'default' }
OpusEncoder does not support setting bitrate, using default
```

### 2. 节点端（测试）

**检查日志**:
```
Opus encoder bitrate set to 24000 bps (24 kbps for VOIP)
```

### 3. ASR 服务

**检查音频质量指标**:
```
Audio data validation: 
std=0.15,  # ✅ 应该 > 0.1（之前是 0.0121-0.0898）
rms=0.08,  # ✅ 应该 > 0.01
dynamic_range=0.5,  # ✅ 应该 > 0.05
```

---

## 下一步

1. ✅ **重新编译 Web 端**
   ```bash
   cd webapp/web-client
   npm run build
   ```

2. ✅ **重启 Web 端服务**
   - 应用新的比特率配置

3. ✅ **测试验证**
   - 验证音频质量是否改善
   - 验证 ASR 识别率是否提高
   - 验证不再生成 "The" 语音

---

**修复完成时间**: 2025-12-25  
**状态**: ✅ **已配置推荐比特率（24 kbps for VOIP）**

**注意**: 
- Web 端需要重新编译和重启
- 节点端测试代码已更新，下次测试时会使用新配置
- 解码端不需要设置比特率（自动从 packet 读取）



---

## FIX_AUDIO_CHUNK_FORMAT.md

# 修复audio_chunk格式问题

**日期**: 2025-12-24  
**修复**: Web端`sendAudioChunk()`使用Plan A格式  
**状态**: ✅ **已完成**

---

## 问题总结

### 发现的问题

1. **Web端使用两种消息类型**：
   - `audio_chunk`消息：流式发送，使用`encode()`方法（连续字节流）❌
   - `utterance`消息：一次性发送，使用`encodePackets()`方法（packet格式）✅

2. **调度服务器处理方式**：
   - `audio_chunk` → `audio_buffer` → finalize → job（连续字节流）
   - `utterance` → 直接创建job（packet格式）

3. **结果**：
   - 第一个请求（`utterance`消息）：成功检测到packet格式 ✅
   - 后续请求（`audio_chunk`消息合并）：检测不到packet格式 ❌

---

## 修复内容

### 修改文件

**文件**: `webapp/web-client/src/websocket_client.ts`

**方法**: `sendAudioChunkJSON()`

### 修复前

```typescript
// ❌ 使用 encode() 方法，生成连续字节流
encodedAudio = await this.audioEncoder.encode(audioData);
```

### 修复后

```typescript
// ✅ 使用 encodePackets() 方法（Plan A格式）
const opusPackets = await encoder.encodePackets(audioData);

// ✅ 为每个packet添加长度前缀（Plan A格式）
for (const packet of opusPackets) {
  const lenBuffer = new ArrayBuffer(2);
  const lenView = new DataView(lenBuffer);