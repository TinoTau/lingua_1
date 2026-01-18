# 移除SKIP策略修复

## 问题

用户明确指出：
1. GPU忙时，应该通过通知调度服务器停止分配任务来解决
2. 节点端不应该有跳过服务或丢弃任务的行为
3. 这直接涉及用户体验，绝对不允许发送

## 修复内容

### 1. 移除GPU仲裁器中的所有SKIP策略

**文件**: `electron_node/electron-node/main/src/gpu-arbiter/gpu-arbiter.ts`

**修改**:
- 移除了低优先级任务在GPU使用率高时的SKIP策略
- 移除了GPU被占用时的SKIP策略
- 所有任务都必须进入队列等待，不能跳过

**关键变更**:
```typescript
// 之前：低优任务直接SKIP
if (busyPolicy === "SKIP") {
  return { status: "SKIPPED", reason: "GPU_USAGE_HIGH" };
}

// 现在：所有任务都必须等待
logger.info({
  note: 'Low-priority task will wait in queue. Scheduler should stop assigning new tasks based on heartbeat resource usage.',
}, 'GpuArbiter: GPU usage high, low-priority task will wait in queue');
return this.enqueueRequest(gpuKey, request, maxWaitMs);
```

### 2. 移除语义修复中的SKIP策略处理

**文件**: `electron_node/electron-node/main/src/agent/postprocess/semantic-repair-stage-zh.ts`

**修改**:
- 移除了SKIP策略的处理逻辑
- 移除了FALLBACK_CPU策略的处理逻辑（未实现）
- 如果GPU租约获取失败，抛出错误而不是返回PASS

### 3. 修改GPU仲裁器配置

**文件**: `electron_node/electron-node/main/src/gpu-arbiter/gpu-arbiter-factory.ts`

**修改**:
- 将`SEMANTIC_REPAIR`的`busyPolicy`从`"SKIP"`改为`"WAIT"`
- 将`maxWaitMs`从`400ms`增加到`8000ms`（8秒）

### 4. 在心跳中添加GPU队列信息

**文件**: `electron_node/electron-node/main/src/agent/node-agent-heartbeat.ts`

**修改**:
- 添加了GPU队列长度的获取逻辑
- 在心跳消息中包含`gpu_queue_length`字段
- 当GPU队列有任务等待时，记录警告日志

**文件**: `electron_node/shared/protocols/messages.ts`

**修改**:
- 在`ResourceUsage`接口中添加了`gpu_queue_length?: number`字段

### 5. 修复无效GPU key的处理

**文件**: `electron_node/electron-node/main/src/gpu-arbiter/gpu-arbiter.ts`

**修改**:
- 当GPU key无效时，抛出错误而不是返回SKIPPED（这是配置错误，不是资源忙的问题）

## 预期效果

1. **所有任务都必须等待**：GPU忙时，所有任务都会进入队列等待，不会跳过
2. **调度服务器会收到通知**：心跳中包含GPU队列长度，调度服务器可以根据这个信息停止分配新任务
3. **更好的错误处理**：配置错误会抛出异常，而不是静默跳过

## 注意事项

1. **等待时间**：如果GPU真的非常忙，8秒的等待时间可能会导致任务延迟
2. **调度服务器支持**：需要确保调度服务器能够处理`gpu_queue_length`字段，并根据这个信息停止分配新任务
3. **向后兼容**：`gpu_queue_length`字段是可选的，如果调度服务器不支持，可以忽略

## 测试建议

1. **正常情况**：确认所有任务都能正常执行
2. **GPU忙时**：确认所有任务都会等待，不会跳过
3. **心跳信息**：确认心跳中包含GPU队列长度信息
4. **调度服务器**：确认调度服务器能够根据GPU队列长度停止分配新任务
