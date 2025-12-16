# Web 端实时语音翻译 —— 技术方案（Tech Spec）

版本：v1.0  
作者：Tino（产品规划）  

---

## 1. 系统整体架构

### 1.1 组件拓扑

```text
Browser (Web UI)
  ├─ Audio Recorder (Web Audio API)
  ├─ State Machine (Input/Output)
  ├─ WebSocket Client
  └─ TTS Player

Backend
  ├─ ASR Engine (Whisper / Faster-Whisper)
  ├─ Translation Engine (NMT / LLM)
  ├─ TTS Engine
  └─ Utterance Group Manager
```

### 1.2 数据流简述

1. 浏览器采集用户语音 → 以 PCM16 分片通过 WebSocket 发送到 ASR。  
2. ASR 输出识别结果 → 交由 Translation Engine 翻译。  
3. 翻译结果 → 传入 TTS Engine 合成音频。  
4. TTS 音频以流式形式返回浏览器 → 浏览器播放。  

---

## 2. 前端技术方案

### 2.1 录音模块（recorder.js）

- 使用 `getUserMedia({ audio: true })` 获取麦克风。  
- 通过 AudioContext/ScriptProcessor/AudioWorklet，按固定帧长（如 100ms）获取 PCM16 数据。  
- 支持：
  - 开始录音：进入 INPUT_RECORDING 状态；  
  - 停止录音：释放 MediaStream、停止上传；  
  - 静音检测：计算音量 RMS/能量，判断是否连续静音超过阈值。

### 2.2 状态机模块（state_machine.js）

负责前端四个状态：

- INPUT_READY  
- INPUT_RECORDING  
- WAITING_RESULT  
- PLAYING_TTS  

核心逻辑：

- 检测到语音活动 → `INPUT_READY → INPUT_RECORDING`；  
- 用户点击 Send 或静音超时 → `INPUT_RECORDING → WAITING_RESULT`；  
- 收到翻译 + TTS 开始信号 → `WAITING_RESULT → PLAYING_TTS`；  
- 播放结束 → `PLAYING_TTS → INPUT_READY`；  

麦克风控制：

- 在 `INPUT_READY / INPUT_RECORDING` 开启；  
- 在 `WAITING_RESULT / PLAYING_TTS` 关闭。

### 2.3 WebSocket 客户端（websocket_client.js）

- 负责向后端发送音频数据帧：

  ```jsonc
  {
    "type": "audio_chunk",
    "session_id": "...",
    "seq": 12,
    "is_final": false,
    "payload": "<binary pcm16>"
  }
  ```

- 在结束本轮发言时发送 `is_final=true` 的结束帧。  
- 接收服务端消息：

  ```jsonc
  // 翻译文本
  { "type": "translation_result", "text": "..." }

  // TTS 流式音频
  { "type": "tts_audio", "seq": 0, "payload": "<binary pcm16>" }
  ```

### 2.4 TTS 播放模块（tts_player.js）

- 使用 AudioContext 或 HTMLAudioElement 播放。  
- 支持流式缓冲播放：  
  - 将连续的 `tts_audio` chunk 写入 AudioBuffer 或 SourceNode；  
  - 根据 `seq` 顺序播放。  
- 播放结束后触发回调，通知状态机切回 INPUT_READY。

---

## 3. 后端技术方案

### 3.1 Session & Group 管理

- 每一个浏览器会话对应一个 `session_id`。  
- 会话下维护多个 `utterance_group_id`，用于表示话题组。  
- 每轮发言生成一个 `utterance_id`，包含：
  - 关联的 `session_id`、`group_id`、`turn_index`；  
  - 完整 ASR 文本、翻译文本。  

### 3.2 ASR 模块

- 建议使用 Faster-Whisper 等流式引擎：  
  - 接收音频帧并增量识别；  
  - 在 `is_final=true` 后输出 final transcript。  
- 输出结构示例：

  ```jsonc
  {
    "utterance_id": "...",
    "text": "我想订一张明天去奥克兰的机票。",
    "language": "zh",
    "confidence": 0.94
  }
  ```

### 3.3 翻译模块（Translation Engine）

- 可选：
  - 传统 NMT（如 Marian/M2M100）  
  - 或对话式 LLM（作为翻译/重写器）  

- 具备上下文能力：
  - 输入：当前 utterance 文本 + 同一 Group 内历史文本；  
  - 通过 Prompt 或串联方式让翻译引擎利用上下文生成更自然结果。

### 3.4 TTS 模块

- 根据目标语言选择对应 TTS 模型（中/英/多语）。  
- 输出 PCM16 流式数据。  
- 支持标明每 chunk 时长和顺序 seq，方便前端播放。

---

## 4. Utterance Group 逻辑

### 4.1 新 Group 的创建

当满足以下任一条件：

- 距离上一次 TTS 结束时间超过 `group_timeout_sec`；  
- 用户在 UI 上点击“开始新话题”；  
- 后端通过语义分析判断当前发言为全新话题；

则为当前发言创建新的 Group。

### 4.2 Group 的加入

否则，新的 utterance 归属于上一 Group，例如：

```text
session_id: S1
group_id:   G1
turns:
  - G1.part1: "我想订一张明天去奥克兰的机票。"
  - G1.part2: "最好是早上十点以前出发的。"
```

### 4.3 翻译中的上下文使用

翻译引擎在处理 `G1.part2` 时，可接收如下信息：

- `G1.part1_text` 作为上文；  
- 已经生成的目标语译文 `G1.part1_translation`；  
- 通过 Prompt 明确：“下面的句子是对上一句的补充”。

---

## 5. 半双工关键点

1. 前端状态机层面：  
   - 输入模式只负责采集与发送，不播放；  
   - 输出模式只负责播放，不采集与发送。  

2. 服务端无需处理 TTS 回流音频（系统保证不会上传）。  

3. 所有“被打断”的问题都在“轮次”边界解决，不在波形层解决。

---

## 6. 性能与扩展

- 支持多语言 ASR/翻译/TTS 组合。  
- 可通过参数控制静音阈值、Group 超时等策略，以适配不同用户（老年用户可适当延长时间）。  
- 后续可扩展：
  - 情绪检测（根据用户语气调整 TTS 语气）；  
  - 用户偏好保存（语速、音色、目标语言等）。  
