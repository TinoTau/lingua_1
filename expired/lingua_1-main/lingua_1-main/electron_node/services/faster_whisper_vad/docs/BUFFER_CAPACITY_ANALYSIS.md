# 缓冲区容量问题分析

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

