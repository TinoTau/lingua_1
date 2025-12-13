# 节点端协议（第三方节点 ↔ 调度服务器）

本文档详细说明了第三方节点（Electron Node 客户端）与调度服务器之间的 WebSocket 消息协议。

**返回**: [协议规范主文档](./PROTOCOLS.md)

---

## 连接地址

Electron Node 通过 WebSocket 连接调度服务器，例如：

```text
wss://dispatcher.example.com/ws/node
```

---

## 3.1 节点注册与能力上报

### 3.1.1 节点 → 服务器：初次注册 / 重新连接

```jsonc
{
  "type": "node_register",
  "node_id": "node-abc-001",       // 首次可为 null/空字符串，由服务端分配
  "version": "1.0.0",
  "platform": "windows",           // "windows" | "linux" | "macos"
  "hardware": {
    "cpu_cores": 16,
    "memory_gb": 32,
    "gpus": [
      {
        "name": "RTX 3070",
        "memory_gb": 8
      }
    ]
  },
  "installed_models": [
    {
      "model_id": "mdl-nmt-zh-en-base-v1",
      "kind": "nmt",
      "src_lang": "zh",
      "tgt_lang": "en",
      "dialect": null,
      "version": "1.0.0"
    }
  ],
  "features_supported": {
    "emotion_detection": true,
    "voice_style_detection": false,
    "speech_rate_detection": true
  },
  "accept_public_jobs": true
}
```

### 3.1.2 服务器 → 节点：注册确认

```jsonc
{
  "type": "node_register_ack",
  "node_id": "node-abc-001",
  "message": "registered"
}
```

> 说明：首次连接时如节点未提供 `node_id`，可由服务器生成后在 ack 中返回。

---

## 3.2 节点心跳与资源上报

### 3.2.1 节点 → 服务器：心跳

```jsonc
{
  "type": "node_heartbeat",
  "node_id": "node-abc-001",
  "timestamp": 1733800000000,
  "resource_usage": {
    "cpu_percent": 37.5,
    "gpu_percent": 51.2,
    "gpu_mem_percent": 62.3,
    "mem_percent": 40.8,
    "running_jobs": 3
  },
  "installed_models": [
    {
      "model_id": "mdl-nmt-zh-en-base-v1",
      "kind": "nmt",
      "src_lang": "zh",
      "tgt_lang": "en",
      "dialect": null,
      "version": "1.0.0",
      "enabled": true
    }
  ]
}
```

> 注：`installed_models` 可在心跳中减少字段，只保留更新点；具体实现可以在文档中说明。

---

## 3.3 任务下发与结果回传

### 3.3.1 服务器 → 节点：下发 job

```jsonc
{
  "type": "job_assign",
  "job_id": "job-xyz-789",
  "session_id": "sess-123456",
  "utterance_index": 4,
  "src_lang": "zh",
  "tgt_lang": "en",
  "dialect": null,
  "features": {
    "emotion_detection": false,
    "voice_style_detection": false,
    "speech_rate_detection": true
  },
  "pipeline": {
    "use_asr": true,
    "use_nmt": true,
    "use_tts": true
  },
  "audio": "base64-encoded-audio-data",
  "audio_format": "pcm16",
  "sample_rate": 16000
}
```

### 3.3.2 节点 → 服务器：job 结果

```jsonc
{
  "type": "job_result",
  "job_id": "job-xyz-789",
  "node_id": "node-abc-001",
  "session_id": "sess-123456",
  "utterance_index": 4,
  "success": true,
  "text_asr": "今天天气不错。",
  "text_translated": "The weather is nice today.",
  "tts_audio": "base64-encoded-tts-audio",
  "tts_format": "pcm16",
  "extra": {
    "emotion": null,
    "speech_rate": 1.2,
    "voice_style": null
  },
  "processing_time_ms": 220
}
```

### 3.3.3 节点 → 服务器：job 失败

```jsonc
{
  "type": "job_result",
  "job_id": "job-xyz-789",
  "node_id": "node-abc-001",
  "session_id": "sess-123456",
  "utterance_index": 4,
  "success": false,
  "error": {
    "code": "MODEL_NOT_AVAILABLE",
    "message": "Required NMT model mdl-nmt-zh-en-base-v1 is not installed or disabled"
  }
}
```

调度服务器可根据错误策略决定是否重试 / 切换节点。

---

## 3.4 节点侧错误与控制消息

### 3.4.1 节点 → 服务器：节点内部错误（非 job 级）

```jsonc
{
  "type": "node_error",
  "node_id": "node-abc-001",
  "code": "INFERENCE_BACKEND_ERROR",
  "message": "ONNX Runtime initialization failed",
  "details": {
    "backend": "onnxruntime",
    "errno": 123
  }
}
```

### 3.4.2 服务器 → 节点：控制消息（预留）

将来可扩展如下消息类型，例如：

```jsonc
{
  "type": "node_control",
  "command": "shutdown",           // 或 "reload_config"
  "reason": "maintenance"
}
```

---

**返回**: [协议规范主文档](./PROTOCOLS.md)

