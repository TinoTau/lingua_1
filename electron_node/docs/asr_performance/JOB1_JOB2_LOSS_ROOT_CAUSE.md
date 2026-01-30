# Job1和Job2丢失问题 - 根本原因分析

**日期**: 2026-01-28  
**问题**: Job1和Job2都丢失了部分文本

---

## 一、问题总结

### 1.1 用户观察到的结果

**原文**:
```
"我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。"
```

**实际返回**:
```
[1] [音频丢失] 我會先讀音量 用力量去比较短的话,通來確認系統會不會在句子之間隨意的把語音切斷或者在沒有?
[2] 要必要的时候提前结束本次识别
```

**问题**:
- Job1: 缺少前半句"我会先读一两句比较短的话，用来确认系统"
- Job2: 缺少前半句"用来确认系统不会在句子之间随意地把语音切断，或者在没有"

---

## 二、Job1的问题分析

### 2.1 处理流程

**Job1 (utteranceIndex:1)**:
- 音频时长: 8840ms
- 切分成11个segment
- 创建了2个batch (1800ms + 6100ms)
- 剩余940ms缓存到pendingMaxDurationAudio

**ASR处理**:
- Batch1 (1800ms): "我會先讀音量" (6字符) ✅
- Batch2 (6100ms): "用力量去比较短的话,中来确认系统不会在聚者之间随意的把语音切断或者在没有" (36字符) ✅

### 2.2 根本原因

**问题**: ASR结果被错误地标记为空

**执行流程**:
1. 两个batch都被正确累积到`OriginalJobResultDispatcher` ✅
2. 但是Job1有pendingMaxDurationAudio (940ms)
3. 在`finalizeOriginalJob`中，检查到`hasPendingMaxDurationAudio = true`
4. **返回`false`，不触发回调** ❌
5. 因此`runAsrStep`中的`ctx.asrText`没有被设置（仍然是空字符串）
6. `runAsrStep: ASR completed`显示`asrTextLength:0`
7. 发送了空结果: `"reason":"ASR result is empty, sending empty result to acknowledge (ASR_EMPTY)"`
8. 后来通过TTL触发了`forceFinalizePartial`，合并了文本，但此时已经发送了空结果

**代码位置**: `original-job-result-dispatcher.ts` 第395-406行

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

---

## 三、Job2的问题分析

### 3.1 处理流程

**Job2 (utteranceIndex:2)**:
- 合并了Job1的pendingMaxDurationAudio (940ms)
- 当前音频: 1820ms
- 合并后: 2760ms (< 5秒)
- 由于是手动finalize，强制flush: `FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE` ✅

**ASR处理**:
- ASR结果: "要必要的时候提前结束本次识别" (14字符) ✅
- 但缺少了前半句（来自pending音频的部分）

### 3.2 根本原因

**问题**: 合并pending音频后，ASR结果不完整

**执行流程**:
1. Job2合并了Job1的pendingMaxDurationAudio (940ms) ✅
2. 合并后的音频 (2760ms) 被发送到ASR服务 ✅
3. ASR服务返回: "要必要的时候提前结束本次识别" (14字符)
4. **但缺少了前半句（来自pending音频的部分）** ❌

**可能原因**:
1. **pending音频 (940ms) 太短**: ASR服务可能没有正确识别这么短的音频
2. **合并后的音频在ASR服务中被截断**: 可能只识别了音频的后半部分
3. **ASR服务的识别问题**: 可能对合并后的音频识别不完整

**需要进一步检查**:
- 合并后的音频 (2760ms) 是否完整发送到ASR服务
- ASR服务是否返回了完整的识别结果
- 是否有音频质量问题导致ASR只识别了部分内容

---

## 四、问题总结

### 4.1 Job1的问题

**根本原因**: 有pendingMaxDurationAudio时，`finalizeOriginalJob`返回`false`，不触发回调，导致`ctx.asrText`为空

**影响**: Job1发送了空结果，虽然后来通过TTL合并了文本，但已经发送了空结果

### 4.2 Job2的问题

**根本原因**: 合并pending音频后，ASR结果不完整，缺少了pending音频的部分

**影响**: Job2缺少了前半句（来自pending音频的部分）

---

## 五、需要修复的问题

### 5.1 Job1的问题修复

**问题**: 有pendingMaxDurationAudio时，不应该立即发送空结果

**修复方案**:
- 有pendingMaxDurationAudio时，应该等待pending音频被处理或TTL超时
- 不应该在`finalizeOriginalJob`返回`false`时立即发送空结果
- 应该等待TTL超时或后续batch到达后再处理

### 5.2 Job2的问题修复

**问题**: 合并pending音频后，ASR结果不完整

**需要进一步调查**:
- 合并后的音频是否完整发送到ASR服务
- ASR服务是否返回了完整的识别结果
- 是否有音频质量问题

---

*需要进一步检查代码逻辑，确定如何修复这些问题。*
