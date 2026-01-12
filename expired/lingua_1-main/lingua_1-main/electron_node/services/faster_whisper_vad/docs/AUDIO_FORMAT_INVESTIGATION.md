# 音频格式不一致问题调查

**日期**: 2025-12-24  
**问题**: 第一个请求能检测到packet格式，后续请求检测不到  
**状态**: 🔍 **调查中**

---

## 问题现象

### 第一个请求（job-62962106）- 第一次 ✅
```
[INFO] Detected Opus packet format: packet_len=73, total_bytes=8352
[INFO] Successfully decoded Opus packets: 3840 samples
[INFO] POST /utterance HTTP/1.1" 200 OK
```

### 第一个请求（job-62962106）- 第二次（同一个job_id）❌
```
[WARN] Opus data is not in packet format
[INFO] Attempting to decode Opus audio with ffmpeg: 8745 bytes
[ERROR] Failed to decode Opus audio (continuous byte stream method)
[INFO] POST /utterance HTTP/1.1" 400 Bad Request
```

**关键发现**:
- 同一个`job_id`被发送了两次
- 第一次：8352 bytes（packet格式）
- 第二次：8745 bytes（非packet格式）

---

## 可能的原因

### 1. 调度服务器重试机制 ⚠️

**假设**: 调度服务器在第一次请求失败后重试，但使用了不同的数据源

**检查点**:
- 调度服务器是否有重试机制？
- 重试时是否使用相同的音频数据？
- 是否有多个数据源（`Utterance`消息 vs `AudioChunk`消息）？

### 2. 音频缓冲区合并问题 ⚠️

**假设**: 调度服务器使用`audio_buffer`合并音频块时，可能破坏了packet格式

**检查点**:
- `audio_buffer.add_chunk()`是否正确处理packet格式？
- `audio_buffer.get_combined()`是否只是简单连接，还是修改了数据？

**代码分析**:
```rust
// audio_buffer.rs
fn get_combined(&self) -> Vec<u8> {
    let mut combined = Vec::with_capacity(self.total_size);
    for chunk in &self.chunks {
        combined.extend_from_slice(chunk);  // 只是简单连接
    }
    combined
}
```

**结论**: `get_combined()`只是简单连接chunk，不应该破坏packet格式。

### 3. Web端发送路径不同 ⚠️

**假设**: Web端可能通过两个不同的路径发送音频：
1. `Utterance`消息（一次性发送，使用packet格式）
2. `AudioChunk`消息（流式发送，可能不使用packet格式）

**检查点**:
- Web端是否同时使用`Utterance`和`AudioChunk`？
- 两个路径的编码方式是否一致？

### 4. Base64编码/解码问题 ⚠️

**假设**: Base64编码/解码可能导致数据格式变化

**检查点**:
- 调度服务器是否正确进行Base64解码？
- 节点端是否正确进行Base64解码？

**代码分析**:
```rust
// utterance.rs - 调度服务器接收
let audio_data = general_purpose::STANDARD.decode(&audio)?;

// mod.rs - 调度服务器发送给节点
let audio_base64 = general_purpose::STANDARD.encode(&job.audio_data);
```

**结论**: Base64编码/解码应该是透明的，不应该修改数据格式。

---

## 数据流分析

### 路径1: Utterance消息（一次性发送）
```
Web端 (packet格式) 
  → Base64编码 
  → 调度服务器 (Base64解码) 
  → 创建Job (存储audio_data) 
  → Base64编码 
  → 节点端 (Base64解码) 
  → 服务端 (检测packet格式) ✅
```

### 路径2: AudioChunk消息（流式发送）
```
Web端 (packet格式?) 
  → Base64编码 
  → 调度服务器 (Base64解码) 
  → audio_buffer.add_chunk() 
  → audio_buffer.get_combined() 
  → 创建Job (存储audio_data) 
  → Base64编码 
  → 节点端 (Base64解码) 
  → 服务端 (检测packet格式?) ❓
```

---

## 关键问题

### 问题1: 为什么同一个job_id被发送两次？

**可能原因**:
1. 调度服务器有重试机制
2. 有多个地方创建了同一个job
3. 节点端重试了请求

### 问题2: 为什么第二次的数据格式不同？

**可能原因**:
1. 使用了不同的数据源（`Utterance` vs `AudioChunk`）
2. Web端在第二次发送时使用了不同的编码方式
3. 音频缓冲区合并时破坏了格式

---

## 调试建议

### 1. 检查调度服务器日志

查找：
- `job-62962106`的创建记录
- 是否有重试记录
- 数据来源（`Utterance` vs `AudioChunk`）

### 2. 检查Web端日志

查找：
- 每次发送时使用的编码方法
- 发送的数据大小和格式
- 是否使用了`Utterance`和`AudioChunk`两种消息

### 3. 添加调试日志

**在调度服务器**:
```rust
// utterance.rs
info!(
    audio_size_bytes = audio_data.len(),
    first_10_bytes_hex = format!("{:02x?}", &audio_data[..min(10, audio_data.len())]),
    "Received Utterance audio data"
);

// audio_buffer.rs
info!(
    chunk_size = chunk.len(),
    first_10_bytes_hex = format!("{:02x?}", &chunk[..min(10, chunk.len())]),
    "Adding audio chunk to buffer"
);
```

**在服务端**:
```python
# audio_decoder.py
if len(audio_bytes) >= 10:
    first_10_hex = ' '.join([f'{b:02x}' for b in audio_bytes[:10]])
    logger.info(f"[{trace_id}] First 10 bytes (hex): {first_10_hex}")
```

---

## 下一步

1. **检查调度服务器日志**，确认`job-62962106`的创建和发送过程
2. **检查Web端日志**，确认每次发送时使用的编码方法
3. **添加调试日志**，记录数据的前几个字节，便于对比
4. **确认数据来源**，是`Utterance`消息还是`AudioChunk`消息

