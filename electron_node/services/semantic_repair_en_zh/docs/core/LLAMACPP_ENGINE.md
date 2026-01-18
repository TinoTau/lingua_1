# llama.cpp 推理引擎说明

**引擎**: LlamaCppEngine  
**技术**: llama.cpp  
**模型格式**: GGUF  
**量化**: INT4

---

## 📋 概述

本服务使用 **llama.cpp** 作为 LLM 推理引擎，替代 auto-gptq，以解决兼容性问题并提供更好的性能。

---

## 🎯 为什么选择 llama.cpp？

### 对比 auto-gptq

| 特性 | llama.cpp (GGUF) | auto-gptq (GPTQ) |
|------|------------------|------------------|
| **兼容性** | ✅ 优秀 | ❌ PyTorch 版本敏感 |
| **安装难度** | ✅ 简单 | ❌ 复杂（需编译） |
| **GPU 支持** | ✅ 稳定 | ⚠️ 不稳定 |
| **内存占用** | ✅ 低 | ⚠️ 中等 |
| **推理速度** | ✅ 快 | ✅ 快 |
| **模型格式** | GGUF | GPTQ / SafeTensors |
| **跨平台** | ✅ 优秀 | ⚠️ 一般 |

### 优势

1. **兼容性强**
   - 不依赖特定 PyTorch 版本
   - 避免 meta tensor 问题
   - 跨平台支持（Windows/Linux/macOS）

2. **资源占用低**
   - 常驻内存小
   - 适合节点端场景
   - 支持 CPU fallback

3. **部署简单**
   - 预编译 wheel 可用
   - 或从源码编译（稳定）

4. **性能优秀**
   - GPU 推理快（200-500ms）
   - GGUF 格式优化
   - 支持量化（INT4/INT8）

---

## 🔧 引擎架构

### 文件结构

```
engines/
├── llamacpp_engine.py      # LlamaCppEngine 主类
├── prompt_templates.py     # Prompt 模板管理
└── repair_engine.py        # 修复逻辑封装（已弃用，逻辑在 processor 中）
```

### LlamaCppEngine 类

**核心方法**:

```python
class LlamaCppEngine:
    def __init__(self, model_path, n_ctx=2048, n_gpu_layers=-1, verbose=False):
        """初始化引擎并加载模型"""
        self.llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,  # -1 = 全部使用GPU
            verbose=verbose
        )
    
    def repair(self, text_in, micro_context=None, quality_score=None):
        """执行语义修复"""
        prompt = self._build_prompt(text_in, micro_context, quality_score)
        output = self.llm(
            prompt,
            max_tokens=512,
            temperature=0.3,
            stop=["</s>", "\n\n"]
        )
        return self._parse_output(output)
    
    def shutdown(self):
        """清理资源"""
        del self.llm
        gc.collect()
```

---

## 🚀 GPU 支持

### 安装 CUDA 版本

#### 方式 1: 预编译 wheel（推荐）

```bash
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121
```

**支持的 CUDA 版本**:
- cu117 (CUDA 11.7)
- cu118 (CUDA 11.8)
- cu121 (CUDA 12.1)
- cu122 (CUDA 12.2)

#### 方式 2: 从源码编译

```powershell
# Windows
$env:CMAKE_ARGS="-DGGML_CUDA=on"
$env:FORCE_CMAKE=1
pip install llama-cpp-python --no-cache-dir

# Linux/Mac
CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 pip install llama-cpp-python --no-cache-dir
```

**编译要求**:
- Visual Studio 2019+ (Windows)
- GCC 8+ (Linux)
- CUDA Toolkit
- CMake 3.18+

**编译时间**: 30-60 分钟

### 验证 GPU 支持

```python
from llama_cpp import Llama

# 加载模型
llm = Llama(
    model_path="path/to/model.gguf",
    n_gpu_layers=-1,
    verbose=True
)

# 启动日志应该显示:
# ggml_cuda_init: CUDA device 0: NVIDIA RTX 4060 Laptop GPU
# load_tensors: layer 0 assigned to device CUDA
```

---

## ⚙️ 关键参数

### n_ctx（上下文长度）

```python
n_ctx=2048  # 默认
```

**说明**: 
- 模型可处理的最大 token 数
- 越大占用内存越多
- 典型值: 512, 1024, 2048, 4096

**建议**:
- 短文本修复: 512-1024
- 长文本处理: 2048-4096

### n_gpu_layers（GPU 层数）

```python
n_gpu_layers=-1  # 全部使用 GPU
n_gpu_layers=0   # 全部使用 CPU
n_gpu_layers=20  # 前 20 层使用 GPU
```

**说明**:
- -1: 所有层都在 GPU 上（最快）
- 0: 所有层都在 CPU 上（最慢）
- N: 前 N 层在 GPU，其余在 CPU

**显存不足时**:
- 减少 n_gpu_layers
- 或使用更小的模型

### temperature（温度）

```python
temperature=0.3  # 默认
```

**说明**:
- 控制输出的随机性
- 0.0: 完全确定（贪婪搜索）
- 1.0: 完全随机
- 典型值: 0.1-0.5

**建议**:
- 语义修复: 0.1-0.3（需要确定性）
- 创作性任务: 0.7-1.0

### max_tokens（最大输出长度）

```python
max_tokens=512  # 默认
```

**说明**:
- 限制输出的最大 token 数
- 避免无限生成

---

## 🎨 Prompt 工程

### Prompt 模板结构

```python
# prompt_templates.py
REPAIR_TEMPLATE = """
<|im_start|>system
你是一个语义修复助手，用于修复ASR识别错误。
<|im_end|>
<|im_start|>user
请修复以下文本中的错误：
原文：{text_in}
质量分数：{quality_score}
<|im_end|>
<|im_start|>assistant
"""
```

**关键点**:
- 使用 Qwen2.5 的对话格式
- 明确任务目标
- 提供上下文信息

### Prompt 优化建议

1. **明确指令**: 清楚说明要做什么
2. **提供上下文**: 质量分数、微上下文
3. **限制输出**: 要求只输出修复后的文本
4. **格式约束**: 使用 JSON 或特定格式

---

## 🧪 性能优化

### 1. 模型量化

**当前**: INT4 量化（GGUF Q4_0）

**优势**:
- 模型大小: ~2GB（vs FP16 ~6GB）
- 推理速度: 接近 FP16
- 准确率损失: <2%

### 2. GPU 加速

**关键**: 确保 llama-cpp-python 有 CUDA 支持

**性能提升**:
- CPU: ~4000ms/请求
- GPU: ~300ms/请求
- **提升 10-15 倍**

### 3. 批处理（未实现）

**潜在优化**: 
- 批量处理多个请求
- GPU 利用率更高
- 响应延迟增加

**trade-off**: 延迟 vs 吞吐量

---

## 🔍 调试和诊断

### 启用详细日志

```python
# 启动时设置 verbose=True
llm = Llama(
    model_path=model_path,
    n_gpu_layers=-1,
    verbose=True  # 显示详细的加载和推理信息
)
```

**输出示例**:
```
llama_model_load_internal: format     = GGUF V3
llama_model_load_internal: arch       = qwen2
llama_model_load_internal: n_vocab    = 151936
ggml_cuda_init: CUDA device 0: NVIDIA RTX 4060 Laptop GPU
load_tensors: layer 0 assigned to device CUDA
```

### 监控推理性能

```python
import time

start = time.time()
result = engine.repair(text_in="测试")
elapsed = time.time() - start

print(f"Inference time: {elapsed*1000:.2f}ms")
```

---

## 📚 参考资源

### 官方文档
- [llama.cpp GitHub](https://github.com/ggerganov/llama.cpp)
- [llama-cpp-python](https://github.com/abetlen/llama-cpp-python)
- [GGUF 格式说明](https://github.com/ggerganov/ggml/blob/master/docs/gguf.md)

### 模型资源
- [Qwen2.5 模型](https://huggingface.co/Qwen)
- [GGUF 量化模型](https://huggingface.co/models?search=gguf)

---

**更新**: 2026-01-19  
**维护**: 开发团队
