# Aggregator Flush重复发送问题分析

## 问题描述

用户停止说话3秒后，最后一句话被发送了两次。用户怀疑可能是节点端的utterance处理，在某个超时后将最后半句又发送了一遍。

## 发现的潜在问题

### 1. AggregatorState的Final强制提交逻辑

在 `aggregator-state.ts` 第281-300行：

```typescript
} else if (isFinal && this.pendingText) {
  // 如果是 final 但没有触发 commit（可能是因为 pending 文本太短），强制提交
  commitText = this.pendingText;
  // 如果有 tail buffer，也包含进去
  if (this.tailBuffer) {
    commitText = this.tailBuffer + commitText;
    this.tailBuffer = '';
  }
  this.pendingText = '';
  this.lastCommitTsMs = nowMs;
  this.metrics.commitCount++;
  // 更新上一次提交的文本
  this.lastCommittedText = commitText;
  // S1/S2: 更新最近提交的文本
  this.updateRecentCommittedText(commitText);
  this.lastCommitQuality = qualityScore;
  // 标记为应该提交
  shouldCommitNow = true;
}
```

**问题**：如果同一个utterance的多个job都标记为`isFinal=true`，这个逻辑可能会被调用多次。

### 2. AggregatorMiddleware的Flush逻辑

在 `aggregator-middleware.ts` 第294-308行：

```typescript
if (!aggregatorResult.shouldCommit) {
  // 强制 flush pending 文本（因为是 final）
  const flushedText = this.manager?.flush(job.session_id) || '';
  if (flushedText) {
    aggregatedText = flushedText;
    logger.debug(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        action: aggregatorResult.action,
        flushedLength: flushedText.length,
      },
      'Aggregator middleware: Flushed pending text for final utterance'
    );
  }
}
```

**问题**：
1. 如果第一个job已经提交了pending文本（`shouldCommit=true`），pending文本已经被清空
2. 但如果第二个job（可能是同一个utterance的另一个chunk）也触发了这个逻辑，可能会再次flush已经清空的pending文本
3. 或者，如果第一个job的`shouldCommit=false`，会flush pending文本；然后第二个job又来，如果pending文本已经被清空，flush会返回空字符串，但可能仍然会发送

### 3. 可能的重复触发场景

**场景1：多个Final Job**
- 用户停止说话，调度服务器发送final job
- 第一个job到达，`isFinal=true`，触发final强制提交，pending文本被清空
- 第二个job到达（可能是重传或重复），`isFinal=true`，再次触发final强制提交
- 但此时pending文本已经被清空，`this.pendingText = ''`，所以`commitText = ''`
- 然而，如果`shouldCommit=true`，仍然会返回空文本，可能导致重复发送

**场景2：Flush和Final提交的冲突**
- 第一个job：`shouldCommit=false`，触发flush，pending文本被清空
- 第二个job：`isFinal=true`，触发final强制提交，但pending文本已经被清空
- 如果两个job都返回了文本（即使一个是空的），可能导致重复发送

## 修复方案

### 方案1：在AggregatorState中添加Final提交保护

确保`isFinal=true`时，只触发一次commit：

```typescript
// 在 processUtterance 中
private lastFinalCommitUtteranceIndex: number = -1;

if (shouldCommitNow && this.pendingText) {
  // ... commit逻辑
  if (isFinal) {
    this.lastFinalCommitUtteranceIndex = utteranceIndex;
  }
} else if (isFinal && this.pendingText && this.lastFinalCommitUtteranceIndex !== utteranceIndex) {
  // final强制commit（只在未commit时执行）
  // ... 强制commit逻辑
  this.lastFinalCommitUtteranceIndex = utteranceIndex;
}
```

### 方案2：在AggregatorMiddleware中检查Flush结果

确保flush的文本不为空，且与上次发送的文本不同：

```typescript
if (!aggregatorResult.shouldCommit) {
  const flushedText = this.manager?.flush(job.session_id) || '';
  if (flushedText && flushedText.trim().length > 0) {
    // 检查是否与上次发送的文本相同
    const lastSent = this.lastSentText.get(job.session_id);
    if (lastSent && normalizeText(flushedText) === normalizeText(lastSent)) {
      logger.warn({ jobId: job.job_id }, 'Skipping duplicate flushed text');
      return { shouldSend: false, ... };
    }
    aggregatedText = flushedText;
  }
}
```

### 方案3：增强日志

添加更详细的日志，追踪：
- 每个job的`isFinal`状态
- `shouldCommit`的值
- `pendingText`的内容
- flush的文本内容

## 验证方法

1. **检查日志**：
   - 查看是否有多个job的`isFinal=true`
   - 查看是否有"Flushed pending text"的日志
   - 查看是否有重复的commit

2. **检查Aggregator状态**：
   - 查看`pendingText`是否在第一次commit后被清空
   - 查看是否有多次flush调用

3. **检查Job ID**：
   - 查看是否有相同的job_id被处理多次
   - 查看是否有不同的job_id但相同的utterance_index

## 下一步

1. 添加更详细的日志，追踪final提交和flush的调用
2. 实现Final提交保护，防止重复提交
3. 增强flush逻辑，检查重复文本

