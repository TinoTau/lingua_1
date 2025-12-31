# 重复发送Bug修复（V2 - 简化版）

## 修复内容

### 1. 简化Job ID验证逻辑

根据用户反馈，只需要验证相邻的两个job_id即可（因为重复是明显的，只是最后两句重复）：

```typescript
// 只保留最近2个job_id
private recentJobIds: string[] = [];

// 检查是否与最近处理的job_id重复
if (this.recentJobIds.length > 0 && 
    this.recentJobIds[this.recentJobIds.length - 1] === job.job_id) {
  logger.warn(
    {
      jobId: job.job_id,
      traceId: job.trace_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      recentJobIds: this.recentJobIds,
    },
    'Skipping duplicate job_id (same as last processed job)'
  );
  return;
}

// 更新最近处理的job_id列表（只保留最近2个）
this.recentJobIds.push(job.job_id);
if (this.recentJobIds.length > 2) {
  this.recentJobIds.shift(); // 移除最旧的
}
```

### 2. 增强日志

添加了更详细的日志信息，包括：
- `recentJobIds`：显示最近处理的job_id列表
- `utteranceIndex`：便于追踪

## 调度服务器端Finalize机制分析

### Finalize触发条件

从调度服务器代码看，finalize可能在以下情况触发：

1. **Pause检测**（`handle_audio_chunk`第277-280行）
   - 当两个audio_chunk之间的时间间隔超过`pause_ms`（默认3000ms）时触发
   - 在收到新chunk时检查

2. **IsFinal**（`handle_audio_chunk`第296-299行）
   - 当收到`is_final=true`的audio_chunk时触发
   - Web端静音检测后发送

3. **Timeout机制**（`handle_timeout_fired`第337-370行）
   - 如果`pause_ms > 0`，每次收到新chunk时会启动/重置超时计时器
   - 如果在`pause_ms`时间内没有收到新chunk，超时计时器会触发`TimeoutFired`事件
   - 这也会触发finalize（原因：`"Timeout"`）

### 可能的重复触发场景

**场景1：Pause和Timeout的时序问题**
- 用户停止说话
- 最后一个chunk到达，如果与上一个chunk间隔>3秒，会触发`pause_exceeded = true`
- 代码会调用`try_finalize(utterance_index, "Pause")`
- 但如果`try_finalize`返回`false`（例如因为`can_finalize`检查失败），代码会继续执行
- 然后如果`should_finalize = false`且`pause_ms > 0`，会调用`reset_timers()`启动超时计时器
- 3秒后，`TimeoutFired`触发，又调用`try_finalize(utterance_index, "Timeout")`

**场景2：IsFinal和Timeout同时触发**
- Web端检测到静音，发送`is_final=true`
- 同时，调度服务器的timeout计时器也触发
- 如果两个都调用了`try_finalize`，可能导致重复

**场景3：try_finalize的去重检查失效**
- `try_finalize`中有`can_finalize`检查（第425行）
- 但如果两个finalize请求几乎同时到达，可能都通过了检查

### 调度服务器端的保护机制

`try_finalize`中有去重检查：

```rust
// 检查是否可以 finalize
if !self.internal_state.can_finalize(utterance_index) {
    debug!("Skipping finalize: already finalized or in progress");
    crate::metrics::on_duplicate_finalize_suppressed();
    return Ok(false);
}
```

但可能有时序问题，如果两个finalize请求几乎同时到达，可能都通过了检查。

## 验证方法

1. **检查节点端日志**：
   - 查看是否有"Skipping duplicate job_id"的日志
   - 查看`recentJobIds`是否包含重复的job_id

2. **检查调度服务器日志**：
   - 查看是否有多个finalize请求（相同utterance_index）
   - 查看finalize的原因（Pause、Timeout、IsFinal）
   - 查看是否有"Skipping finalize: already finalized"的日志

3. **检查Web端日志**：
   - 查看是否发送了多次`is_final=true`
   - 查看静音检测的触发时机

## 下一步

1. 重新编译并测试，确认重复发送问题是否解决
2. 如果问题仍然存在，需要检查调度服务器端的finalize逻辑
3. 可能需要增强调度服务器端的去重检查，或者确保Pause和Timeout不会同时触发

