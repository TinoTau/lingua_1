# GPU 性能分析

## 问题

用户报告 ASR+NMT+TTS 处理速度很慢（4-9秒），怀疑没有使用 GPU。

## GPU 支持情况

### 1. Whisper ASR（Rust）

**位置**：`electron_node/services/node-inference/Cargo.toml`

**状态**：✅ **已启用 GPU**
- 使用 `whisper-rs = { version = "0.15.1", features = ["cuda"] }`
- 自动检测并使用 CUDA（如果可用）

**验证方法**：
```powershell
# 查看节点日志，应该看到 CUDA 相关的信息
Get-Content "electron_node\electron-node\logs\*.log" | Select-String -Pattern "CUDA|cuda|GPU|gpu"
```

### 2. VAD（Rust）

**位置**：`electron_node/services/node-inference/src/vad.rs`

**状态**：✅ **已启用 GPU**
- 使用 `ort = { version = "2.0.0-rc.10", features = ["cuda"] }`
- 代码中优先尝试使用 CUDA，失败则回退到 CPU

**验证方法**：
查看日志中是否有 "Silero VAD: Using CUDA GPU acceleration" 或 "CUDA not available, falling back to CPU"

### 3. NMT（Python）

**位置**：`electron_node/services/nmt_m2m100/nmt_service.py`

**状态**：✅ **自动检测 GPU**
```python
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
```

**验证方法**：
查看 NMT 服务启动日志，应该看到：
```
[NMT Service] Device: cuda
[NMT Service] [OK] CUDA available: True
[NMT Service] [OK] GPU name: <GPU名称>
```

如果看到 "CUDA not available, using CPU"，说明 GPU 未启用。

### 4. TTS - YourTTS（Python）

**位置**：`electron_node/services/your_tts/yourtts_service.py`

**状态**：⚠️ **默认未启用 GPU**
```python
def get_device(use_gpu=False):  # 默认 False
    if use_gpu:
        if torch.cuda.is_available():
            selected_device = "cuda"
        else:
            selected_device = "cpu"
    else:
        selected_device = "cpu"  # 默认使用 CPU
    return selected_device
```

**问题**：需要找到调用 `get_device()` 的地方，确认是否传入了 `use_gpu=True`

### 5. TTS - Piper（Python）

**位置**：`electron_node/services/piper_tts/piper_http_server.py`

**状态**：⚠️ **通过环境变量控制，默认未启用**
```python
use_gpu = os.environ.get("PIPER_USE_GPU", "false").lower() == "true"
```

**启用方法**：
```powershell
$env:PIPER_USE_GPU = "true"
```

## 诊断步骤

### 1. 检查节点日志

查看各个服务的启动日志，确认 GPU 使用情况：

```powershell
# 查看 NMT 服务日志
Get-Content "electron_node\services\nmt_m2m100\*.log" | Select-String -Pattern "Device|CUDA|GPU"

# 查看 YourTTS 服务日志
Get-Content "electron_node\services\your_tts\*.log" | Select-String -Pattern "device|GPU|CPU"

# 查看节点推理服务日志
Get-Content "electron_node\services\node-inference\logs\*.log" | Select-String -Pattern "CUDA|GPU|device"
```

### 2. 检查 GPU 是否可用

在节点机器上运行：

```powershell
# 检查 NVIDIA 驱动
nvidia-smi

# 检查 PyTorch CUDA 支持（Python）
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'CUDA version: {torch.version.cuda if torch.cuda.is_available() else \"N/A\"}')"

# 检查 CUDA 设备
python -c "import torch; print(f'GPU count: {torch.cuda.device_count() if torch.cuda.is_available() else 0}')"
```

### 3. 检查环境变量

确认启动脚本中是否设置了 GPU 相关的环境变量：

```powershell
# 检查当前环境变量
$env:PIPER_USE_GPU
$env:CUDA_VISIBLE_DEVICES
```

## 性能优化建议

### 1. 启用 YourTTS GPU

需要修改 `yourtts_service.py`，将 `get_device(use_gpu=False)` 改为 `get_device(use_gpu=True)`，或者通过环境变量控制。

### 2. 启用 Piper TTS GPU

在启动脚本中设置：
```powershell
$env:PIPER_USE_GPU = "true"
```

### 3. 检查模型预热

确保模型在启动时已经加载到 GPU，避免首次推理时的延迟。

### 4. 检查批处理

如果可能，使用批处理来提高 GPU 利用率。

## 预期性能

使用 GPU 后，预期处理时间：
- **ASR（Whisper）**：0.5-1.5 秒（取决于音频长度）
- **NMT（M2M100）**：0.5-1.5 秒（取决于文本长度）
- **TTS（YourTTS/Piper）**：0.5-2 秒（取决于文本长度）

**总计**：1.5-5 秒（正常范围）

如果仍然很慢（>10秒），可能的原因：
1. GPU 显存不足，导致频繁的 CPU-GPU 数据传输
2. 模型太大，GPU 无法完全加载
3. 批处理大小不合适
4. GPU 驱动或 CUDA 版本不兼容

## 已完成的修复

### 1. 自动检测并启用 GPU

**位置**：`electron_node/electron-node/main/src/python-service-manager/service-process.ts`

**修复内容**：
- 添加了 `checkCudaAvailable()` 函数，通过 Python 脚本检测 CUDA 是否可用
- 修改了 `buildServiceArgs()` 函数，使其成为 async 函数，在启动服务前检测 CUDA
- 如果 CUDA 可用：
  - **YourTTS**：自动添加 `--gpu` 参数
  - **Piper TTS**：自动设置 `PIPER_USE_GPU=true` 环境变量

**代码变更**：
```typescript
// 检测 CUDA 是否可用
let cudaAvailable = false;
if (pythonExe) {
  cudaAvailable = await checkCudaAvailable(pythonExe);
}

// YourTTS：添加 --gpu 参数
if (cudaAvailable) {
  args.push('--gpu');
}

// Piper TTS：设置环境变量
if (cudaAvailable && config.env) {
  config.env.PIPER_USE_GPU = 'true';
}
```

### 2. 日志记录

添加了日志记录，显示 GPU 检测结果：
- `CUDA detected, GPU acceleration will be enabled`
- `CUDA not available, using CPU`

## 下一步行动

1. **重新编译 Electron 节点**：
   ```powershell
   cd electron_node\electron-node
   npm run build:main
   ```

2. **重启节点**，查看启动日志：
   ```powershell
   # 查看节点日志
   Get-Content "electron_node\electron-node\logs\*.log" | Select-String -Pattern "CUDA|GPU|device"
   ```

3. **查看服务启动日志**：
   ```powershell
   # YourTTS 服务日志
   Get-Content "electron_node\services\your_tts\logs\*.log" | Select-String -Pattern "device|GPU|CPU"
   
   # Piper TTS 服务日志
   Get-Content "electron_node\services\piper_tts\logs\*.log" | Select-String -Pattern "GPU|device"
   
   # NMT 服务日志
   Get-Content "electron_node\services\nmt_m2m100\logs\*.log" | Select-String -Pattern "Device|CUDA|GPU"
   ```

4. **验证 GPU 使用**：
   - 查看日志中是否显示 "Using GPU" 或 "Device: cuda"
   - 使用 `nvidia-smi` 查看 GPU 使用率
   - 重新测试，查看处理时间是否改善

5. **如果仍然慢**：
   - 检查 GPU 使用率（`nvidia-smi`）和显存占用
   - 确认模型是否已加载到 GPU
   - 检查是否有其他进程占用 GPU

