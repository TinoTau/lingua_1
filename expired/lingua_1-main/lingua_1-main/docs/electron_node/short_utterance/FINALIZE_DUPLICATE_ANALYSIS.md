# Finalize重复发送问题分析

## 问题描述

用户停止说话3秒后，finalize触发，但最后一句话被发送了两次。

## 调度服务器Finalize机制

### Finalize触发条件

从 `central_server/scheduler/src/websocket/session_actor/actor.rs` 看，finalize可能在以下情况触发：

1. **Pause检测**（第277-280行）
   - 当两个audio_chunk之间的时间间隔超过`pause_ms`（默认3000ms）时触发
   - 在`handle_audio_chunk`中，收到新chunk时检查

2. **IsFinal**（第296-299行）
   - 当收到`is_final=true`的audio_chunk时触发
   - Web端静音检测后发送

3. **Timeout机制**（第254-256行）
   - 如果`pause_ms > 0`，每次收到新chunk时会启动/重置超时计时器
   - 如果在`pause_ms`时间内没有收到新chunk，超时计时器会触发`TimeoutFired`事件
   - 这也会触发finalize（原因：`"Timeout"`）

4. **MaxDuration**（第283-293行）
   - 当累积音频时长超过`max_duration_ms`时触发

### 可能的重复触发场景

**场景1：Pause和Timeout同时触发**
- 用户停止说话
- 最后一个chunk到达，触发`pause_exceeded = true`（因为与上一个chunk间隔>3秒）
- 同时，timeout计时器也在运行，3秒后触发`TimeoutFired`
- 如果两个都调用了`try_finalize`，可能导致重复

**场景2：IsFinal和Timeout同时触发**
- Web端检测到静音，发送`is_final=true`
- 同时，调度服务器的timeout计时器也触发
- 如果两个都调用了`try_finalize`，可能导致重复

**场景3：try_finalize的去重检查失效**
- `try_finalize`中有`can_finalize`检查（第425行）
- 但如果两个finalize请求几乎同时到达，可能都通过了检查

## 节点端修复

### 简化Job ID验证

根据用户反馈，只需要验证相邻的两个job_id即可：

```typescript
// 只保留最近2个job_id
private recentJobIds: string[] = [];

// 检查是否与最近处理的job_id重复
if (this.recentJobIds.length > 0 && 
    this.recentJobIds[this.recentJobIds.length - 1] === job.job_id) {
  logger.warn({ jobId: job.job_id }, 'Skipping duplicate job_id');
  return;
}

// 更新最近处理的job_id列表（只保留最近2个）
this.recentJobIds.push(job.job_id);
if (this.recentJobIds.length > 2) {
  this.recentJobIds.shift();
}
```

## 调度服务器端可能的修复

### 检查点1：Timeout和Pause的互斥

在`handle_audio_chunk`中，如果`pause_exceeded = true`，应该取消timeout计时器，避免重复触发。

### 检查点2：IsFinal和Timeout的互斥

如果收到`is_final=true`，应该取消timeout计时器。

### 检查点3：try_finalize的原子性

确保`try_finalize`是原子的，防止并发调用。

## 验证方法

1. **检查调度服务器日志**：
   - 查看是否有多个finalize请求（相同utterance_index）
   - 查看finalize的原因（Pause、Timeout、IsFinal）

2. **检查节点端日志**：
   - 查看是否有"Skipping duplicate job_id"的日志
   - 查看是否有相同job_id被处理两次

3. **检查Web端日志**：
   - 查看是否发送了多次`is_final=true`
   - 查看静音检测的触发时机

## 下一步

1. 在节点端添加更详细的日志，记录每个job的处理情况
2. 检查调度服务器端是否有重复finalize的逻辑
3. 如果确认是调度服务器端的问题，需要在调度服务器端修复

