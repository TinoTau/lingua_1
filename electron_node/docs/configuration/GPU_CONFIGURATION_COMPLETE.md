# GPU 加速配置完成 ✅

## 配置状态

### 1. Faster Whisper VAD 服务

**GPU 支持状态**: ✅ 已启用

**已安装依赖**:
- `onnxruntime-gpu>=1.16.0` (已替换 `onnxruntime`)
- `faster-whisper>=1.0.0` (支持 CUDA)

**配置详情**:
- **ASR (Faster Whisper)**: 自动检测 CUDA，使用 `cuda` 设备和 `float16` 计算类型
- **VAD (Silero)**: 使用 `CUDAExecutionProvider` 优先，回退到 CPU

**验证结果**:
- ✅ ONNX Runtime CUDA 提供程序可用
- ✅ Faster Whisper GPU 测试成功

**性能提升预期**:
- ASR: 10-20x 加速
- VAD: 2-10x 加速
- 整体服务: 5-15x 性能提升

### 2. Speaker Embedding 服务

**GPU 支持状态**: ✅ 已启用

**已安装依赖**:
- `torch>=2.0.0` (CUDA 12.1 版本)
- `torchaudio>=2.0.0` (CUDA 12.1 版本)
- `speechbrain>=0.5.16`

**配置详情**:
- 自动检测 CUDA 可用性
- 如果 CUDA 可用，自动添加 `--gpu` 参数启动服务

**验证结果**:
- ✅ PyTorch CUDA 可用
- ✅ GPU 名称: NVIDIA GeForce RTX 4060 Laptop GPU

**性能提升预期**:
- 单次推理: 5-10x 加速
- 批量处理: 10-32x 加速

## 硬件信息

- **GPU**: NVIDIA GeForce RTX 4060 Laptop GPU
- **CUDA 版本**: 12.4 (驱动) / 12.1 (PyTorch)
- **显存**: 8GB

## 配置更改

### 依赖更新

1. **Faster Whisper VAD** (`requirements.txt`):
   - 将 `onnxruntime>=1.16.0` 替换为 `onnxruntime-gpu>=1.16.0`

2. **Speaker Embedding** (`requirements.txt`):
   - 已安装 PyTorch CUDA 版本 (2.5.1+cu121)
   - 已安装 torchaudio CUDA 版本 (2.5.1+cu121)

### 代码配置

1. **Faster Whisper VAD**:
   - 自动检测 CUDA 可用性
   - 如果 CUDA 可用，设置 `ASR_DEVICE=cuda` 和 `ASR_COMPUTE_TYPE=float16`
   - VAD 模型自动使用 `CUDAExecutionProvider`

2. **Speaker Embedding**:
   - 在 `service-process.ts` 中自动检测 CUDA
   - 如果 CUDA 可用，自动添加 `--gpu` 参数

## 使用方法

### 启动服务

服务启动时会自动检测 GPU 并启用加速，无需额外配置。

### 验证 GPU 使用

1. **Faster Whisper VAD**:
   - 查看日志，应该看到 "Faster Whisper model loaded successfully on CUDA"
   - 查看日志，应该看到 "Silero VAD model loaded with CUDA support"

2. **Speaker Embedding**:
   - 查看日志，应该看到 "✅ Using GPU: NVIDIA GeForce RTX 4060 Laptop GPU"

### 手动测试

**Faster Whisper VAD**:
```powershell
cd electron_node\services\faster_whisper_vad
.\venv\Scripts\python.exe -c "from faster_whisper import WhisperModel; model = WhisperModel('base', device='cuda', compute_type='float16'); print('✅ GPU working')"
```

**Speaker Embedding**:
```powershell
cd electron_node\services\speaker_embedding
.\venv\Scripts\python.exe -c "import torch; print('CUDA:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A')"
```

## 注意事项

1. **显存使用**: 
   - Faster Whisper VAD 需要至少 4GB 显存（Base 模型）
   - Speaker Embedding 需要至少 2GB 显存
   - 同时运行两个服务需要约 6-8GB 显存

2. **性能优化**:
   - 如果显存不足，可以降低模型大小或使用 `int8` 计算类型
   - 批量处理时性能提升更明显

3. **故障排除**:
   - 如果 GPU 不可用，服务会自动回退到 CPU
   - 检查 `nvidia-smi` 确认 GPU 状态
   - 检查 CUDA 环境变量是否正确设置

## 完成时间

配置完成时间: 2025-12-23

