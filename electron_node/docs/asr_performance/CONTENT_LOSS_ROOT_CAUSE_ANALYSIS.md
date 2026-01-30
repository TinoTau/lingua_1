# 内容丢失根因分析报告

**日期**: 2026-01-27  
**问题**: Utterance 15 和 17 的内容丢失  
**原文**: "接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。"

**实际识别结果**:
- [15] 他这一句我会尽量的连续的说得长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过
- [17] 变于医生的不完整,读起来前后不连关的情况

**丢失内容**: "十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现"

---

## 一、处理流程追踪

### 1.1 Job `job-ee8e1cef-0d30-4aff-8170-22027986de68`（Utterance 15）

| 时间 | 事件 | 详情 |
|------|------|------|
| 14:05:54.248 | MaxDuration 触发 | 音频 8.58s，切分后：batch0 (7.1s) + remaining (1.48s → pendingMaxDurationAudio) |
| 14:05:54.259 | 注册 originalJob | `originalJobId=job-ee8e1cef`, `expectedSegmentCount=1`, `batchCountForThisJob=1` |
| 14:05:55.489 | ASR 完成 | batch0 → "他这一句我会尽量的连续的说得长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过" (41字) |
| 14:05:55.489 | **TextMerge #1** | `batchCount=1`, `receivedCount=1`, `expectedSegmentCount=1` → **立即触发** |
| 14:05:57.055 | **Original job completed** | 发送到 scheduler，`textAsrLength=41` |

**关键问题**: `expectedSegmentCount=1`，收到 1 个 batch 后立即触发，originalJob 被标记为 completed。

---

### 1.2 Job `job-2a74f42d-1887-4f9a-883f-7739fd060775`（Utterance 16）

| 时间 | 事件 | 详情 |
|------|------|------|
| 14:05:59.686 | MaxDuration 触发 | 处理 job-ee8e1cef 的 `pendingMaxDurationAudio` (1.48s) + 当前音频 → 合并后 6.42s |
| 14:05:59.735 | AudioAggregator 输出 | `originalJobIds: ["job-ee8e1cef..."]`（**归属 job-ee8e1cef**，头部对齐） |
| 14:05:59.736 | 注册 originalJob | `originalJobId=job-ee8e1cef`, `expectedSegmentCount=1`, `batchCountForThisJob=1` |
| 14:05:59.782 | ASR 完成 | batch0 → "如果10秒钟之后系统会不会因为超时或者监控判定而相信把这句话解断" (32字) |
| 14:05:59.782 | **TextMerge #2** | `originalJobId=job-ee8e1cef`, `batchCount=1`, `receivedCount=1`, `expectedSegmentCount=1` → **立即触发** |

**关键问题**: 
- 这个 batch 被分配到 `job-ee8e1cef`（头部对齐：第一个片段来自 pendingMaxDurationAudio，属于 job-ee8e1cef）
- 但 `job-ee8e1cef` 的 originalJob **已经 completed**（在 14:05:57.055）
- **新注册的 originalJob**（14:05:59.736）覆盖了之前的注册，导致：
  - 之前的 batch（41字）可能被丢弃或覆盖
  - 新的 batch（32字）单独处理

---

### 1.3 Job `job-25c9d9ee-d9d4-48db-a866-f05ad19e965a`（Utterance 17）

| 时间 | 事件 | 详情 |
|------|------|------|
| 14:06:07.117 | 手动截断 | mergePendingMaxDurationAudio（job-ee8e1cef 的 pending，1.48s）+ 当前音频 (3.12s) = 7.24s |
| 14:06:07.127 | AudioAggregator 输出 | `originalJobIds: ["job-ee8e1cef...", "job-25c9d9ee..."]`（**2 个 batch，分别归属不同 job**） |
| 14:06:07.130 | 注册两个 originalJob | 
  - `originalJobId=job-ee8e1cef`, `expectedSegmentCount=1`
  - `originalJobId=job-25c9d9ee`, `expectedSegmentCount=1` |
| 14:06:07.807 | ASR #1 完成 | batch0 → "前半句和后半句在几点端被参战两个不同的任务甚至出现" (25字) → 归属 `job-ee8e1cef` |
| 14:06:07.807 | **TextMerge #3** | `originalJobId=job-ee8e1cef`, `batchCount=1`, `receivedCount=1` → **立即触发** |
| 14:06:08.757 | ASR #2 完成 | batch1 → "变于医生的不完整,读起来前后不连关的情况" (20字) → 归属 `job-25c9d9ee` |
| 14:06:08.757 | **TextMerge #4** | `originalJobId=job-25c9d9ee`, `batchCount=1`, `receivedCount=1` → **立即触发** |

**关键问题**:
- batch0 被分配到 `job-ee8e1cef`（头部对齐：第一个片段来自 pendingMaxDurationAudio）
- batch1 被分配到 `job-25c9d9ee`（头部对齐：第一个片段来自当前 job）
- **两个 batch 被分配到不同的 originalJob，无法合并**

---

## 二、根因分析

### 2.1 问题 1：OriginalJob 重复注册导致覆盖

**现象**:
- `job-ee8e1cef` 的 originalJob 被注册了**3 次**：
  1. Utterance 15: `expectedSegmentCount=1` → 收到 1 个 batch → completed
  2. Utterance 16: `expectedSegmentCount=1` → 收到 1 个 batch → completed（**覆盖了之前的注册**）
  3. Utterance 17: `expectedSegmentCount=1` → 收到 1 个 batch → completed（**再次覆盖**）

**根因**:
- `OriginalJobResultDispatcher.registerOriginalJob()` 可能**没有检查 originalJob 是否已存在**
- 或者：已存在的 originalJob 被**新注册覆盖**，导致之前的 `accumulatedSegments` 丢失

**日志证据**:
```json
// Utterance 15 (14:05:54.259)
{"originalJobId":"job-ee8e1cef-0d30-4aff-8170-22027986de68","expectedSegmentCount":1,"registrationTtlMs":10000}

// Utterance 16 (14:05:59.736) - 重新注册
{"originalJobId":"job-ee8e1cef-0d30-4aff-8170-22027986de68","expectedSegmentCount":1,"registrationTtlMs":10000}

// Utterance 17 (14:06:07.130) - 再次重新注册
{"originalJobId":"job-ee8e1cef-0d30-4aff-8170-22027986de68","expectedSegmentCount":1,"registrationTtlMs":10000}
```

---

### 2.2 问题 2：头部对齐导致跨 job 分割

**现象**:
- Utterance 17 的 2 个 batch 被分配到不同的 originalJob：
  - batch0 → `job-ee8e1cef`（第一个片段来自 pendingMaxDurationAudio）
  - batch1 → `job-25c9d9ee`（第一个片段来自当前 job）

**根因**:
- AudioAggregator 的头部对齐实现：每个 batch 使用**第一个片段**所属的 jobId
- 当 mergePendingMaxDurationAudio 时，如果 pending 音频属于前一个 job，会导致 batch 被分配到前一个 job
- **设计意图**：同一 utterance finalize 的所有 batch 应该合并到同一个 originalJob
- **实际实现**：按第一个片段所属 job 分配，导致跨 job 分割

**日志证据**:
```json
{"originalJobIds":["job-ee8e1cef-0d30-4aff-8170-22027986de68","job-25c9d9ee-d9d4-48db-a866-f05ad19e965a"]}
```

---

### 2.3 问题 3：ExpectedSegmentCount 计算错误

**现象**:
- 每个 batch 单独注册 originalJob，`expectedSegmentCount=1`
- 收到 1 个 batch 后立即触发，无法等待其他 batch

**根因**:
- `batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length`
- 在 Utterance 17 中：
  - `originalJobIds = ["job-ee8e1cef", "job-25c9d9ee"]`
  - 对于 `job-ee8e1cef`：`batchCountForThisJob = 1`（正确，因为只有 batch0 归属它）
  - 对于 `job-25c9d9ee`：`batchCountForThisJob = 1`（正确，因为只有 batch1 归属它）
- **但设计意图是**：如果两个 batch 都属于同一个 utterance，应该合并到同一个 originalJob，`expectedSegmentCount=2`

---

## 三、丢失内容的具体位置

### 3.1 原文分段

| 段落 | 内容 | 对应 ASR 结果 |
|------|------|--------------|
| 1 | "接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过" | Utterance 15: "他这一句我会尽量的连续的说得长一些中间只保留自然的呼吸节奏不做刻意的停顿看看在超过" |
| 2 | "十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致" | **丢失**（应该在 Utterance 16，但被覆盖） |
| 3 | "前半句和后半句在节点端被拆成两个不同的 job，甚至出现" | Utterance 17 batch0: "前半句和后半句在几点端被参战两个不同的任务甚至出现" |
| 4 | "语义上不完整、读起来前后不连贯的情况。" | Utterance 17 batch1: "变于医生的不完整,读起来前后不连关的情况" |

### 3.2 丢失原因

1. **段落 2 丢失**：
   - Utterance 16 的 batch 被分配到 `job-ee8e1cef`
   - 但 `job-ee8e1cef` 的 originalJob 已 completed（Utterance 15）
   - 新注册的 originalJob 覆盖了之前的注册，导致段落 2 的文本（32字）**覆盖或丢弃了段落 1 的文本（41字）**
   - 最终只保留了段落 2 的文本："如果10秒钟之后系统会不会因为超时或者监控判定而相信把这句话解断"

2. **段落 3 和 4 分离**：
   - Utterance 17 的 2 个 batch 被分配到不同的 originalJob
   - batch0 → `job-ee8e1cef` → 单独处理
   - batch1 → `job-25c9d9ee` → 单独处理
   - **两个文本无法合并**

---

## 四、结论

### 4.1 根本原因

1. **OriginalJob 重复注册导致覆盖**：
   - `OriginalJobResultDispatcher` 没有正确处理已存在的 originalJob
   - 新注册覆盖了之前的注册，导致之前的 `accumulatedSegments` 丢失

2. **头部对齐导致跨 job 分割**：
   - mergePendingMaxDurationAudio 时，pending 音频的 batch 被分配到前一个 job
   - 同一 utterance 的多个 batch 无法合并到同一个 originalJob

3. **ExpectedSegmentCount 计算错误**：
   - 每个 batch 单独注册，`expectedSegmentCount=1`
   - 无法等待其他 batch 到达

### 4.2 修复建议

1. **修复 OriginalJob 重复注册**：
   - 在 `registerOriginalJob()` 中检查 originalJob 是否已存在
   - 如果已存在，**追加 batch** 而不是覆盖：
     ```typescript
     if (registration.exists) {
       registration.expectedSegmentCount += batchCountForThisJob;
       // 不要重置 accumulatedSegments
     }
     ```

2. **修复头部对齐逻辑**：
   - 当 mergePendingMaxDurationAudio 时，如果当前是 manual/timeout finalize，**统一使用当前 job 作为所有 batch 的 originalJobId**
   - 或者：在 mergePendingMaxDurationAudio 时，**将 pending 音频的 batch 也归属到当前 job**

3. **修复 ExpectedSegmentCount 计算**：
   - 在 mergePendingMaxDurationAudio 时，**正确计算属于同一 originalJob 的 batch 数量**
   - 确保 `expectedSegmentCount` 等于该 originalJob 的所有 batch 数量

---

*本报告基于 `electron-main.log` 中的 `originalJobIds`、`TextMerge`、`expectedSegmentCount` 等日志字段分析。*
