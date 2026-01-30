# 备份代码 AggregatorMiddleware 分析

**日期**: 2026-01-24  
**目的**: 分析备份代码中 AggregatorMiddleware 的处理机制

---

## 一、关键发现

### 1.1 备份代码也有同样的问题

**日志显示**：
- ✅ `hasAggregatorManager: true` - AggregatorManager 已启用
- ❌ 所有 job 的 `action: "NEW_STREAM"` - 没有被合并
- ❌ 关键原因：`lastUtteranceIsManualCut: true` - 上一个 utterance 有手动截断标识

**结论**：✅ **备份代码也有同样的问题**（所有 job 都被判定为 `NEW_STREAM`）

### 1.2 为什么备份代码结果完美？

**关键区别：AudioAggregator 合并了音频**

**备份代码日志**：
```json
// utterance_index=4
{
  "jobId": "s-A3DF9711:102",
  "utteranceIndex": 4,
  "pendingAudioDurationMs": 9100,
  "currentAudioDurationMs": 1040,
  "mergedAudioDurationMs": 10140,
  "msg": "AudioAggregatorFinalizeHandler: Merging pendingTimeoutAudio with current audio"
}
```

**关键发现**：
- ✅ **AudioAggregator 在调度器 finalize 之前合并了音频**
- ✅ `utterance_index=3` 的音频（9100ms）被缓冲到 `pendingTimeoutAudio`
- ✅ `utterance_index=4` 的音频（1040ms）到达时，与 `pendingTimeoutAudio` 合并
- ✅ 合并后的音频（10140ms）作为一个完整的 job 发送给 ASR
- ✅ ASR 返回完整的结果

---

## 二、根本原因对比

### 2.1 备份代码的处理流程

```
客户端发送音频块
    ↓
调度器接收音频块（未 finalize）
    ↓
节点端 AudioAggregator 缓冲音频（pendingTimeoutAudio）
    ↓
调度器 finalize（reason="IsFinal" 或 "Timeout"）
    ↓
调度器创建 job（is_manual_cut=true）
    ↓
节点端接收 job
    ↓
AudioAggregatorFinalizeHandler 合并 pendingTimeoutAudio 和当前音频
    ↓
合并后的完整音频发送给 ASR
    ↓
ASR 返回完整结果
    ↓
AggregatorMiddleware 处理（action=NEW_STREAM，但文本已经完整）
```

### 2.2 当前代码的处理流程

```
客户端发送音频块
    ↓
调度器接收音频块
    ↓
调度器立即 finalize（reason="IsFinal"）
    ↓
调度器创建 job（is_manual_cut=true）
    ↓
节点端接收 job（音频已经被 finalize，无法合并）
    ↓
AudioAggregator 无法找到 pendingTimeoutAudio（因为已经 finalize）
    ↓
每个 job 都是独立的短音频
    ↓
ASR 返回不完整结果（只有后半句）
    ↓
AggregatorMiddleware 处理（action=NEW_STREAM，文本不完整，无法合并）
```

---

## 三、关键区别

### 3.1 AudioAggregator 的合并时机

**备份代码**：
- AudioAggregator 在**调度器 finalize 之前**缓冲音频
- 当新的音频到达时，与 `pendingTimeoutAudio` 合并
- 合并后的完整音频作为一个 job 发送给 ASR

**当前代码**：
- 调度器**立即 finalize**（收到 `is_final=true` 后）
- AudioAggregator 无法找到 `pendingTimeoutAudio`（因为已经 finalize）
- 每个 job 都是独立的短音频

### 3.2 为什么备份代码的 AudioAggregator 能合并？

**关键代码**（备份代码）：
```typescript
// AudioAggregatorFinalizeHandler
if (utteranceIndexDiff === 1) {
  // 连续的utteranceIndex，允许合并（超时finalize的正常场景）
  mergePendingTimeoutAudio();
}
```

**关键发现**：
- 备份代码中，`utterance_index=3` 的音频被缓冲到 `pendingTimeoutAudio`
- `utterance_index=4` 的音频到达时，检测到 `utteranceIndexDiff === 1`（连续）
- 允许合并 `pendingTimeoutAudio` 和当前音频
- 合并后的完整音频（10140ms）作为一个 job 发送给 ASR

---

## 四、结论

### 4.1 备份代码也有同样的问题

✅ **备份代码的 AggregatorMiddleware 也有同样的问题**：
- 所有 job 都被判定为 `NEW_STREAM`
- 因为 `lastUtterance.isManualCut === true`

### 4.2 但备份代码结果完美

✅ **备份代码结果完美的原因**：
- **AudioAggregator 在调度器 finalize 之前合并了音频**
- 即使调度器 finalize 成多个 job，AudioAggregator 也会在节点端合并
- 合并后的完整音频作为一个 job 发送给 ASR
- ASR 返回完整结果，即使 `AggregatorMiddleware` 没有合并文本，结果也是完整的

### 4.3 当前代码的问题

❌ **当前代码的问题**：
- 调度器**立即 finalize**（收到 `is_final=true` 后）
- AudioAggregator 无法合并音频（因为已经 finalize）
- 每个 job 都是独立的短音频
- ASR 返回不完整结果（只有后半句）
- `AggregatorMiddleware` 无法合并文本（因为 `isManualCut=true`，强制 `NEW_STREAM`）

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
