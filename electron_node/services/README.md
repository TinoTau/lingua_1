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
    ├─ M2M100 NMT 服务 (5008)  ← 机器翻译
    ├─ Piper TTS 服务 (5006)   ← 语音合成（标准）
    └─ YourTTS 服务 (5004)      ← 语音克隆（零样本，可选）
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
3. **模型文件**: 
   - 确保模型文件已正确下载和配置
   - YourTTS 模型必须从模型库下载，服务不会自动下载
   - 模型路径：`electron_node/services/node-inference/models/tts/your_tts`
4. **服务状态**: 
   - 所有服务启动时会显示"正在启动"过渡状态
   - 服务状态会自动保存，窗口关闭或意外中断后下次启动会恢复
5. **日志格式**: 
   - 所有 Python 服务日志采用统一格式：时间戳 + 日志级别 + 内容
   - 日志级别智能识别：ERROR、WARN、INFO
   - 日志文件位置：各服务目录下的 `logs/` 子目录

