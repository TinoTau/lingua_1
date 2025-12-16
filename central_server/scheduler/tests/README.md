# 调度服务器测试说明

## 测试策略

### GPU 和节点端模拟

**在测试 central_server 时，默认节点已经启动了 GPU（在测试中模拟），但不需要真的启动 GPU 或节点端服务**。

- ✅ **测试中模拟节点有 GPU**：通过 `create_test_hardware()` 函数模拟节点硬件信息
- ✅ **测试节点注册逻辑**：验证节点必须有 GPU 才能注册
- ✅ **测试节点选择逻辑**：验证节点选择时检查 GPU 可用性
- ❌ **不需要实际运行节点端服务**：这是单元测试，只测试调度服务器逻辑
- ❌ **不需要实际启动 GPU**：测试中只模拟硬件信息，不涉及实际硬件

### 测试文件结构

```
tests/
├── stage1_1.rs          # 阶段 1.1 测试
├── stage1_2.rs          # 阶段 1.2 测试
├── stage2_1_2.rs        # 阶段 2.1.2 测试
└── stage3.2/
    ├── mod.rs
    └── node_selection_test.rs  # 阶段 3.2 节点选择测试
```

### 运行测试

```bash
# 运行所有测试
cargo test

# 运行特定阶段的测试
cargo test --test stage1_1
cargo test --test stage3_2

# 运行特定测试
cargo test --test stage3_2 test_select_node_with_models_ready

# 显示详细输出
cargo test --test stage3_2 -- --nocapture
```

## 相关文档

- `GPU_REQUIREMENT_EXPLANATION.md` - GPU 要求详细说明
- `TEST_GUIDE.md` - 测试指南
