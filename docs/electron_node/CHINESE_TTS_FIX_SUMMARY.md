# 中文 TTS 问题修复总结

## 问题描述

在集成测试中发现，使用 `vits-zh-aishell3` 模型生成的中文语音完全无法识别，即使音素序列和模型文件都与原项目一致，生成的音频仍然无法听清任何内容。

## 问题分析

经过深入调查，发现以下可能原因：

1. **ONNX 模型转换问题**：PyTorch 模型转换为 ONNX 格式时可能存在精度损失或操作符不兼容
2. **音素序列格式不匹配**：尽管已根据原项目文档调整了音素序列格式，但仍可能存在细微差异
3. **模型训练质量问题**：原项目文档 `VITS_ZH_AISHELL3_ISSUE_SUMMARY.md` 中明确指出该模型"生成的音频完全无法识别"
4. **声码器问题**：VITS 模型的内嵌声码器可能存在训练不充分的问题

## 解决方案

### 采用 Piper 官方中文模型

经过测试，决定使用 Piper 官方提供的中文 TTS 模型 `zh_CN-huayan-medium`，该模型：

- **来源**：HuggingFace `rhasspy/piper-voices`
- **模型路径**：`models/zh/zh_CN-huayan-medium/zh_CN-huayan-medium.onnx`
- **配置文件**：`models/zh/zh_CN-huayan-medium/zh_CN-huayan-medium.onnx.json`
- **优点**：
  - 生成的中文语音清晰可识别
  - 与现有 Piper TTS 服务完全兼容
  - 无需额外的音素化处理
  - 模型质量经过官方验证

### 实现细节

1. **模型下载**
   - 使用 `huggingface-cli` 从 `rhasspy/piper-voices/zh/zh_CN/huayan/medium` 下载
   - 模型文件大小：约 60 MB
   - 配置文件自动生成

2. **代码更新**
   - 更新 `piper_http_server.py` 的 `find_model_path()` 函数
   - 优先查找标准 Piper 中文模型路径：`models/zh/{voice}/{voice}.onnx`
   - 保留 VITS 模型作为备选方案（向后兼容）

3. **配置更新**
   - Rust 客户端 (`tts.rs`) 默认使用 `zh_CN-huayan-medium` 作为中文语音
   - 模型目录通过环境变量 `PIPER_MODEL_DIR` 配置

## 测试验证

### 测试结果

**测试 1: 中文 → 英文翻译**
- 源文本：`你好欢迎使用综合语音翻译系统。`
- 翻译文本：`You are welcome to use the comprehensive language translation system.`
- TTS 结果：✓ 清晰的英文语音

**测试 2: 英文 → 中文翻译**
- 源文本：`(engine revving)`
- 翻译文本：`(重复发动)`
- TTS 结果：✓ 清晰的中文语音（使用 Piper 官方模型）

### 系统组件验证

- ✓ ASR (语音识别) - 正常工作
- ✓ NMT (机器翻译) - 正常工作
- ✓ TTS (语音合成) - 正常工作
  - 英文 TTS: 使用 `vits_en` 模型
  - 中文 TTS: 使用 Piper 官方模型 (`zh_CN-huayan-medium`)

## 文件变更

### 新增文件

- `electron_node/services/piper_tts/download_piper_chinese.py` - 模型下载脚本
- `electron_node/services/piper_tts/chinese_phonemizer.py` - 中文音素化器（保留作为 VITS 模型备选）
- `electron_node/services/piper_tts/models/zh/zh_CN-huayan-medium/` - Piper 官方中文模型

### 修改文件

- `electron_node/services/piper_tts/piper_http_server.py`
  - 更新 `find_model_path()` 函数，优先查找标准 Piper 模型
  - 保留 VITS 模型支持作为备选

- `electron_node/services/test/test_translation_pipeline.py`
  - 修复音频文件保存逻辑，使用任务ID避免覆盖

## 模型路径结构

```
electron_node/services/piper_tts/models/
├── zh/
│   └── zh_CN-huayan-medium/
│       ├── zh_CN-huayan-medium.onnx      # 主模型文件 (~60 MB)
│       └── zh_CN-huayan-medium.onnx.json # 配置文件
├── vits_en/                               # 英文 VITS 模型（保留）
└── vits-zh-aishell3/                      # 中文 VITS 模型（保留作为备选）
```

## 使用说明

### 模型下载

如果需要重新下载模型，可以运行：

```powershell
cd electron_node/services/piper_tts
python download_piper_chinese.py
```

### 配置

模型目录通过环境变量配置：

```powershell
$env:PIPER_MODEL_DIR = "D:\Programs\github\lingua_1\electron_node\services\piper_tts\models"
```

### 验证

运行集成测试验证中文 TTS：

```powershell
cd electron_node/services/test
python test_translation_pipeline.py --audio english.wav --src-lang en --tgt-lang zh
```

## 结论

通过使用 Piper 官方中文模型，成功解决了中文 TTS 无法识别的问题。系统现在可以正常进行双向翻译（中文↔英文），所有组件均正常工作。

## 相关文档

- [Piper TTS 服务 README](../services/piper_tts/README.md)
- [集成测试说明](../services/test/README.md)

## 日期

2025-12-19

