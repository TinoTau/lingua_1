# Electron Node 文档索引

各模块文档仅保留在对应模块目录下，此处仅做导航。

## 节点应用（electron-node）

- **架构与配置**：`electron_node/electron-node/docs/`
  - [ARCHITECTURE.md](../electron-node/docs/ARCHITECTURE.md) — 节点端架构
  - [AGGREGATOR.md](../electron-node/docs/AGGREGATOR.md) — 聚合中间件
  - [CONFIGURATION.md](../electron-node/docs/CONFIGURATION.md)
  - [SERVICES.md](../electron-node/docs/SERVICES.md)
  - [TROUBLESHOOTING.md](../electron-node/docs/TROUBLESHOOTING.md)
- **ASR / 音频聚合**：`electron_node/electron-node/docs/`
  - [ASR_Module_Flow.md](../electron-node/docs/ASR_Module_Flow.md) — ASR 流程与调用链
  - [AUDIO_AGGREGATOR_Data_Format.md](../electron-node/docs/AUDIO_AGGREGATOR_Data_Format.md) — 聚合数据格式
  - [Long_Utterance_Job_Container_Policy.md](../electron-node/docs/Long_Utterance_Job_Container_Policy.md) — 长语音 Job 容器策略
- **GPU / 调度**：[GPU_USAGE_VERIFICATION.md](../electron-node/docs/GPU_USAGE_VERIFICATION.md)、[NODE_SCHEDULER_CONNECTION.md](../electron-node/docs/NODE_SCHEDULER_CONNECTION.md)

## 服务（services）

- **ASR Sherpa 英文 CTC**：`electron_node/services/asr_sherpa_en/`
  - [README.md](../services/asr_sherpa_en/README.md) — 服务说明与运行
  - [docs/CTC_Decode.md](../services/asr_sherpa_en/docs/CTC_Decode.md) — 解码与 blank/「4」定位
- **Faster Whisper VAD**：`services/faster_whisper_vad/README.md`、`docs/`
- **Piper TTS**：`services/piper_tts/README.md`
- **语义修复 / 音色修正**：各服务目录下 README

## 脚本与测试

- 测试说明见 `electron-node/tests/README.md`、各 `stage*/README.md`
- LID 脚本说明见 `electron-node/scripts/README_LID_VOXLINGUA107.md`

文档以代码为准；若与代码冲突，以代码为准。
