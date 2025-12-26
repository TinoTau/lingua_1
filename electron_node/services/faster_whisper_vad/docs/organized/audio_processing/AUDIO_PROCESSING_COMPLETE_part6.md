# ��Ƶ���������ĵ� (Part 6/6)

  lenView.setUint16(0, packet.length, true); // little-endian
  
  packetDataParts.push(new Uint8Array(lenBuffer));
  packetDataParts.push(packet);
}

// �?合并所有packet数据
encodedAudio = new Uint8Array(totalSize);
// ...
```

---

## 修复后的数据�?

### audio_chunk消息流程（修复后�?

```
Web端录�?
  �?sendAudioChunk() [使用encodePackets() + Plan A格式] 
  �?audio_chunk消息 [packet格式] 
  �?调度服务器audio_buffer [累积packet格式数据] 
  �?finalize合并 [packet格式] 
  �?创建job [packet格式] 
  �?节点�?
  �?服务�?[检测到packet格式] �?
```

### utterance消息流程（保持不变）

```
Web端录�?
  �?sendUtterance() [使用encodePackets() + Plan A格式] 
  �?utterance消息 [packet格式] 
  �?调度服务�?[直接创建job] 
  �?节点�?
  �?服务�?[检测到packet格式] �?
```

---

## 关键变化

1. **`sendAudioChunkJSON()`现在使用Plan A格式**�?
   - 使用`encodePackets()`方法
   - 为每个packet添加长度前缀
   - 没有回退机制（如果`encodePackets()`不可用，直接失败�?

2. **与`sendUtterance()`保持一�?*�?
   - 两种消息类型都使用相同的Plan A格式
   - 确保所有音频数据都是packet格式

---

## 预期效果

1. **所有请求都能检测到packet格式**�?
   - `audio_chunk`消息合并后的数据是packet格式
   - `utterance`消息的数据是packet格式

2. **不再出现400错误**�?
   - 服务端能正确检测到packet格式
   - 成功解码所有音频数�?

3. **不再出现404错误**�?
   - 节点端能正确处理所有请�?
   - 正确返回结果给调度服务器

---

## 相关文件

- `webapp/web-client/src/websocket_client.ts` - Web端发送逻辑
- `electron_node/services/faster_whisper_vad/audio_decoder.py` - 服务端解码逻辑
- `central_server/scheduler/src/managers/audio_buffer.rs` - 调度服务器音频缓冲区
- `electron_node/services/faster_whisper_vad/docs/WEB_CLIENT_AUDIO_FORMAT_ANALYSIS.md` - 详细分析



---


