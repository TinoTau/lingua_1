# Faster Whisper + Silero VAD Service 文档

## 概述

Faster Whisper + Silero VAD 服务整合了 Faster Whisper ASR 和 Silero VAD 功能，支持上下文缓冲和 Utterance 任务处理。该服务严格按照现有 Rust 实现，确保功能一致性。

## 功能特性

- ✅ **Faster Whisper ASR**：使用 Faster Whisper 进行语音识别，支持束搜索和文本上下文
- ✅ **Silero VAD**：严格按照现有 Rust 实现，使用 ONNX Runtime
- ✅ **上下文缓冲**：音频上下文和文本上下文，严格按照现有实现
- ✅ **Utterance 任务处理**：完整的 utterance 处理流程

## 架构设计

### 服务组成

```
Faster Whisper VAD Service (Python, 端口 6007)
├── Faster Whisper ASR
│   ├── 模型：Systran/faster-whisper-large-v3（默认）
│   ├── 设备：CPU/CUDA（自动检测）
│   └── 束搜索：beam_size=5
├── Silero VAD
│   ├── 模型：silero_vad_official.onnx
│   ├── 帧大小：512 样本（32ms @ 16kHz）
│   └── 静音阈值：0.2
└── 上下文管理
    ├── 音频上下文缓冲区（最后 2 秒）
    └── 文本上下文缓存（最后一句）
```

### 工作流程

1. **前置上下文音频**：如果启用 `use_context_buffer`，将前一个 utterance 的尾部音频（最后 2 秒）前置到当前音频
2. **VAD 检测**：使用 Silero VAD 检测有效语音段
3. **提取有效语音**：去除静音部分，只保留有效语音段
4. **ASR 识别**：使用 Faster Whisper 进行识别，支持文本上下文（`initial_prompt`）
5. **更新上下文**：更新音频上下文缓冲区和文本上下文缓存

## 实现细节

### VAD 实现

严格按照现有 Rust 实现（`electron_node/services/node-inference/src/vad.rs`）：

- **帧大小**：512 样本（32ms @ 16kHz）
- **静音阈值**：0.2
- **隐藏状态管理**：`[2, 128]`，在帧之间传递
- **自适应阈值调整**：根据语速动态调整（200ms - 800ms）
- **输出处理**：严格按照 Rust 实现的 logit/sigmoid 转换逻辑

### 上下文缓冲

严格按照现有 Rust 实现（`electron_node/services/node-inference/src/inference.rs`）：

- **音频上下文**：
  - 保存前一个 utterance 的尾部音频（最后 2 秒）
  - 使用 VAD 选择最佳上下文片段（最后一个语音段的尾部）
  - 如果 VAD 未检测到语音段，回退到简单尾部保存
  
- **文本上下文**：
  - 保存最后一句识别文本
  - 用于 Faster Whisper 的 `initial_prompt`
  - 只保留最后一句，避免累积重复

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

## Rust 客户端

### 使用示例

```rust
use lingua_node_inference::FasterWhisperVADClient;

// 创建客户端
let client = FasterWhisperVADClient::new_with_url(None)?;

// 处理 Utterance
let result = client.process_utterance(
    &audio_data,  // f32 数组，16kHz 单声道
    Some("zh"),   // 语言代码（可选）
    true,         // 使用音频上下文缓冲区
    true,         // 使用文本上下文
).await?;

println!("识别文本: {}", result.text);
println!("语言: {:?}", result.language);
println!("VAD 段数: {}", result.vad_segments.len());
```

## 环境变量

### Faster Whisper
- `ASR_MODEL_PATH`: Faster Whisper 模型路径（默认：`Systran/faster-whisper-large-v3`）
- `ASR_DEVICE`: 设备类型（`cpu` 或 `cuda`，默认：`cpu`）
- `ASR_COMPUTE_TYPE`: 计算类型（`float32`、`float16`、`int8`，默认：`float32`）

### Silero VAD
- `VAD_MODEL_PATH`: Silero VAD 模型路径（默认：`models/vad/silero/silero_vad_official.onnx`）

### 服务
- `FASTER_WHISPER_VAD_PORT`: 服务端口（默认：`6007`）

## 安装和运行

```bash
# 安装依赖
cd electron_node/services/faster_whisper_vad
pip install -r requirements.txt

# 运行服务
python faster_whisper_vad_service.py
```

## 与现有实现的对比

### 优势

1. **更高的识别准确率**：
   - 使用束搜索（beam_size=5）而非贪心搜索
   - 支持文本上下文（initial_prompt）
   - 支持条件生成（condition_on_previous_text）

2. **完整的 VAD 集成**：
   - VAD 和 ASR 在同一个服务中，减少通信开销
   - 上下文缓冲和 VAD 状态管理统一

3. **热插拔支持**：
   - 通过 PythonServiceManager 管理
   - 支持动态启动/停止

### 注意事项

1. **模型路径**：确保 Faster Whisper 和 Silero VAD 模型路径正确
2. **GPU 支持**：如果使用 CUDA，确保已安装 `onnxruntime-gpu` 和 CUDA 驱动
3. **会话隔离**：当前实现使用全局状态，多会话场景需要为每个会话创建独立实例

## 相关文档

- [ASR 准确率对比与改进方案](../../node-inference/docs/ASR_ACCURACY_COMPARISON_AND_IMPROVEMENTS.md)
- [架构分析与 Faster Whisper 改造方案](../../node-inference/docs/ARCHITECTURE_ANALYSIS_AND_FASTER_WHISPER_MIGRATION.md)
- [VAD 上下文缓冲区实现](../../node-inference/docs/VAD_CONTEXT_BUFFER_IMPLEMENTATION.md)

