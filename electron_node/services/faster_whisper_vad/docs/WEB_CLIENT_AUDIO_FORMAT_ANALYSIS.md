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

### 当前流程（有问题）

```
Web端录音
  → sendAudioChunk() [连续字节流] 
  → audio_chunk消息 
  → 调度服务器audio_buffer 
  → finalize合并 
  → 创建job [连续字节流] 
  → 节点端 
  → 服务端 [检测不到packet格式] ❌
```

### 修复后流程

```
Web端录音
  → sendAudioChunk() [packet格式] 
  → audio_chunk消息 
  → 调度服务器audio_buffer 
  → finalize合并 [packet格式] 
  → 创建job [packet格式] 
  → 节点端 
  → 服务端 [检测到packet格式] ✅
```

---

## 总结

1. **Web端同时使用两种消息**：
   - `audio_chunk`：流式发送（当前使用连续字节流）
   - `utterance`：一次性发送（使用packet格式）

2. **调度服务器处理方式不同**：
   - `audio_chunk` → `audio_buffer` → finalize → job
   - `utterance` → 直接创建job

3. **问题根源**：
   - `sendAudioChunk()`没有使用Plan A格式
   - 导致`audio_chunk`消息中的数据是连续字节流

4. **解决方案**：
   - 修复`sendAudioChunk()`，使用`encodePackets()`和Plan A格式
   - 确保所有音频数据都使用packet格式

