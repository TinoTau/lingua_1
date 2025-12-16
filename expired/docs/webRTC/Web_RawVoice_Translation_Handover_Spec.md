# Web↔Web 原声通话 + 翻译接管 功能说明与技术方案（v1.0 - 历史版本）

> ⚠️ **注意**: 本文档为 v1.0 版本，已被 v1.1 版本替代。  
> 当前实现基于 [v1.1 版本](./Web_RawVoice_Translation_Handover_Spec_v1.1.md)，请参考最新版本文档。

## Presence Raw Voice + Translated TTS Handover

版本：v1.0（历史版本）  
状态：**已被 v1.1 替代**  
适用范围：Web Client / Scheduler / Node（翻译链路）  
设计目标：在 Web↔Web 双人通话场景中，通过 **原声端到端 + 翻译语音接管** 的方式，显著降低等待焦虑，营造“面对面交谈”的体验。

---

## 1. 背景与问题定义

在 Web↔Web 实时翻译通话场景中，传统流程为：

> 一方完整说话 → ASR → NMT → TTS → 对方播放 → 对方再回应

该流程存在明显问题：
- 翻译链路长，端到端延迟大
- 等待期间对端完全静默，用户感知为“系统卡住”
- 简短、可直观理解的回应（ok / yes / 好的）仍需等待翻译

---

## 2. 核心设计思路（冻结）

### 2.1 双通道并行架构

本方案将通话拆分为 **两条并行但职责清晰的音频通道**：

1. **原声通道（Raw Voice / Presence Audio）**
   - Web↔Web 端到端实时语音
   - 不经过调度服务器、不经过第三方节点
   - 目标：即时传递“对方正在说话”的语气、情绪、节奏

2. **翻译通道（Translated Audio）**
   - 语音 → Scheduler → Node（ASR / NMT / TTS）
   - 返回译后语音给接收端
   - 目标：提供可理解内容

---

## 3. 用户体验原则

- 对端一开口，接收端 **立即有声音反馈**
- 不追求原声与译后语音的时间轴对齐
- 不要求自然停顿或完整句子
- **译后语音到达即接管**
- 原声通过 **淡出（fade out）** 方式停止，避免突兀
- 用户无需感知“切换发生在何时”

---

## 4. 系统整体架构

```text
[B Web Client]
  ├─ WebRTC 原声上行 ────────────────▶ [A Web Client]
  │
  └─ 翻译音频上行
        │
        ▼
   Scheduler ──► Node (ASR/NMT/TTS)
        │
        ▼
  翻译后语音下行 ──────────────────▶ [A Web Client]
```

---

## 5. 原声通道（Raw Voice Channel）

### 5.1 技术选型

- WebRTC Audio Track（P2P 优先，必要时 TURN）
- getUserMedia 推荐参数：
  - echoCancellation: true
  - noiseSuppression: true
  - autoGainControl: true

### 5.2 原声通道职责

- 仅用于实时存在感与语气传递
- 不参与翻译、不做任何处理
- 可直接被用户理解或忽略

---

## 6. 翻译通道（Translation Channel）

### 6.1 处理流程

- B 端音频同时送入翻译链路
- 按 VAD / 最大时长切分为 utterance（推荐 1.2–4s）
- 每个 utterance：
  - ASR → NMT → TTS
  - 生成一个或多个译后音频分段

### 6.2 上下文处理

- 沿用现有 Utterance Group / Context 拼接方案
- 原声通道不影响 Group 逻辑
- Group 仅服务于翻译质量

---

## 7. 接收端音频混控与接管策略（核心）

### 7.1 双播放器模型（WebAudio）

- Raw Voice：
  - MediaStreamAudioSourceNode
  - GainNode(rawGain)
- Translated TTS：
  - AudioBufferSourceNode / MediaElementSourceNode
  - GainNode(ttsGain)

两路音频最终汇入同一 destination。

---

### 7.2 接管规则（冻结）

#### 初始状态
- rawGain = 1.0
- ttsGain = 0.0

#### 当译后音频到达（任意分段）
1. rawGain 从 1.0 → 0.0（200–400ms fade out）
2. ttsGain 从 0.0 → 1.0（可选 50–150ms fade in）
3. 播放译后音频

#### 译后音频播放结束
- 若检测到对端仍在说话：
  - rawGain 从 0.0 → 1.0（200ms fade in）
- 否则保持静音，等待下一轮

---

## 8. 状态机（接收端视角）

```text
LISTENING_RAW
  ├─(translated_audio_arrived)→ HANDOVER_TO_TTS
HANDOVER_TO_TTS
  ├─(fade complete)→ PLAYING_TTS
PLAYING_TTS
  ├─(tts_end & remote_speaking)→ LISTENING_RAW
  └─(tts_end & remote_silent)→ IDLE
```

---

## 9. 延迟优化建议（非强制）

- 会话级 Sticky Node：通话期间优先固定同一推理节点
- 更短 utterance 切分 + Group 上下文补偿
- TTS 流式分片（可选）

---

## 10. 边界与非目标（明确不做）

- 不做原声与译后语音的时间轴对齐
- 不做字幕先行
- 不对原声内容做安全/隐私处理
- 不保证用户一定听完整译后语音（允许被下一轮原声覆盖）

---

## 11. 验收标准（功能级）

- A1：对端一开口，本端 <300ms 内能听到原声
- A2：译后语音到达时，原声以淡出方式停止
- A3：切换过程中无明显爆音、卡顿
- A4：短语场景（ok/yes）无需等待翻译也可完成交流
- A5：连续对话中，用户能清晰感知“对方在说话/在回应”

---

## 12. 总结

本方案不试图消除翻译链路的物理延迟，而是通过 **原声存在感 + 翻译接管** 的方式，将“等待”转化为“交流进行中”的体验，特别适合 Web↔Web 远距离实时通话场景。

---

**END OF SPEC**
