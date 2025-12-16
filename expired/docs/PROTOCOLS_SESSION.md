# 会话端协议（移动端 ↔ 调度服务器）

本文档详细说明了移动端（手机 App）与调度服务器之间的 WebSocket 消息协议。

**返回**: [协议规范主文档](./PROTOCOLS.md)

---

## 连接地址

移动端通过 WebSocket 连接调度服务器，例如：

```text
wss://dispatcher.example.com/ws/session
```

---

## 2.1 会话建立与认证（可选）

### 2.1.1 客户端 → 服务器：会话初始化

```jsonc
{
  "type": "session_init",
  "client_version": "1.0.0",
  "platform": "android",       // "ios" | "android" | "web"
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": null,             // 可选，例如 "zh-sichuan"
  "features": {                // 可选模块开关
    "emotion_detection": false,
    "voice_style_detection": false,
    "speech_rate_detection": false
  },
  "pairing_code": null         // 非空时表示希望绑定到指定节点（6位安全码）
}
```

### 2.1.2 服务器 → 客户端：会话初始化响应

```jsonc
{
  "type": "session_init_ack",
  "session_id": "sess-123456",
  "assigned_node_id": null,    // 若指定节点绑定成功，可返回实际 node_id
  "message": "session created"
}
```

如果 `pairing_code` 无效，可以返回：

```jsonc
{
  "type": "error",
  "code": "INVALID_PAIRING_CODE",
  "message": "Pairing code not found or expired"
}
```

---

## 2.2 句级音频上传（utterance）

移动端使用**轻量级 VAD + 手动截断**的方式决定何时发送一句话的音频。

### 2.2.1 客户端 → 服务器：上传 utterance

```jsonc
{
  "type": "utterance",
  "session_id": "sess-123456",
  "utterance_index": 4,         // 当前会话内的句序号（递增）
  "manual_cut": true,           // 是否由用户手动截断
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": null,
  "features": {                 // 可选模块开关，覆盖会话默认值（可选）
    "emotion_detection": false,
    "voice_style_detection": false,
    "speech_rate_detection": true
  },
  "audio": "base64-encoded-audio-data",
  "audio_format": "pcm16",      // 或 "wav", "opus" 等
  "sample_rate": 16000
}
```

> 说明： 
> - `utterance_index` 由客户端自增，服务器按此顺序聚合结果。 
> - `features` 不填时使用会话初始化时的默认配置。

---

## 2.3 翻译结果返回

调度服务器收到节点返回结果后，将结果推送给移动端。

### 2.3.1 服务器 → 客户端：翻译结果

```jsonc
{
  "type": "translation_result",
  "session_id": "sess-123456",
  "utterance_index": 4,
  "job_id": "job-xyz-789",
  "text_asr": "今天天气不错。",
  "text_translated": "The weather is nice today.",
  "tts_audio": "base64-encoded-tts-audio",
  "tts_format": "pcm16",
  "extra": {
    "emotion": null,             // 例如 "happy"（如启用情感分析）
    "speech_rate": 1.2,          // 可选模块输出
    "voice_style": null
  }
}
```

> 注：  
> - 即使部分可选模块未启用，对应字段可以为 `null` 或直接省略。 
> - 客户端应按 `utterance_index` 排序展示或播放。

---

## 2.4 会话控制与心跳

### 2.4.1 客户端 → 服务器：心跳（可选）

如果需要应用层心跳（WebSocket 本身的 Ping/Pong 之外）：

```jsonc
{
  "type": "client_heartbeat",
  "session_id": "sess-123456",
  "timestamp": 1733800000000
}
```

服务器可以按需返回：

```jsonc
{
  "type": "server_heartbeat",
  "session_id": "sess-123456",
  "timestamp": 1733800000500
}
```

### 2.4.2 客户端 → 服务器：结束会话

```jsonc
{
  "type": "session_close",
  "session_id": "sess-123456",
  "reason": "user_finished"     // 或 "network_error", "app_exit" 等
}
```

服务器可回复：

```jsonc
{
  "type": "session_close_ack",
  "session_id": "sess-123456"
}
```

---

## 2.5 错误消息（移动端侧）

服务器在解析或处理移动端消息时出现错误，可以返回：

```jsonc
{
  "type": "error",
  "code": "INVALID_MESSAGE",
  "message": "Missing field: audio",
  "details": {
    "field": "audio"
  }
}
```

常见 error code 建议：
- `INVALID_MESSAGE`
- `INVALID_SESSION`
- `INTERNAL_ERROR`
- `NODE_UNAVAILABLE`
- `UNSUPPORTED_FEATURE`

---

**返回**: [协议规范主文档](./PROTOCOLS.md)

