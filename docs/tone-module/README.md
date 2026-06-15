# Tone Module 文档

> **状态**：**P0 已冻结** — 声学普通话声调 CNN  
> **代码**：`electron_node/services/faster_whisper_vad/tone_module/`  
> **架构 SSOT**：[ARCHITECTURE.md](./ARCHITECTURE.md)

## 职责

从 **原始音频 + FW Word Timestamp** 推断每音节声调，作为 FW Recall **排序信号**（Tone Score），**不**直接改文本、不 Hard Gate 删候选。

## 数据流（摘要）

```text
音频 → tone_module/inference.py → UtteranceAcousticTonePayload
  → ASR extra → FW tone-time-align.ts → tone-match-score.ts
  → recallTopKForWindows / recallSpanTopKV3 排序
```

## 与 TTS「Tone Stage」区分

| 名称 | 路径 | 用途 |
|------|------|------|
| **Tone Module（本文）** | `faster_whisper_vad/tone_module/` | FW 声学声调 |
| TTS Tone Stage | `postprocess/tone-stage.ts` | 音色克隆，与 FW 无关 |

## 配置

`features.fwDetector.toneTimestampOnlyEnabled`（默认 `true`）— 时间戳对齐模式。

## 常用命令

```powershell
# 训练/推理环境见 tone_module/ 内脚本
cd electron_node/electron-node
npx jest --testPathPattern="tone-match-score|tone-time-align|span-assembly-v4-tone-score"
```

## 本目录

| 文件 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | CNN、对齐、FW 集成、冻结原则 |

**已移除**：原 `docs/tone/` 下 ToneModule P0 开发/测试/审计报告（并入 ARCHITECTURE）。
