# Task Router

将 Pipeline / 后处理阶段路由到本地 HTTP 子服务（ASR、NMT、TTS、语义修复等）。

入口：`task-router.ts`；分文件：`faster-whisper-asr-strategy.ts`、`task-router-tts.ts`、`task-router-nmt.ts`、`task-router-semantic-repair.ts`。

## ASR（faster-whisper-vad）

- `condition_on_previous_text: false`（`faster-whisper-asr-strategy.ts`），避免上下文重复识别
- 仍可使用 `initial_prompt` 提示
- GPU：经 `gpu-arbiter` 租约后请求

## TTS（Piper）

`task-router-tts.ts` 按目标语言选默认 voice（未指定 `voice_id` 时）：

| 语言前缀 | 默认 voice |
|----------|------------|
| `en` | `en_US-lessac-medium` |
| `zh` | `zh_CN-huayan-medium` |

HTTP 超时 60s；返回 WAV，Opus 编码在 Pipeline 侧。

## 语义修复

- `task-router-semantic-repair.ts`：HTTP 超时 **30s**
- 错误码前缀：`SEM_REPAIR_UNAVAILABLE`、`SEM_REPAIR_TIMEOUT`、`SEM_REPAIR_ERROR`
- FW 默认主链不启用 5015；见 `pipeline/enhancement/README.md`

## NMT

- `task-router-nmt.ts`：经 GPU 租约调用 M2M100 服务

## 服务选择

`selectServiceEndpoint(ServiceType)` 从 `ServiceRegistry` 选取已注册且运行中的端点。
