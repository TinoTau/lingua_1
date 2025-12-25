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
  lenView.setUint16(0, packet.length, true); // little-endian
  
  packetDataParts.push(new Uint8Array(lenBuffer));
  packetDataParts.push(packet);
}

// ✅ 合并所有packet数据
encodedAudio = new Uint8Array(totalSize);
// ...
```

---

## 修复后的数据流

### audio_chunk消息流程（修复后）

```
Web端录音
  → sendAudioChunk() [使用encodePackets() + Plan A格式] 
  → audio_chunk消息 [packet格式] 
  → 调度服务器audio_buffer [累积packet格式数据] 
  → finalize合并 [packet格式] 
  → 创建job [packet格式] 
  → 节点端 
  → 服务端 [检测到packet格式] ✅
```

### utterance消息流程（保持不变）

```
Web端录音
  → sendUtterance() [使用encodePackets() + Plan A格式] 
  → utterance消息 [packet格式] 
  → 调度服务器 [直接创建job] 
  → 节点端 
  → 服务端 [检测到packet格式] ✅
```

---

## 关键变化

1. **`sendAudioChunkJSON()`现在使用Plan A格式**：
   - 使用`encodePackets()`方法
   - 为每个packet添加长度前缀
   - 没有回退机制（如果`encodePackets()`不可用，直接失败）

2. **与`sendUtterance()`保持一致**：
   - 两种消息类型都使用相同的Plan A格式
   - 确保所有音频数据都是packet格式

---

## 预期效果

1. **所有请求都能检测到packet格式**：
   - `audio_chunk`消息合并后的数据是packet格式
   - `utterance`消息的数据是packet格式

2. **不再出现400错误**：
   - 服务端能正确检测到packet格式
   - 成功解码所有音频数据

3. **不再出现404错误**：
   - 节点端能正确处理所有请求
   - 正确返回结果给调度服务器

---

## 相关文件

- `webapp/web-client/src/websocket_client.ts` - Web端发送逻辑
- `electron_node/services/faster_whisper_vad/audio_decoder.py` - 服务端解码逻辑
- `central_server/scheduler/src/managers/audio_buffer.rs` - 调度服务器音频缓冲区
- `electron_node/services/faster_whisper_vad/docs/WEB_CLIENT_AUDIO_FORMAT_ANALYSIS.md` - 详细分析

