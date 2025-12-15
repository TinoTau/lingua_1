# 本地模型测试说明

## 模型文件位置

所有模型文件位于 `node-inference/models/` 目录下：

- **ASR (Whisper)**: `models/asr/whisper-base/ggml-base.bin` ✅
- **VAD (Silero VAD)**: `models/vad/silero/silero_vad_official.onnx` ✅
- **NMT (M2M100)**: `models/nmt/m2m100-en-zh/` 和 `models/nmt/m2m100-zh-en/` (ONNX 格式，但当前实现需要 HTTP 服务)
- **TTS (Piper)**: `models/tts/` (多种格式，但当前实现需要 HTTP 服务)

## 可以直接本地调用的模型

### ✅ ASR (Whisper) - 完全支持本地调用

**模型文件**: `models/asr/whisper-base/ggml-base.bin`

**测试状态**:
- ✅ `test_asr_engine_load` - 模型加载测试通过
- ✅ `test_asr_transcribe` - 音频转录测试通过
- ✅ `test_asr_language_detection` - 语言设置测试通过

**运行测试**:
```bash
cd node-inference
cargo test --test asr_test -- --ignored
```

**特点**:
- 使用 `whisper-rs` 库直接加载 GGML 格式模型
- 支持 GPU 加速（如果 CUDA 可用）
- 不需要外部服务
- 支持语言设置和自动检测

### ✅ VAD (Silero VAD) - 完全支持本地调用

**模型文件**: `models/vad/silero/silero_vad_official.onnx`

**测试状态**:
- ✅ `test_vad_engine_load` - 模型加载测试通过
- ✅ `test_vad_config_default` - 配置默认值测试通过
- ✅ `test_vad_config_custom` - 自定义配置测试通过
- ✅ `test_vad_set_silence_threshold` - 阈值设置测试通过
- ✅ `test_vad_reset_state` - 状态重置测试通过
- ⚠️ `test_vad_detect_speech` - 需要实际音频数据测试
- ⚠️ `test_vad_detect_speech_segments` - 需要实际音频数据测试

**运行测试**:
```bash
cd node-inference
cargo test --test vad_test -- --ignored
```

**特点**:
- 使用 `ort` (ONNX Runtime) 直接加载 ONNX 模型
- 支持 GPU 加速（如果 CUDA 可用）
- 不需要外部服务
- 支持自适应阈值调整
- 支持状态重置

## 需要外部服务的模型

### ⏸️ NMT (M2M100) - 当前需要 HTTP 服务

**模型文件**: `models/nmt/m2m100-en-zh/` 和 `models/nmt/m2m100-zh-en/` (ONNX 格式)

**当前实现**:
- 通过 HTTP 调用 Python M2M100 服务
- 服务地址: `http://127.0.0.1:5008/v1/translate`

**未来改进**:
- 代码中已预留 ONNX 本地调用接口（待实现）
- 模型文件已存在，理论上可以实现本地 ONNX 推理

**运行测试**:
```bash
# 需要先启动 NMT 服务
cargo test --test nmt_test -- --ignored
```

### ⏸️ TTS (Piper) - 当前需要 HTTP 服务

**模型文件**: `models/tts/` (多种格式)

**当前实现**:
- 通过 HTTP 调用 Piper TTS 服务
- 服务地址: `http://127.0.0.1:5006/tts`

**未来改进**:
- 可以考虑实现本地 ONNX 推理（如果模型支持）

**运行测试**:
```bash
# 需要先启动 TTS 服务
cargo test --test tts_test -- --ignored
```

## 测试总结

### 可以直接运行的测试（不需要外部服务）

```bash
cd node-inference

# ASR 测试（3个测试，全部通过）
cargo test --test asr_test -- --ignored

# VAD 测试（7个测试，5个通过，2个需要实际音频数据）
cargo test --test vad_test -- --ignored

# 配置测试（不需要模型文件）
cargo test --test vad_test test_vad_config_default test_vad_config_custom
```

### 需要外部服务的测试

```bash
# NMT 测试（需要 Python M2M100 服务运行）
cargo test --test nmt_test -- --ignored

# TTS 测试（需要 Piper TTS 服务运行）
cargo test --test tts_test -- --ignored

# 集成测试（需要所有模型和服务）
cargo test --test integration_test -- --ignored
```

## 结论

**可以直接本地调用的模型**:
1. ✅ **ASR (Whisper)** - 完全支持，测试全部通过
2. ✅ **VAD (Silero VAD)** - 完全支持，模型加载和配置测试通过

**需要外部服务的模型**:
1. ⏸️ **NMT (M2M100)** - 当前通过 HTTP 服务，但模型文件存在，可以未来实现本地调用
2. ⏸️ **TTS (Piper)** - 当前通过 HTTP 服务

**建议**:
- ASR 和 VAD 可以直接使用，无需启动外部服务
- NMT 和 TTS 需要启动对应的 Python 服务，或者未来实现本地 ONNX 推理

