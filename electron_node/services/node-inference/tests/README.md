# 节点推理服务单元测试

## 测试结构

本目录包含节点推理服务的所有单元测试。

## 相关文档

- [ASR 文本过滤配置文档](../docs/ASR_TEXT_FILTER_CONFIG.md) - ASR 文本过滤规则配置说明

### 测试模块

- **asr_test.rs**: ASR (Whisper) 引擎测试
  - 模型加载
  - 音频转录（PCM 16-bit 和 f32 格式）
  - 语言设置和检测

- **nmt_test.rs**: NMT (M2M100) 引擎测试
  - HTTP 客户端初始化
  - 英文到中文翻译
  - 中文到英文翻译
  - 自定义服务 URL

- **tts_test.rs**: TTS (Piper) 引擎测试
  - 中文语音合成
  - 英文语音合成
  - 自定义配置

- **vad_test.rs**: VAD (Silero VAD) 引擎测试
  - 模型加载
  - 语音活动检测
  - 语音段检测
  - 配置测试（默认值和自定义）
  - 阈值设置
  - 状态重置

- **integration_test.rs**: 集成测试
  - 完整推理流程（ASR → NMT → TTS）
  - 推理服务初始化

- **stage1.3/**: 阶段一.3（节点推理服务）测试
  - ASR、NMT、TTS、VAD 测试
  - [测试报告](./stage1.3/TEST_REPORT.md)

- **stage1.4/**: 阶段一.4（自动语种识别与双向模式）测试
  - LanguageDetector 语言检测测试
  - [测试报告](./stage1.4/TEST_REPORT.md)

- **stage2.1.2/**: 阶段 2.1.2（ASR 字幕）测试
  - ASR 流式推理测试
  - 部分结果回调测试
  - [测试报告](./stage2.1.2/TEST_REPORT.md)

## 运行测试

```bash
# 运行所有测试
cargo test

# 运行特定测试模块
cargo test --test asr_test
cargo test --test nmt_test
cargo test --test tts_test
cargo test --test vad_test
cargo test --test integration_test

# 运行阶段测试
cargo test --test stage1_4  # 阶段 1.4（自动语种识别）
cargo test --test stage2_1_2  # 阶段 2.1.2（ASR 字幕）

# 运行特定测试
cargo test test_vad_config_default

# 显示测试输出
cargo test -- --nocapture

# 运行被忽略的测试（需要模型文件和服务）
cargo test -- --ignored
```

## 测试覆盖率

当前测试覆盖了以下功能：

- ✅ ASR 引擎（模型加载、转录、语言设置）
- ✅ NMT 引擎（HTTP 客户端、翻译）
- ✅ TTS 引擎（语音合成、配置）
- ✅ VAD 引擎（模型加载、语音检测、配置、状态管理）
- ✅ 推理服务（完整流程）
- ✅ LanguageDetector（语言检测、配置管理、错误处理）
- ✅ ASR 流式推理（部分结果回调）

## 注意事项

1. **模型文件依赖**：大部分测试需要模型文件存在，默认使用 `#[ignore]` 标记
   - ASR: `models/asr/whisper-base/ggml-base.bin`
   - VAD: `models/vad/silero_vad.onnx`

2. **服务依赖**：NMT 和 TTS 测试需要外部服务运行
   - NMT: `http://127.0.0.1:5008/v1/translate` (Python M2M100 服务)
   - TTS: `http://127.0.0.1:5006/tts` (Piper TTS 服务)

3. **运行被忽略的测试**：使用 `cargo test -- --ignored` 运行需要模型和服务的测试

4. **测试独立性**：所有测试都是异步测试，使用 `#[tokio::test]`，测试之间相互独立

5. **配置测试**：VAD 配置测试不需要模型文件，可以直接运行

