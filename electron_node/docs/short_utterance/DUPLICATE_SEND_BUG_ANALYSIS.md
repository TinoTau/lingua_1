# 重复发送Bug分析

## 问题描述

用户报告：在finalize后，最后一句话被发送了两遍。例如："不担斗斗斗"重复了两次。

## 可能的原因

### 1. AggregatorState 中的双重Commit

在 `aggregator-state.ts` 中，当 `isFinal=true` 时，有两个地方可能触发commit：

```typescript
// 第一个位置：正常commit
if (shouldCommitNow && this.pendingText) {
  // ... commit逻辑
}

// 第二个位置：final强制commit
else if (isFinal && this.pendingText) {
  // ... 强制commit逻辑
}
```

**问题**：如果第一个条件满足，第二个条件不会执行。但如果第一个条件不满足（`shouldCommitNow=false`），第二个条件会执行。这可能导致：
- 第一次：正常commit（如果满足条件）
- 第二次：final强制commit（如果第一次没满足条件）

### 2. 多个Job处理同一个Final结果

如果同一个final结果被处理了两次（例如，由于网络重传或调度服务器的重复发送），可能会导致重复发送。

### 3. 重复检测逻辑失效

当前的重复检测逻辑在 `aggregator-middleware.ts` 和 `node-agent.ts` 中都有，但可能存在时序问题：
- `lastSentText` 的更新在发送成功后
- 如果两次发送几乎同时发生，第二次可能还没有更新 `lastSentText`

## 解决方案

### 方案1: 在AggregatorState中添加Final Commit保护

确保 `isFinal=true` 时，只触发一次commit：

```typescript
// 在 processUtterance 中
if (shouldCommitNow && this.pendingText) {
  // ... commit逻辑
  if (isFinal) {
    // 标记为已final commit，防止后续再次commit
    this.finalCommitted = true;
  }
} else if (isFinal && this.pendingText && !this.finalCommitted) {
  // final强制commit（只在未commit时执行）
  // ... 强制commit逻辑
  this.finalCommitted = true;
}
```

### 方案2: 在NodeAgent中添加Job ID去重

使用 `job_id` 或 `trace_id` 来防止同一个job被处理两次：

```typescript
private processedJobIds: Set<string> = new Set();

// 在处理job前检查
if (this.processedJobIds.has(job.job_id)) {
  logger.warn({ jobId: job.job_id }, 'Skipping duplicate job_id');
  return;
}
this.processedJobIds.add(job.job_id);

// 在发送成功后，可以选择保留一段时间后清理
```

### 方案3: 增强重复检测逻辑

在发送前立即更新 `lastSentText`（而不是在发送后），并使用更严格的检查：

```typescript
// 在发送前检查并更新
const normalizedCurrent = normalizeText(finalResult.text_asr);
const lastSent = this.aggregatorMiddleware.getLastSentText(job.session_id);

if (lastSent && normalizedCurrent === normalizeText(lastSent)) {
  logger.info({ jobId: job.job_id }, 'Skipping duplicate (pre-check)');
  return;
}

// 立即更新（在发送前）
this.aggregatorMiddleware.setLastSentText(job.session_id, finalResult.text_asr.trim());

// 然后发送
this.ws.send(JSON.stringify(response));
```

## 建议的修复

1. **立即修复**：在 `NodeAgent` 中添加 `job_id` 去重检查
2. **中期优化**：在 `AggregatorState` 中添加 final commit 保护
3. **长期优化**：使用 `trace_id` 进行全局去重（跨节点）

## 识别准确率问题

用户还报告识别准确率非常低。可能的原因：

1. **S1/S2功能未正常工作**：检查日志确认：
   - S1 Prompt是否被应用
   - S2 Rescoring是否被触发
   - 二次解码是否成功

2. **ASR配置问题**：检查ASR参数是否正确传递

3. **音频质量问题**：检查音频格式、采样率等

## 下一步

1. 添加详细的日志来追踪：
   - 每个job的处理次数
   - final commit的触发情况
   - 重复检测的执行情况

2. 实现 `job_id` 去重保护

3. 检查S1/S2功能的日志，确认是否正常工作

