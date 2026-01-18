# 头部对齐 ASR 结果分配机制

## 概述

在流式ASR处理中，多个job的音频可能被合并处理，然后根据**头部对齐策略**将ASR结果分配给原始job_id。

---

## 核心逻辑

### 1. 音频合并

当 Job 618 超时finalize时：
- 音频被缓存到 `pendingTimeoutAudio`
- 保存 `pendingTimeoutJobInfo`（记录 Job 618 的音频字节偏移范围）

当 Job 619 到达时（手动/pause finalize）：
- 合并 `pendingTimeoutAudio`（来自 Job 618）+ 当前音频（来自 Job 619）
- 合并 `jobInfoToProcess = [...pendingJobInfo, ...currentJobInfo]`
- 音频被切分成多个批次（每批≥5秒）

### 2. 头部对齐分配策略

**分配逻辑**（`assignOriginalJobIdsForBatches`）：
```typescript
for (const batch of batches) {
  // 计算批次的字节偏移范围
  const batchStartOffset = currentOffset;
  const batchEndOffset = currentOffset + batch.length;
  
  // 找到第一个与批次有重叠的job（头部对齐）
  for (const info of jobInfo) {
    if (info.startOffset < batchEndOffset && info.endOffset > batchStartOffset) {
      assignedJobId = info.jobId;  // 使用第一个匹配的job
      break;
    }
  }
  
  originalJobIds.push(assignedJobId);
}
```

**关键点**：
- **头部对齐**：使用第一个与批次有重叠的 job，作为该批次的 originalJobId
- **结果**：如果所有批次都落在 Job 618 的范围内，所有结果都会分配给 Job 618

---

## 实际场景示例

### 场景1：所有批次都分配给 Job 618

```
Job 618 (utteranceIndex:5):
  - 音频：0-282880 字节（8.84秒）
  - 超时finalize，缓存到 pendingTimeoutAudio

Job 619 (utteranceIndex:6):
  - 音频：282880-565760 字节（8.84秒）
  - 手动finalize，合并 pendingTimeoutAudio + 当前音频
  - 合并后音频：0-565760 字节（17.68秒）
  - 切分成批次：
    - Batch 1: 0-282880 字节 → originalJobId: 618 ✅
    - Batch 2: 282880-565760 字节 → originalJobId: 618 ✅（因为 Job 618 的范围是 0-282880，与 Batch 2 有重叠）
  
结果：所有ASR结果分配给 Job 618，发送给调度服务器（job_id: 618）
Job 619 不发送结果（因为所有结果都属于 Job 618）
```

### 场景2：部分批次分配给 Job 619

```
Job 618 (utteranceIndex:5):
  - 音频：0-141440 字节（4.42秒）
  - 超时finalize，缓存到 pendingTimeoutAudio

Job 619 (utteranceIndex:6):
  - 音频：141440-424320 字节（8.84秒）
  - 手动finalize，合并 pendingTimeoutAudio + 当前音频
  - 合并后音频：0-424320 字节（13.26秒）
  - 切分成批次：
    - Batch 1: 0-141440 字节 → originalJobId: 618 ✅
    - Batch 2: 141440-282880 字节 → originalJobId: 618 ✅（与 Job 618 有重叠）
    - Batch 3: 282880-424320 字节 → originalJobId: 619 ✅（超出 Job 618 范围，属于 Job 619）
  
结果：
- Batch 1-2 的ASR结果分配给 Job 618，发送给调度服务器（job_id: 618）
- Batch 3 的ASR结果分配给 Job 619，发送给调度服务器（job_id: 619）
```

---

## 代码位置

**AudioAggregator**：
- `assignOriginalJobIdsForBatches()` - 为批次分配 originalJobId（头部对齐策略）
- `assignOriginalJobIds()` - 为音频段分配 originalJobId（已废弃，保留用于兼容）

**ASR Step**：
- `asr-step.ts` - 处理 originalJobIds，通过 `OriginalJobResultDispatcher` 分配结果

---

## 与去重逻辑的关系

**关键点**：
- 一个 job_id 只发送一次结果（去重逻辑假设）
- 头部对齐确保：**如果 Job 618 和 Job 619 的音频合并后，所有批次都分配给 Job 618，那么 Job 619 不会发送任何结果**
- 只有当 Job 619 有新的音频批次（超出 Job 618 范围）时，才会发送 Job 619 的结果

**示例**：
```
Job 618: 发送结果（包含合并后的所有ASR结果）
Job 619: 不发送结果（因为所有结果都属于 Job 618）
```

或

```
Job 618: 发送结果（包含 Job 618 部分的ASR结果）
Job 619: 发送结果（包含 Job 619 部分的ASR结果）
```

---

## 总结

**头部对齐策略**：
- 根据音频字节偏移，找到第一个与批次有重叠的 job，作为该批次的 originalJobId
- 如果所有批次都落在 Job 618 的范围内，所有结果都会分配给 Job 618
- 只有当 Job 619 有新的音频批次（超出 Job 618 范围）时，才会分配给 Job 619

**结果发送**：
- Job 618 和 Job 619 的结果会被合并到 Job 618，然后发送给调度服务器（如果所有批次都分配给 Job 618）
- 只有当 Job 619 里有新的 ASR 批次（不属于 Job 618 的），才会返回 Job 619 的结果
