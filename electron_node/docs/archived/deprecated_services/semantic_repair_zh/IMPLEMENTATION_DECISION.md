# 实施决策记录

## 决策：不降级 PyTorch，使用 llama.cpp 方案

### 决策时间
2026-01-02

### 背景
- `auto-gptq` 0.7.1 与 PyTorch 2.5.1 存在兼容性问题
- 降级 PyTorch 到 2.4.x 可能影响其他服务

### 影响分析

#### 使用 PyTorch 的服务
1. **semantic_repair_zh** - 强制要求 GPU，需要 PyTorch 2.0.0+
2. **semantic_repair_en** - 强制要求 GPU，需要 PyTorch 2.0.0+
3. **nmt_m2m100** - 支持 GPU，需要 PyTorch 2.0.0+
4. **your_tts** - 支持 GPU，需要 PyTorch 1.12.0+
5. **speaker_embedding** - 支持 GPU，需要 PyTorch 2.0.0+，torchaudio<2.9.0

#### 降级 PyTorch 的风险
- ❌ 可能影响 NMT 服务的 CUDA 支持
- ❌ 可能影响 TTS 服务的功能
- ❌ 可能影响 Speaker Embedding 服务
- ❌ 需要回滚的风险高

### 决策

**采用 llama.cpp（GGUF 4bit）方案，不降级 PyTorch**

### 理由
1. ✅ **不影响其他服务**：保持 PyTorch 2.5.1+cu121
2. ✅ **完全避免兼容性问题**：不依赖 auto-gptq
3. ✅ **符合文档建议**：`SEMANTIC_REPAIR_DUAL_ENGINE_AUTOTUNE_SPEC.md` 推荐使用 llama.cpp
4. ✅ **常驻资源低**：适合节点端场景
5. ✅ **避免依赖冲突**：独立的依赖树

### 实施步骤
1. 安装 llama-cpp-python（使用 conda 或预编译包）
2. 下载 GGUF 4bit 模型
3. 实现 llama.cpp 引擎适配器
4. 修改模型加载逻辑
5. 测试服务启动和其他服务兼容性

### 回滚计划
如果 llama.cpp 方案实施失败：
1. 保持 PyTorch 2.5.1+cu121
2. 等待 auto-gptq 更新修复兼容性问题
3. 或考虑使用 ExLlamaV2 作为备选方案

### 验证清单
- [ ] PyTorch 2.5.1+cu121 已恢复
- [ ] CUDA 可用
- [ ] NMT 服务可以正常使用 CUDA
- [ ] TTS 服务可以正常使用 CUDA
- [ ] Speaker Embedding 服务可以正常使用 CUDA
- [ ] llama.cpp 引擎实现完成
- [ ] semantic_repair_zh 服务可以正常启动
