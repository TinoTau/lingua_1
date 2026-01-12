# Faster Whisper VAD 当前模型状态

**日期**: 2025-12-25  
**状态**: ✅ **已使用大模型 (Large-v3)**

---

## 当前配置

### 模型信息

- **模型名称**: `Systran/faster-whisper-large-v3`
- **模型大小**: 约 2.88 GB
- **模型类型**: Large-v3（大模型）
- **参数量**: 约 1.5B 参数

### 模型位置

- **本地缓存**: `models/asr/models--Systran--faster-whisper-large-v3/`
- **配置路径**: `Systran/faster-whisper-large-v3`（HuggingFace 标识符）
- **缓存目录**: `models/asr/`

---

## 配置逻辑

### 自动检测机制

1. **优先使用本地缓存**:
   - faster-whisper 会自动从 HuggingFace 标识符查找缓存目录
   - 如果找到本地缓存，直接使用（无需重新下载）

2. **配置方式**:
   ```python
   # config.py
   ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"  # HuggingFace 标识符
   WHISPER_CACHE_DIR = "models/asr"  # 缓存目录
   ```

3. **工作原理**:
   - faster-whisper 使用 `huggingface_hub` 库
   - `huggingface_hub` 会自动在缓存目录中查找模型
   - 缓存格式：`models--{org}--{model-name}/`
   - 实际路径：`models/asr/models--Systran--faster-whisper-large-v3/`

---

## 验证方法

### 1. 检查模型文件

```bash
# Windows PowerShell
Get-ChildItem -Path "models\asr\models--Systran--faster-whisper-large-v3" -Recurse | Measure-Object -Property Length -Sum

# 预期结果：约 2.88 GB
```

### 2. 检查服务启动日志

启动服务时，日志应该显示：
```
Using HuggingFace model identifier: Systran/faster-whisper-large-v3
Using model cache directory: models/asr
```

### 3. 检查实际加载的模型

服务启动后，在日志中查找：
```
Loading Faster Whisper model in worker process...
Model path: Systran/faster-whisper-large-v3, Device: ..., Compute Type: ...
✅ Faster Whisper model loaded successfully in worker process
```

---

## 模型对比

### Large-v3（当前使用）✅

- **参数量**: 约 1.5B
- **模型大小**: 约 2.88 GB
- **准确度**: 高（接近原项目水平）
- **速度**: 较慢（但可接受）

### Base（之前使用）❌

- **参数量**: 约 74M
- **模型大小**: 约 141 MB
- **准确度**: 较低（比 large-v3 低 20-30%）
- **速度**: 快

---

## 性能考虑

### 资源需求

- **内存**: 约 4-6 GB（模型 + 运行时）
- **GPU**: 推荐使用 CUDA（如果可用）
- **CPU**: 如果使用 CPU，推理速度会较慢

### 优化建议

1. **使用 CUDA GPU**:
   - 设置 `ASR_DEVICE=cuda`
   - 推理速度提升 5-10 倍

2. **使用 float16**:
   - 设置 `ASR_COMPUTE_TYPE=float16`
   - 内存占用减少约 50%

---

## 总结

✅ **当前状态**: 已使用大模型 (Large-v3)

- ✅ 模型已下载到本地（约 2.88 GB）
- ✅ 配置正确（使用 `Systran/faster-whisper-large-v3`）
- ✅ 服务会自动使用本地缓存的模型
- ✅ 识别准确度应该接近原项目水平

---

## 相关文档

- [模型下载指南](./MODEL_DOWNLOAD_GUIDE.md)
- [ASR识别准确度对比](./ASR_ACCURACY_COMPARISON_ORIGINAL_VS_CURRENT.md)

