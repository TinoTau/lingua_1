# 修复 llama-cpp-python GPU 支持

## 问题诊断

测试发现：
- ✅ CUDA 环境正常（PyTorch 可以检测到 GPU）
- ✅ GPU 硬件正常（RTX 4060 Laptop GPU）
- ❌ **llama-cpp-python 没有 CUDA 支持**（所有层都在 CPU 上运行）

从日志可以看到：
```
load_tensors: layer   0 assigned to device CPU
load_tensors: layer   1 assigned to device CPU
...
llama_kv_cache_unified: layer   0: dev = CPU
```

这导致：
- CPU 使用率极高
- 推理速度慢（~4000ms）
- GPU 未被使用

## 解决方案

### 方法1：重新安装带 CUDA 支持的 llama-cpp-python（推荐）

#### Windows 上安装 CUDA 版本

```powershell
# 1. 卸载当前版本
pip uninstall llama-cpp-python -y

# 2. 设置环境变量（指定 CUDA 版本）
$env:CMAKE_ARGS="-DLLAMA_CUBLAS=on"
$env:FORCE_CMAKE=1

# 3. 安装（会从源码编译，需要 CUDA 工具链）
pip install llama-cpp-python --no-cache-dir

# 或者使用预编译的 wheel（如果有）
# pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121
```

#### 使用预编译 wheel（更简单）

```powershell
# 卸载当前版本
pip uninstall llama-cpp-python -y

# 安装 CUDA 12.1 版本（根据你的 CUDA 版本选择）
pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121

# 或者 CUDA 11.8
# pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu118
```

### 方法2：使用 conda（推荐，避免编译问题）

```powershell
# 使用 conda 安装（会自动处理 CUDA 依赖）
conda install -c conda-forge llama-cpp-python
```

### 方法3：检查已安装的版本

```powershell
# 检查当前安装
python -c "import llama_cpp; print(llama_cpp.__file__)"

# 检查是否有 CUDA 支持
python -c "import llama_cpp; print('CUDA available:', hasattr(llama_cpp, 'LlamaGPU'))"
```

## 验证 GPU 支持

安装后，运行验证脚本：

```powershell
python check_gpu_usage_detailed.py
```

应该看到：
- `load_tensors: layer   0 assigned to device CUDA`（而不是 CPU）
- `llama_kv_cache_unified: layer   0: dev = CUDA`

## 如果仍然无法使用 GPU

### 检查 CUDA 工具链

```powershell
# 检查 CUDA 编译器
nvcc --version

# 检查 CUDA 路径
echo $env:CUDA_PATH
```

### 临时解决方案：使用 CPU（不推荐）

如果无法安装 CUDA 版本，可以临时使用 CPU，但性能会很差：

```python
# 在 llamacpp_engine.py 中
self.llm = Llama(
    model_path=model_path,
    n_ctx=n_ctx,
    n_gpu_layers=0,  # 强制使用 CPU
    ...
)
```

## 性能对比

- **CPU 模式**：~4000ms/请求，CPU 使用率 100%
- **GPU 模式**：~200-500ms/请求，GPU 使用，CPU 使用率低

## 注意事项

1. **CUDA 版本匹配**：确保 llama-cpp-python 的 CUDA 版本与系统 CUDA 版本兼容
2. **编译时间**：从源码编译可能需要 10-30 分钟
3. **依赖项**：编译需要 CMake、C++ 编译器、CUDA 工具链

## 推荐操作步骤

1. **先尝试预编译 wheel**（最快）
   ```powershell
   pip uninstall llama-cpp-python -y
   pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu121
   ```

2. **如果失败，使用 conda**
   ```powershell
   conda install -c conda-forge llama-cpp-python
   ```

3. **最后选择：从源码编译**（需要完整开发环境）

4. **验证安装**
   ```powershell
   python check_gpu_usage_detailed.py
   ```

5. **重启服务并测试**
   ```powershell
   python semantic_repair_zh_service.py
   python test_comprehensive.py
   ```
