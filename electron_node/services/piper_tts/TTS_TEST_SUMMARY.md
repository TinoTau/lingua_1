# 中文 TTS 测试总结

## 测试目标
恢复 VITS 中文 AISHELL3 模型生成可识别中文语音的能力。

## 已尝试的方法

### 1. 音素序列格式变化

#### 方法 1: 使用 #0 作为分隔符（lexicon 原始格式）
- 格式: `声母 + 韵母 + #0 + 声母 + 韵母 + #0`
- 音素ID: `[19, 81, 3, 14, 51, 3]`
- 带 sil/eos: `[0, 19, 81, 3, 14, 51, 3, 1]`
- 文件: `test_lexicon_direct_lexicon.wav`, `test_lexicon_direct_lexicon_sil.wav`

#### 方法 2: 使用 sp 替换 #0
- 格式: `声母 + 韵母 + sp + 声母 + 韵母 + sp`
- 音素ID: `[19, 81, 2, 14, 51, 2]`
- 带 sil/eos: `[0, 19, 81, 2, 14, 51, 2, 1]`
- 文件: `test_lexicon_replace_sp.wav`, `test_lexicon_replace_sp_sil.wav`

#### 方法 3: 不使用分隔符
- 格式: `声母 + 韵母 + 声母 + 韵母`
- 音素ID: `[19, 81, 14, 51]`
- 带 sil/eos: `[0, 19, 81, 14, 51, 1]`
- 文件: `test_lexicon_no_separator.wav`, `test_lexicon_no_separator_sil.wav`

### 2. 参数组合测试

测试了多种参数组合：
- `noise_scale`: 0.3, 0.5, 0.667
- `length_scale`: 1.0, 1.5, 2.0
- `noise_w_scale`: 0.4, 0.6, 0.8

### 3. 生成的测试文件

所有测试文件位于 `electron_node/services/piper_tts/` 目录下，文件名格式：
- `test_method{1-5}_{default|recommended}.wav` - 不同音素格式
- `test_original_{no_sil_eos|with_sil_eos}_{low_noise|medium|high_length}.wav` - 原始格式变体
- `test_lexicon_{method_name}.wav` - 直接 lexicon 格式

## 下一步

1. **测试所有生成的音频文件**，找出能识别出中文的格式
2. 如果找到可识别的格式，更新 `piper_http_server.py` 使用该格式
3. 如果所有格式都无法识别，考虑：
   - 检查模型文件是否正确
   - 尝试使用原始 PyTorch 模型
   - 考虑使用其他中文 TTS 模型

## 注意事项

根据原项目文档，即使音素ID完全正确，该模型也可能无法生成可识别的音频。这可能是：
- 模型本身的问题（ONNX 转换或训练质量问题）
- 需要特殊的预处理或后处理
- 模型使用方式不正确

