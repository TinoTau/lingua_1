# TTS 完全在第三方节点侧生成 + 手机端 WebSocket PCM16 流式播放  
技术方案文档（交付开发部门）

版本：v1.0  
适用范围：iOS 客户端、调度服务器、第三方节点客户端（PC）

---

# 1. 概述

本方案定义：

1. **TTS 计算发生在第三方客户端（PC 节点）侧**  
2. **手机端不执行 TTS，仅播放接收到的 PCM16 流式音频**  
3. **通过 WebSocket 管道，实现实时（流式）翻译语音输出**

该方案具有低延迟、高扩展性、可支持未来方言模型与第三方算力池的能力。

---

# 2. 系统整体流程（端到端）

```
iOS 设备
 | 录音 → 轻量 VAD → AudioChunk
 v
调度服务器
 | 分配可用节点
 v
PC 节点（第三方计算端）
 | Silero VAD（精准断句）
 | Whisper ASR
 | NMT 翻译
 | TTS（本地模型）
 | 生成 PCM16 流
 v
调度服务器
 v
iOS 客户端（边收边播）
```

特点：

- 手机端保持极轻量  
- 节点可安装方言模型、音色模型、语速模型  
- 流式音频播放可实现“边说边译”

---

# 3. 音频格式规范

## 3.1 上行音频（iOS → 节点）

| 属性 | 值 |
|------|------|
| 格式 | PCM 16-bit little endian |
| 采样率 | 16kHz |
| 声道 | Mono |
| 分片 | 200–300ms |

JSON 示例：

```json
{
  "type": "audio_chunk",
  "session_id": "sess-123",
  "sequence": 42,
  "timestamp_ms": 170000123,
  "audio": "<base64>",
  "dropped_silence_ms": 120
}
```

---

## 3.2 下行音频（节点 → iOS）

节点输出的音频格式：

| 属性 | 值 |
|------|------|
| 格式 | PCM16 (raw) |
| 采样率 | 16kHz |
| 声道 | Mono |
| 分片 | 200–500ms |

JSON 示例：

```json
{
  "type": "tts_stream",
  "session_id": "sess-123",
  "sequence": 42,
  "is_last": false,
  "pcm": "<base64_pcm16>"
}
```

最后一块：

```json
{
  "type": "tts_stream",
  "session_id": "sess-123",
  "sequence": 42,
  "is_last": true
}
```

---

# 4. WebSocket 消息协议

## 4.1 消息类型

| 消息类型 | 方向 | 内容 |
|---------|------|------|
| `session_init` | iOS → Server | 请求使用节点 |
| `node_assignment` | Server → iOS | 指定节点地址 |
| `audio_chunk` | iOS → Node | 音频上行 |
| `translation_result` | Node → iOS | 文本翻译（可选） |
| `tts_stream` | Node → iOS | TTS 流式 PCM |
| `ping/pong` | 双向 | 心跳 |

---

# 5. 调度服务器流程（核心逻辑）

伪代码：

```
on session_init:
    node = pick_idle_node()
    respond node_assignment(node_url)

on audio_chunk:
    forward to assigned node
```

调度服务器只负责路由，不做推理。

---

# 6. 第三方节点执行 TTS（核心逻辑）

节点处理流程：

1. 收到 audio_chunk  
2. 使用 Silero VAD 二次断句  
3. Whisper ASR → 文本  
4. NMT 翻译 → 目标语言文本  
5. TTS → PCM16  
6. 分块后通过 WebSocket 发送给 iOS

关键要求：

- 必须支持流式推送（生成一点发一点）  
- 每块 PCM 建议 200–500ms  
- 必须附带 `sequence`，客户端按序播放  
- `is_last=true` 代表本句结束

---

# 7. iOS 客户端播放逻辑（开发指南）

手机端只做一件事：**播放 PCM16 流**

播放流程：

```
收到 base64 PCM → 解码 Data → 转成 AVAudioPCMBuffer → 写入 audioPlayerNode → 播放
```

开发说明：

- 使用 `AVAudioEngine + AVAudioPlayerNode`  
- 设置 `AVAudioSessionCategoryPlayAndRecord + mode: voiceChat`（开启系统 AEC）  
- 保持 engine 持续运行  
- 解码与 buffer 构建放入后台线程  

播放代码框架（示例）：

```swift
playerNode.scheduleBuffer(buffer, at: nil, options: [])
```

---

# 8. 弱网处理

- 每 20–30 秒发送 ping  
- ping 超时 → 重连  
- 重连后发送 `session_resume`  
- 节点保存最近未完成的 TTS 状态（可选）

---

# 9. 错误处理

### 音频丢包  
客户端按 sequence 自动忽略丢包，不中断播放。

### TTS 失败  
节点发送：

```json
{
  "type": "error",
  "code": "TTS_FAIL",
  "message": "tts crashed"
}
```

客户端提示用户。

---

# 10. 性能指标

| 指标 | 要求 |
|------|------|
| 单句 TTS 延迟 | < 800 ms |
| TTS 分片推送延迟 | < 150 ms |
| iOS 播放延迟 | < 50 ms |
| 上行带宽 | ≤ 30 KB/s |
| 下行带宽 | 20–40 KB/s |
| 整句端到端 | ≤ 1–1.5 秒 |

---

# 11. 节点模型要求

- 支持多语言 / 方言模型  
- 支持本地 TTS 推理（如 VITS / FastSpeech2 / Bark 等）  
- 支持模型更新与下载  
- 实时报告 CPU / GPU 使用情况  
- 可选择“只做 ASR/NMT，不做 TTS”（调试用）

---

# 12. 安全性与隐私

- 每句话独立发送，无法重建长语境  
- 不保存音频  
- 节点随机分配用户请求，避免数据集中暴露  
- 支持用户指定专用节点（6 位安全码匹配）

---

# 13. 总结（给开发团队）

本方案的目标是：

- **TTS 全部在第三方节点完成（可安装方言模型）**  
- **手机端只负责播放 PCM16 流式音频 → 延迟最低**  
- **调度服务器不参与推理**  
- **协议简单、可扩展，可轻松支持未来模型升级**

开发顺序：

1. 节点实现 TTS → PCM16 → tts_stream  
2. iOS 实现 WebSocket 接收 + PCM 播放  
3. 调度服务器实现 session → node 路由  
4. 集成测试端到端

这份文档可直接作为开发部门的实施蓝图。
