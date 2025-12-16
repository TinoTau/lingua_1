# iOS ↔ 调度服务器 ↔ Node 翻译节点：端到端序列图（E2E）

本文件展示完整语音翻译流程，从手机采集音频到节点返回翻译 + TTS。

---

# 1. 总体序列流程图

```
User
 | Speak
 v
iOS Audio Engine
 | (PCM16 20ms)
 v
Lightweight VAD
 | drop silence
 v
AudioChunker
 | 250ms chunk
 v
RealtimeClient (WS)
 | send{audio_chunk}
 v
--------------------------------------
调度服务器 (Dispatcher)
 | 校验 token / rate limit
 | 路由到可用 Node
 v
Node 翻译节点
 | 1. Silero VAD（二次断句）
 | 2. Whisper ASR
 | 3. NMT 翻译
 | 4. TTS 生成 PCM
 v
调度服务器
 | send{translation_result + TTS chunk}
--------------------------------------
 v
iOS RealtimeClient
 | onReceive
 v
AudioPlayerService
 | 播放 TTS PCM
 v
User hears result
```

---

# 2. 消息示例

## 2.1 上行 audio_chunk

```json
{
  "type": "audio_chunk",
  "session_id": "sess-111",
  "sequence": 42,
  "timestamp_ms": 170000123,
  "audio": "<base64 pcm16>",
  "dropped_silence_ms": 160
}
```

## 2.2 下行 translation_result

```json
{
  "type": "translation_result",
  "session_id": "sess-111",
  "sequence": 42,
  "text_src": "你好",
  "text_tgt": "Hello",
  "tts_audio": "<base64 pcm16>",
  "rtt": 168
}
```

---

# 3. RTT 计算

客户端 timestamp =  T0  
服务器收到时间 = T1  
服务器发送 time = T2  
客户端收到时间 = T3  

RTT = T3 - T0

---

# 4. 错误恢复序列

```
[Network Lost]
iOS RealtimeClient
 | detect ping timeout
 v
Reconnect Loop (1s → 2s → 4s)
 | success
 v
send session_resume
 | server accepts
 v
continue streaming
```

---

# 5. 异常情况与处理策略

## 5.1 Node 负载过高 → 调度切换节点
调度服务器应返回：

```
type: node_redirect
new_node_url: "wss://node2..."
```

iOS 操作：
- 停止旧 WS  
- 连接新 WS  
- 发送 session_resume  

---

# 6. 总结

本序列图可作为整体系统开发对齐依据，确保各模块协作一致。

