# Faster Whisper + Silero VAD Service

整合 Faster Whisper ASR 和 Silero VAD 的 Python HTTP 服务，支持上下文缓冲、进程隔离和 GPU 加速。

## 功能特性

- ✅ **Faster Whisper ASR**：使用 Faster Whisper 进行语音识别，支持束搜索和文本上下文
- ✅ **Silero VAD**：严格按照现有 Rust 实现，使用 ONNX Runtime
- ✅ **上下文缓冲**：音频上下文和文本上下文，严格按照现有实现
- ✅ **进程隔离**：ASR 推理在独立子进程中执行，防止崩溃影响主服务
- ✅ **自动重启**：ASR Worker 进程崩溃时自动重启
- ✅ **GPU 加速**：支持 CUDA GPU 加速，性能提升 5-15x
- ✅ **音频解码**：支持 PCM16 和 Opus 音频格式（Opus 已废弃，由 Pipeline 负责解码）

## 架构设计

### 进程隔离

ASR 推理在独立子进程中执行，通过进程间队列通信：

- **主进程**：FastAPI 服务，处理 HTTP 请求
- **ASR Worker 进程**：独立的 Faster Whisper 推理进程
- **进程间通信**：使用 `multiprocessing.Queue` 传递任务和结果
- **自动重启**：Worker 进程崩溃时自动重启，不影响主服务

### ASR Worker Manager

`ASRWorkerManager` 负责管理 ASR Worker 进程：

- 启动和监控 Worker 进程
- 任务队列管理
- 结果队列管理
- 自动重启机制
- 健康检查和超时处理

## 环境变量

### Faster Whisper

- `ASR_MODEL_PATH`: Faster Whisper 模型路径（默认：`Systran/faster-whisper-large-v3`）
- `ASR_DEVICE`: 设备类型（`cpu` 或 `cuda`，自动检测）
- `ASR_COMPUTE_TYPE`: 计算类型（`float32`、`float16`、`int8`，自动选择）
- `ASR_BEAM_SIZE`: Beam search 宽度（默认：5，OpenAI Whisper 标准值）
- `ASR_TEMPERATURE`: 采样温度（默认：0.0）
- `ASR_PATIENCE`: Beam search 耐心值（默认：1.0）
- `ASR_COMPRESSION_RATIO_THRESHOLD`: 压缩比阈值（默认：2.4）
- `ASR_LOG_PROB_THRESHOLD`: 对数概率阈值（默认：-1.0）
- `ASR_NO_SPEECH_THRESHOLD`: 无语音阈值（默认：0.6）

### Silero VAD

- `VAD_MODEL_PATH`: Silero VAD 模型路径（默认：`models/vad/silero/silero_vad_official.onnx`）

### 服务

- `FASTER_WHISPER_VAD_PORT`: 服务端口（默认：`6007`）
- `MAX_AUDIO_DURATION_SEC`: 最大音频时长（秒，默认：30.0）

### GPU 配置

- `CUDA_PATH`: CUDA 安装路径（用于自动检测 GPU）
- `WHISPER_CACHE_DIR`: 模型缓存目录（默认：`models/asr`）

## API 端点

### `GET /health`

健康检查

**响应**：
```json
{
  "status": "ok",
  "asr_model_loaded": true,
  "vad_model_loaded": true
}
```

### `POST /reset`

重置 VAD 状态和上下文缓冲区

**请求**：
```json
{
  "reset_vad": true,
  "reset_context": true,
  "reset_text_context": true
}
```

### `POST /utterance`

处理 Utterance 任务

**请求**：
```json
{
  "job_id": "job_123",
  "src_lang": "zh",
  "audio": "base64_encoded_audio",
  "audio_format": "pcm16",
  "sample_rate": 16000,
  "language": "zh",
  "task": "transcribe",
  "beam_size": 5,
  "condition_on_previous_text": false,
  "use_context_buffer": true,
  "use_text_context": true
}
```

**响应**：
```json
{
  "text": "完整转录文本",
  "segments": [
    {
      "text": "分段1",
      "start": 0.0,
      "end": 1.0
    }
  ],
  "language": "zh",
  "language_probabilities": {
    "zh": 0.95,
    "en": 0.05
  },
  "duration_ms": 2500
}
```

## 工作流程

1. **音频解码**：解码 Base64 编码的音频（支持 PCM16 格式）
2. **音频长度检查**：检查音频长度是否超过限制（默认 30 秒）
3. **重采样**：重采样到指定采样率（默认 16kHz）
4. **前置上下文音频**：如果启用 `use_context_buffer`，将前一个 utterance 的尾部音频（最后 2 秒）前置到当前音频
5. **VAD 检测**：使用 Silero VAD 检测有效语音段
6. **提取有效语音**：去除静音部分，只保留有效语音段
7. **ASR 识别**：通过 ASR Worker Manager 发送任务到 Worker 进程，使用 Faster Whisper 进行识别，支持文本上下文（`initial_prompt`）
8. **更新上下文**：更新音频上下文缓冲区和文本上下文缓存

## 实现细节

### VAD 实现

严格按照现有 Rust 实现：

- 帧大小：512 样本（32ms @ 16kHz）
- 静音阈值：0.2
- 隐藏状态管理：`[2, 128]`
- 自适应阈值调整：根据语速动态调整

### 上下文缓冲

严格按照现有 Rust 实现：

- 音频上下文：保存前一个 utterance 的尾部音频（最后 2 秒）
- 文本上下文：保存最后一句识别文本，用于 Faster Whisper 的 `initial_prompt`
- 使用 VAD 选择最佳上下文片段（最后一个语音段的尾部）

### 进程隔离

- ASR 推理在独立子进程中执行
- 使用 `multiprocessing.Queue` 进行进程间通信
- Worker 进程崩溃时自动重启
- 主进程不受 Worker 进程崩溃影响

### GPU 支持

- 自动检测 CUDA 可用性
- GPU 模式下使用 `float16` 计算类型
- CPU 模式下使用 `float32` 计算类型
- 性能提升 5-15x（详见 [GPU.md](./GPU.md)）

## 安装和运行

### 1. 安装依赖

```bash
cd electron_node/services/faster_whisper_vad
pip install -r requirements.txt
```

### 2. 下载模型（可选）

如果使用本地模型：

```bash
python download_model.py
```

### 3. 运行服务

```bash
python faster_whisper_vad_service.py
```

服务将在 `http://localhost:6007` 启动。

## 配置

### 模型配置

- **ASR 模型**：默认使用 `Systran/faster-whisper-large-v3`
- **VAD 模型**：默认使用 `models/vad/silero/silero_vad_official.onnx`
- **模型路径**：可通过环境变量 `ASR_MODEL_PATH` 和 `VAD_MODEL_PATH` 配置

### 性能配置

- **Beam Size**：默认 5（OpenAI Whisper 标准值，平衡准确度和速度）
- **Temperature**：默认 0.0（更确定，减少随机性）
- **GPU 加速**：自动检测，详见 [GPU.md](./GPU.md)

## 故障排除

### ASR Worker 进程崩溃

- Worker 进程会自动重启
- 检查日志文件 `logs/faster-whisper-vad-service.log`
- 检查 GPU 显存是否足够

### GPU 不可用

- 检查 CUDA 是否正确安装
- 检查 `CUDA_PATH` 环境变量
- 服务会自动回退到 CPU 模式

### 音频解码失败

- 检查音频格式是否为 PCM16
- 检查采样率是否为 16kHz
- 检查音频长度是否超过限制（默认 30 秒）

## 相关文档

- [GPU 配置与性能优化](./GPU.md)：详细的 GPU 配置说明
- [配置说明](./config.py)：配置文件说明

## 注意事项

1. **模型路径**：确保 Faster Whisper 和 Silero VAD 模型路径正确
2. **GPU 支持**：如果使用 CUDA，确保已安装 `onnxruntime-gpu` 和 CUDA 驱动
3. **进程隔离**：ASR 推理在独立子进程中执行，崩溃不影响主服务
4. **音频长度**：默认最大音频长度为 30 秒，可通过 `MAX_AUDIO_DURATION_SEC` 环境变量配置

