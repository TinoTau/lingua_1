# 服务目录说明

各子目录为独立服务（ASR、TTS、语义修复等），文档与配置均在各自目录下。

## 文档位置

| 服务 | 说明与文档 |
|------|------------|
| asr_sherpa_en | [README](asr_sherpa_en/README.md)、[docs/CTC_Decode.md](asr_sherpa_en/docs/CTC_Decode.md) |
| asr_sherpa_lm | [README](asr_sherpa_lm/README.md) |
| faster_whisper_vad | [README](faster_whisper_vad/README.md) |
| piper_tts | [README](piper_tts/README.md)、[docs/TROUBLESHOOTING.md](piper_tts/docs/TROUBLESHOOTING.md) |
| semantic_repair_en_zh | [README](semantic_repair_en_zh/README.md) |
| phonetic_correction_zh | [README](phonetic_correction_zh/README.md) |
| nmt_m2m100、punctuation_restore 等 | 见各目录下 README 或 service.json |

## 日志

各服务日志由节点端启动时配置，输出到各服务 `logs/` 或控制台；具体见各服务 README。节点端主进程日志见 `electron-node/logs/electron-main.log`。
