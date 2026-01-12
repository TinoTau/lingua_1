# PyTorch CUDA 安装指南

本文档说明如何为各个服务安装支持 CUDA 的 PyTorch 版本。

## 服务分类

### 1. 强制要求 GPU 的服务

以下服务**必须**安装 CUDA 版本的 PyTorch：

- **semantic_repair_zh** (中文语义修复)
- **semantic_repair_en** (英文语义修复)

这些服务在启动时会检查 CUDA 可用性，如果不可用会直接失败。

### 2. 支持 GPU 加速的服务（可选）

以下服务支持 GPU 加速，但可以在 CPU 模式下运行：

- **nmt_m2m100** (NMT 翻译服务)
- **your_tts** (YourTTS 语音克隆)
- **speaker_embedding** (说话人嵌入)

### 3. 不使用 PyTorch 的服务

以下服务不直接使用 PyTorch：

- **faster_whisper_vad** (使用 `faster-whisper` 和 `onnxruntime-gpu`)
- **piper_tts** (使用 `onnxruntime`)
- **en_normalize** (纯规则，不需要 GPU)

## 安装 CUDA 版本的 PyTorch

### 步骤 1: 确认 CUDA 版本

首先检查系统的 CUDA 版本：

```powershell
nvidia-smi
```

查看 "CUDA Version" 行，例如 "12.4" 或 "11.8"。

### 步骤 2: 选择对应的 PyTorch 版本

根据 CUDA 版本选择安装命令：

#### CUDA 12.1/12.4 (推荐)

```bash
pip install torch>=2.0.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

#### CUDA 11.8

```bash
pip install torch>=2.0.0 torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

### 步骤 3: 验证安装

安装后验证 CUDA 是否可用：

```python
import torch
print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"CUDA version: {torch.version.cuda}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
```

## 各服务安装说明

### semantic_repair_zh / semantic_repair_en

**强制要求 GPU**，必须安装 CUDA 版本：

```bash
cd electron_node/services/semantic_repair_zh
pip install torch>=2.0.0 --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

### nmt_m2m100

支持 GPU 加速（可选）：

```bash
cd electron_node/services/nmt_m2m100
# 如果需要 GPU，先安装 CUDA 版本的 PyTorch
pip install torch>=2.0.0 --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

### your_tts

支持 GPU 加速（可选）：

```bash
cd electron_node/services/your_tts
# 如果需要 GPU，先安装 CUDA 版本的 PyTorch
pip install torch>=1.12.0 --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

### speaker_embedding

支持 GPU 加速（可选）：

```bash
cd electron_node/services/speaker_embedding
# 如果需要 GPU，先安装 CUDA 版本的 PyTorch
pip install torch>=2.0.0 torchaudio<2.9.0 --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements.txt
```

## 常见问题

### Q: 如何确认当前安装的 PyTorch 是否支持 CUDA？

A: 运行以下命令：

```python
import torch
print(torch.cuda.is_available())  # 应该返回 True
print(torch.version.cuda)  # 应该显示 CUDA 版本号，而不是 None
```

### Q: 安装 CUDA 版本后仍然显示 CUDA 不可用？

A: 可能的原因：
1. PyTorch 版本与 CUDA 驱动版本不匹配
2. 需要重启 Python 进程或服务
3. CUDA 驱动未正确安装

### Q: 可以同时安装 CPU 和 GPU 版本的 PyTorch 吗？

A: 不可以。只能安装一个版本。如果需要切换，需要先卸载再重新安装。

## 注意事项

1. **版本兼容性**: 确保 PyTorch 的 CUDA 版本与系统的 CUDA 驱动版本兼容
2. **虚拟环境**: 建议每个服务使用独立的虚拟环境，避免依赖冲突
3. **显存管理**: 多个服务同时使用 GPU 时，注意显存分配，避免 OOM 错误
