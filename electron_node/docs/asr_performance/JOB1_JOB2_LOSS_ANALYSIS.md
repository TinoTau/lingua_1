# Job1和Job2丢失问题分析

**日期**: 2026-01-28  
**问题**: Job2明显丢失了前半句话，可能是Job1被整个丢失了

---

## 一、用户观察到的结果

### 1.1 原文
```
"我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。"
```

### 1.2 实际返回结果
```
[1] [音频丢失] 我會先讀音量 用力量去比较短的话,通來確認系統會不會在句子之間隨意的把語音切斷或者在沒有?
[2] 要必要的时候提前结束本次识别
```

**问题**:
- Job1: 缺少前半句"我会先读一两句比较短的话，用来确认系统"
- Job2: 缺少前半句"用来确认系统不会在句子之间随意地把语音切断，或者在没有"

---

## 二、日志分析

### 2.1 Job1 (utteranceIndex:1) 处理流程

**Job ID**: `job-ea3810b8-9ce0-4464-8bc8-2d505c0619bd`

**音频处理**:
- 音频时长: 8840ms
- 切分成11个segment
- 创建了2个batch (1800ms + 6100ms)
- 剩余940ms缓存到pendingMaxDurationAudio

**ASR处理**:
- Batch1 (1800ms): "我會先讀音量" (6字符) ✅
- Batch2 (6100ms): "用力量去比较短的话,中来确认系统不会在聚者之间随意的把语音切断或者在没有" (36字符) ✅

**问题**: 
- Job1的结果被标记为"ASR result is empty"，发送了空结果
- 日志显示: `"reason":"ASR result is empty, sending empty result to acknowledge (ASR_EMPTY)"`
- 但ASR实际上返回了文本！

**后续处理**:
- 通过TTL触发了`forceFinalizePartial`
- 合并了文本: "我會先讀音量 用力量去比较短的话,中来确认系统不会在聚者之间随意的把语音切断或者在没有" (43字符)
- 但此时已经发送了空结果

### 2.2 Job2 (utteranceIndex:2) 处理流程

**Job ID**: `job-3417432b-efec-4856-818e-dd51496bc2ea`

**音频处理**:
- 合并了Job1的pendingMaxDurationAudio (940ms)
- 当前音频: 1820ms
- 合并后: 2760ms (< 5秒)
- 由于是手动finalize，强制flush: `FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE`

**ASR处理**:
- ASR结果: "要必要的时候提前结束本次识别" (14字符) ✅
- 但缺少了前半句

**问题**:
- Job2合并了Job1的pending音频 (940ms)
- 但ASR结果只包含了后半句，缺少了前半句

---

## 三、问题分析

### 3.1 Job1的问题

**关键发现**:
- ASR返回了两个batch的文本：
  - Batch1: "我會先讀音量" (6字符) ✅
  - Batch2: "用力量去比较短的话,中来确认系统不会在聚者之间随意的把语音切断或者在没有" (36字符) ✅
- 两个batch都被正确累积到`OriginalJobResultDispatcher`
- **但是**: `runAsrStep: ASR completed`显示`asrTextLength:0` ❌

**根本原因**:
- 日志显示: `"Has pendingMaxDurationAudio, waiting for TTL or subsequent batches"`
- Job1有pendingMaxDurationAudio (940ms)，所以`OriginalJobResultDispatcher`等待后续batch或TTL
- 在`finalizeOriginalJob`中，如果有`hasPendingMaxDurationAudio`，会返回`false`，不触发回调
- 因此`runAsrStep`中的`ctx.asrText`没有被设置（仍然是空字符串）
- `runAsrStep: ASR completed`显示`asrTextLength:0`，然后发送了空结果
- 后来通过TTL触发了`forceFinalizePartial`，合并了文本，但此时已经发送了空结果

**代码逻辑** (`original-job-result-dispatcher.ts` 第395-406行):
```typescript
if (registration.hasPendingMaxDurationAudio) {
  logger.info(
    {
      sessionId,
      originalJobId,
      receivedCount: registration.receivedCount,
      expectedSegmentCount: registration.expectedSegmentCount,
      reason: 'Has pendingMaxDurationAudio, waiting for TTL or subsequent batches',
    },
    'OriginalJobResultDispatcher: Waiting for pendingMaxDurationAudio (TTL or subsequent batches)'
  );
  // 不 finalize，继续等待 TTL 超时或后续 batch
  return false;  // ❌ 不触发回调，导致ctx.asrText为空
}
```

**问题**: 
- 有pendingMaxDurationAudio时，`finalizeOriginalJob`返回`false`，不触发回调
- 导致`runAsrStep`中的`ctx.asrText`没有被设置，被认为是空结果
- 应该等待pending音频被处理或TTL超时，而不是立即发送空结果

### 3.2 Job2的问题

**关键发现**:
- Job2合并了Job1的pendingMaxDurationAudio (940ms)
- 合并后的音频: 2760ms (< 5秒)
- 由于是手动finalize，强制flush: `FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE` ✅
- **但是**: ASR结果只包含了当前音频的部分: "要必要的时候提前结束本次识别" (14字符)
- 缺少了前半句（来自pending音频的部分）

**根本原因**:
- pending音频 (940ms) 被合并到Job2的音频中
- 合并后的音频被发送到ASR服务
- 但ASR结果只识别了当前音频的部分，没有识别pending音频的部分
- **可能原因**: 
  - pending音频 (940ms) 太短，ASR服务可能没有正确识别
  - 或者合并后的音频在ASR服务中被截断
  - 或者ASR服务只识别了音频的后半部分（当前音频的部分）

---

## 四、需要进一步检查

### 4.1 Job1的ASR文本合并

**检查点**:
- `mergeASRText`是否正确合并了batch1和batch2的文本
- 为什么合并后的文本被认为是空的

### 4.2 Job2的pending音频处理

**检查点**:
- pending音频 (940ms) 是否被正确发送到ASR服务
- 如果pending音频没有被发送到ASR，那么ASR结果自然不包含这部分内容

---

## 五、初步结论

### 5.1 Job1的问题

**问题**: ASR结果被错误地标记为空
- ASR实际上返回了文本
- 但系统认为结果是空的
- 导致发送了空结果

### 5.2 Job2的问题

**问题**: 合并pending音频后，ASR结果不完整
- 合并了Job1的pending音频
- 但ASR结果只包含了当前音频的部分
- pending音频的部分没有被识别

---

*需要进一步检查ASR文本合并逻辑和pending音频的ASR处理流程。*
