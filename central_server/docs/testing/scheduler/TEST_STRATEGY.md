# 测试策略说明

## 核心原则

**在测试 central_server 时，默认节点已经启动了 GPU（在测试中模拟），但不需要真的启动 GPU 或节点端服务。**

## 测试设计

### 1. 节点硬件模拟

所有测试使用 `create_test_hardware()` 函数模拟节点硬件信息：

```rust
fn create_test_hardware() -> HardwareInfo {
    HardwareInfo {
        cpu_cores: 8,
        memory_gb: 16,
        gpus: Some(vec![GpuInfo {
            name: "Test GPU".to_string(),
            memory_gb: 8,
        }]),  // 模拟节点有 GPU
    }
}
```

### 2. 为什么这样设计

- ✅ **单元测试的目的**：只测试调度服务器的逻辑，不涉及实际硬件
- ✅ **隔离性**：测试不依赖外部服务（节点端、GPU）
- ✅ **可重复性**：测试可以在任何环境运行，不需要 GPU
- ✅ **快速执行**：不需要启动实际服务，测试运行更快

### 3. 测试覆盖

测试覆盖以下场景：
- 节点注册（验证必须有 GPU 才能注册）
- 节点选择（验证选择时检查 GPU 可用性）
- 模型匹配（验证节点是否有所需模型）
- 资源检查（验证 CPU/GPU/内存使用率）

### 4. 不需要的内容

- ❌ **不需要实际运行节点端服务**
- ❌ **不需要实际启动 GPU**
- ❌ **不需要真实的硬件环境**

## 相关文档

- `GPU_REQUIREMENT_EXPLANATION.md` - GPU 要求详细说明
- `tests/README.md` - 测试文件说明
