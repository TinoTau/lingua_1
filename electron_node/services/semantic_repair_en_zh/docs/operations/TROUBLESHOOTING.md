# 故障排查指南

**服务**: semantic-repair-en-zh  
**版本**: 1.0.0

---

## 📋 目录

- [常见问题快速索引](#常见问题快速索引)
- [服务启动问题](#服务启动问题)
- [GPU 支持问题](#gpu-支持问题)
- [性能问题](#性能问题)
- [模型加载问题](#模型加载问题)
- [API 调用问题](#api-调用问题)
- [诊断工具](#诊断工具)

---

## 🔍 常见问题快速索引

| 问题症状 | 可能原因 | 章节链接 |
|---------|---------|---------|
| 服务无法启动 | 模型未找到、端口占用、依赖缺失 | [服务启动问题](#服务启动问题) |
| GPU 未被使用 | llama-cpp-python 无 CUDA 支持 | [GPU 支持问题](#gpu-支持问题) |
| 响应速度慢 | GPU 未启用、CPU 模式 | [性能问题](#性能问题) |
| 模型加载失败 | 文件损坏、路径错误 | [模型加载问题](#模型加载问题) |
| API 返回 503 | 处理器未初始化 | [API 调用问题](#api-调用问题) |

---

## 🚀 服务启动问题

### 问题 1: 模型文件未找到

**错误信息**:
```
[Config] WARNING: zh model not found at: .../models/qwen2.5-3b-instruct-zh-gguf
[Config] Please copy model to: .../models/qwen2.5-3b-instruct-zh-gguf
```

**原因**: 模型文件不存在

**解决方案**:
```powershell
# 运行模型安装脚本
cd semantic_repair_en_zh
.\setup_models.ps1

# 或手动复制
Copy-Item -Path "..\semantic_repair_zh\models\qwen2.5-3b-instruct-zh-gguf" -Destination "models\" -Recurse
Copy-Item -Path "..\semantic_repair_en\models\qwen2.5-3b-instruct-en-gguf" -Destination "models\" -Recurse
```

### 问题 2: 端口被占用

**错误信息**:
```
OSError: [WinError 10048] 通常每个套接字地址(协议/网络地址/端口)只允许使用一次
```

**原因**: 端口 5015 已被占用

**检查端口占用**:
```powershell
netstat -ano | findstr :5015
```

**解决方案**:
```powershell
# 方案 1: 停止占用端口的进程
$processId = (netstat -ano | findstr :5015 | ForEach-Object {$_.Trim() -split '\s+'} | Select-Object -Last 1)
Stop-Process -Id $processId -Force

# 方案 2: 修改端口（不推荐）
$env:PORT=5016
python service.py
```

### 问题 3: Python 依赖缺失

**错误信息**:
```
ModuleNotFoundError: No module named 'fastapi'
```

**解决方案**:
```bash
# 安装依赖
pip install -r requirements.txt

# 如果使用 GPU，确保安装 CUDA 版本的 llama-cpp-python
# 参考 GPU 支持问题章节
```

---

## 🎮 GPU 支持问题

### 概述

**GPU 支持的重要性**:
- CPU 模式: ~2000-4000ms/请求
- GPU 模式: ~200-500ms/请求
- **性能提升 5-10 倍**

### 问题 1: GPU 未被使用

**诊断方法**:

1. **检查 PyTorch GPU 支持**:
```python
import torch
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"CUDA device: {torch.cuda.get_device_name(0)}")
```

2. **检查 llama-cpp-python GPU 支持**:
```python
from llama_cpp import Llama

# 启动服务并查看日志
# 如果看到 "assigned to device CPU" 则 GPU 未启用
# 应该看到 "assigned to device CUDA"
```

3. **监控 GPU 使用**:
```powershell
# 实时监控
nvidia-smi -l 1

# 在推理时应该看到 GPU 利用率上升
```

**症状**:
- ❌ 所有层显示 `assigned to device CPU`
- ❌ nvidia-smi 显示 GPU 利用率为 0%
- ❌ CPU 使用率接近 100%
- ❌ 响应时间 >2秒

**原因**: llama-cpp-python 安装时未包含 CUDA 支持

**解决方案 A: 使用预编译 CUDA wheel（推荐，最快）**

```powershell
# 卸载现有版本
pip uninstall llama-cpp-python -y

# 安装 CUDA 版本
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121
```

**注意**: 替换 `cu121` 为您的 CUDA 版本（11.7→cu117, 11.8→cu118, 12.1→cu121 等）

**解决方案 B: 从源码编译（最可靠，但耗时）**

```powershell
# 设置编译选项
$env:CMAKE_ARGS="-DGGML_CUDA=on"
$env:FORCE_CMAKE=1

# 从源码安装（需要 30-60 分钟）
pip uninstall llama-cpp-python -y
pip install llama-cpp-python --no-cache-dir --force-reinstall
```

**编译要求**:
- ✅ Visual Studio 2019/2022 (C++ 工具)
- ✅ CUDA Toolkit (与 PyTorch 版本匹配)
- ✅ CMake
- ✅ 足够的时间（30-60 分钟）

**解决方案 C: 使用 conda（简单但需要 conda 环境）**

```bash
conda install -c conda-forge llama-cpp-python
```

**验证 GPU 支持**:

```bash
# 启动服务并查看日志
python service.py

# 应该看到:
# [llama_model_load_internal] ggml_cuda_init: CUDA device 0: NVIDIA RTX 4060 Laptop GPU
# [load_tensors] layer 0 assigned to device CUDA
```

### 问题 2: CUDA 版本不匹配

**错误信息**:
```
CUDA error: CUDA driver version is insufficient for CUDA runtime version
```

**解决方案**:
```powershell
# 检查 CUDA 版本
nvidia-smi  # 查看 Driver Version 和 CUDA Version

# 检查 PyTorch CUDA 版本
python -c "import torch; print(torch.version.cuda)"

# 确保两者兼容
```

### 问题 3: 显存不足

**错误信息**:
```
CUDA out of memory
```

**解决方案**:
```python
# 修改 config.py，减少 GPU 层数
'n_gpu_layers': 20  # 从 -1 改为具体数值

# 或强制使用 CPU
'n_gpu_layers': 0
```

---

## ⚡ 性能问题

### 问题 1: 响应速度慢（>2秒）

**诊断步骤**:

1. **检查 GPU 使用**:
```powershell
nvidia-smi
```

2. **测试响应时间**:
```bash
time curl -X POST http://localhost:5015/zh/repair \
  -H "Content-Type: application/json" \
  -d '{"job_id":"test","session_id":"s1","text_in":"你好"}'
```

3. **查看启动日志**:
```
# GPU 模式应该显示:
[load_tensors] layer 0 assigned to device CUDA

# CPU 模式会显示:
[load_tensors] layer 0 assigned to device CPU
```

**可能原因和解决方案**:

| 原因 | 症状 | 解决方案 |
|------|------|---------|
| GPU 未启用 | CPU 100%, GPU 0% | 参考 [GPU 支持问题](#gpu-支持问题) |
| 并发请求 | 多个请求排队 | 检查 max_concurrency 配置 |
| 模型过大 | 显存不足 | 减少 n_gpu_layers |
| 网络延迟 | API 调用慢 | 检查网络连接 |

### 问题 2: 首次请求超时

**症状**: 第一个请求等待 30+ 秒

**原因**: 模型加载时间（正常现象）

**解决方案**:
```python
# 服务启动时预热（在 lifespan 中）
# 已在代码中实现，不需要额外配置
```

### 问题 3: 内存使用过高

**症状**: 服务占用内存持续增长

**诊断**:
```python
import psutil
import os

process = psutil.Process(os.getpid())
print(f"Memory: {process.memory_info().rss / 1024 / 1024:.2f} MB")
```

**解决方案**:
- 定期重启服务
- 检查是否有内存泄漏
- 调整 n_ctx 参数（减少上下文长度）

---

## 🗄️ 模型加载问题

### 问题 1: 模型文件损坏

**错误信息**:
```
ggml_init_from_file: failed to load model
```

**解决方案**:
```powershell
# 从备份恢复
Copy-Item -Path "models.backup\*" -Destination "models\" -Recurse -Force

# 或重新下载模型
.\setup_models.ps1
```

### 问题 2: 模型格式不兼容

**错误信息**:
```
invalid model file (bad magic)
```

**原因**: GGUF 格式版本不兼容

**解决方案**:
- 升级 llama-cpp-python
- 或使用兼容的模型版本

### 问题 3: 模型加载超时

**症状**: 服务启动时卡住

**原因**: 
- 模型文件过大
- 磁盘 I/O 慢
- GPU 初始化慢

**解决方案**:
- 耐心等待（首次加载需要时间）
- 检查磁盘性能
- 查看启动日志确认进度

---

## 🌐 API 调用问题

### 问题 1: 503 Service Unavailable

**错误响应**:
```json
{
  "detail": "Processor 'zh_repair' not available"
}
```

**原因**: 处理器未初始化或初始化失败

**诊断**:
```bash
# 检查健康状态
curl http://localhost:5015/health

# 查看各处理器状态
curl http://localhost:5015/zh/health
```

**解决方案**:
- 检查模型文件是否存在
- 查看服务启动日志
- 重启服务

### 问题 2: 请求超时

**错误**: 请求等待 30+ 秒后超时

**原因**: 
- 处理器处理时间过长
- GPU 未启用（CPU 模式慢）

**解决方案**:
```python
# 调整超时时间（config.py）
self.timeout = 60  # 从 30 改为 60 秒

# 或启用 GPU 加速
```

### 问题 3: 422 Validation Error

**错误响应**:
```json
{
  "detail": [
    {
      "loc": ["body", "job_id"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

**原因**: 请求参数缺失或格式错误

**解决方案**: 检查请求格式，参考 [API 参考](./API_REFERENCE.md)

---

## 🔧 诊断工具

### 1. 语法检查

```bash
cd semantic_repair_en_zh
python check_syntax.py
```

### 2. 单元测试

```bash
pytest tests/ -v
```

### 3. 健康检查

```bash
# 全局健康
curl http://localhost:5015/health

# 各处理器健康
curl http://localhost:5015/zh/health
curl http://localhost:5015/en/health
```

### 4. GPU 监控

```powershell
# 实时监控
nvidia-smi -l 1

# 详细信息
nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used --format=csv -lms 1000
```

### 5. 性能测试

```bash
# 测试响应时间
for i in {1..10}; do
  time curl -X POST http://localhost:5015/zh/repair \
    -H "Content-Type: application/json" \
    -d "{\"job_id\":\"perf-$i\",\"session_id\":\"s1\",\"text_in\":\"测试\"}"
done
```

---

## 📝 日志分析

### 关键日志模式

**正常启动**:
```
[Unified SR] ===== Starting Unified Semantic Repair Service =====
[Config] Found zh model: .../models/qwen2.5-3b-instruct-zh-gguf/*.gguf
[Config] Found en model: .../models/qwen2.5-3b-instruct-en-gguf/*.gguf
[zh_repair] Loading Chinese model...
[zh_repair] Model warmed up successfully
[Unified SR] Service ready with 3 processor(s)
```

**GPU 已启用**:
```
ggml_cuda_init: CUDA device 0: NVIDIA RTX 4060 Laptop GPU
load_tensors: layer 0 assigned to device CUDA
```

**GPU 未启用**:
```
load_tensors: layer 0 assigned to device CPU  # ← 注意这里
```

**处理器超时**:
```
[zh_repair] TIMEOUT | request_id=... | elapsed_ms=30000 | fallback=PASS
```

**处理器错误**:
```
[zh_repair] ERROR | request_id=... | error=... | fallback=PASS
```

---

## 🆘 获取支持

如果以上方法都无法解决问题：

1. **收集诊断信息**:
   - 服务启动完整日志
   - 错误信息截图
   - 系统环境信息（OS、CUDA 版本、Python 版本）

2. **查看相关文档**:
   - [维护指南](./MAINTENANCE_GUIDE.md)
   - [架构设计](./ARCHITECTURE.md)
   - [API 参考](./API_REFERENCE.md)

3. **联系开发团队**

---

## 📋 问题报告模板

```markdown
### 问题描述
[简短描述问题]

### 环境信息
- OS: Windows 11 / Linux / macOS
- Python: 3.x.x
- CUDA: 12.1
- GPU: NVIDIA RTX 4060

### 复现步骤
1. [步骤1]
2. [步骤2]
3. [步骤3]

### 期望行为
[期望看到什么]

### 实际行为
[实际看到什么]

### 日志输出
```
[粘贴相关日志]
```

### 已尝试的解决方案
- [ ] 重启服务
- [ ] 检查模型文件
- [ ] 查看文档
```

---

**更新**: 2026-01-19  
**维护**: 开发团队
