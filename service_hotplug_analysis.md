# 节点端服务热插拔机制分析报告

## 概述

本报告分析节点端服务热插拔机制，确认用户是否可以随时启动或停止服务，以及调度服务器是否能根据节点端的服务变化重新分配 pool。

## 1. 节点端服务状态变化检测

### 1.1 Python 服务管理器

**文件**: `electron_node/electron-node/main/src/python-service-manager/index.ts`

**机制**:
- `updateStatus()` 方法检测服务 `running` 状态变化
- 当状态从 `false` 变为 `true` 或从 `true` 变为 `false` 时，触发 `onStatusChangeCallback`
- 回调在 `NodeAgent` 中注册

**代码位置**: 第 403-450 行
```typescript
// 如果 running 状态发生变化，触发回调
if (previousRunning !== newRunning && this.onStatusChangeCallback) {
  try {
    this.onStatusChangeCallback(serviceName as PythonServiceName, mergedStatus);
  } catch (error) {
    logger.error({ error, serviceName }, 'Error in onStatusChangeCallback');
  }
}
```

### 1.2 语义修复服务管理器

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

**机制**:
- 语义修复服务管理器也有类似的状态变化回调机制
- 当服务启动或停止时，会触发回调

**代码位置**: 第 244-256 行
```typescript
if (this.semanticRepairServiceManager && typeof this.semanticRepairServiceManager.setOnStatusChangeCallback === 'function') {
  this.semanticRepairServiceManager.setOnStatusChangeCallback((serviceId: string, status: any) => {
    logger.info({ 
      serviceId, 
      running: status.running,
      starting: status.starting,
      port: status.port
    }, '语义修复服务状态变化，触发立即心跳以更新语言能力：serviceId={}, running={}', serviceId, status.running);
    this.heartbeatHandler.triggerImmediateHeartbeat();
  });
}
```

## 2. 心跳机制

### 2.1 立即心跳触发

**文件**: `electron_node/electron-node/main/src/agent/node-agent-heartbeat.ts`

**机制**:
- 服务状态变化时，调用 `heartbeatHandler.triggerImmediateHeartbeat()`
- 防抖机制：2秒内最多触发一次立即心跳（避免频繁触发）
- 心跳消息包含：
  - `installed_services`: 当前所有服务的状态
  - `capability_by_type`: 按服务类型的能力信息
  - `language_capabilities`: 语言能力信息

**代码位置**: 第 201-215 行
```typescript
triggerImmediateHeartbeat(): void {
  // 如果已有待发送的立即心跳，取消它
  if (this.heartbeatDebounceTimer) {
    clearTimeout(this.heartbeatDebounceTimer);
  }

  // 设置新的防抖定时器
  this.heartbeatDebounceTimer = setTimeout(async () => {
    this.heartbeatDebounceTimer = null;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.nodeId) {
      logger.debug({}, 'Triggering immediate heartbeat due to service state change');
      await this.sendHeartbeatOnce();
    }
  }, this.HEARTBEAT_DEBOUNCE_MS);
}
```

### 2.2 心跳消息内容

**文件**: `electron_node/electron-node/main/src/agent/node-agent-heartbeat.ts`

**心跳消息包含**:
- `installed_services`: 所有已安装服务的列表（包括运行状态）
- `capability_by_type`: 按服务类型的能力信息（ASR、NMT、TTS等）
- `language_capabilities`: 支持的语言对列表

**代码位置**: 第 117-136 行

## 3. 调度服务器处理

### 3.1 心跳接收

**文件**: `central_server/scheduler/src/websocket/node_handler/message/register.rs`

**处理流程**:
1. 接收心跳消息
2. 调用 `handle_node_heartbeat()` 处理

**代码位置**: 第 124-149 行

### 3.2 能力同步到 Redis

**文件**: `central_server/scheduler/src/node_registry/core.rs`

**机制**:
- 心跳处理时，会将 `capability_by_type` 同步到 Redis
- 使用 `sync_node_capabilities_to_redis()` 方法
- Redis 中存储节点能力信息，供 Pool 分配逻辑读取

**代码位置**: 第 203 行（节点注册时）
```rust
rt.sync_node_capabilities_to_redis(&final_node_id, &capability_by_type).await;
```

**注意**: 在心跳处理函数中，能力同步应该在 `handle_node_heartbeat` 中完成，但当前实现可能不完整。

### 3.3 Pool 重新分配

**文件**: `central_server/scheduler/src/node_registry/phase3_pool_allocation_impl.rs`

**机制**:
- `phase3_upsert_node_to_pool_index_with_runtime()` 方法会检查节点服务能力
- 从 Redis 读取节点能力（`has_node_capability`）
- 如果服务能力变化（缺少 ASR、NMT 或 TTS），会触发重新分配
- 如果所有必需服务都有效，跳过重新分配（优化）

**代码位置**: 第 41-73 行
```rust
// 如果服务能力变化，需要重新分配
if let Some(rt) = phase2_runtime {
    let has_asr = rt.has_node_capability(node_id, &crate::messages::ServiceType::Asr).await;
    let has_nmt = rt.has_node_capability(node_id, &crate::messages::ServiceType::Nmt).await;
    let has_tts = rt.has_node_capability(node_id, &crate::messages::ServiceType::Tts).await;
    
    // 如果所有必需的服务能力都有效，可以跳过重新分配
    if has_asr && has_nmt && has_tts {
        // 跳过重新分配
        return;
    } else {
        // 节点服务能力变化，需要重新分配 Pool
    }
}
```

## 4. 潜在问题

### 4.1 心跳处理中缺少 Pool 重新分配

**问题**: 
- `handle_node_heartbeat()` 函数目前只调用了 `scheduler.heartbeat()`，没有调用 `phase3_upsert_node_to_pool_index_with_runtime()`
- 虽然注释说"在心跳处理函数中会调用"，但实际代码中没有

**影响**:
- 服务状态变化后，心跳会更新节点状态，但可能不会立即触发 Pool 重新分配
- Pool 重新分配可能只在节点注册时执行，而不是在每次心跳时检查

### 4.2 能力同步时机

**问题**:
- `update_node_heartbeat()` 方法中，能力同步的注释说"实际同步在 handle_node_heartbeat 中完成"
- 但 `handle_node_heartbeat()` 中没有看到能力同步的代码

**影响**:
- 服务能力变化可能不会及时同步到 Redis
- Pool 分配逻辑从 Redis 读取的能力信息可能不是最新的

## 5. 结论

### ✅ 已实现的功能

1. **节点端服务状态检测**: ✅ 已实现
   - Python 服务管理器检测状态变化
   - 语义修复服务管理器检测状态变化
   - 状态变化时触发回调

2. **立即心跳触发**: ✅ 已实现
   - 服务状态变化时触发立即心跳（带防抖）
   - 心跳消息包含完整的服务能力信息

3. **Pool 分配逻辑**: ✅ 已实现
   - Pool 分配逻辑会检查节点服务能力
   - 如果能力变化，会触发重新分配

### ⚠️ 潜在问题

1. **心跳处理不完整**: 
   - `handle_node_heartbeat()` 可能没有同步能力到 Redis
   - 可能没有触发 Pool 重新分配

2. **延迟更新**:
   - 即使心跳触发了，Pool 重新分配可能不会立即执行
   - 可能需要等待下一次 Pool 分配检查

## 6. 建议

### 6.1 修复心跳处理

在 `handle_node_heartbeat()` 中添加：
1. 同步能力到 Redis（`sync_node_capabilities_to_redis`）
2. 触发 Pool 重新分配（`phase3_upsert_node_to_pool_index_with_runtime`）

### 6.2 验证机制

添加测试验证：
1. 节点启动/停止服务
2. 检查心跳是否包含最新能力信息
3. 检查 Redis 中的能力信息是否更新
4. 检查 Pool 分配是否更新

## 7. 总结

**当前状态**: 
- 节点端服务热插拔机制**基本实现**，但可能**不完整**
- 服务状态变化会触发心跳，但调度服务器可能不会立即响应

**建议**:
- 检查并修复 `handle_node_heartbeat()` 函数，确保能力同步和 Pool 重新分配
- 添加测试验证完整流程
