# Faster Whisper 模型下载指南

**日期**: 2025-12-25  
**状态**: ✅ **模型已下载到本地**

---

## 模型下载状态

✅ **模型已成功下载到本地**
- **模型名称**: `Systran/faster-whisper-large-v3`
- **模型大小**: 约 2.9 GB
- **下载位置**: `models/asr/models--Systran--faster-whisper-large-v3/`
- **下载时间**: 约 1 分钟（取决于网络速度）

---

## 配置说明

### 自动使用本地模型

服务已配置为**自动使用本地缓存的模型**：

1. **缓存目录配置**:
   ```python
   # config.py
   WHISPER_CACHE_DIR = os.path.join(os.path.dirname(__file__), "models", "asr")
   ```

2. **模型路径配置**:
   ```python
   # config.py
   ASR_MODEL_PATH = "Systran/faster-whisper-large-v3"
   ```

3. **工作原理**:
   - faster-whisper 会自动检测缓存目录中的模型
   - 如果模型已存在，直接使用本地缓存
   - 如果模型不存在，会自动从 HuggingFace 下载（但现在已经下载好了）

---

## 下载模型（如果需要重新下载）

### 方法 1：使用 Python 脚本（推荐）

```bash
# Windows
.\download_model.bat

# Linux/Mac
chmod +x download_model.sh
./download_model.sh

# 或直接使用 Python
python download_model.py --model Systran/faster-whisper-large-v3 --output models/asr/faster-whisper-large-v3 --token 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
```

### 方法 2：手动下载

1. **激活虚拟环境**:
   ```bash
   # Windows
   venv\Scripts\activate

   # Linux/Mac
   source venv/bin/activate
   ```

2. **运行下载脚本**:
   ```bash
   python download_model.py \
     --model Systran/faster-whisper-large-v3 \
     --output models/asr/faster-whisper-large-v3 \
     --token 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
   ```

---

## 验证模型是否已下载

### 检查模型文件

```bash
# Windows PowerShell
Get-ChildItem -Path "models\asr\models--Systran--faster-whisper-large-v3" -Recurse | Measure-Object -Property Length -Sum

# Linux/Mac
du -sh models/asr/models--Systran--faster-whisper-large-v3
```

**预期结果**: 目录大小约 2.9 GB

### 检查服务启动日志

启动服务时，日志应该显示：
```
Using HuggingFace model identifier: Systran/faster-whisper-large-v3 (local cache found at ...)
```

如果显示 `(local cache found at ...)`，说明服务会使用本地缓存的模型。

---

## 模型位置

### 实际存储位置

```
electron_node/services/faster_whisper_vad/
├── models/
│   └── asr/
│       └── models--Systran--faster-whisper-large-v3/  # HuggingFace 缓存格式
│           ├── blobs/
│           ├── refs/
│           └── snapshots/
│               └── edaa852ec7e145841d8ffdb056a99866b5f0a478/
│                   ├── config.json
│                   ├── model.bin
│                   ├── tokenizer.json
│                   └── ...
```

### 为什么是这个格式？

- faster-whisper 使用 `huggingface_hub` 库下载模型
- `huggingface_hub` 使用特定的缓存格式：`models--{org}--{model-name}/`
- 这种格式便于版本管理和缓存复用

---

## 服务启动行为

### 首次启动（模型未下载）

1. 服务检测到模型不存在
2. 自动从 HuggingFace 下载模型（使用配置的 token）
3. 将模型保存到缓存目录
4. 加载模型并开始服务

### 后续启动（模型已下载）

1. 服务检测到模型已存在
2. **直接使用本地缓存的模型**（无需重新下载）
3. 加载模型并开始服务

---

## 性能优化建议

### 1. 使用 CUDA（如果可用）

如果系统有 NVIDIA GPU，可以使用 CUDA 加速：

```bash
python download_model.py \
  --model Systran/faster-whisper-large-v3 \
  --output models/asr/faster-whisper-large-v3 \
  --device cuda \
  --compute-type float16 \
  --token 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
```

**优势**:
- 推理速度提升 5-10 倍
- 内存占用减少（float16 vs float32）

### 2. 使用 int8 量化（CPU 模式）

如果只有 CPU，可以使用 int8 量化：

```bash
python download_model.py \
  --model Systran/faster-whisper-large-v3 \
  --output models/asr/faster-whisper-large-v3 \
  --device cpu \
  --compute-type int8 \
  --token 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
```

**优势**:
- 模型大小减少约 75%
- 推理速度提升 2-3 倍
- 准确度略有下降（通常 < 1%）

---

## 故障排除

### 问题 1：模型下载失败

**症状**: 下载脚本报错或超时

**解决方案**:
1. 检查网络连接
2. 验证 HuggingFace token 是否有效
3. 尝试使用代理或 VPN

### 问题 2：服务启动时仍然下载模型

**症状**: 服务启动日志显示正在下载模型

**可能原因**:
1. 缓存目录配置不正确
2. 模型文件损坏或不完整

**解决方案**:
1. 检查 `WHISPER_CACHE_DIR` 配置
2. 验证模型文件是否完整
3. 重新下载模型

### 问题 3：模型文件太大

**症状**: 磁盘空间不足

**解决方案**:
1. 使用 int8 量化版本（模型大小减少约 75%）
2. 清理其他不需要的文件
3. 使用外部存储设备

---

## 相关文件

- **下载脚本**: `download_model.py`
- **Windows 批处理**: `download_model.bat`
- **Linux/Mac 脚本**: `download_model.sh`
- **配置文件**: `config.py`
- **Token 文件**: `hf_token.txt`

---

## 总结

✅ **模型已下载到本地**
- 位置: `models/asr/models--Systran--faster-whisper-large-v3/`
- 大小: 约 2.9 GB
- 格式: HuggingFace 缓存格式

✅ **服务已配置为使用本地模型**
- 启动时自动检测并使用本地缓存
- 无需重新下载

✅ **下载脚本已就绪**
- 支持 Windows/Linux/Mac
- 支持 CUDA/CPU
- 支持多种计算类型

---

## 下一步

1. **重启服务**: 服务会自动使用本地模型
2. **验证**: 检查启动日志确认使用本地模型
3. **测试**: 进行识别准确度测试

