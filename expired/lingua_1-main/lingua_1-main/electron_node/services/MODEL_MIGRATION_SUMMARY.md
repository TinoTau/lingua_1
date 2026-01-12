# 模型迁移总结

## 迁移完成情况

### ✅ 已迁移的模型

1. **TTS 模型** → `piper_tts/models/`
   - `vits_en/` - 英文 VITS 模型
   - `vits-zh-aishell3/` - 中文 VITS 模型

2. **YourTTS 模型** → `your_tts/models/your_tts/`
   - `your_tts/` - YourTTS 音色克隆模型

3. **NMT 模型** → `nmt_m2m100/models/`
   - `m2m100-zh-en/` - 中英翻译模型
   - `m2m100-en-zh/` - 英中翻译模型

### 📝 已更新的配置文件

1. **Piper TTS 服务配置**
   - `electron_node/electron-node/main/src/utils/python-service-config.ts`
   - 默认模型路径：`piper_tts/models/`

2. **YourTTS 服务配置**
   - `electron_node/electron-node/main/src/utils/python-service-config.ts`
   - `electron_node/services/your_tts/yourtts_service.py`
   - 默认模型路径：`your_tts/models/your_tts/`

3. **NMT 服务配置**
   - `electron_node/services/nmt_m2m100/nmt_service.py`
   - 添加了从服务目录加载模型的逻辑

### ⚠️ 注意事项

1. **NMT 模型格式**
   - 当前迁移的 ONNX 模型可能不是 NMT 服务直接使用的
   - NMT 服务使用 HuggingFace Transformers，期望模型在 HuggingFace 缓存格式
   - 如果服务无法加载模型，可能需要：
     - 将 ONNX 模型转换为 HuggingFace 格式，或
     - 使用 HuggingFace 的 `cache_dir` 参数指向正确位置

2. **保留在 node-inference/models/ 的模型**
   - `asr/` - ASR 模型（由推理服务直接使用）
   - `vad/` - VAD 模型（由推理服务直接使用）
   - `emotion/` - 情感识别模型（由推理服务直接使用）
   - `persona/` - 人设模型（由推理服务直接使用）
   - `speaker_embedding/` - 说话人嵌入模型（由推理服务直接使用）

### 🔄 后续步骤

1. 重启所有服务以应用新的模型路径
2. 测试每个服务是否能正常加载模型
3. 如果 NMT 服务无法加载模型，需要调整模型格式或路径配置

## 模型路径映射

| 服务 | 旧路径 | 新路径 |
|------|--------|--------|
| Piper TTS | `node-inference/models/tts/vits_*` | `piper_tts/models/vits_*` |
| YourTTS | `node-inference/models/tts/your_tts` | `your_tts/models/your_tts` |
| NMT | `node-inference/models/nmt/m2m100-*` | `nmt_m2m100/models/m2m100-*` |

## 环境变量

可以通过以下环境变量覆盖默认路径：

- `PIPER_MODEL_DIR` - Piper TTS 模型目录
- `YOURTTS_MODEL_DIR` - YourTTS 模型目录
- `HF_HOME` 或 `HF_DATASETS_CACHE` - HuggingFace 模型缓存目录（用于 NMT）

