# Faster Whisper VAD 服务参考

本文档汇总本服务（Python）的 API、配置与流程。节点端流式聚合与 finalize 逻辑见 `electron-node` 主进程代码。

---

## 1. API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查；返回 device、compute_type、asr_model_path、asr_worker 状态等 |
| POST | `/reset` | 重置 VAD 状态和/或上下文缓冲区（body: reset_vad, reset_context, reset_text_context） |
| POST | `/utterance` | 主入口：接收音频，VAD 切段后送 Whisper ASR，返回文本与片段信息 |

### 请求/响应要点

- **POST /utterance**：Content-Type 多为 `multipart/form-data` 或 `application/octet-stream`，音频格式 16kHz、单声道、f32 或 s16。响应含 `text`、`segments`（起止时间、文本）、`language` 等。
- **POST /reset**：`ResetRequest` 含 `reset_vad`、`reset_context`、`reset_text_context` 布尔字段，按需置 true。

---

## 2. 处理流程

1. **音频校验**：格式、采样率、长度（不超过 `MAX_AUDIO_DURATION_SEC`，默认 30 秒）。
2. **VAD**：Silero VAD 检测语音段，过滤静音。
3. **上下文**：可选使用上一句尾部音频做上下文拼接，提升边界识别。
4. **ASR**：Faster Whisper（CTranslate2）对每个语音段识别，再合并与去重。
5. **后处理**：无意义片段过滤、上下文去重等。

ASR 在独立子进程（ASR Worker）中执行，主进程通过队列提交任务，避免阻塞。

---

## 3. 配置（环境变量与 config.py）

### 服务与模型

| 变量 | 说明 | 默认 |
|------|------|------|
| `FASTER_WHISPER_VAD_PORT` | HTTP 服务端口 | 6007 |
| `ASR_MODEL_PATH` | 模型路径或 HuggingFace 标识（如 Systran/faster-whisper-base） | Systran/faster-whisper-base |
| `WHISPER_CACHE_DIR` | CTranslate2 模型缓存目录 | 服务下 models/asr |
| `ASR_DEVICE` | 设备：cuda（本服务要求 GPU） | cuda |
| `ASR_COMPUTE_TYPE` | 计算类型：float16 / float32 / int8_float16 等 | CUDA 下 float16 |

### ASR 参数

| 变量 | 说明 | 默认 |
|------|------|------|
| `ASR_BEAM_SIZE` | Beam 宽度；1～3 提速，5 偏重准确度 | 5 |
| `ASR_TEMPERATURE` | 采样温度 | 0.0 |
| `ASR_PATIENCE` | Beam search 耐心值 | 1.0 |
| `ASR_COMPRESSION_RATIO_THRESHOLD` | 压缩比阈值 | 2.4 |
| `ASR_LOG_PROB_THRESHOLD` | 对数概率阈值 | -1.0 |
| `ASR_NO_SPEECH_THRESHOLD` | 无语音判定阈值 | 0.6 |

### VAD（Silero）

| 变量 | 说明 | 默认 |
|------|------|------|
| `VAD_MODEL_PATH` | VAD 模型路径 | models/vad/silero/silero_vad_official.onnx |
| `VAD_SILENCE_THRESHOLD` | 静音概率阈值 | 0.2 |
| `VAD_MIN_UTTERANCE_MS` | 最小语句时长（毫秒） | 1000 |

### 限制与超时

| 变量 | 说明 | 默认 |
|------|------|------|
| `MAX_AUDIO_DURATION_SEC` | 单次请求最大音频时长（秒） | 30.0 |
| `MAX_WAIT_SECONDS` | ASR 任务最大等待时间（秒） | 30.0 |

更多常量见 `config.py`（如上下文时长、VAD 起止阈值等）。

---

## 4. GPU

本服务强制使用 GPU（`ASR_DEVICE=cuda`）。安装 CUDA、cuDNN 及 GPU 版 CTranslate2/onnxruntime 后，启动时会在 `/health` 中返回 `device` 与 `compute_type`。详细步骤见同目录 **[GPU.md](../GPU.md)**。

---

## 5. N-best / 多候选

当前接口仅返回最优文本与 segments。若需 n-best 用于 rerank/纠偏，可选方案包括：直接调用 CTranslate2 的 `generate(..., num_hypotheses=...)`，或 fork faster-whisper 在 Python 层透出多候选。实现细节见本目录历史稿 `whisper_nbest_implementation_options.md`（若仍保留）；否则以代码与 CTranslate2 文档为准。

---

## 6. 日志与排错

- 日志文件：服务目录下 `logs/faster-whisper-vad-service.log`。
- 确认 VAD 生效：日志中可见「VAD检测到 N 个语音段」类输出。
- 若识别异常：检查采样率/格式、`ASR_BEAM_SIZE`/`ASR_NO_SPEECH_THRESHOLD`，以及 `/health` 中的 worker 状态与 device。
