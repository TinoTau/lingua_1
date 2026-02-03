# 节点端服务概览

节点端依赖以下服务，均位于 `electron_node/services/` 下，各服务文档在各自目录内（如 `README.md`、`docs/`）。

| 服务 | 路径 | 端口 | 说明 |
|------|------|------|------|
| node-inference | `services/node-inference/` | 5009 | Rust 推理网关，调用 ASR/NMT/TTS 等 |
| nmt_m2m100 | `services/nmt_m2m100/` | 5008 | M2M100 机器翻译 |
| piper_tts | `services/piper_tts/` | 5006 | Piper TTS 语音合成 |
| your_tts | `services/your_tts/` | 5004 | YourTTS 零样本语音克隆 |
| faster_whisper_vad | `services/faster_whisper_vad/` | 6007 | Faster Whisper ASR + Silero VAD |
| speaker_embedding | `services/speaker_embedding/` | 5003 | 说话人特征提取 |
| semantic_repair_en_zh | `services/semantic_repair_en_zh/` | 按 service.json | 中英文语义修复等 |
| phonetic_correction_zh | `services/phonetic_correction_zh/` | 按 service.json | 中文同音纠错 |

- **配置**：各服务端口与启动参数见对应目录下 `service.json` 或 README。
- **GPU**：NMT、TTS、语义修复、Speaker Embedding 等可选用 CUDA；Faster Whisper VAD 使用 onnxruntime-gpu。详见各服务文档与 `CONFIGURATION.md`。
- **依赖关系**：主进程通过服务发现扫描 `services/`，按需启动；node-inference 通过 HTTP 调用各 Python/Rust 服务。
