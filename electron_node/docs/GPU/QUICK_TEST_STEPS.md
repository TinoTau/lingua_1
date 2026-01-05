# GPU仲裁器快速测试步骤

## 当前状态检查

根据检查，配置文件不存在，节点端可能使用默认配置（GPU仲裁器默认未启用）。

## 快速测试步骤

### 步骤1: 启用GPU仲裁器

1. 启动节点端（如果尚未启动）
2. 节点端会自动创建配置文件：`%APPDATA%\electron-node\electron-node-config.json`
3. 编辑该配置文件，添加以下内容：

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

### 步骤2: 重启节点端

修改配置后，重启节点端使配置生效。

### 步骤3: 验证初始化

查看日志文件（`%APPDATA%\electron-node\logs\`），搜索：
- `GpuArbiter initialized` - 应该看到GPU仲裁器已初始化

### 步骤4: 发送测试任务

1. 通过客户端发送一些翻译任务
2. 观察日志中的GPU仲裁器记录：
   - `GpuArbiter: Lease acquired` - 租约获取
   - `GpuArbiter: Lease released` - 租约释放

### 步骤5: 检查功能

1. **基本功能**: 任务应该正常处理
2. **并发测试**: 发送多个任务，观察是否按优先级处理
3. **忙时降级**: 发送大量任务，观察语义修复是否被跳过

## 预期日志示例

启用GPU仲裁器后，应该看到类似以下日志：

```
GpuArbiter initialized: enabled=true, gpuKeys=["gpu:0"], defaultQueueLimit=8, defaultHoldMaxMs=8000
GpuArbiter: Lease acquired immediately (gpuKey=gpu:0, taskType=ASR, leaseId=lease_xxx)
GpuArbiter: Lease released (gpuKey=gpu:0, taskType=ASR, leaseId=lease_xxx, holdMs=1234)
```

## 如果遇到问题

1. **GPU仲裁器未初始化**
   - 检查配置文件中 `enabled` 是否为 `true`
   - 检查是否有配置语法错误
   - 重启节点端

2. **没有看到租约记录**
   - 确认已发送翻译任务
   - 检查日志级别是否包含 `debug`
   - 确认GPU仲裁器已启用

3. **任务处理异常**
   - 检查是否有错误日志
   - 确认服务正常运行
   - 检查GPU资源是否充足

## 测试检查清单

- [ ] 配置文件已创建并包含 `gpuArbiter` 配置
- [ ] `gpuArbiter.enabled = true`
- [ ] 节点端已重启
- [ ] 日志中有 `GpuArbiter initialized` 记录
- [ ] 发送任务后，日志中有租约获取/释放记录
- [ ] 任务正常处理完成
- [ ] 无异常错误

## 下一步

完成基本测试后，可以：
1. 进行性能测试（对比启用前后的延迟和吞吐量）
2. 测试并发场景
3. 测试忙时降级策略
4. 监控GPU使用情况

详细测试指南请参考：`GPU_ARBITRATION_TESTING_GUIDE.md`
