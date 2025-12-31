# 重复发送Bug修复

## 问题描述

用户报告：在finalize后，最后一句话被发送了两遍。例如："不担斗斗斗"重复了两次。

## 修复方案

### 1. Job ID去重保护

在 `NodeAgent` 中添加了 `processedJobIds` Set，防止同一个job被处理多次：

```typescript
// 在 handleJob 开始时检查
if (this.processedJobIds.has(job.job_id)) {
  logger.warn({ jobId: job.job_id }, 'Skipping duplicate job_id (already processed)');
  return;
}

// 标记为已处理
this.processedJobIds.add(job.job_id);

// 定期清理（保留最近500个，防止内存泄漏）
if (this.processedJobIds.size > 1000) {
  const idsArray = Array.from(this.processedJobIds);
  this.processedJobIds = new Set(idsArray.slice(-500));
}
```

### 2. 增强重复检测

在 `AggregatorMiddleware` 中：
- 将重复检测日志从 `info` 改为 `warn`，更容易发现
- 添加 `utteranceIndex` 到日志中，便于追踪
- 在返回前立即更新 `lastSentText`（pre-send），防止并发请求导致的重复发送

```typescript
// 在返回前立即更新lastSentText（防止并发请求导致的重复发送）
if (aggregatedText && aggregatedText.length > 0) {
  const normalizeText = (text: string): string => {
    return text.replace(/\s+/g, ' ').trim();
  };
  this.lastSentText.set(job.session_id, normalizeText(aggregatedText));
  logger.debug(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      text: aggregatedText.substring(0, 50),
    },
    'Updated lastSentText (pre-send) to prevent duplicate'
  );
}
```

### 3. 增强日志

添加了更详细的日志，包括：
- `job_id`、`trace_id`、`session_id`、`utterance_index`
- 重复检测的详细信息
- `lastSentText` 更新时机

## 识别准确率问题

用户还报告识别准确率非常低。可能的原因：

1. **S1/S2功能未正常工作**
   - 检查日志确认S1 Prompt是否被应用
   - 检查S2 Rescoring是否被触发
   - 检查二次解码是否成功

2. **ASR配置问题**
   - 检查ASR参数是否正确传递
   - 检查音频格式、采样率等

3. **音频质量问题**
   - 检查音频是否被正确接收和处理

## 验证方法

1. **检查重复发送修复**：
   - 查看日志中是否有 "Skipping duplicate job_id" 或 "Skipping duplicate text"
   - 确认同一句话不再重复发送

2. **检查S1/S2功能**：
   - 查看日志中是否有 "S1: Prompt built"
   - 查看日志中是否有 "S2: Rescoring applied"
   - 查看日志中是否有 "S2-6: Secondary decode completed"

3. **检查识别准确率**：
   - 对比修复前后的识别结果
   - 检查短句识别是否有改善

## 下一步

1. 重新编译并测试
2. 检查日志确认修复是否生效
3. 如果识别准确率仍然很低，需要进一步调查S1/S2功能

