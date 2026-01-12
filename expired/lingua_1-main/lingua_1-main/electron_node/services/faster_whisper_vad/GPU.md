# GPU 配置与性能优化

## GPU 支持

### ✅ 已完全支持 GPU 加速

Faster Whisper VAD 服务完全支持 GPU 加速，使用 GPU 可以获得 **5-15x 的性能提升**。

## 性能提升预期

### Faster Whisper ASR（GPU vs CPU）

| 模型 | CPU 处理速度 | GPU 处理速度 | 加速比 |
|------|-------------|-------------|--------|
| Base | ~2秒/分钟音频 | ~0.1-0.2秒/分钟 | **10-20x** |
| Small | ~4秒/分钟音频 | ~0.2-0.4秒/分钟 | **10-20x** |
| Medium | ~8秒/分钟音频 | ~0.4-0.8秒/分钟 | **10-20x** |
| Large | ~15秒/分钟音频 | ~1-2秒/分钟 | **10-20x** |

### Silero VAD（GPU vs CPU）

- CPU：~1-2ms/帧（32ms 音频）
- GPU：~0.1-0.5ms/帧
- **加速比：2-10x**（批量处理时更明显）

### 整体服务性能

**预计整体性能提升：5-15x**

- ASR 部分：10-20x 加速（主要瓶颈）
- VAD 部分：2-10x 加速（辅助）
- **实际应用：5-15x 整体加速**

## GPU 配置步骤

### 1. 硬件要求

- NVIDIA GPU（支持 CUDA）
- 至少 4GB 显存（Base 模型）
- 推荐 8GB+ 显存（Large 模型）

### 2. 安装 CUDA Toolkit

```powershell
# 检查 CUDA 是否已安装
nvcc --version

# 如果未安装，下载并安装 CUDA Toolkit
# 推荐版本：CUDA 11.8 或 12.x
# 下载地址：https://developer.nvidia.com/cuda-downloads
```

### 3. 安装 GPU 版本的依赖

```powershell
cd electron_node/services/faster_whisper_vad
.\venv\Scripts\Activate.ps1

# 卸载 CPU 版本的 onnxruntime
pip uninstall onnxruntime

# 安装 GPU 版本的 onnxruntime
pip install onnxruntime-gpu>=1.16.0

# faster-whisper 会自动使用 CTranslate2 的 CUDA 支持
# 无需额外安装，但需要确保 CUDA 环境变量正确设置
```

### 4. 验证 GPU 支持

```powershell
python -c "import onnxruntime as ort; print('Providers:', ort.get_available_providers())"
# 应该看到：['CUDAExecutionProvider', 'CPUExecutionProvider']
```

### 5. 设置环境变量（可选）

```powershell
# 设置 CUDA 路径（如果系统未自动检测）
$env:CUDA_PATH = "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v11.8"

# 强制使用 GPU
$env:ASR_DEVICE = "cuda"
$env:ASR_COMPUTE_TYPE = "float16"
```

## 自动检测机制

服务启动时会自动：

1. 检测 `CUDA_PATH` 环境变量
2. 如果存在，自动设置 `ASR_DEVICE=cuda` 和 `ASR_COMPUTE_TYPE=float16`
3. 如果 CUDA 加载失败，自动回退到 CPU

## 性能对比示例

### 场景：处理 1 分钟音频（Base 模型）

| 设备 | 处理时间 | 实时比 |
|------|---------|--------|
| CPU (float32) | ~2秒 | 30x 实时 |
| GPU (float16) | ~0.1-0.2秒 | **300-600x 实时** |

### 场景：处理 10 秒音频（Base 模型）

| 设备 | 处理时间 |
|------|---------|
| CPU | ~200ms |
| GPU | ~10-20ms |

## 注意事项

1. **显存占用**
   - Base 模型：约 0.5-1 GB 显存
   - Large 模型：约 2-4 GB 显存

2. **计算类型**
   - GPU 推荐使用 `float16`（半精度）
   - 性能提升明显，精度损失可忽略
   - CPU 必须使用 `float32`（不支持 float16）

3. **批量处理**
   - GPU 在批量处理时优势更明显
   - 可以同时处理多个音频流

## 实现细节

### ASR GPU 支持

- 使用 `faster-whisper` 库，基于 CTranslate2
- 支持 CUDA GPU 加速
- 通过 `device="cuda"` 和 `compute_type="float16"` 启用 GPU
- 代码已实现自动检测和启用 GPU

### VAD GPU 支持

- 使用 ONNX Runtime
- 支持 CUDAExecutionProvider
- 代码中优先尝试使用 CUDA，失败则回退到 CPU

### 配置位置

- **配置文件**: `config.py`
- **自动检测**: `check_cuda_available()` 函数
- **设备选择**: 根据 CUDA 可用性自动选择 `cpu` 或 `cuda`
- **计算类型**: CPU 使用 `float32`，GPU 使用 `float16`

## 总结

**GPU 使用可行性：✅ 高度可行**

- 代码已完全支持 GPU
- 性能提升显著（5-15x）
- 配置简单，自动检测和回退
- 推荐在有 GPU 的环境中使用

