# Semantic Repair ZH Service - 优化总结

## 已完成的优化工作

### 1. 详细日志记录 ✅

#### 启动阶段日志
- ✅ 每个步骤的耗时记录（设备设置、模型路径查找、tokenizer加载、模型加载、warm-up）
- ✅ 时间戳记录（每个关键步骤的开始和结束时间）
- ✅ 资源监控日志（内存、CPU、GPU使用情况）

#### 模型加载日志
- ✅ 加载前后的GPU内存变化监控
- ✅ 如果GPU内存没有增加，会发出警告
- ✅ 加载时间统计

#### 推理过程日志
- ✅ Prompt构建耗时
- ✅ Tokenization耗时
- ✅ 模型生成耗时（model.generate）
- ✅ 解码耗时
- ✅ 推理前后的GPU内存变化

### 2. 诊断端点 ✅

新增 `/diagnostics` 端点，提供详细的诊断信息：

```bash
GET http://127.0.0.1:5013/diagnostics
```

返回信息包括：
- 设备类型和名称
- GPU内存使用情况（已分配、已保留、总内存）
- 模型所在设备
- 模型数据类型
- 是否启用量化
- 进程内存使用
- CUDA可用性

### 3. GPU内存监控 ✅

#### 模型加载时
- 记录加载前的GPU内存状态
- 记录加载后的GPU内存状态
- 如果GPU内存没有增加，发出警告

#### 推理过程中
- 记录推理前的GPU内存状态
- 记录推理后的GPU内存状态
- 显示内存变化量

### 4. 启动日志捕获脚本 ✅

创建了 `capture_startup_logs.ps1` 脚本，用于：
- 启动服务并捕获所有输出
- 将日志保存到 `logs/startup_YYYYMMDD_HHMMSS.log` 文件
- 实时显示服务状态

使用方法：
```powershell
cd electron_node\services\semantic_repair_zh
.\capture_startup_logs.ps1
```

### 5. 调试和诊断工具 ✅

#### check_service_status.py
- 检查服务健康状态
- 显示进程信息（PID、内存、CPU、运行时间）
- 检查GPU信息
- 测试修复端点

#### check_gpu_usage.py
- 检查推理前后的GPU使用情况
- 帮助诊断GPU内存问题

#### view_logs.ps1
- 查看服务状态
- 查找和显示日志文件
- 检查进程信息

## 使用方法

### 查看启动日志

**方法1：使用调试脚本（推荐）**
```powershell
cd electron_node\services\semantic_repair_zh
.\start_debug.ps1
```

**方法2：使用日志捕获脚本**
```powershell
cd electron_node\services\semantic_repair_zh
.\capture_startup_logs.ps1
```

### 检查服务状态

```powershell
cd electron_node\services\semantic_repair_zh
python check_service_status.py
```

### 检查GPU使用情况

```powershell
cd electron_node\services\semantic_repair_zh
python check_gpu_usage.py
```

### 查看诊断信息

```bash
curl http://127.0.0.1:5013/diagnostics
```

或使用Python：
```python
import requests
import json

response = requests.get('http://127.0.0.1:5013/diagnostics')
print(json.dumps(response.json(), indent=2, ensure_ascii=False))
```

## 日志输出示例

启动时会看到类似以下日志：

```
[Semantic Repair ZH] ===== Starting Semantic Repair Service (Chinese) =====
[Semantic Repair ZH] Timestamp: 2026-01-02 04:32:36
[Semantic Repair ZH] [1/5] Setting up device... (took 0.15s)
[Semantic Repair ZH] [INIT] Memory: 150.23 MB | CPU: 2.5% | GPU Allocated: 0.000 GB
[Semantic Repair ZH] [2/5] Finding model path... (took 0.02s)
[Semantic Repair ZH] [3/5] Loading tokenizer... (took 1.23s)
[Semantic Repair ZH] [4/5] Loading model...
[Semantic Repair ZH] GPU before load - Allocated: 0.000 GB, Reserved: 0.000 GB
[Semantic Repair ZH] Starting model.from_pretrained() at 04:32:40...
[Semantic Repair ZH] Model.from_pretrained() completed at 04:33:15
[Semantic Repair ZH] GPU after load - Allocated: 2.345 GB (+2.345 GB), Reserved: 2.500 GB (+2.500 GB)
[Semantic Repair ZH] Model loaded successfully with INT4 quantization (took 35.23s)
[Semantic Repair ZH] [5/5] Warming up model...
[Repair Engine] Starting repair at 04:33:20 for text: 你好，这是一个测试句子。...
[Repair Engine] Model.generate() completed (took 2.45s, output shape: torch.Size([1, 128]))
[Semantic Repair ZH] ✅ Service is ready (total startup time: 45.67s)
```

## 问题诊断

### GPU内存显示为0 GB

如果看到以下警告：
```
[Semantic Repair ZH] ⚠️  WARNING: GPU memory did not increase significantly after model load!
[Semantic Repair ZH] ⚠️  This may indicate the model is not loaded on GPU or quantization is not working correctly
```

可能的原因：
1. 模型实际在CPU上运行（但代码要求GPU）
2. 量化配置有问题
3. bitsandbytes库的内存追踪问题

解决方法：
1. 检查 `/diagnostics` 端点，查看 `model_device` 字段
2. 检查 `quantization_enabled` 字段
3. 查看完整的启动日志

### 推理时间过长（>5秒）

可能的原因：
1. 首次推理需要编译CUDA kernels（正常，1-5分钟）
2. 模型在CPU上运行
3. 量化配置导致性能下降

解决方法：
1. 查看推理日志，确认每个步骤的耗时
2. 检查 `/diagnostics` 端点，确认模型设备
3. 如果是首次运行，等待CUDA kernels编译完成

## 下一步优化建议

1. **性能优化**
   - 如果GPU内存为0，检查量化配置
   - 优化模型加载参数
   - 考虑使用更高效的量化方法

2. **监控增强**
   - 添加性能指标收集
   - 添加错误率统计
   - 添加请求队列监控

3. **日志改进**
   - 添加日志轮转
   - 添加日志级别控制
   - 添加结构化日志输出

## 文件清单

### 新增文件
- `start_debug.ps1` - 调试启动脚本
- `capture_startup_logs.ps1` - 启动日志捕获脚本
- `check_service_status.py` - 服务状态检查脚本
- `check_gpu_usage.py` - GPU使用情况检查脚本
- `view_logs.ps1` - 日志查看脚本
- `OPTIMIZATION_SUMMARY.md` - 本文档

### 修改文件
- `semantic_repair_zh_service.py` - 添加详细日志、诊断端点
- `model_loader.py` - 添加GPU内存监控
- `repair_engine.py` - 添加推理过程详细日志

## 注意事项

1. **首次启动**：首次启动时，PyTorch需要编译CUDA kernels，可能需要1-5分钟，CPU使用率会很高，这是正常现象。

2. **GPU内存**：使用INT4量化时，`torch.cuda.memory_allocated()` 可能不准确，建议使用 `torch.cuda.memory_reserved()` 或 `nvidia-smi` 来查看实际GPU内存使用。

3. **日志文件**：日志文件会保存在 `logs/` 目录下，建议定期清理旧日志文件。

4. **性能监控**：建议定期检查 `/diagnostics` 端点，确保模型正确加载到GPU上。
