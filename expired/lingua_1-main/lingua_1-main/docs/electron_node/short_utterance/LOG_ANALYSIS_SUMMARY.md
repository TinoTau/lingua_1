# 日志检查总结

## 检查日期
2025-12-30

## 检查范围
- 节点端日志（electron-main.log）
- NMT服务日志（nmt-service.log）
- 重复输出问题
- NMT提取问题（P>残留）

## 发现的问题

### 问题1: DedupStage检测到重复但仍发送job_result

**现象**：
- DedupStage正确检测到重复文本（similarity=1.000）
- 日志显示："DedupStage: Duplicate text detected (high similarity), skipping send"
- 但是仍然发送了job_result："Sending job_result to scheduler"

**根本原因**：
- NodeAgent在处理`shouldSend=false`时，如果`aggregatedText`不为空，仍然会发送job_result
- 这是为了"确保job被核销"，但这导致了重复输出

**修复**：
- 修改NodeAgent逻辑：当PostProcessCoordinator返回`shouldSend=false`时，无论`aggregatedText`是否为空，都不发送job_result
- 避免发送重复内容导致重复输出

### 问题2: NMT提取逻辑

**检查结果**：
- ✅ 没有发现P>残留问题
- ✅ 分隔符被正确找到和清理
- ✅ 提取逻辑正常工作

**示例日志**：
```
[NMT Service] Found separator ' <SEP> ' at position 97
[NMT Service] Extracted current sentence translation (method: separator match, separator pos=104, raw length=139, cleaned length=139)
[NMT Service] Final output: 'says the effect after his translation is also acceptable...'
```

## 已修复的问题

### 修复1: DedupStage重复输出

**文件**：`electron_node/electron-node/main/src/agent/node-agent.ts`

**修改**（第976-1012行）：
- 当PostProcessCoordinator返回`shouldSend=false`时，不发送job_result
- 避免发送重复内容或空结果导致重复输出

```typescript
} else {
  // PostProcessCoordinator 决定不发送（可能是重复文本或被过滤）
  // 修复：如果PostProcessCoordinator决定不发送（shouldSend=false），不发送job_result
  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      reason: postProcessResult.reason || 'PostProcessCoordinator filtered result',
      aggregatedText: postProcessResult.aggregatedText?.substring(0, 50) || '',
    },
    'PostProcessCoordinator filtered result (shouldSend=false), skipping job_result send to avoid duplicate output'
  );
  return;  // 不发送结果，避免重复输出
}
```

## 仍需关注的问题

### 问题1: ASR服务可能重复识别相同文本

**现象**：
- 从日志看，多个job的ASR结果完全相同
- 例如：job-01501A34, job-CB81AAC7, job-D61532DC的ASR结果都是"这个功能就出现了..."

**可能原因**：
- ASR服务重复识别了相同音频
- 调度服务器重复发送了任务
- 需要检查ASR服务日志和调度服务器日志

**建议**：
- 检查ASR服务日志，确认是否重复识别
- 检查调度服务器日志，确认是否重复发送任务
- 如果ASR服务重复识别，需要检查ASR服务的去重逻辑

### 问题2: 调度服务器可能重复发送任务

**现象**：
- 多个job的utteranceIndex不同，但ASR结果相同
- 例如：utteranceIndex 6, 15, 7的ASR结果都是"这个功能就出现了..."

**可能原因**：
- 调度服务器可能重复发送了任务
- 需要检查调度服务器日志

**建议**：
- 检查调度服务器日志，确认是否重复发送任务
- 如果调度服务器重复发送，需要检查调度服务器的去重逻辑

## 检查结果总结

### ✅ 已修复
1. **DedupStage重复输出**：当DedupStage检测到重复时，不再发送job_result
2. **NMT提取逻辑**：P>残留问题已修复，提取逻辑正常工作

### ⚠️ 仍需关注
1. **ASR服务重复识别**：需要检查ASR服务日志
2. **调度服务器重复发送**：需要检查调度服务器日志

## 相关文件

- **NodeAgent**: `electron_node/electron-node/main/src/agent/node-agent.ts`
- **DedupStage**: `electron_node/electron-node/main/src/agent/postprocess/dedup-stage.ts`
- **PostProcessCoordinator**: `electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`
- **NMT Service**: `electron_node/services/nmt_m2m100/nmt_service.py`

---

**检查日期**：2025-12-30  
**检查人员**：AI Assistant  
**状态**：✅ 已修复DedupStage重复输出问题，待进一步检查ASR和调度服务器日志

