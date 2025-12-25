# 超时问题分析报告

**日期**: 2025-12-25  
**状态**: 🔍 **问题已定位**

---

## 问题现象

调度服务器终端显示两个警告：

1. **Session idle timeout**:
   ```
   WARN Session idle timeout, closing actor 
   session_id=s-13FCFE78 
   idle_secs=66
   ```

2. **Job pending timeout**:
   ```
   WARN Job pending 超时，标记失败 
   trace_id=b2623b14-eb5e-464c-8a28-817784791d5c 
   job_id=job-966BC189 
   session_id=s-13FCFE78 
   utterance_index=0 
   node_id=None 
   pending_timeout_seconds=10
   ```

---

## 问题分析

### 1. Session idle timeout（会话空闲超时）

**原因**:
- 会话在66秒内没有活动
- 可能是因为所有请求都被音频质量检查过滤，返回空响应
- Web端没有收到结果，可能停止了发送新请求

**影响**:
- 会话被关闭
- 后续请求可能无法处理

### 2. Job pending timeout（任务挂起超时）

**关键信息**:
- `node_id=None` - **调度服务器没有找到处理该任务的节点**
- `pending_timeout_seconds=10` - 任务在10秒内没有节点认领

**可能原因**:

#### 原因1：节点端没有收到job_assign消息 ⚠️

**检查**:
- 节点端日志中没有 `job-966BC189` 的记录
- 其他job（job-2CD41CD4, job-A46AD500等）都正常处理了

**可能问题**:
- WebSocket连接断开
- 消息丢失
- 节点端消息处理逻辑有问题

#### 原因2：节点端收到了但没有处理 ⚠️

**检查**:
- `handleJob` 方法中有检查：
  ```typescript
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) {
    logger.warn('Cannot handle job: WebSocket not ready');
    return;
  }
  ```

**可能问题**:
- WebSocket状态不是OPEN
- nodeId为空
- 但没有看到警告日志

#### 原因3：节点端处理了但job_result格式有问题 ⚠️

**检查**:
- 节点端发送job_result时包含 `node_id: this.nodeId`
- 但调度服务器显示 `node_id=None`

**可能问题**:
- job_result消息格式不正确
- 调度服务器无法解析node_id
- 消息在传输过程中丢失

---

## 日志分析

### 节点端日志

**成功处理的job**:
- job-2CD41CD4: 处理时间450ms ✅
- job-A46AD500: 处理时间91ms ✅
- job-B132ABD8: 处理时间72ms ✅
- job-209EAC28: 处理时间60ms ✅
- job-9202BC86: 处理时间59ms ✅

**缺失的job**:
- job-966BC189: **没有处理记录** ❌

### ASR服务端日志

**所有请求都被音频质量检查过滤**:
- 返回空响应
- 处理时间很短（< 100ms）

---

## 根本原因推测

### 最可能的原因：节点端没有收到job_assign消息

**证据**:
1. 节点端日志中没有 `job-966BC189` 的任何记录
2. 其他job都正常处理了
3. 调度服务器显示 `node_id=None`，说明没有节点认领任务

**可能原因**:
1. **WebSocket连接问题**:
   - 连接在发送job-966BC189时断开
   - 消息在传输过程中丢失
   - 节点端没有正确接收消息

2. **消息处理顺序问题**:
   - 如果节点端正在处理其他job，可能没有及时处理新消息
   - 但其他job处理时间都很短（< 500ms），不应该阻塞

3. **调度服务器问题**:
   - 调度服务器没有正确发送job_assign消息
   - 或者发送到了错误的节点

---

## 修复建议

### 1. 增强日志记录 ⚠️

**在节点端添加更详细的日志**:
```typescript
// 在handleMessage中添加
case 'job_assign': {
  const job = message as JobAssignMessage;
  logger.info({ 
    jobId: job.job_id, 
    wsState: this.ws?.readyState, 
    nodeId: this.nodeId,
    messageReceived: true 
  }, 'Received job_assign message');
  await this.handleJob(job);
  break;
}
```

### 2. 检查WebSocket连接状态 ⚠️

**添加连接状态监控**:
```typescript
// 定期检查WebSocket状态
setInterval(() => {
  if (this.ws) {
    logger.debug({ 
      readyState: this.ws.readyState,
      nodeId: this.nodeId 
    }, 'WebSocket status check');
  }
}, 5000);
```

### 3. 添加消息确认机制 ⚠️

**节点端收到job_assign后立即发送确认**:
```typescript
// 在handleJob开始时发送确认
logger.info('Received job_assign, sending ack');
this.ws.send(JSON.stringify({
  type: 'job_ack',
  job_id: job.job_id,
  node_id: this.nodeId
}));
```

### 4. 调整音频质量检查阈值 ✅

**已修复**：降低了阈值，允许0.24秒的音频通过

---

## 下一步

1. ✅ **重启ASR服务**：应用新的音频质量检查阈值

2. ⚠️ **检查WebSocket连接**：
   - 查看节点端是否有WebSocket断开/重连的日志
   - 检查连接状态

3. ⚠️ **增强日志记录**：
   - 在节点端添加更详细的job_assign接收日志
   - 添加WebSocket状态监控

4. ⚠️ **验证消息传递**：
   - 检查调度服务器是否正确发送了job_assign
   - 检查节点端是否正确接收

---

**分析完成时间**: 2025-12-25  
**状态**: ✅ **问题已定位：节点端没有收到job_assign消息或WebSocket连接问题**

**建议**: 先重启ASR服务应用音频质量检查修复，然后增强节点端的日志记录以诊断WebSocket连接问题

