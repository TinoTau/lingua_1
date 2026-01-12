# Web Client Integration (Part 1/2)

# Web Client Integration

本文档合并了所有相关文档。

---

## WEB_CLIENT_AUDIO_BUFFER_AND_ASR_CONTEXT_ISSUES.md

# Web端音频缓存和ASR上下文问题分析

**日期**: 2025-12-25  
**状态**: 🔍 **问题分析中**

---

## 问题描述

用户反馈：
1. **Web端没有将调度服务器返回的音频放入缓存区**
2. **大量已经被翻译好的内容被丢弃**
3. **语音识别的准确度需要查看上下文相关的日志**

---

## 日志分析

### 1. 调度服务器日志

**成功发送的结果**：
```
"Sending translation result to session (single mode)"
"tts_audio_len=228752"
"Successfully sent translation result to session"
```

**被跳过的空结果**：
```
"Skipping empty translation result (silence detected), not forwarding to web client"
```

**结果队列状态**：
```
expected_index=12, queue_size=9, queue_indices=[0, 1, 2, 3, 4, 5, 6, 7, 10]
```

**分析**：
- ✅ 调度服务器成功发送了翻译结果（`tts_audio_len=228752`）
- ⚠️ 有很多空结果被跳过（静音检测）
- ⚠️ 结果队列中有结果但没有被释放（`expected_index=12`，但队列中只有 `[0, 1, 2, 3, 4, 5, 6, 7, 10]`）

---

### 2. ASR服务日志

**上下文参数**：
```
has_initial_prompt=True, initial_prompt_length=17
initial_prompt_preview='搴旇鏈夌‖鐗囪杩斿洖浜?浣嗘槸杩樻病鏈夋樉绀?'
condition_on_previous_text=True  # ⚠️ 应该是 False
```

**问题**：
- ⚠️ `condition_on_previous_text=True` 应该被设置为 `False`，以避免重复识别
- ⚠️ 日志显示乱码，可能是日志编码问题（但实际数据可能是正确的）

---

## 代码检查

### 1. ASR Worker 默认值问题

**文件**: `electron_node/services/faster_whisper_vad/asr_worker_process.py`

**问题**：
```python
condition_on_previous_text = task.get("condition_on_previous_text", True)  # ❌ 默认值是 True
```

**应该改为**：
```python
condition_on_previous_text = task.get("condition_on_previous_text", False)  # ✅ 默认值改为 False
```

**原因**：
- `faster_whisper_vad_service.py` 中 `UtteranceRequest.condition_on_previous_text: bool = False`
- 但如果任务中没有传递这个参数，`asr_worker_process.py` 会使用默认值 `True`
- 这会导致 ASR 重复识别问题

---

### 2. Web端音频缓存逻辑

**文件**: `webapp/web-client/src/app.ts`

**当前实现**：
```typescript
case 'translation_result':
  // 检查结果是否为空
  if (asrEmpty && translatedEmpty && ttsEmpty) {
    console.log('[App] 收到空文本结果（静音检测），跳过缓存和播放');
    return;  // ❌ 直接返回，不处理
  }
  
  // 处理 TTS 音频
  if (message.tts_audio && message.tts_audio.length > 0) {
    this.ttsPlayer.addAudioChunk(message.tts_audio, message.utterance_index).then(() => {
      console.log('[App] TTS 音频块已添加到缓冲区');
    });
  }
```

**可能的问题**：
1. **Web端没有收到消息**：
   - WebSocket 连接断开
   - 消息路由错误
   - 消息被过滤

2. **消息被过滤**：
   - 空结果检查：`if (asrEmpty && translatedEmpty && ttsEmpty)` 可能过于严格
   - 会话状态检查：`if (!this.isSessionActive)` 可能过早结束会话

3. **音频添加失败**：
   - `addAudioChunk()` 抛出错误但被捕获
   - base64 解码失败
   - 音频格式不匹配

---

## 修复方案

### 1. 修复 ASR Worker 默认值

**文件**: `electron_node/services/faster_whisper_vad/asr_worker_process.py`

**修改**：
```python
condition_on_previous_text = task.get("condition_on_previous_text", False)  # 默认值改为 False
```

---

### 2. 增强 Web端日志

**文件**: `webapp/web-client/src/app.ts`

**添加详细日志**：
```typescript
case 'translation_result':
  console.log('[App] 收到 translation_result 消息:', {
    utterance_index: message.utterance_index,
    has_text_asr: !!message.text_asr,
    has_text_translated: !!message.text_translated,
    has_tts_audio: !!message.tts_audio,
    tts_audio_length: message.tts_audio?.length || 0,
    is_session_active: this.isSessionActive
  });
  
  // ... 现有逻辑 ...
  
  if (message.tts_audio && message.tts_audio.length > 0) {
    console.log('[App] 准备添加 TTS 音频到缓冲区:', {
      utterance_index: message.utterance_index,
      base64_length: message.tts_audio.length
    });
    
    this.ttsPlayer.addAudioChunk(message.tts_audio, message.utterance_index)
      .then(() => {
        console.log('[App] ✅ TTS 音频块已成功添加到缓冲区');
      })
      .catch((error) => {
        console.error('[App] ❌ 添加 TTS 音频块失败:', error);
      });
  } else {
    console.warn('[App] ⚠️ 翻译结果中没有 TTS 音频');
  }
```

---

### 3. 检查结果队列问题

**问题**：`expected_index=12`，但队列中只有 `[0, 1, 2, 3, 4, 5, 6, 7, 10]`

**可能的原因**：
- 结果 8, 9, 11 丢失或延迟
- 结果队列的 gap tolerance 机制可能有问题

**需要检查**：
- 结果队列的 `gap_timeout_ms` 配置
- `MissingResult` 消息是否被正确处理

---

## 诊断步骤

### 1. 检查浏览器控制台

**打开浏览器开发者工具（F12），查看控制台日志**：

**预期日志**：
```
[App] 收到 translation_result 消息: {utterance_index: 10, has_tts_audio: true, ...}
收到 TTS 音频，累积到缓冲区，不自动播放 base64长度: 228752
TtsPlayer: 添加音频块，当前状态: input_recording base64长度: 228752 utteranceIndex: 10
TtsPlayer: 音频块已添加到缓冲区，缓冲区大小: 1 utteranceIndex: 10
[App] ✅ TTS 音频块已成功添加到缓冲区
```

**如果没有看到这些日志**：
- ❌ Web端没有收到 `translation_result` 消息
- ⚠️ 检查 WebSocket 连接状态
- ⚠️ 检查消息是否被过滤

---

### 2. 检查 ASR 上下文日志

**查看 ASR 服务日志**：
```bash
tail -f electron_node/services/faster_whisper_vad/logs/faster-whisper-vad-service.log | grep -i "ASR.*上下文\|condition_on_previous_text"
```

**预期日志**：
```
ASR 上下文参数: has_initial_prompt=True, initial_prompt_length=17, condition_on_previous_text=False
```

**如果看到 `condition_on_previous_text=True`**：
- ❌ ASR Worker 默认值问题
- ⚠️ 需要修复 `asr_worker_process.py`

---

## 下一步

1. ✅ **修复 ASR Worker 默认值**：将 `condition_on_previous_text` 默认值改为 `False`
2. ⏳ **增强 Web端日志**：添加详细的接收和处理日志
3. ⏳ **检查浏览器控制台**：确认 Web端是否收到消息
4. ⏳ **检查结果队列**：确认为什么 `expected_index` 不匹配



---

## WEB_CLIENT_AUDIO_FORMAT_ANALYSIS.md

# Web端音频格式分析

**日期**: 2025-12-24  
**问题**: Web端发送两种不同格式的音频数据  
**状态**: ✅ **问题已定位**

---

## 核心发现

### Web端使用两种消息类型

1. **`audio_chunk`消息**（流式发送）
   - 使用`sendAudioChunk()`方法
   - 在录音过程中持续发送音频块
   - **问题**：使用`encode()`方法，生成**连续字节流**（非packet格式）

2. **`utterance`消息**（一次性发送）
   - 使用`sendUtterance()`方法
   - 在用户停止说话时发送完整音频
   - **正确**：使用`encodePackets()`方法，生成**packet格式**

---

## 代码分析

### 1. Web端发送逻辑

#### `sendAudioChunk()` - 流式发送（❌ 问题）

**文件**: `webapp/web-client/src/websocket_client.ts`

```typescript
// 第662行：sendAudioChunkJSON()
private async sendAudioChunkJSON(audioData: Float32Array, isFinal: boolean = false) {
  if (this.audioEncoder && this.audioCodecConfig?.codec === 'opus') {
    // ❌ 使用 encode() 方法，生成连续字节流
    encodedAudio = await this.audioEncoder.encode(audioData);
  }
  
  const message: AudioChunkMessage = {
    type: 'audio_chunk',
    session_id: this.sessionId,
    seq: this.sequence++,
    is_final: isFinal,
    payload: base64,  // 连续字节流，非packet格式
  };
}
```

**问题**：
- 使用`encode()`方法，将所有音频帧合并成连续字节流
- 没有使用`encodePackets()`方法
- 没有添加packet长度前缀

#### `sendUtterance()` - 一次性发送（✅ 正确）

**文件**: `webapp/web-client/src/websocket_client.ts`

```typescript
// 第775行：sendUtterance()
async sendUtterance(audioData: Float32Array, ...) {
  if (encoder.encodePackets && typeof encoder.encodePackets === 'function') {
    // ✅ 使用 encodePackets() 方法，生成packet数组
    opusPackets = await encoder.encodePackets(audioData);
    
    // ✅ 为每个packet添加长度前缀（Plan A格式）
    for (const packet of opusPackets) {
      const lenBuffer = new ArrayBuffer(2);
      const lenView = new DataView(lenBuffer);
      lenView.setUint16(0, packet.length, true); // little-endian
      // ...
    }
  }
}
```

**正确**：
- 使用`encodePackets()`方法，生成packet数组
- 为每个packet添加长度前缀（Plan A格式）

---

### 2. 调度服务器处理逻辑

#### `audio_chunk`消息处理

**文件**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

```rust
// 第197行：handle_audio_chunk()
async fn handle_audio_chunk(&mut self, chunk: Vec<u8>, ...) {
  // 添加音频块到缓冲区
  self.state.audio_buffer.add_chunk(&self.session_id, utterance_index, chunk).await;
  
  // 如果是最终块，立即 finalize
  if is_final {
    self.try_finalize(utterance_index, "IsFinal").await?;
  }
}
```

**处理流程**：
1. 接收`audio_chunk`消息
2. Base64解码得到`chunk: Vec<u8>`
3. 添加到`audio_buffer`（简单累积）
4. 在finalize时，`audio_buffer.get_combined()`合并所有chunk
5. 创建job并发送给节点

**问题**：
- `audio_buffer.get_combined()`只是简单连接chunk：`combined.extend_from_slice(chunk)`
- 如果chunk是连续字节流，合并后仍然是连续字节流
- **没有packet格式信息**

#### `utterance`消息处理

**文件**: `central_server/scheduler/src/websocket/session_message_handler/utterance.rs`

```rust
// 第9行：handle_utterance()
pub(super) async fn handle_utterance(..., audio: String, ...) {
  // 解码音频
  let audio_data = general_purpose::STANDARD.decode(&audio)?;
  
  // 直接创建job（不经过audio_buffer）
  let jobs = create_translation_jobs(..., audio_data, ...).await?;
}
```

**处理流程**：
1. 接收`utterance`消息
2. Base64解码得到`audio_data: Vec<u8>`
3. **直接创建job**（不经过`audio_buffer`）
4. 发送给节点

**正确**：
- 数据直接传递，不经过合并
- 如果Web端发送的是packet格式，节点端接收到的也是packet格式

---

### 3. 原node-inference处理方式

**文件**: `electron_node/services/node-inference/src/audio_codec.rs`

```rust
// 第42行：OpusDecoder::decode()
pub fn decode(&mut self, opus_data: &[u8]) -> Result<Vec<u8>> {
  // 尝试解码整个数据块（如果数据是单个帧）
  match self.decoder.decode(opus_data, &mut pcm_buffer, false) {
    Ok(decoded_samples) => {
      // 成功解码
    }
    Err(e) => {
      // 如果整体解码失败，尝试分帧解码（简化处理：假设每帧最大 400 字节）
      let mut offset = 0;
      while offset < opus_data.len() {
        let chunk_size = std::cmp::min(400, opus_data.len() - offset);
        let chunk = &opus_data[offset..offset + chunk_size];
        // 尝试解码chunk
      }
    }
  }
}
```

**特点**：
- 使用`opus-rs`库，可以处理连续字节流
- 先尝试整体解码，失败后分帧解码（每帧最大400字节）
- **不依赖packet格式**，可以处理连续字节流（虽然不完美）

---

## 问题根源

### 问题1: Web端`sendAudioChunk()`没有使用Plan A格式

**原因**：
- `sendAudioChunk()`使用`encode()`方法，生成连续字节流
- 没有使用`encodePackets()`方法
- 没有添加packet长度前缀

**影响**：
- `audio_chunk`消息 → `audio_buffer` → finalize → 创建job
- 节点端接收到的是连续字节流，无法检测到packet格式
- 服务端尝试连续字节流解码，失败

### 问题2: 调度服务器`audio_buffer`合并逻辑

**原因**：
- `audio_buffer.get_combined()`只是简单连接chunk
- 不检查或修改数据格式
- 如果chunk是连续字节流，合并后仍然是连续字节流

**影响**：
- 即使Web端发送packet格式的chunk，合并后可能破坏格式
- 但更可能的是：Web端发送的就是连续字节流

---

## 解决方案

### 方案1: 修复Web端`sendAudioChunk()`（推荐）

**修改**: `webapp/web-client/src/websocket_client.ts`

```typescript
// 修改 sendAudioChunkJSON() 方法
private async sendAudioChunkJSON(audioData: Float32Array, isFinal: boolean = false) {
  if (this.audioEncoder && this.audioCodecConfig?.codec === 'opus') {
    const encoder = this.audioEncoder as any;
    
    // ✅ 使用 encodePackets() 方法（Plan A格式）
    if (encoder.encodePackets && typeof encoder.encodePackets === 'function') {
      const opusPackets = await encoder.encodePackets(audioData);
      
      // ✅ 为每个packet添加长度前缀
      const packetDataParts: Uint8Array[] = [];
      for (const packet of opusPackets) {
        if (packet.length === 0) continue;
        
        const lenBuffer = new ArrayBuffer(2);
        const lenView = new DataView(lenBuffer);
        lenView.setUint16(0, packet.length, true);
        
        packetDataParts.push(new Uint8Array(lenBuffer));
        packetDataParts.push(packet);
      }
      
      // 合并所有packet数据
      const totalSize = packetDataParts.reduce((sum, part) => sum + part.length, 0);
      encodedAudio = new Uint8Array(totalSize);
      let offset = 0;
      for (const part of packetDataParts) {
        encodedAudio.set(part, offset);
        offset += part.length;
      }
    } else {
      throw new Error('Opus encoder does not support encodePackets(). Plan A format requires encodePackets() method.');
    }
  }
}
```

### 方案2: 确保调度服务器正确合并packet格式

**检查**: `central_server/scheduler/src/managers/audio_buffer.rs`

- `get_combined()`只是简单连接，应该没问题
- 但需要确保Web端发送的是packet格式

---

## 数据流对比