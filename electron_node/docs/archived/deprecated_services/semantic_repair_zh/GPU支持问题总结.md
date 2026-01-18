# GPU 支持问题总结与解决方案

## 问题诊断

**当前状态**：
- ✅ CUDA 环境正常（PyTorch 可以检测到 GPU）
- ✅ GPU 硬件正常（RTX 4060 Laptop GPU）
- ❌ **llama-cpp-python 没有 CUDA 支持**（所有层都在 CPU 上运行）

**影响**：
- CPU 使用率极高（100%）
- 推理速度慢（~4000ms/请求）
- GPU 未被使用

## 已尝试的解决方案

### 1. 预编译 wheel（失败）
```powershell
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121
```
**结果**：安装成功，但仍然是 CPU 版本

### 2. 从源码编译（进行中/被取消）
```powershell
$env:CMAKE_ARGS="-DGGML_CUDA=on"
$env:FORCE_CMAKE=1
pip install llama-cpp-python --no-cache-dir
```
**结果**：编译时间很长（30+ 分钟），可能被取消或失败

## 推荐解决方案

### 方案 A：完成从源码编译（如果已开始）

如果编译正在进行中，建议：
1. **让编译继续完成**（可能需要 30-60 分钟）
2. **不要中断**编译过程
3. 编译完成后验证 GPU 支持

**继续编译命令**：
```powershell
$env:CMAKE_ARGS="-DGGML_CUDA=on"
$env:FORCE_CMAKE=1
pip install llama-cpp-python --no-cache-dir
```

### 方案 B：使用 conda（推荐，最简单）

conda 通常提供预编译的 CUDA 版本：

```powershell
# 如果有 conda 环境
conda install -c conda-forge llama-cpp-python
```

### 方案 C：临时使用 CPU 模式（不推荐，但可用）

如果无法启用 GPU，可以临时接受 CPU 模式，但性能会很差：

**修改代码**：
```python
# 在 semantic_repair_zh_service.py 中
llamacpp_engine = LlamaCppEngine(
    model_path=gguf_model_path,
    n_ctx=2048,
    n_gpu_layers=0,  # 强制使用 CPU（性能差）
    verbose=False
)
```

### 方案 D：检查是否有更新的预编译版本

访问官方仓库查看是否有新的预编译 CUDA wheel：
- https://github.com/abetlen/llama-cpp-python/releases
- https://abetlen.github.io/llama-cpp-python/whl/

## 编译时间说明

**从源码编译 llama-cpp-python 需要 30-60 分钟是正常的**，因为：

1. **代码量大**：需要编译整个 llama.cpp 库（数万行 C++ 代码）
2. **CUDA 编译**：CUDA 代码编译比普通 C++ 慢
3. **Windows MSVC**：Windows 上的 MSVC 编译器通常比 Linux 的 GCC 慢
4. **依赖链接**：需要链接 CUDA 库、BLAS 库等

**建议**：
- 如果编译正在进行，**耐心等待完成**
- 可以在编译时做其他事情
- 编译完成后会生成 wheel，下次安装会很快

## 验证 GPU 支持

编译/安装完成后，运行：

```powershell
python check_gpu_usage_detailed.py
```

**成功标志**：
- `load_tensors: layer   0 assigned to device CUDA`（而不是 CPU）
- `llama_kv_cache_unified: layer   0: dev = CUDA`
- 推理速度显著提升（从 ~4000ms 降至 ~200-500ms）

## 当前建议

1. **如果编译正在进行**：继续等待完成
2. **如果编译失败或被取消**：
   - 优先尝试 conda（如果有）
   - 或者重新开始编译，并确保有足够时间
3. **如果急需使用**：可以临时使用 CPU 模式，但性能会很差

## 性能对比

| 模式 | 响应时间 | CPU 使用率 | GPU 使用率 |
|------|---------|-----------|-----------|
| CPU 模式 | ~4000ms | 100% | 0% |
| GPU 模式 | ~200-500ms | 低 | 高 |

## 注意事项

1. **编译需要**：
   - Visual Studio 2019/2022（C++ 编译器）
   - CUDA Toolkit
   - CMake
   - 足够的磁盘空间（~5GB 临时文件）

2. **如果编译失败**：
   - 检查 CUDA 路径是否正确
   - 检查 Visual Studio 是否安装
   - 查看完整错误信息

3. **替代方案**：
   - 考虑使用其他推理引擎（如 ExLlamaV2）
   - 或者暂时接受 CPU 模式的性能
