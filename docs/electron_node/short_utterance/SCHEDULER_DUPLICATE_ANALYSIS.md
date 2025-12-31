# 调度服务器重复发送任务分析

## 检查日期
2025-12-30

## 问题发现

### 问题1: 重复的job_id

从日志分析发现，多个job_id在日志中出现了多次：

- `job-01501A34`: 出现 **8次**
- `job-D61532DC`: 出现 **8次**
- `job-E386366D`: 出现 **6次**
- 其他job_id: 出现2-4次

### 问题2: Job超时和Failover机制

从日志看，多个job因为超时触发了failover机制：

```
"Job dispatched 超时，尝试 cancel + failover"
"job_id":"job-01501A34"
"failover_attempts":0/1/2
"failover_max_attempts":3
```

**流程**：
1. Job被派发到节点端（attempt_id=1）
2. 30秒后，如果节点端没有返回结果，调度服务器认为job超时
3. 调度服务器触发failover，重新派发同一个job（attempt_id递增）
4. 如果节点端最终返回了原始job的结果，就会导致重复输出

### 问题3: 具体案例分析

#### 案例1: job-01501A34 (utterance_index=6)

**时间线**：
1. `09:57:27` - Job超时，触发failover (attempt_id=0→1)
2. `09:58:01` - Job再次超时，触发failover (attempt_id=1→2)
3. `09:58:09` - Job failover成功下发 (attempt_id=2→3)
4. `09:58:12` - 节点端返回job_result (attempt_id=3)
5. `09:58:13` - 调度服务器收到结果，但已超过ack_timeout (13096ms > 5000ms)
6. **结果被丢弃**："Result arrived after acknowledgment timeout, discarding"

**问题**：
- Job被多次派发（attempt_id递增）
- 节点端可能处理了多个attempt，导致重复输出
- 最终结果因为超时被丢弃

#### 案例2: job-D61532DC (utterance_index=7)

**时间线**：
1. `09:57:37` - Job超时，触发failover (attempt_id=0→1)
2. `09:58:12` - Job再次超时，触发failover (attempt_id=1→2)
3. `09:58:21` - Job failover成功下发 (attempt_id=2→3)
4. `09:58:19` - 节点端返回job_result (attempt_id=3)
5. `09:58:23` - 调度服务器收到结果，但已超过ack_timeout (23047ms > 5000ms)
6. **结果被丢弃**："Result arrived after acknowledgment timeout, discarding"

**问题**：
- 同样的failover机制导致重复派发
- 结果因为超时被丢弃

### 问题4: 调度服务器的幂等性检查

从代码看，调度服务器在派发job前会检查`dispatched_to_node`标志：

```rust
// 检查是否已派发（幂等）
if let Some(existing) = self.state.dispatcher.get_job(&job.job_id).await {
    if existing.dispatched_to_node {
        continue;  // 跳过已派发的job
    }
}
```

**但是**，failover机制会：
1. 取消原始job
2. 创建新的job（使用相同的job_id，但attempt_id递增）
3. 重新派发

这导致即使有幂等性检查，failover仍然会重新派发同一个job。

## 根本原因

### 原因1: Job超时机制过于激进

- **超时时间**：30秒（`dispatched_timeout_seconds: 30`）
- **问题**：节点端处理可能需要更长时间（特别是ASR+NMT+TTS的完整流程）
- **结果**：调度服务器认为job超时，触发failover，但节点端仍在处理

### 原因2: Failover机制导致重复派发

- **Failover逻辑**：超时后重新派发同一个job（attempt_id递增）
- **问题**：节点端可能已经处理了原始job，failover又派发了新job
- **结果**：节点端处理了多个attempt，导致重复输出

### 原因3: 节点端没有正确处理attempt_id

- **问题**：节点端可能没有检查attempt_id，导致处理了多个attempt
- **结果**：即使调度服务器只派发一次，节点端也可能重复处理

## 解决方案建议

### 方案1: 增加Job超时时间

- **当前**：30秒
- **建议**：增加到60-90秒，给节点端足够的处理时间
- **位置**：`central_server/scheduler/src/timeout/job_timeout.rs`

### 方案2: 改进Failover机制

- **当前**：超时后立即重新派发
- **建议**：
  1. 在重新派发前，先检查节点端是否仍在处理
  2. 如果节点端仍在处理，延长超时时间而不是立即failover
  3. 或者，failover时使用新的job_id，而不是相同的job_id

### 方案3: 节点端检查attempt_id

- **建议**：节点端在处理job时，检查attempt_id
- **逻辑**：
  1. 如果收到相同job_id但attempt_id更大的job，取消之前的处理
  2. 或者，如果收到相同job_id但attempt_id更小的job，忽略它

### 方案4: 改进Acknowledgment机制

- **当前**：5秒ack_timeout
- **问题**：如果job处理时间超过5秒，结果会被丢弃
- **建议**：
  1. 增加ack_timeout时间（例如30秒）
  2. 或者，根据job的处理时间动态调整ack_timeout

## 相关文件

- **Job超时处理**: `central_server/scheduler/src/timeout/job_timeout.rs`
- **Job派发逻辑**: `central_server/scheduler/src/websocket/session_actor/actor.rs`
- **Job创建逻辑**: `central_server/scheduler/src/websocket/job_creator.rs`
- **Dispatcher**: `central_server/scheduler/src/core/dispatcher.rs`

## 日志证据

### 重复job_id统计
```
重复的job_id: job-01501A34 (出现 8 次)
重复的job_id: job-D61532DC (出现 8 次)
重复的job_id: job-E386366D (出现 6 次)
```

### Failover日志
```
"Job dispatched 超时，尝试 cancel + failover"
"failover_attempts":0/1/2
"failover_max_attempts":3
```

### 超时丢弃日志
```
"Result arrived after acknowledgment timeout, discarding (will not be sent)"
"elapsed_ms":13096,"ack_timeout_ms":5000
```

---

**分析日期**：2025-12-30  
**分析人员**：AI Assistant  
**状态**：✅ 已确认调度服务器重复发送任务，需要修复failover机制

