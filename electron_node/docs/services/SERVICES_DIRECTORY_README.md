# 节点端服务

本目录包含节点端所需的核心服务，这些服务为节点推理服务提供基础能力。

## 服务列表

### 1. M2M100 NMT 服务

**位置**: `services/nmt_m2m100/`  
**端口**: 5008  
**功能**: 提供机器翻译能力（M2M100 模型）

详细文档请参考: [M2M100 NMT 服务 README](./nmt_m2m100/README.md)

### 2. Piper TTS 服务

**位置**: `services/piper_tts/`  
**端口**: 5006  
**功能**: 提供语音合成能力（Piper TTS 模型）

详细文档请参考: [Piper TTS 服务 README](./piper_tts/README.md)

### 3. YourTTS 服务

**位置**: `services/your_tts/`  
**端口**: 5004  
**功能**: 提供零样本语音克隆能力（YourTTS 模型，支持音色克隆）

**模型路径**：
- 默认：`electron_node/services/node-inference/models/tts/your_tts`
- 可通过环境变量 `YOURTTS_MODEL_DIR` 覆盖

**启动说明**：
- 服务启动时会通过 `--model-dir` 参数明确传递模型路径
- 如果模型路径不存在，服务会退出并记录错误日志
- 模型必须从模型库下载，服务不会自动下载模型

### 4. Faster Whisper VAD 服务

**位置**: `services/faster_whisper_vad/`  
**端口**: 6007  
**功能**: 整合 Faster Whisper ASR 和 Silero VAD 的语音识别服务

**特性**:
- ✅ Faster Whisper ASR：高性能语音识别（支持 GPU 加速，10-20x 性能提升）
- ✅ Silero VAD：语音活动检测，支持上下文缓冲
- ✅ GPU 加速：自动检测 CUDA，使用 `float16` 计算类型
- ✅ 上下文缓冲：音频上下文和文本上下文支持

**GPU 配置**:
- 自动检测 CUDA 可用性
- 如果 CUDA 可用，使用 GPU 和 `float16` 计算类型
- 如果 CUDA 不可用，自动回退到 CPU 和 `float32`

**模型路径**:
- ASR 模型：`services/faster_whisper_vad/models/asr/whisper-base-ct2`（CTranslate2 格式）
- VAD 模型：`services/faster_whisper_vad/models/vad/silero/silero_vad_official.onnx`

详细文档请参考: [Faster Whisper VAD 服务 README](./faster_whisper_vad/README.md)

### 5. Speaker Embedding 服务

**位置**: `services/speaker_embedding/`  
**端口**: 5003  
**功能**: 提取说话者特征向量（用于说话者识别）

**特性**:
- ✅ SpeechBrain ECAPA-TDNN 模型
- ✅ GPU 加速：支持 CUDA（5-10x 性能提升，批量处理可达 10-32x）
- ✅ HTTP API 接口，易于集成
- ✅ 自动模型下载（从 HuggingFace）

**GPU 配置**:
- 自动检测 CUDA 可用性
- 如果 CUDA 可用，自动添加 `--gpu` 参数启用 GPU
- 支持批量处理，性能提升显著

**模型路径**:
- 模型自动下载到：`services/speaker_embedding/models/speaker_embedding/cache/`

详细文档请参考: [Speaker Embedding 服务 README](./speaker_embedding/README.md)

## 快速开始

### 一键启动所有服务

```powershell
.\scripts\start_all.ps1
```

这将启动：
1. 模型库服务（端口 5000）
2. M2M100 NMT 服务（端口 5008）
3. Piper TTS 服务（端口 5006）
4. YourTTS 服务（端口 5004，可选）
5. 节点推理服务（端口 5009）
6. 调度服务器（端口 5010）
7. API Gateway（端口 8081，可选）

### 单独启动服务

```powershell
# 启动 M2M100 NMT 服务
.\scripts\start_nmt_service.ps1

# 启动 Piper TTS 服务
.\scripts\start_tts_service.ps1

# 启动节点推理服务
.\scripts\start_node_inference.ps1
```

## 服务依赖关系

```
节点推理服务 (5009)
    ├─ M2M100 NMT 服务 (5008)        ← 机器翻译
    ├─ Piper TTS 服务 (5006)          ← 语音合成（标准）
    ├─ YourTTS 服务 (5004)            ← 语音克隆（零样本，可选）
    ├─ Faster Whisper VAD 服务 (6007) ← ASR + VAD（GPU加速）
    └─ Speaker Embedding 服务 (5003)   ← 说话者特征提取（GPU加速）
```

节点推理服务通过 HTTP 调用各个 Python 服务。

### TTS 服务选择逻辑

节点推理服务会根据任务请求中的 `features.voice_cloning` 自动选择 TTS 服务：

- **标准流程**：使用 Piper TTS（端口 5006）
- **音色克隆流程**：如果启用 `voice_cloning` 且有 `speaker_id`，使用 YourTTS（端口 5004）
- **优雅降级**：如果 YourTTS 服务不可用，自动降级到 Piper TTS

详细实现请参考：[YourTTS 集成实现文档](../docs/YOURTTS_INTEGRATION_IMPLEMENTATION.md)

## 注意事项

1. **服务启动顺序**: 建议先启动 M2M100 和 TTS 服务，再启动节点推理服务
2. **GPU 支持**: 
   - M2M100 服务支持 GPU 加速（如果系统有 CUDA GPU）
   - YourTTS 服务支持 GPU 加速（如果系统有 CUDA GPU）
   - **Faster Whisper VAD 服务**：已配置 GPU 加速（需要 `onnxruntime-gpu`）
   - **Speaker Embedding 服务**：已配置 GPU 加速（需要 PyTorch CUDA 版本）
3. **模型文件**: 
   - 确保模型文件已正确下载和配置
   - YourTTS 模型必须从模型库下载，服务不会自动下载
   - 模型路径：`electron_node/services/node-inference/models/tts/your_tts`
   - **Faster Whisper VAD**：需要转换后的 CTranslate2 格式模型
   - **Speaker Embedding**：模型会自动从 HuggingFace 下载
4. **服务独立性**: 
   - 每个服务都有独立的虚拟环境（venv），依赖完全隔离
   - 每个服务只在自己的目录下查找模型，找不到直接报错
   - 服务之间相互独立，互不干扰
5. **服务状态**: 
   - 所有服务启动时会显示"正在启动"过渡状态
   - 服务状态会自动保存，窗口关闭或意外中断后下次启动会恢复
6. **日志格式**: 
   - 所有 Python 服务日志采用统一格式：时间戳 + 日志级别 + 内容
   - 日志级别智能识别：ERROR、WARN、INFO
   - 日志文件位置：各服务目录下的 `logs/` 子目录

