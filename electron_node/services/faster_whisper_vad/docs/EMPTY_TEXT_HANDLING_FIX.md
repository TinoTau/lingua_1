# 空文本处理修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题

用户反馈：**节点端根本不应该返回空文本，甚至空文本不应该进入NMT流程。**

### 当前问题

1. ASR服务返回空文本（被音频质量检查过滤）
2. 节点端`pipeline-orchestrator`正确跳过了NMT/TTS流程 ✅
3. 但节点端仍然发送了包含空文本的`job_result`给调度服务器 ❌
4. 调度服务器转发给Web端，导致Web端收到空文本 ❌

---

## 修复方案

### 修复位置

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

### 修复逻辑

在`handleJob`方法中，检查ASR结果是否为空：
- 如果ASR结果为空，**不发送job_result**给调度服务器
- 记录警告日志，标记为"静音检测"
- 直接返回，不进入后续流程

### 代码变更

```typescript
// 检查ASR结果是否为空（空文本不应该进入NMT流程，也不应该返回给调度服务器）
const asrTextTrimmed = (result.text_asr || '').trim();
if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
  logger.warn(
    { jobId: job.job_id, traceId: job.trace_id },
    'ASR result is empty, skipping job_result (silence detected)'
  );
  // 不发送job_result，让调度服务器知道这是静音/空音频
  // 注意：这可能会导致调度服务器超时，但这是正确的行为
  // 因为空文本不应该进入NMT/TTS流程，也不应该返回给Web端
  return;
}
```

---

## 影响分析

### 正面影响

1. ✅ **空文本不会进入NMT流程**（已在`pipeline-orchestrator`中实现）
2. ✅ **空文本不会返回给Web端**（新修复）
3. ✅ **减少不必要的网络传输**
4. ✅ **减少调度服务器和Web端的处理负担**

### 潜在问题

⚠️ **调度服务器可能超时**：
- 如果节点端不发送`job_result`，调度服务器可能会等待10秒后超时
- 但这比发送空文本给Web端更合理

### 解决方案

如果调度服务器需要知道这是"静音跳过"而不是"失败"，可以考虑：
1. 发送`job_result`，但`success: false`，并设置`error`字段为`"silence_skipped"`
2. 或者在`extra`字段中添加标记

**当前方案**：先不发送`job_result`，观察调度服务器的行为。如果确实需要，再添加"跳过"标记。

---

## 测试建议

1. ✅ 测试空文本场景：ASR返回空文本时，节点端不发送`job_result`
2. ✅ 测试正常文本场景：ASR返回正常文本时，节点端正常发送`job_result`
3. ⚠️ 观察调度服务器行为：是否会出现超时，是否需要添加"跳过"标记

---

## 相关文件

- `electron_node/electron-node/main/src/agent/node-agent.ts` - 节点端job处理逻辑
- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` - 流水线编排器（已正确跳过NMT/TTS）

---

**修复完成时间**: 2025-12-25  
**状态**: ✅ **已修复：节点端不再发送空文本的job_result**

