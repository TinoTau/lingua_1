# Job 重复与空结果问题排查指南（2026-01-28）

## 问题现象

- job1 和 job2 内容重复（都是"我開始進行一次的語音識別穩定性測試"）
- 之后没有返回结果
- 调度服务器收到重复的 job_result，result_type="empty"

## 日志检查步骤

### 1. 检查 ASR 步骤：每个原始 job 的 ASR 输入/输出

**关键字**：`runAsrStep: Processing original job from dispatcher`

```
{
  "originalJobId": "job-xxx",
  "sessionId": "s-xxx",
  "asrTextLength": 123,
  "segmentCount": 5
}
```

**检查点**：
- 每个原始 job 的 `originalJobId` 是否不同？
- 每个原始 job 的 `asrText` 是否相同？（如果相同，说明 ASR 服务返回了重复结果）

**相关日志**：
- `runAsrStep: Registering original job` - 注册原始 job 时的信息
- `runAsrStep: Original job result sent to scheduler` - 发送结果时的信息

### 2. 检查聚合步骤：聚合后的文本

**关键字**：`runAggregationStep: Aggregation completed`

```
{
  "jobId": "job-xxx",
  "aggregatedTextLength": 123,
  "originalTextLength": 120,
  "action": "NEW_STREAM" | "MERGE",
  "aggregationChanged": true/false
}
```

**检查点**：
- `aggregatedText` 是否与 `asrText` 相同？
- `action` 是什么？（NEW_STREAM 还是 MERGE）
- `aggregationChanged` 是否为 true？

**相关日志**：
- `AggregationStage: Processing completed with forward merge` - 包含 `aggregatedTextPreview`、`shouldSendToSemanticRepair`

### 3. 检查去重步骤：是否被标记为重复

**关键字**：`runDedupStep: Deduplication check completed`

```
{
  "jobId": "job-xxx",
  "shouldSend": true/false,
  "dedupReason": "duplicate_job_id" | undefined
}
```

**检查点**：
- `shouldSend` 是否为 `false`？
- 如果为 `false`，`dedupReason` 是什么？

**相关日志**：
- `DedupStage: Duplicate job_id detected, skipping send` - 如果检测到重复 job_id
- `DedupStage: Job_id check passed, will be recorded after successful send` - 如果通过检查

### 4. 检查结果发送：是否实际发送

**关键字**：`runAsrStep: Original job result sent to scheduler`

```
{
  "originalJobId": "job-xxx",
  "textAsrLength": 123,
  "textTranslatedLength": 100,
  "shouldSend": true/false
}
```

**检查点**：
- `shouldSend` 是否为 `true`？
- 如果为 `false`，说明结果被过滤，不会发送

**相关日志**：
- `NodeAgent: Job filtered by JobPipeline, skipping job_result send` - 如果被过滤
- `Skipping duplicate job result (same as last sent after normalization)` - 如果文本与上次发送的相同
- `Sending job_result to scheduler` - 如果准备发送
- `Job result sent successfully` - 如果成功发送

### 5. 检查 ResultSender：文本去重逻辑

**关键字**：`Skipping duplicate job result (same as last sent after normalization)`

如果看到这条日志，说明：
- 当前 job 的文本与上次发送的文本（归一化后）完全相同
- ResultSender 会跳过发送，但会记录 job_id（用于后续去重）

**检查点**：
- job1 和 job2 的文本是否完全相同？
- 如果 job1 发送了文本，job2 的文本与 job1 相同，job2 会被过滤

### 6. 检查 DedupStage：job_id 记录

**关键字**：`DedupStage: Job_id marked as sent`

```
{
  "jobId": "job-xxx",
  "sessionId": "s-xxx"
}
```

**检查点**：
- 每个 job_id 是否只记录一次？
- 如果同一个 job_id 被记录两次，说明去重逻辑有问题

## 可能的原因

### 原因 1：ASR 服务返回重复文本

**现象**：两个不同的 job_id，但 ASR 文本完全相同

**检查方法**：
- 查看 `runAsrStep: Processing original job from dispatcher` 日志
- 对比不同 `originalJobId` 的 `asrText`

**解决方案**：
- 检查 ASR 服务的 batch 分配逻辑
- 检查音频聚合逻辑是否正确

### 原因 2：ResultSender 文本去重过滤

**现象**：job1 发送了文本，job2 的文本与 job1 相同，job2 被过滤

**检查方法**：
- 查看 `Skipping duplicate job result (same as last sent after normalization)` 日志
- 查看 `ResultSender: Job_id marked as sent (text duplicate, but recorded for deduplication)` 日志

**解决方案**：
- 如果这是预期行为（文本确实重复），则正常
- 如果文本不应该重复，检查聚合逻辑

### 原因 3：去重逻辑错误标记

**现象**：`shouldSend: false`，`dedupReason: "duplicate_job_id"`

**检查方法**：
- 查看 `runDedupStep: Deduplication check completed` 日志
- 查看 `DedupStage: Duplicate job_id detected, skipping send` 日志

**解决方案**：
- 检查 DedupStage 的 job_id 记录逻辑
- 确认是否在发送前就记录了 job_id（应该在成功发送后才记录）

### 原因 4：结果为空但被发送

**现象**：调度服务器收到 `result_type="empty"`

**检查方法**：
- 查看 `NodeAgent: Sending empty job_result to acknowledge` 日志
- 查看 `text_asr` 是否为空

**解决方案**：
- 检查 ResultSender 的空结果发送逻辑（第 95-128 行）
- 确认是否应该发送空结果（核销情况）

## 建议的日志搜索命令

按 `job_id` 或 `session_id` 搜索：

```bash
# 搜索特定 job 的所有日志
grep "job-69d87201-d46e-451e-a33b-4d33fdec96e4" electron-main.log

# 搜索特定 session 的所有日志
grep "s-8C39915F" electron-main.log

# 搜索 ASR 步骤日志
grep "runAsrStep: Processing original job" electron-main.log

# 搜索去重步骤日志
grep "runDedupStep: Deduplication check completed" electron-main.log

# 搜索结果发送日志
grep "runAsrStep: Original job result sent to scheduler" electron-main.log
grep "Skipping duplicate job result" electron-main.log
```

## 关键检查点总结

1. **ASR 输入/输出**：每个原始 job 的 ASR 文本是否不同？
2. **聚合结果**：聚合后的文本是否正确？
3. **去重检查**：`shouldSend` 是否为 `true`？
4. **结果发送**：是否实际发送了结果？
5. **文本去重**：是否因为文本重复而被过滤？
