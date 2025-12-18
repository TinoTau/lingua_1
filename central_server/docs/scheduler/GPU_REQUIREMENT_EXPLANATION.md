# GPU 要求说明

## 问题

用户问：central_server 里不应该有 GPU 的依赖，只有节点端才会启动 GPU。这里的 GPU 配置是什么意思？需要运行一个节点端进行测试吗？

## 解释

### 1. 调度服务器本身不需要 GPU

**调度服务器（central_server/scheduler）本身不需要 GPU**，它只是一个调度服务，负责：
- 接收任务请求
- 选择合适的节点
- 分配任务给节点
- 管理节点状态

### 2. 但是，调度服务器需要知道节点是否有 GPU

**调度服务器要求注册的节点必须有 GPU**，这是因为：

1. **业务逻辑要求**：
   - 只有有 GPU 的节点才能提供算力（AI 推理需要 GPU）
   - 没有 GPU 的节点无法完成翻译任务
   - 因此，调度服务器只接受有 GPU 的节点注册

2. **代码中的要求**：
   ```rust
   // 检查节点是否有 GPU（必需）
   if hardware.gpus.is_none() || hardware.gpus.as_ref().unwrap().is_empty() {
       return Err("节点必须有 GPU 才能注册为算力提供方".to_string());
   }
   ```

3. **节点选择时的检查**：
   ```rust
   // 检查 GPU 可用性
   if node.hardware.gpus.is_none() || node.hardware.gpus.as_ref().unwrap().is_empty() {
       continue; // 排除没有 GPU 的节点
   }
   ```

### 3. 测试中的 GPU 配置

**在测试 central_server 时，默认节点已经启动了 GPU（在测试中模拟），但不需要真的启动 GPU 或节点端服务**。

1. **测试策略**：
   - ✅ 在测试中模拟节点有 GPU（通过 `create_test_hardware()` 函数）
   - ✅ 测试节点注册逻辑（验证节点必须有 GPU 才能注册）
   - ✅ 测试节点选择逻辑（验证节点选择时检查 GPU）
   - ❌ **不需要实际运行节点端服务**
   - ❌ **不需要实际启动 GPU**

2. **测试中的模拟**：
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

3. **为什么这样设计**：
   - 这是单元测试，只需要测试调度服务器的逻辑
   - 节点端的具体实现（如何启动 GPU）不在调度服务器的测试范围内
   - 测试中已经模拟了节点注册的场景，包括节点有 GPU 的情况

## 总结

- ✅ **调度服务器本身不需要 GPU**
- ✅ **调度服务器要求注册的节点必须有 GPU**（业务逻辑要求）
- ✅ **测试中模拟节点有 GPU 是合理的**（单元测试）
- ❌ **不需要运行节点端进行测试**（单元测试不需要实际服务）

## 相关代码位置

- `central_server/scheduler/src/node_registry/mod.rs`:
  - 第 97-106 行：节点注册时的 GPU 检查
  - 第 290-293 行：节点选择时的 GPU 检查
  - 第 385-388 行：节点选择时的 GPU 检查
