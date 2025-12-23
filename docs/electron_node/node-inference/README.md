# 节点推理服务文档

**位置**: `electron_node/services/node-inference/`  
**技术栈**: Rust + ONNX Runtime + Whisper + Silero VAD

---

## 概述

节点推理服务是 Electron Node 客户端的核心推理引擎，提供 ASR、NMT、TTS、VAD 和 Speaker Embedding 功能。

---

## 核心功能

### 1. ASR (Whisper) 引擎 ✅

- **模型**: Whisper Base (GGML)
- **功能**: 语音转文本
- **支持**: 多语言识别、语言检测
- **加速**: CUDA GPU 支持

### 2. NMT (M2M100) 引擎 ✅

- **模型**: M2M100 (通过 HTTP 服务)
- **功能**: 机器翻译
- **支持**: 多语言翻译

### 3. TTS (Piper) 引擎 ✅

- **模型**: Piper TTS (通过 HTTP 服务)
- **功能**: 文本转语音
- **支持**: 多语言合成

### 4. VAD (Silero VAD) 引擎 ✅

- **模型**: Silero VAD (ONNX)
- **功能**: 语音活动检测
- **加速**: CUDA GPU 支持
- **集成状态**: ✅ **已集成到处理流程**（2025-01-XX）

### 5. Speaker Embedding 服务 ✅

- **模型**: SpeechBrain ECAPA-TDNN (通过 HTTP 服务)
- **功能**: 说话者特征提取
- **端口**: 5003
- **输出**: 192 维特征向量
- **集成状态**: ✅ **已集成到处理流程**（2025-01-XX）
- **服务位置**: `electron_node/services/speaker_embedding/`

---

## 音频处理优化

### 1. Opus 压缩支持 ✅

**完成状态**: ✅ **100% 完成并测试**

- ✅ **Web 客户端 Opus 编码**: 使用 `@minceraftmc/opus-encoder`
- ✅ **节点端 Opus 解码**: 使用 `opus-rs`
- ✅ **Binary Frame 协议**: 支持高效的二进制数据传输
- ✅ **自动降级机制**: Opus 失败时自动回退到 PCM16

**性能影响**:
- **带宽节省**: 约 50%（相比 PCM16）
- **延迟影响**: 
  - 高/中速网络（> 2 Mbps）: 可能略微增加总延迟
  - 低速/移动网络（< 2 Mbps）: 显著减少总延迟

**相关文档**: [Opus 压缩支持文档](./OPUS_COMPRESSION_SUPPORT.md)

### 2. VAD 引擎集成 ✅

**完成状态**: ✅ **100% 完成并测试**（2025-01-XX）

#### 2.1 VAD 语音段检测和提取

- ✅ 在 ASR 处理前使用 VAD 检测有效语音段
- ✅ 自动合并多个语音段，去除静音部分
- ✅ 提高 ASR 识别准确性

#### 2.2 VAD 上下文缓冲区优化

- ✅ 使用 VAD 选择最后一个语音段的尾部作为上下文
- ✅ 避免将静音部分作为上下文
- ✅ 提高下一个 utterance 的 ASR 准确性

#### 2.3 Level 2 断句功能

- ✅ 节点端精确断句
- ✅ 支持多语音段处理
- ✅ 容错机制（VAD 失败时自动回退）

**相关文档**:
- [VAD 引擎集成实现文档](./VAD_INTEGRATION_IMPLEMENTATION.md)
- [VAD 上下文缓冲区实现文档](./VAD_CONTEXT_BUFFER_IMPLEMENTATION.md)

---

## 技术实现

### 音频处理流程

```
音频输入（PCM16 或 Opus）
  ↓
Opus 解码（如果是 Opus）
  ↓
转换为 f32 格式
  ↓
前置上下文音频（如果有）
  ↓
VAD 检测语音段
  ↓
提取有效语音段，去除静音
  ↓
ASR 识别（只处理有效语音）
  ↓
VAD 选择最佳上下文片段
  ↓
更新上下文缓冲区
  ↓
继续后续处理（NMT、TTS）
```

---

## 测试

### 单元测试

- ✅ ASR 引擎测试
- ✅ VAD 引擎测试
- ✅ Opus 编解码测试
- ✅ 集成测试

### 测试报告

- [VAD 集成测试报告](../tests/VAD_INTEGRATION_TEST_REPORT.md)
- [VAD 集成测试总结](../tests/VAD_INTEGRATION_TEST_SUMMARY.md)

---

## 可选模块

### Speaker Identification（说话者识别）✅

- **功能**: 基于 Speaker Embedding 的说话者识别
- **实现**: 调用 Python Speaker Embedding 服务（端口 5003）
- **模式**: 支持单人模式和多人模式
- **热插拔**: ✅ 支持动态启用/禁用

**相关文档**:
- [Embedding 模块迁移报告](../../electron_node/services/node-inference/docs/EMBEDDING_MODULE_MIGRATION.md)
- [Embedding 模块对比分析](../../electron_node/services/node-inference/docs/EMBEDDING_MODULE_COMPARISON.md)
- [模块实现方式说明](../../electron_node/services/node-inference/docs/MODULE_IMPLEMENTATION_METHODS.md)

## 相关文档

### 核心功能文档

- [VAD 引擎集成实现文档](./VAD_INTEGRATION_IMPLEMENTATION.md)
- [VAD 上下文缓冲区实现文档](./VAD_CONTEXT_BUFFER_IMPLEMENTATION.md)
- [Opus 压缩支持文档](./OPUS_COMPRESSION_SUPPORT.md)

### 模块文档

- [模块列表](../../electron_node/services/node-inference/docs/MODULE_LIST.md)
- [模块实现方式说明](../../electron_node/services/node-inference/docs/MODULE_IMPLEMENTATION_METHODS.md)
- [Embedding 模块迁移报告](../../electron_node/services/node-inference/docs/EMBEDDING_MODULE_MIGRATION.md)

### 其他文档

- [测试文档](../tests/README.md)

---

## 更新历史

- **2025-01-XX**: Speaker Embedding 模块迁移完成
  - Python Speaker Embedding 服务（端口 5003）
  - Rust HTTP 客户端集成
  - Speaker Identification 模块更新
  - 支持热插拔和自动服务管理
- **2025-01-XX**: VAD 引擎集成完成
  - VAD 语音段检测和提取
  - VAD 上下文缓冲区优化
  - Level 2 断句功能
- **2025-01-XX**: Opus 压缩支持完成
  - Web 客户端 Opus 编码
  - 节点端 Opus 解码
  - Binary Frame 协议支持
