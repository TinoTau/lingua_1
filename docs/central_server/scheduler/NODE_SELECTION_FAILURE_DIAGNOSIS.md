# 节点选择失败诊断指南

## 错误信息

```
WARN 节点选择失败（类型选择）：没有找到可用节点，请检查节点是否具备所需能力类型
```

## 可能的原因

根据调度服务器的节点选择逻辑，节点被排除的原因包括：

### 1. 节点状态不是 `ready`
- **检查点**: 节点的 `status` 必须是 `"ready"`
- **可能原因**: 
  - 节点刚注册，还在 `"registering"` 状态
  - 节点健康检查失败，被标记为 `"degraded"` 或其他状态
- **解决方法**: 等待节点状态变为 `ready`，或检查节点健康检查日志

### 2. 节点离线 (`offline`)
- **检查点**: 节点的 `online` 字段必须是 `true`
- **可能原因**: 
  - 节点心跳超时
  - 节点连接断开
- **解决方法**: 检查节点是否正常连接，心跳是否正常发送

### 3. 节点没有 GPU (`gpu_unavailable`)
- **检查点**: 节点的 `hardware.gpus` 必须存在且不为空
- **可能原因**: 
  - 节点没有检测到 GPU
  - GPU 信息未正确上报
- **解决方法**: 检查节点的硬件信息上报，确保 GPU 信息正确

### 4. 节点没有安装所需服务类型 (`model_not_available`)
- **检查点**: 节点的 `installed_services` 中必须有匹配的服务类型
- **可能原因**: 
  - 节点没有安装 ASR/NMT/TTS 等服务
  - 服务类型不匹配
- **解决方法**: 检查节点的 `installed_services` 列表

### 5. 节点的能力类型未就绪 (`capability_by_type.ready = false`)
- **检查点**: 节点的 `capability_by_type` 中对应类型的 `ready` 必须是 `true`
- **可能原因**: 
  - 服务没有运行（`status !== 'running'`）
  - 服务不是 GPU 模式（`device !== 'gpu'`）
  - 没有安装该类型的服务
- **解决方法**: 检查节点的 `capability_by_type` 和 `installed_services`

### 6. 节点容量已满 (`capacity_exceeded`)
- **检查点**: 节点的 `current_jobs < max_concurrent_jobs`
- **可能原因**: 节点正在处理的任务数已达到上限
- **解决方法**: 等待任务完成，或增加 `max_concurrent_jobs`

### 7. 节点资源阈值超限 (`resource_threshold_exceeded`)
- **检查点**: CPU/GPU/内存使用率低于阈值
- **可能原因**: 节点资源使用率过高
- **解决方法**: 等待资源释放，或调整资源阈值

## 诊断步骤

### 步骤 1: 检查节点注册日志

查看节点端的注册日志，确认：
- `capability_by_type_count` 是否大于 0
- `installed_services_count` 是否大于 0
- `capabilityByType` 中每个类型的 `ready` 状态

**节点端日志示例**:
```json
{
  "capability_by_type_count": 4,
  "capabilityByType": [
    {"type": "asr", "ready": true, "ready_impl_ids": ["faster-whisper-vad"]},
    {"type": "nmt", "ready": false, "reason": "gpu_impl_not_running"},
    ...
  ],
  "installed_services_count": 3,
  "installed_services": [
    {"service_id": "faster-whisper-vad", "type": "asr", "device": "gpu", "status": "running"},
    ...
  ]
}
```

### 步骤 2: 检查调度服务器日志

查看调度服务器的节点选择日志，确认：
- `total_nodes`: 注册表中的节点总数
- `status_not_ready`: 状态不是 ready 的节点数
- `offline`: 离线的节点数
- `gpu_unavailable`: 没有 GPU 的节点数
- `model_not_available`: 没有所需服务类型的节点数
- `capacity_exceeded`: 容量已满的节点数
- `resource_threshold_exceeded`: 资源超限的节点数
- `best_reason`: 最主要的排除原因

**调度服务器日志示例**:
```
WARN total_nodes=1 status_not_ready=0 offline=0 gpu_unavailable=0 model_not_available=1 capacity_exceeded=0 resource_threshold_exceeded=0 best_reason=ModelNotAvailable required_types=[Asr] "节点选择失败（类型选择）：没有找到可用节点"
```

### 步骤 3: 检查节点的能力类型状态

根据 `getCapabilityByType` 的逻辑，一个服务类型只有在以下条件下才会 `ready: true`：
- 至少有一个该类型的服务
- 该服务是 GPU 模式（`device === 'gpu'`）
- 该服务正在运行（`status === 'running'`）

**检查清单**:
- [ ] 节点是否安装了所需服务类型（ASR/NMT/TTS）？
- [ ] 服务是否配置为 GPU 模式？
- [ ] 服务是否正在运行？
- [ ] 节点的 `capability_by_type` 中对应类型的 `ready` 是否为 `true`？

### 步骤 4: 检查节点状态

查看调度服务器的节点状态日志，确认：
- 节点的 `status` 是否为 `"ready"`
- 节点的 `online` 是否为 `true`
- 节点的健康检查是否通过

## 常见问题

### Q1: 节点注册成功，但 `capability_by_type` 中所有类型都是 `ready: false`

**原因**: 服务没有运行，或不是 GPU 模式

**解决方法**:
1. 检查服务是否正常启动
2. 检查服务配置是否为 GPU 模式
3. 查看服务日志，确认服务状态

### Q2: 节点有 GPU，但 `gpu_unavailable` 计数增加

**原因**: 节点的硬件信息上报中 `gpus` 字段为空或未正确设置

**解决方法**:
1. 检查节点的硬件信息获取逻辑
2. 确认 GPU 信息是否正确上报到调度服务器
3. 查看节点注册消息中的 `hardware.gpus` 字段

### Q3: 节点状态一直是 `registering`，没有变为 `ready`

**原因**: 节点的健康检查失败

**解决方法**:
1. 检查节点的 `installed_services` 是否为空
2. 检查节点的 `capability_by_type` 是否为空
3. 查看调度服务器的健康检查日志

## 调试命令

### 查看节点注册信息
在节点端日志中搜索：
```
"Sending node registration message"
```

### 查看节点心跳信息
在节点端日志中搜索：
```
"Sending heartbeat with type-level capability"
```

### 查看调度服务器节点选择日志
在调度服务器日志中搜索：
```
"节点选择失败（类型选择）"
```

## 相关代码位置

- **节点能力类型构建**: `electron_node/electron-node/main/src/agent/node-agent.ts:513` (`getCapabilityByType`)
- **节点服务获取**: `electron_node/electron-node/main/src/agent/node-agent.ts:405` (`getInstalledServices`)
- **调度服务器节点选择**: `central_server/scheduler/src/node_registry/selection.rs:250` (`select_node_by_type`)
- **节点能力验证**: `central_server/scheduler/src/node_registry/validation.rs:7` (`node_has_required_types_ready`)

