# TTS 服务文档

## 概述

Electron Node 支持多种 TTS（文本转语音）服务，包括 Piper TTS 和 YourTTS。系统根据任务需求自动选择服务，支持音色克隆功能。

## 服务类型

### 1. Piper TTS（默认）

**端口**: 5006  
**功能**: 标准语音合成，支持多语言  
**模型**: 
- 英文：`vits_en`
- 中文：`zh_CN-huayan-medium`（Piper 官方模型）

**特点**:
- 生成速度快
- 语音质量稳定
- 支持多语言

### 2. YourTTS（音色克隆）

**端口**: 5004  
**功能**: 零样本语音克隆，支持音色克隆  
**特点**:
- 支持通过 `speaker_id` 进行音色克隆
- 需要参考音频进行音色提取
- 生成速度较慢，但音色还原度高

## 任务链流程

### 标准流程（无音色克隆）

```
调度服务器 → Node Agent → Inference Service
    ↓
1. ASR (Whisper, 本地)
    ↓
2. NMT (HTTP 5008)
    ↓
3. TTS (HTTP 5006, Piper TTS)
    ↓
返回音频文件
```

### 音色克隆流程（启用 `voice_cloning`）

```
调度服务器 → Node Agent → Inference Service
    ↓
1. ASR (Whisper, 本地)
    ↓
2. NMT (HTTP 5008)
    ↓
3. YourTTS (HTTP 5004, 音色克隆)
    ↓
返回音频文件
```

## 动态服务选择

系统根据任务请求中的 `features.voice_cloning` 自动选择 TTS 服务：

```typescript
// 如果启用 voice_cloning 且有 speaker_id → 使用 YourTTS
// 否则 → 使用 Piper TTS
```

**优雅降级**: YourTTS 失败时自动降级到 Piper TTS

## 中文 TTS 问题修复

### 问题描述

使用 `vits-zh-aishell3` 模型生成的中文语音完全无法识别，即使音素序列和模型文件都与原项目一致。

### 解决方案

采用 Piper 官方中文模型 `zh_CN-huayan-medium`：

- **来源**: HuggingFace `rhasspy/piper-voices`
- **模型路径**: `models/zh/zh_CN-huayan-medium/zh_CN-huayan-medium.onnx`
- **优点**:
  - 生成的中文语音清晰可识别
  - 与现有 Piper TTS 服务完全兼容
  - 无需额外的音素化处理
  - 模型质量经过官方验证

### 实现细节

1. **模型下载**
   - 使用 `huggingface-cli` 从 `rhasspy/piper-voices/zh/zh_CN/huayan/medium` 下载
   - 模型文件大小：约 60 MB

2. **代码更新**
   - 更新 `piper_http_server.py` 的 `find_model_path()` 函数
   - 优先查找标准 Piper 中文模型路径：`models/zh/{voice}/{voice}.onnx`
   - 保留 VITS 模型作为备选方案（向后兼容）

3. **配置更新**
   - Rust 客户端 (`tts.rs`) 默认使用 `zh_CN-huayan-medium` 作为中文语音
   - 模型目录通过环境变量 `PIPER_MODEL_DIR` 配置

## 模型路径结构

```
electron_node/services/piper_tts/models/
├── zh/
│   └── zh_CN-huayan-medium/
│       ├── zh_CN-huayan-medium.onnx      # 主模型文件 (~60 MB)
│       └── zh_CN-huayan-medium.onnx.json # 配置文件
├── vits_en/                               # 英文 VITS 模型
└── vits-zh-aishell3/                      # 中文 VITS 模型（保留作为备选）
```

## YourTTS 集成实现

### 实现内容

1. **YourTTS HTTP 客户端模块**
   - 文件: `electron_node/services/node-inference/src/yourtts.rs`
   - 功能:
     - 实现 `YourTTSEngine` 结构体，封装 YourTTS HTTP 服务调用
     - 支持通过 HTTP POST 请求调用 YourTTS 服务（端口 5004）
     - 自动处理音频格式转换（f32 → PCM16）
     - 支持音频重采样（从 22050Hz 到 16000Hz）

2. **VoiceCloner 调用 YourTTS**
   - 文件: `electron_node/services/node-inference/src/speaker.rs`
   - 功能:
     - 在 `VoiceCloner` 结构体中添加 `yourtts_engine` 字段
     - 实现 `VoiceCloner::clone_voice()` 方法，调用 YourTTS 服务
     - 支持通过 `speaker_id` 进行音色克隆

3. **推理流程支持动态 TTS 选择**
   - 文件: `electron_node/services/node-inference/src/inference.rs`
   - 功能:
     - 根据 `features.voice_cloning` 自动选择 YourTTS 或 Piper TTS
     - 实现优雅降级：YourTTS 失败时自动降级到 Piper TTS

## 使用方式

### 启动服务

```typescript
// 启动 Piper TTS
await pythonServiceManager.startService('tts');

// 启动 YourTTS
await pythonServiceManager.startService('yourtts');
```

### 任务请求配置

**标准 TTS**:
```json
{
  "features": {
    "voice_cloning": false
  }
}
```

**音色克隆**:
```json
{
  "features": {
    "voice_cloning": true,
    "speaker_identification": true
  },
  "speaker_id": "speaker_123"
}
```

## 配置

### 环境变量

- `PIPER_MODEL_DIR`: Piper 模型目录
- `YOURTTS_MODEL_DIR`: YourTTS 模型目录

### 服务端口

- Piper TTS: 5006
- YourTTS: 5004
- NMT: 5008
- 节点推理服务: 5009

## 特性

- ✅ 动态服务选择：根据任务需求自动选择 TTS 服务
- ✅ 优雅降级：YourTTS 不可用时自动使用 Piper TTS
- ✅ 错误处理：完善的错误处理和日志记录
- ✅ 热插拔支持：服务可以动态启动/停止
- ✅ 多语言支持：支持中文和英文语音合成

## 相关文档

- [Piper TTS 服务 README](../services/piper_tts/README.md)
- [YourTTS 服务文档](../services/your_tts/)
- [服务热插拔验证](SERVICE_HOT_PLUG_VERIFICATION.md)

## 更新历史

### 2024-12-19: YourTTS 服务集成完成

- ✅ 创建 YourTTS HTTP 客户端模块
- ✅ 实现 VoiceCloner 调用 YourTTS
- ✅ 实现动态 TTS 服务选择
- ✅ 实现优雅降级机制

### 2024-12-19: 中文 TTS 问题修复

- ✅ 采用 Piper 官方中文模型 `zh_CN-huayan-medium`
- ✅ 更新模型查找逻辑
- ✅ 修复中文语音无法识别问题

