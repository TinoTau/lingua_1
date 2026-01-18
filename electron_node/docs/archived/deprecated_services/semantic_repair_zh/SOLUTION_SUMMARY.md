# GPTQ 兼容性问题解决方案总结

## 问题现状

1. **auto-gptq 0.7.1 与 PyTorch 2.5.1 兼容性问题**
   - 错误：`Cannot copy out of meta tensor; no data!`
   - 所有加载方式（device_map、max_memory、offload_buffers）都失败

2. **降级 auto-gptq 导致依赖冲突**
   - NumPy 版本冲突（需要 < 1.28.0，但环境有 2.2.6）
   - scipy、sklearn 等库不兼容

## 推荐解决方案（按文档建议）

根据 `SEMANTIC_REPAIR_DUAL_ENGINE_AUTOTUNE_SPEC.md` 的建议，使用 **llama.cpp（GGUF 4bit）** 作为替代方案。

### 优势
1. ✅ **不依赖 auto-gptq**：完全避免兼容性问题
2. ✅ **常驻资源低**：适合节点端场景
3. ✅ **GPU 推理支持**：通过 CUDA 后端
4. ✅ **Python 绑定成熟**：`llama-cpp-python` 库稳定
5. ✅ **避免依赖冲突**：独立的依赖树

### 实施步骤

#### 阶段1：快速验证（当前阶段）
1. 安装 `llama-cpp-python[cuda]`
2. 下载或转换 GGUF 4bit 模型
3. 实现简单的 llama.cpp 引擎适配器
4. 修改模型加载逻辑，优先使用 llama.cpp

#### 阶段2：完整实现（后续）
1. 实现双引擎自动切换（按文档）
2. 添加基准测试和运行时监控
3. 实现引擎选择策略

## 当前建议

由于用户要求"等功能跑通了再做"，建议：

1. **立即行动**：实现 llama.cpp 引擎（解决当前问题）
2. **保留接口**：为后续双引擎切换预留接口
3. **暂不实现**：GPU 仲裁模块（按用户要求）

## 实施优先级

- **P0**：实现 llama.cpp 引擎，让服务能够启动 ✅
- **P1**：完善错误处理和日志
- **P2**：实现双引擎自动切换（后续）
- **P3**：实现 GPU 仲裁（后续）

## 参考文档

- `SEMANTIC_REPAIR_DUAL_ENGINE_AUTOTUNE_SPEC.md` - 双引擎方案设计
- `GPU_ARBITRATION_MVP_TECH_SPEC.md` - GPU 仲裁方案（暂不实现）
- `LLAMACPP_IMPLEMENTATION_PLAN.md` - llama.cpp 实施计划
