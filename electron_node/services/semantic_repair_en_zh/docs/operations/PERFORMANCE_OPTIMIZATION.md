# 性能优化指南

**服务**: semantic-repair-en-zh  
**版本**: 1.0.0

---

## 📊 性能基准

### 响应时间基准

| 场景 | GPU 模式 | CPU 模式 | 说明 |
|------|---------|---------|------|
| 首次请求（冷启动） | ~30秒 | ~30秒 | 模型加载时间 |
| 后续请求（中文修复） | 200-500ms | 2000-4000ms | 推理时间 |
| 后续请求（英文修复） | 200-500ms | 2000-4000ms | 推理时间 |
| 后续请求（英文标准化） | <10ms | <10ms | 规则引擎 |

### 资源占用基准

| 资源 | GPU 模式 | CPU 模式 |
|------|---------|---------|
| GPU 显存 | ~2GB | 0GB |
| 系统内存 | ~1GB | ~1GB |
| CPU 使用率 | 10-30% | 80-100% |
| GPU 使用率 | 80-100% | 0% |

---

## 🚀 优化策略

### 1. 启用 GPU 加速（最重要）

**性能提升**: 10-15倍

**检查 GPU 状态**:
```python
import torch
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"Device: {torch.cuda.get_device_name(0)}")
```

**安装 CUDA 版本**:
```bash
# 预编译 wheel（推荐）
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121

# 或从源码编译
CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 pip install llama-cpp-python --no-cache-dir
```

**验证 GPU 使用**:
```bash
# 启动服务时查看日志
# 应该看到: "assigned to device CUDA"

# 运行时监控
nvidia-smi -l 1
```

详细说明: [故障排查 - GPU 支持](./TROUBLESHOOTING.md#gpu-支持问题)

---

### 2. 优化模型配置

#### n_gpu_layers（GPU 层数）

**默认**: -1（全部使用 GPU）

**优化建议**:

```python
# 显存充足（8GB+）
'n_gpu_layers': -1  # 最快

# 显存有限（4-8GB）
'n_gpu_layers': 24  # 平衡

# 显存不足（<4GB）
'n_gpu_layers': 0   # 使用 CPU
```

**如何选择**:
1. 启动服务，查看显存占用
2. 如果显存不足（OOM），减少层数
3. 如果有余量，可以增加层数

#### n_ctx（上下文长度）

**默认**: 2048

**优化建议**:

```python
# 短文本修复（<100字）
'n_ctx': 512   # 节省内存

# 中等文本（100-300字）
'n_ctx': 1024  # 平衡

# 长文本（>300字）
'n_ctx': 2048  # 默认
```

**trade-off**:
- n_ctx 越小: 内存越少，但可能截断长文本
- n_ctx 越大: 支持更长文本，但占用更多内存

---

### 3. 调整超时时间

**位置**: `config.py`

```python
self.timeout = 30  # 默认 30 秒
```

**推荐值**:

| 模式 | 推荐超时 | 说明 |
|------|---------|------|
| GPU 模式 | 30秒 | 默认值 |
| CPU 模式 | 60秒 | CPU 推理慢 |
| 快速模式 | 10秒 | 仅 normalize |

---

### 4. 预热优化

**当前实现**: 服务启动时自动预热

```python
# zh_repair_processor.py
async def initialize(self):
    # 加载模型
    self.engine = LlamaCppEngine(...)
    
    # 预热（避免首次请求慢）
    warmup_text = "你好，这是一个测试句子。"
    _ = self.engine.repair(warmup_text)
    self.warmed = True
```

**优势**:
- 首次请求不需要额外加载时间
- 验证模型可用性

---

### 5. 并发控制

**当前设置**: `max_concurrency: 1`

**原因**:
- GPU 模型推理是串行的
- 并发请求会排队
- 避免 GPU 内存过载

**如果需要提高吞吐量**:
- 部署多个服务实例
- 使用负载均衡
- 或实现批处理（代码修改）

---

## 🔍 性能诊断

### 1. 响应时间分析

**检查响应时间**:
```bash
time curl -X POST http://localhost:5015/zh/repair \
  -H "Content-Type: application/json" \
  -d '{"job_id":"perf","session_id":"s1","text_in":"测试"}'
```

**性能分级**:
- ✅ 优秀: <500ms
- ✅ 良好: 500-1000ms
- ⚠️ 一般: 1000-2000ms
- ❌ 较差: >2000ms

**改进建议**:
- >2000ms → 检查 GPU 是否启用
- 500-1000ms → 优化 prompt 或减少 n_ctx
- <500ms → 已达到最优

### 2. GPU 使用率分析

**监控命令**:
```powershell
nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.used --format=csv -lms 1000
```

**预期值**:
- 推理时 GPU 利用率: 80-100%
- 空闲时 GPU 利用率: 0-5%
- 显存占用: ~2GB（单模型）

**问题诊断**:
- GPU 利用率始终为 0% → GPU 未启用
- 显存占用 >4GB → 检查是否加载了多个模型
- GPU 利用率 <50% → 可能是 CPU 瓶颈

### 3. 内存使用分析

**监控脚本**:
```python
import psutil
import os

process = psutil.Process(os.getpid())
mem_info = process.memory_info()

print(f"RSS: {mem_info.rss / 1024 / 1024:.2f} MB")
print(f"VMS: {mem_info.vms / 1024 / 1024:.2f} MB")
```

**预期值**:
- 启动时: ~500MB
- 模型加载后: ~1GB
- 运行时稳定: ~1-1.5GB

**问题诊断**:
- 内存持续增长 → 可能有内存泄漏
- 内存 >3GB → 检查 n_ctx 设置

---

## 📈 优化案例

### 案例 1: 从 CPU 模式切换到 GPU 模式

**前**:
- 响应时间: ~3500ms
- CPU 使用率: 100%
- GPU 使用率: 0%

**操作**:
```bash
# 安装 CUDA 版本
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121

# 重启服务
```

**后**:
- 响应时间: ~350ms（**提升 10倍**）
- CPU 使用率: 15%
- GPU 使用率: 90%

### 案例 2: 优化上下文长度

**前**:
- n_ctx: 4096
- 显存占用: ~3GB
- 响应时间: 500ms

**问题**: 大部分文本 <100字，不需要 4096 上下文

**操作**:
```python
# 修改 config.py
'n_ctx': 1024  # 从 4096 改为 1024
```

**后**:
- 显存占用: ~1.5GB（**节省 50%**）
- 响应时间: 300ms（**提升 40%**）

### 案例 3: 选择性启用处理器

**场景**: 只需要英文标准化，不需要语义修复

**操作**:
```bash
export ENABLE_ZH_REPAIR=false
export ENABLE_EN_REPAIR=false
export ENABLE_EN_NORMALIZE=true
python service.py
```

**效果**:
- 启动时间: 30秒 → <1秒
- 内存占用: ~1.5GB → ~100MB
- 响应时间: ~300ms → <10ms

---

## 🎯 性能调优清单

### 初次部署优化

- [ ] 确认 GPU 已启用
- [ ] 验证响应时间 <500ms
- [ ] 检查 GPU 使用率 >80%
- [ ] 预热测试正常

### 持续优化

- [ ] 监控平均响应时间
- [ ] 检查内存泄漏
- [ ] 优化 prompt 长度
- [ ] 调整质量阈值

### 资源受限优化

- [ ] 减少 n_gpu_layers
- [ ] 减小 n_ctx
- [ ] 选择性启用处理器
- [ ] 增加超时时间

---

## 📚 相关文档

- [架构设计](./ARCHITECTURE.md) - 系统架构
- [故障排查](./TROUBLESHOOTING.md) - 问题诊断
- [llama.cpp 引擎](./LLAMACPP_ENGINE.md) - 引擎详解
- [配置参考](./CONFIGURATION.md) - 配置说明

---

**更新**: 2026-01-19  
**维护**: 开发团队
