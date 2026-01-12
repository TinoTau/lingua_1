# llama.cpp 实现方案（解决 auto-gptq 兼容性问题）

## 问题背景

当前使用 `auto-gptq` 加载 GPTQ 模型时遇到 meta tensor 兼容性问题：
- `auto-gptq` 0.7.1 与 PyTorch 2.5.1 存在兼容性问题
- 所有加载方式都失败：`Cannot copy out of meta tensor`

## 解决方案

根据 `SEMANTIC_REPAIR_DUAL_ENGINE_AUTOTUNE_SPEC.md` 的建议，使用 `llama.cpp`（GGUF 4bit）作为替代方案。

### 优势
1. **不依赖 auto-gptq**：避免兼容性问题
2. **常驻资源低**：适合节点端场景
3. **GPU 推理支持**：通过 CUDA 后端
4. **Python 绑定成熟**：`llama-cpp-python` 库稳定

### 实现步骤

#### 1. 安装依赖
```bash
pip install llama-cpp-python[cuda]
```

#### 2. 模型转换或下载
- 选项A：将现有 GPTQ 模型转换为 GGUF 格式
- 选项B：下载现成的 GGUF 4bit 模型（如 Qwen2.5-3B-Instruct-GGUF）

#### 3. 实现 llama.cpp 引擎适配器
创建 `llamacpp_engine.py`，实现统一的引擎接口。

#### 4. 修改模型加载逻辑
在 `model_loader.py` 中添加 llama.cpp 加载路径。

## 当前阶段建议

由于用户要求"等功能跑通了再做"，建议：

1. **短期方案**：先尝试修复 auto-gptq 问题
   - 降级 PyTorch 到 2.4.x
   - 或等待 auto-gptq 更新

2. **中期方案**：实现 llama.cpp 引擎（按文档建议）
   - 作为默认主引擎
   - 保留 auto-gptq 作为备用（如果修复成功）

3. **长期方案**：实现双引擎自动切换（按文档完整实现）

## 实施优先级

1. **P0**：解决当前启动问题（短期方案）
2. **P1**：实现 llama.cpp 引擎（中期方案）
3. **P2**：实现双引擎自动切换（长期方案，GPU仲裁后）
