# GPU仲裁器测试状态

## 当前测试状态

### 1. 节点端状态
- ✅ **节点端正在运行**
  - 进程数: 4个electron进程
  - 启动时间: 2026-01-04 23:52:39

### 2. 配置状态
- ⚠️ **配置文件状态**: 
  - 如果配置文件不存在，节点端会使用默认配置
  - 默认配置中GPU仲裁器是**未启用**的（`enabled: false`）

### 3. 启用GPU仲裁器

要启用GPU仲裁器，需要：

1. **创建/编辑配置文件**: `%APPDATA%\electron-node\electron-node-config.json`

2. **添加以下配置**:
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

3. **重启节点端**（重要！）

### 4. 验证测试

启用并重启后，进行以下验证：

#### 4.1 检查初始化
在日志中搜索：`GpuArbiter initialized`
- 应该看到：`GpuArbiter initialized: enabled=true, gpuKeys=["gpu:0"], ...`

#### 4.2 检查租约获取
发送翻译任务后，在日志中搜索：`GpuArbiter: Lease acquired`
- 应该看到每个GPU任务（ASR、NMT、TTS）都会获取租约

#### 4.3 检查租约释放
任务完成后，在日志中搜索：`GpuArbiter: Lease released`
- 应该看到租约被正确释放

#### 4.4 检查忙时降级
发送大量任务时，在日志中搜索：`GpuArbiter: GPU busy, skipping`
- 语义修复任务应该被跳过（SKIP策略）

### 5. 测试检查清单

- [ ] 配置文件已创建/修改
- [ ] `gpuArbiter.enabled = true`
- [ ] 节点端已重启
- [ ] 日志中有 `GpuArbiter initialized` 记录
- [ ] 发送任务后，日志中有租约获取记录
- [ ] 任务完成后，日志中有租约释放记录
- [ ] 任务正常处理完成
- [ ] 无异常错误

### 6. 日志位置

日志文件通常位于：
- `%APPDATA%\electron-node\logs\`
- `%LOCALAPPDATA\electron-node\logs\`

查找最新的 `.log` 文件。

### 7. 快速测试命令

在PowerShell中运行以下命令检查配置：

```powershell
$configPath = "$env:APPDATA\electron-node\electron-node-config.json"
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.gpuArbiter -and $config.gpuArbiter.enabled) {
        Write-Host "GPU Arbiter is ENABLED" -ForegroundColor Green
    } else {
        Write-Host "GPU Arbiter is DISABLED" -ForegroundColor Yellow
    }
} else {
    Write-Host "Config file not found (using defaults, GPU Arbiter disabled)" -ForegroundColor Yellow
}
```

### 8. 问题排查

如果测试中遇到问题：

1. **GPU仲裁器未初始化**
   - 检查配置文件中 `enabled` 是否为 `true`
   - 确认节点端已重启
   - 检查日志中是否有错误信息

2. **没有看到租约记录**
   - 确认已发送翻译任务
   - 检查日志级别设置
   - 确认GPU仲裁器已启用

3. **任务处理异常**
   - 检查错误日志
   - 确认服务正常运行
   - 检查GPU资源是否充足

## 下一步

1. 启用GPU仲裁器（如未启用）
2. 重启节点端
3. 发送测试任务
4. 观察日志验证功能
5. 进行性能对比测试

详细测试指南请参考：`GPU_ARBITRATION_TESTING_GUIDE.md`
