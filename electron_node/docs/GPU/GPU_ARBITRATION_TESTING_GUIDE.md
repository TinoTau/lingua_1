# GPU仲裁器测试指南

## 1. 启用GPU仲裁器

### 1.1 修改配置文件

编辑配置文件：`%APPDATA%\electron-node\electron-node-config.json`

添加或修改以下配置：

```json
{
  "gpuArbiter": {
    "enabled": true,
    "gpuKeys": ["gpu:0"],
    "defaultQueueLimit": 8,
    "defaultHoldMaxMs": 8000,
    "policies": {
      "ASR": {
        "priority": 90,
        "maxWaitMs": 3000,
        "busyPolicy": "WAIT"
      },
      "NMT": {
        "priority": 80,
        "maxWaitMs": 3000,
        "busyPolicy": "WAIT"
      },
      "TTS": {
        "priority": 70,
        "maxWaitMs": 2000,
        "busyPolicy": "WAIT"
      },
      "SEMANTIC_REPAIR": {
        "priority": 20,
        "maxWaitMs": 400,
        "busyPolicy": "SKIP"
      }
    }
  }
}
```

### 1.2 重启节点端

修改配置后，需要重启节点端才能生效。

## 2. 验证GPU仲裁器是否启用

### 2.1 检查日志

查看节点端日志文件（通常在 `%APPDATA%\electron-node\logs\` 目录下），搜索以下关键词：

- `GpuArbiter initialized` - 表示GPU仲裁器已初始化
- `GpuArbiter: Lease acquired` - 表示成功获取GPU租约
- `GpuArbiter: Lease released` - 表示GPU租约已释放
- `GpuArbiter: GPU busy, skipping` - 表示GPU忙碌，任务被跳过（SKIP策略）

### 2.2 检查配置加载

在日志中搜索 `GpuArbiter initialized`，应该看到类似以下内容：

```
GpuArbiter initialized: enabled=true, gpuKeys=["gpu:0"], defaultQueueLimit=8, defaultHoldMaxMs=8000
```

## 3. 功能测试

### 3.1 基本功能测试

1. **发送翻译任务**
   - 通过客户端发送一些翻译任务
   - 观察任务处理是否正常

2. **检查GPU租约获取**
   - 在日志中搜索 `GpuArbiter: Lease acquired`
   - 应该看到每个GPU任务（ASR、NMT、TTS）都会获取租约

3. **检查GPU租约释放**
   - 在日志中搜索 `GpuArbiter: Lease released`
   - 任务完成后应该看到租约被释放

### 3.2 并发测试

1. **发送多个并发任务**
   - 同时发送多个翻译任务
   - 观察任务是否按优先级排队

2. **检查队列状态**
   - 在日志中搜索 `GpuArbiter: Request dequeued`
   - 应该看到任务按优先级顺序处理

### 3.3 忙时降级测试（Semantic Repair）

1. **触发GPU忙碌场景**
   - 发送大量ASR/NMT任务，使GPU忙碌
   - 观察语义修复任务的行为

2. **检查SKIP策略**
   - 在日志中搜索 `GpuArbiter: GPU busy, skipping`
   - 语义修复任务应该被跳过（SKIP策略）

3. **验证不影响主链路**
   - ASR和NMT任务应该正常处理
   - 语义修复被跳过不应该影响翻译流程

## 4. 性能测试

### 4.1 延迟测试

1. **测量任务处理延迟**
   - 记录任务从开始到完成的时间
   - 对比启用GPU仲裁器前后的延迟

2. **预期改善**
   - 理想情况下，延迟应该降低或不升高
   - 特别是在高并发场景下

### 4.2 吞吐量测试

1. **测量吞吐量**
   - 记录单位时间内处理的任务数
   - 对比启用GPU仲裁器前后的吞吐量

2. **预期改善**
   - 吞吐量应该提升或不降低
   - 特别是在流水线并行场景下

## 5. 监控指标

### 5.1 关键指标

在日志中搜索以下指标关键词：

- `gpu_arbiter_acquire_total` - 租约获取总数
- `gpu_arbiter_queue_wait_ms` - 队列等待时间
- `gpu_arbiter_hold_ms` - GPU占用时间
- `gpu_arbiter_timeouts_total` - 超时次数
- `gpu_arbiter_queue_full_total` - 队列满次数

### 5.2 获取快照

可以通过代码获取GPU仲裁器快照（需要添加IPC接口）：

```typescript
const arbiter = getGpuArbiter();
const snapshot = arbiter?.snapshot('gpu:0');
console.log(snapshot);
```

## 6. 常见问题

### 6.1 GPU仲裁器未启用

**症状**: 日志中没有 `GpuArbiter initialized` 记录

**解决方法**:
1. 检查配置文件中的 `gpuArbiter.enabled` 是否为 `true`
2. 重启节点端

### 6.2 任务被跳过

**症状**: 看到 `GpuArbiter: GPU busy, skipping` 日志

**说明**: 这是正常行为，特别是对于低优先级任务（如Semantic Repair）

**解决方法**: 
- 如果希望任务等待，可以修改 `busyPolicy` 为 `WAIT`
- 如果希望回退到CPU，可以修改 `busyPolicy` 为 `FALLBACK_CPU`（需要服务支持）

### 6.3 任务超时

**症状**: 看到 `GpuArbiter: Request timeout in queue` 日志

**解决方法**:
1. 增加 `maxWaitMs` 配置值
2. 检查GPU是否真的忙碌
3. 考虑增加队列长度限制

## 7. 测试检查清单

- [ ] GPU仲裁器已启用（`gpuArbiter.enabled = true`）
- [ ] 节点端已重启
- [ ] 日志中有 `GpuArbiter initialized` 记录
- [ ] 发送翻译任务后，日志中有 `GpuArbiter: Lease acquired` 记录
- [ ] 任务完成后，日志中有 `GpuArbiter: Lease released` 记录
- [ ] 并发任务按优先级处理
- [ ] 语义修复任务在GPU忙碌时被跳过（SKIP策略）
- [ ] 主链路（ASR/NMT）任务正常处理
- [ ] 任务处理延迟未增加
- [ ] 无异常错误日志

## 8. 测试报告模板

```
测试日期: YYYY-MM-DD
测试人员: XXX
节点端版本: XXX

配置:
- GPU仲裁器启用: [是/否]
- GPU Keys: [gpu:0]
- 队列限制: [8]
- 策略配置: [ASR/NMT/TTS/SEMANTIC_REPAIR]

测试结果:
- 基本功能: [通过/失败]
- 并发测试: [通过/失败]
- 忙时降级: [通过/失败]
- 性能测试: [通过/失败]

问题记录:
1. [问题描述]
2. [问题描述]

结论:
[测试结论]
```

## 9. 联系支持

如有问题，请联系开发团队或查看：
- `GPU_ARBITRATION_IMPLEMENTATION.md` - 实现总结
- `GPU_ARBITRATION_TEST_SUMMARY.md` - 单元测试总结
