# Faster Whisper + Silero VAD Service

整合 Faster Whisper ASR 和 Silero VAD 的 Python HTTP 服务，支持上下文缓冲和 Utterance 任务处理。

## 功能特性

- ✅ **Faster Whisper ASR**：使用 Faster Whisper 进行语音识别，支持束搜索和文本上下文
- ✅ **Silero VAD**：严格按照现有 Rust 实现，使用 ONNX Runtime
- ✅ **上下文缓冲**：音频上下文和文本上下文，严格按照现有实现
- ✅ **Utterance 任务处理**：完整的 utterance 处理流程

## 环境变量

### Faster Whisper
- `ASR_MODEL_PATH`: Faster Whisper 模型路径（默认：`Systran/faster-whisper-large-v3`）
- `ASR_DEVICE`: 设备类型（`cpu` 或 `cuda`，默认：`cpu`）
- `ASR_COMPUTE_TYPE`: 计算类型（`float32`、`float16`、`int8`，默认：`float32`）

### Silero VAD
- `VAD_MODEL_PATH`: Silero VAD 模型路径（默认：`models/vad/silero/silero_vad_official.onnx`）

### 服务
- `FASTER_WHISPER_VAD_PORT`: 服务端口（默认：`6007`）

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
  "audio_b64": "base64_encoded_wav_audio",
  "language": "zh",  // 可选，None 为自动检测
  "task": "transcribe",  // "transcribe" 或 "translate"
  "beam_size": 5,
  "condition_on_previous_text": true,
  "use_context_buffer": true,  // 是否使用音频上下文缓冲区
  "use_text_context": true  // 是否使用文本上下文
}
```

**响应**：
```json
{
  "text": "完整转录文本",
  "segments": ["分段1", "分段2"],
  "language": "zh",
  "duration": 2.5,
  "vad_segments": [[0, 16000], [20000, 36000]]  // 语音段（样本索引）
}
```

## 工作流程

1. **前置上下文音频**：如果启用 `use_context_buffer`，将前一个 utterance 的尾部音频（最后 2 秒）前置到当前音频
2. **VAD 检测**：使用 Silero VAD 检测有效语音段
3. **提取有效语音**：去除静音部分，只保留有效语音段
4. **ASR 识别**：使用 Faster Whisper 进行识别，支持文本上下文（`initial_prompt`）
5. **更新上下文**：更新音频上下文缓冲区和文本上下文缓存

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

## 安装和运行

```bash
# 安装依赖
pip install -r requirements.txt

# 运行服务
python faster_whisper_vad_service.py
```

## 注意事项

1. **模型路径**：确保 Faster Whisper 和 Silero VAD 模型路径正确
2. **GPU 支持**：如果使用 CUDA，确保已安装 `onnxruntime-gpu` 和 CUDA 驱动
3. **会话隔离**：当前实现使用全局状态，多会话场景需要为每个会话创建独立实例

