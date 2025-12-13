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
**端口**: 5005  
**功能**: 提供语音合成能力（Piper TTS 模型）

详细文档请参考: [Piper TTS 服务 README](./piper_tts/README.md)

## 快速开始

### 一键启动所有服务

```powershell
.\scripts\start_all.ps1
```

这将启动：
1. 模型库服务（端口 5000）
2. M2M100 NMT 服务（端口 5008）
3. Piper TTS 服务（端口 5005）
4. 节点推理服务（端口 9000）
5. 调度服务器（端口 8080）
6. API Gateway（端口 8081，可选）

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
节点推理服务 (9000)
    ├─ M2M100 NMT 服务 (5008)  ← 机器翻译
    └─ Piper TTS 服务 (5005)   ← 语音合成
```

节点推理服务通过 HTTP 调用 M2M100 和 Piper 服务。

## 注意事项

1. **服务启动顺序**: 建议先启动 M2M100 和 Piper 服务，再启动节点推理服务
2. **GPU 支持**: M2M100 服务支持 GPU 加速（如果系统有 CUDA GPU）
3. **模型文件**: 确保模型文件已正确下载和配置

