# 节点端架构

以 `main/src/` 当前实现为准。模块细节见各目录 `README.md`。

## 1. 进程划分

| 部分 | 路径 | 职责 |
|------|------|------|
| 主进程 | `main/src/` | 窗口、NodeAgent、服务/模型管理、Pipeline、IPC |
| 渲染进程 | `renderer/src/` | React UI，`window.electronAPI` |
| 协议 | `shared/protocols/messages.ts` | JobAssign、JobResult 等 |

开发模式：Vite Dev Server（默认 5173，`VITE_PORT` 可改）+ `npm start` 启动 Electron。

## 2. 服务发现与注册表（SSOT）

```
ServiceDiscovery.scanServices() → ServiceRegistrySingleton
  → ServiceProcessRunner / IPC / UI
```

- 扫描 `SERVICES_DIR`（或开发时向上查找含 `installed.json` 的 `services/`）
- 各包 `service.json` 定义端口、启动命令、类型（asr/nmt/tts/…）
- **无**重复 Registry、无补丁式并行状态源

## 3. 能力与调度器

- 上报有向语言对：`asr_languages`、`tts_languages`、`semantic_languages`（当前实现为各**已运行服务**语言交集）
- 必需服务就绪后才注册/心跳；能力变化时重连
- 实现：`agent/node-agent-*.ts`、`language-capability/`
- 连接与池分配排错见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#调度器连接)

## 4. Job 处理主路径

```
Scheduler JobAssign
  → InferenceService / Pipeline (runJobPipeline)
  → [AggregatorMiddleware]（文本聚合，NodeAgent 侧）
  → JobResult 上报
```

### 4.1 Pipeline（默认 FW）

```
Audio → AudioAggregator → ASR (faster_whisper_vad)
  → rawAsrText freeze → FW_SPAN_DETECTOR → AGGREGATION
  → [5015/5016/5017 默认 OFF] → DEDUP → NMT → TTS
  → buildJobResult (text_asr ← segmentForJobResult)
```

- 引擎默认：`asr.engine = fw_detector_v1`
- 文本 SSOT：`ctx.segmentForJobResult`（见 `pipeline/README.md`）
- HTTP 路由（ASR/TTS/NMT/增强）：`task-router/`

### 4.2 文本聚合（Aggregator）

- 位置：Pipeline 结果 → **AggregatorMiddleware** → 发送
- 功能：去重、边界、Text Incompleteness、Language Gate
- 实现：`aggregator/`、`agent/aggregator-middleware.ts`
- Pipeline 内还有 `aggregation-step.ts`（turn 合并写 `segmentForJobResult`）

## 5. GPU 仲裁

- **ASR / NMT / TTS**：经 `gpu-arbiter` 租约后调用（日志：`GPU lease acquired`）
- **语义修复 5015**：独立 Python 服务内用 GPU，节点仅 HTTP，**不经**仲裁器
- **同音纠错 5016**：KenLM CPU，无 GPU
- 验证步骤见 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#gpu-使用验证)

## 6. 本地子服务（`electron_node/services/`）

端口以各目录 **`service.json`** 为准（勿硬编码旧文档端口）。

| 服务 ID | 目录 | 类型 | 说明 |
|---------|------|------|------|
| faster-whisper-vad | `faster_whisper_vad/` | asr | 主链 ASR + VAD |
| nmt_m2m100 | `nmt_m2m100/` | nmt | M2M100 翻译 |
| piper_tts | `piper_tts/` | tts | Piper 合成 |
| your_tts | `your_tts/` | tts | 零样本克隆（可选） |
| semantic_repair_en_zh | `semantic_repair_en_zh/` | semantic | 5015 语义修复 |
| phonetic_correction_zh | `phonetic_correction_zh/` | — | 5016 同音纠错 |
| punctuation_restore | `punctuation_restore/` | — | 5017 标点 |
| lexicon_intent_cpu | `lexicon_intent_cpu/` | — | 5018 Intent CPU |
| speaker_embedding | `speaker_embedding/` | — | 说话人嵌入 |
| node-inference | `node-inference/` | — | Rust 网关（可选，见 servicePreferences） |
| asr_sherpa_en / asr_sherpa_lm | 各自目录 | asr | 备用 ASR，非 FW 默认链 |

各服务 README、`docs/` 在**服务目录内**维护。

## 7. 路径与日志

| 项 | 默认 |
|----|------|
| 节点配置 | `%APPDATA%/lingua-electron-node/electron-node-config.json` |
| 服务目录 | `SERVICES_DIR` 或 userData `services/` |
| 模型 | userData `models/`（`USER_DATA` 可覆盖根） |
| 主进程日志 | `<cwd>/logs/electron-main.log` |

## 8. 源码导航

| 区域 | 入口 |
|------|------|
| 应用启动 | `main/src/index.ts`、`app/` |
| NodeAgent | `main/src/agent/node-agent.ts` |
| Pipeline | `main/src/pipeline/job-pipeline.ts` |
| FW | `main/src/fw-detector/fw-detector-orchestrator.ts` |
| 配置默认值 | `main/src/node-config-defaults.ts` |
| IPC | `main/src/index-ipc.ts`、`ipc-handlers/` |
