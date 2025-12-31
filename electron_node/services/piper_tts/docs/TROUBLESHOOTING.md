# Piper TTS 服务故障排除指南

## 常见问题

### 1. 模型找不到

**症状**: 返回 404 错误，提示 "Model not found"

**可能原因**:
- 模型文件路径不正确
- 模型文件不存在
- 环境变量 `PIPER_MODEL_DIR` 设置错误

**解决方案**:

1. **检查模型目录**
   ```powershell
   # 检查默认模型目录
   dir electron_node\services\piper_tts\models
   
   # 检查环境变量
   echo $env:PIPER_MODEL_DIR
   ```

2. **设置正确的模型目录**
   ```powershell
   $env:PIPER_MODEL_DIR = "D:\path\to\piper_models"
   ```

3. **检查模型文件结构**
   
   标准 Piper 模型结构：
   ```
   models/
   ├── zh/
   │   └── zh_CN-huayan-medium/
   │       ├── zh_CN-huayan-medium.onnx
   │       └── zh_CN-huayan-medium.onnx.json
   └── en/
       └── en_US-lessac-medium/
           ├── en_US-lessac-medium.onnx
           └── en_US-lessac-medium.onnx.json
   ```

### 2. 中文 VITS 模型无法生成可识别音频

**症状**: 生成的音频无法识别或质量很差

**可能原因**:
- 音素序列格式问题
- ONNX 模型转换问题
- 模型训练质量问题
- 声码器问题

**解决方案**:

1. **检查音素化器**
   - 确保 `chinese_phonemizer.py` 可用
   - 检查 `lexicon.txt` 文件是否存在且完整

2. **验证模型文件**
   ```powershell
   # 检查 VITS 模型文件
   dir electron_node\services\piper_tts\models\vits-zh-aishell3
   ```

3. **使用标准 Piper 中文模型**
   - 推荐使用 `zh_CN-huayan-medium` 模型
   - 该模型经过验证，质量稳定

**说明**:
- VITS 中文模型可能存在兼容性问题
- 如果 VITS 模型无法正常工作，建议使用标准 Piper 中文模型
- 标准 Piper 模型使用 Python API，性能更好

### 3. GPU 不可用

**症状**: 服务使用 CPU 模式，性能较慢

**检查方法**:
```powershell
# 检查 ONNX Runtime GPU 支持
python -c "import onnxruntime as ort; print('Providers:', ort.get_available_providers())"
# 应该看到：['CUDAExecutionProvider', 'CPUExecutionProvider']
```

**解决方案**:

1. **安装 GPU 版本的 ONNX Runtime**
   ```powershell
   pip uninstall onnxruntime
   pip install onnxruntime-gpu>=1.16.0
   ```

2. **设置环境变量**
   ```powershell
   $env:PIPER_USE_GPU = "true"
   ```

3. **验证 GPU 使用**
   - 查看服务日志，应该看到 "Model using GPU (CUDAExecutionProvider)"

### 4. 音频生成失败

**症状**: 返回 500 错误或空音频

**可能原因**:
- 模型加载失败
- 文本处理错误
- 音频生成错误

**诊断步骤**:

1. **查看服务日志**
   ```powershell
   Get-Content electron_node\services\piper_tts\logs\tts-service.log -Tail 100
   ```

2. **检查模型加载**
   - 查看日志中的 "Loading model" 信息
   - 确认模型文件完整

3. **测试简单文本**
   ```bash
   curl -X POST http://127.0.0.1:5006/tts \
     -H "Content-Type: application/json" \
     -d '{"text": "Hello", "voice": "en_US-lessac-medium"}'
   ```

### 5. Python API 不可用

**症状**: 日志显示 "WARNING: Piper Python API not available"

**解决方案**:

1. **安装 Piper Python API**
   ```powershell
   pip install piper-tts
   ```

2. **验证安装**
   ```python
   python -c "from piper.voice import PiperVoice; print('Piper Python API available')"
   ```

**说明**:
- Python API 比命令行工具更快
- 支持模型缓存，提高性能
- 推荐使用 Python API

### 6. 中文音素化器不可用

**症状**: 日志显示 "WARNING: ChinesePhonemizer not available"

**解决方案**:

1. **检查文件存在**
   ```powershell
   dir electron_node\services\piper_tts\chinese_phonemizer.py
   ```

2. **检查依赖**
   - 确保 Python 环境正确
   - 确保文件编码为 UTF-8

**说明**:
- 中文音素化器用于 VITS 中文模型
- 如果使用标准 Piper 中文模型，不需要音素化器

## 调试技巧

### 查看详细日志

服务日志位置：`logs/tts-service.log`

关键日志信息：
- 模型加载：`Loading model: ...`
- GPU 使用：`Model using GPU (CUDAExecutionProvider)`
- 合成过程：`Synthesizing text: ...`
- 错误信息：`ERROR: ...`

### 手动测试模型加载

```python
from piper.voice import PiperVoice

model_path = "models/zh/zh_CN-huayan-medium/zh_CN-huayan-medium.onnx"
config_path = "models/zh/zh_CN-huayan-medium/zh_CN-huayan-medium.onnx.json"

try:
    voice = PiperVoice.load(model_path, config_path=config_path, use_cuda=False)
    print("Model loaded successfully!")
    
    # 测试合成
    audio_generator = voice.synthesize("你好")
    audio_chunks = list(audio_generator)
    print(f"Generated {len(audio_chunks)} audio chunks")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
```

### 测试 API 接口

```powershell
# 健康检查
Invoke-WebRequest -Uri "http://127.0.0.1:5006/health" -Method GET

# 列出可用语音
Invoke-WebRequest -Uri "http://127.0.0.1:5006/voices" -Method GET

# TTS 合成
$body = @{
    text = "你好，世界"
    voice = "zh_CN-huayan-medium"
    language = "zh"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://127.0.0.1:5006/tts" -Method POST -Body $body -ContentType "application/json" -OutFile "output.wav"
```

## 环境变量

### PIPER_MODEL_DIR

模型目录路径（默认: `~/piper_models`）

```powershell
$env:PIPER_MODEL_DIR = "D:\path\to\piper_models"
```

### PIPER_USE_GPU

是否启用 GPU 加速（默认: "false"）

```powershell
$env:PIPER_USE_GPU = "true"
```

### PIPER_CMD

piper 命令行工具路径（如果不在 PATH 中）

```powershell
$env:PIPER_CMD = "C:\path\to\piper.exe"
```

## 相关文件

- **服务代码**: `piper_http_server.py`
- **中文音素化器**: `chinese_phonemizer.py`
- **日志文件**: `logs/tts-service.log`
- **模型目录**: `models/`

## 联系支持

如果以上方法都无法解决问题，请提供：
1. 完整的日志文件内容
2. Python 版本 (`python --version`)
3. ONNX Runtime 版本 (`pip show onnxruntime`)
4. 模型文件路径和结构
5. 错误复现步骤

