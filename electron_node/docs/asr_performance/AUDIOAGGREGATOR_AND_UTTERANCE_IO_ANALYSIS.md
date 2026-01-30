# AudioAggregator 与 Utterance 阶段输入/输出分析

**日期**: 2026-01-27  
**分析目标**: 确认每个 job 在 AudioAggregator 和 Utterance 阶段的输入/输出是否符合预期

---

## 一、设计预期

### AudioAggregator 阶段
- **输入**: 当前 chunk + buffer 状态（可能包含 pendingMaxDurationAudio / pendingTimeoutAudio）
- **处理**: 按能量切分，合并成 ~5s 批次
- **输出**: 
  - `audioSegments[]`（切分后的音频段）
  - `originalJobIds[]`（每个 batch 归属的 job，按**头部对齐**：batch 的第一个片段所属的 job）

### Utterance 聚合阶段（OriginalJobResultDispatcher）
- **输入**: 多个 ASR batch 的结果（每个 batch 有 `originalJobId`、`batchIndex`、`asrText`）
- **处理**: 
  - 按 `originalJobId` 分组
  - 等待同一 `originalJobId` 的所有 batch 都返回（`receivedCount >= expectedSegmentCount`）
  - 按 `batchIndex` 排序
  - 合并文本：`fullText = sortedSegments.map(s => s.asrText).join(' ')`
- **输出**: 合并后的完整文本 → 送 NMT

---

## 二、各 Job 实际输入/输出

### 2.1 符合预期的 Job

#### ✅ Job `job-0cc12002…`（Utterance 0，首句）

| 阶段 | 输入 | 输出 | 是否符合预期 |
|------|------|------|------------|
| **AudioAggregator** | 手动截断；新建 buffer → FINALIZING → 按能量切分 | `originalJobIds: ["job-0cc12002..."]`（1 个 batch） | ✅ 符合 |
| **Utterance** | ASR batch #0（16 字） | 合并文本：「我开始进行一次运营识别稳定性测试」（16 字）→ 送 NMT | ✅ 符合 |

**日志证据**:
```json
{"originalJobIds":["job-0cc12002-6762-47d0-9130-008977e758c4"],"expectedSegmentCount":1}
{"operation":"mergeASRText","batchCount":1,"batchTexts":[{"batchIndex":0,"textLength":16}]}
```

---

#### ✅ Job `job-bc0927cc…`（Utterance 1，MaxDuration 触发）

| 阶段 | 输入 | 输出 | 是否符合预期 |
|------|------|------|------------|
| **AudioAggregator** | MaxDuration 触发；按能量切分 | `originalJobIds: ["job-bc09...", "job-bc09..."]`（2 个 batch，**都归属 job-bc09**） | ✅ 符合 |
| **Utterance** | ASR batch #0（6 字）+ batch #1（35 字） | 合并文本：「我会先读一读 这一两句比较短的话...」（42 字）→ 送 NMT | ✅ 符合 |

**日志证据**:
```json
{"originalJobIds":["job-bc0927cc-79fd-4751-ad70-98c77e40d133","job-bc0927cc-79fd-4751-ad70-98c77e40d133"],"expectedSegmentCount":2}
{"operation":"mergeASRText","batchCount":2,"batchTexts":[{"batchIndex":0,"textLength":6},{"batchIndex":1,"textLength":35}],"mergedTextLength":42}
```

---

#### ✅ Job `job-66d64331…`（Utterance 3，MaxDuration 触发）

| 阶段 | 输入 | 输出 | 是否符合预期 |
|------|------|------|------------|
| **AudioAggregator** | MaxDuration 触发；按能量切分 | `originalJobIds: ["job-66d6...", "job-66d6..."]`（2 个 batch，**都归属 job-66d6**） | ✅ 符合 |
| **Utterance** | ASR batch #0（4 字）+ batch #1（39 字） | 合并文本：「接下来最 这一句我会尽量连续的说的长一些...」（44 字）→ 送 NMT | ✅ 符合 |

**日志证据**:
```json
{"originalJobIds":["job-66d64331-39d6-444b-8b11-7f9cb16f6640","job-66d64331-39d6-444b-8b11-7f9cb16f6640"],"expectedSegmentCount":2}
{"operation":"mergeASRText","batchCount":2,"batchTexts":[{"batchIndex":0,"textLength":4},{"batchIndex":1,"textLength":39}],"mergedTextLength":44}
```

---

#### ✅ Job `job-6d136f14…`（Utterance 4，MaxDuration 后续）

| 阶段 | 输入 | 输出 | 是否符合预期 |
|------|------|------|------------|
| **AudioAggregator** | MaxDuration 触发；前 ≥5s 已送 ASR，剩余进 pending；当前 finalize 时合并 pending | `originalJobIds: ["job-66d6..."]`（1 个 batch，**归属 job-66d6**，不是当前 job） | ✅ 符合（头部对齐：第一个片段来自 job-66d6 的 pending） |
| **Utterance** | ASR batch #0（34 字） | 合并文本：「10秒钟之后系统会不会因为超时...」（34 字）→ 送 NMT（但该 originalJob 可能已 finalize，未送 NMT） | ⚠️ 部分符合（文本合并正确，但 NMT 未调用） |

**日志证据**:
```json
{"originalJobIds":["job-66d64331-39d6-444b-8b11-7f9cb16f6640"],"expectedSegmentCount":1}
{"operation":"mergeASRText","batchCount":1,"batchTexts":[{"batchIndex":0,"textLength":34}],"mergedTextLength":34}
```

**说明**: 该 batch 被正确分配到 `job-66d6...`（头部对齐），但该 originalJob 可能已 finalize，导致 NMT 未调用。

---

### 2.2 不符合预期的 Job（**重点**）

#### ❌ Job `job-25c9d9ee…`（Utterance 17，手动截断 + mergePendingMaxDurationAudio）

| 阶段 | 输入 | 输出 | 是否符合预期 |
|------|------|------|------------|
| **AudioAggregator** | 手动截断 + mergePendingMaxDurationAudio（合并 job-ee8e... 的 pendingMaxDurationAudio）→ 按能量切分 | `originalJobIds: ["job-ee8e1cef...", "job-25c9d9ee..."]`（2 个 batch，**分别归属不同 job**） | ⚠️ **头部对齐正确，但导致跨 job 分割** |
| **Utterance** | ASR batch #0（25 字，归属 job-ee8e...）+ batch #1（20 字，归属 job-25c9...） | **job-ee8e...**: 合并文本「前半句和后半句...」（25 字）→ 送 NMT<br>**job-25c9...**: 合并文本「变于医生的不完整...」（20 字）→ 送 NMT | ❌ **不符合预期**：两个 batch 被分配到不同的 originalJob，分别处理，导致文本无法合并 |

**日志证据**:
```json
// AudioAggregator 输出
{"originalJobIds":["job-ee8e1cef-0d30-4aff-8170-22027986de68","job-25c9d9ee-d9d4-48db-a866-f05ad19e965a"]}

// 注册两个 originalJob
{"originalJobId":"job-ee8e1cef-0d30-4aff-8170-22027986de68","expectedSegmentCount":1,"batchCountForThisJob":1}
{"originalJobId":"job-25c9d9ee-d9d4-48db-a866-f05ad19e965a","expectedSegmentCount":1,"batchCountForThisJob":1}

// TextMerge - job-ee8e1cef（只收到 batch #0）
{"originalJobId":"job-ee8e1cef-0d30-4aff-8170-22027986de68","operation":"mergeASRText","batchCount":1,"batchTexts":[{"batchIndex":0,"textLength":25,"textPreview":"前半句和后半句在几点端被参战两个不同的任务甚至出现"}]}

// TextMerge - job-25c9d9ee（只收到 batch #1）
{"originalJobId":"job-25c9d9ee-d9d4-48db-a866-f05ad19e965a","operation":"mergeASRText","batchCount":1,"batchTexts":[{"batchIndex":1,"textLength":20,"textPreview":"变于医生的不完整,读起来前后不连关的情况"}]}
```

**问题根因**:
1. **AudioAggregator 头部对齐正确**：batch0 的第一个片段来自 `pendingMaxDurationAudio`（属于 job-ee8e...），所以 `originalJobId = job-ee8e...`；batch1 的第一个片段来自当前 job，所以 `originalJobId = job-25c9...`。
2. **但设计意图是**：如果两个 batch 都属于同一个 utterance（当前 job 的 finalize），应该合并到同一个 originalJob。
3. **实际结果**：两个 batch 被分配到不同的 originalJob，分别触发处理，导致：
   - job-ee8e... 收到 batch #0，立即触发（expectedSegmentCount=1），送 NMT
   - job-25c9... 收到 batch #1，立即触发（expectedSegmentCount=1），送 NMT
   - **两个文本无法合并**

---

### 2.3 有聚合无 ASR/NMT 的 Job

#### ⚠️ Job `job-8a192db0…`（Utterance 2）、`job-837fc3ac…`（Utterance 18）等

| 阶段 | 输入 | 输出 | 是否符合预期 |
|------|------|------|------------|
| **AudioAggregator** | 手动截断；mergePendingMaxDurationAudio 但合并后 &lt;5s | `originalJobIds: []`（0 个 batch，不送 ASR） | ✅ 符合（&lt;5s 不送 ASR） |
| **Utterance** | 无 ASR batch | 无文本 → 无 NMT | ✅ 符合 |

**日志证据**:
```json
{"originalJobIds":[],"batchesCount":0,"segmentsCount":0}
```

---

## 三、符合预期情况汇总

| Job | Utterance | AudioAggregator 输出 | Utterance 聚合 | 是否符合预期 |
|-----|-----------|---------------------|----------------|------------|
| `job-0cc12002…` | 0 | 1 batch → `["job-0cc..."]` | 1 batch → 16 字 → NMT | ✅ |
| `job-bc0927cc…` | 1 | 2 batch → `["job-bc09...", "job-bc09..."]` | 2 batch → 42 字（合并）→ NMT | ✅ |
| `job-66d64331…` | 3 | 2 batch → `["job-66d6...", "job-66d6..."]` | 2 batch → 44 字（合并）→ NMT | ✅ |
| `job-6d136f14…` | 4 | 1 batch → `["job-66d6..."]`（归属前一个 job） | 1 batch → 34 字 → NMT 未调用 | ⚠️ 部分 |
| `job-ee117dd3…` | 6 | 1 batch → `["job-ee11..."]` | 1 batch → 42 字 → NMT | ✅ |
| `job-ee8e1cef…` | 15 | 1 batch → `["job-ee8e..."]` | 1 batch → 41 字 → NMT | ✅ |
| `job-2a74f42d…` | 16 | 1 batch → `["job-2a74..."]` | 1 batch → 32 字 → NMT 未调用 | ⚠️ 部分 |
| `job-54f932e6…` | 8 | 3 batch → `["job-54f9...", "job-54f9...", "job-54f9..."]` | 3 batch → 32 字（合并，含 1 个空 batch）→ NMT | ✅ |
| `job-8a192db0…` | 2 | 0 batch（&lt;5s 不送） | 无 → 无 NMT | ✅ |
| `job-837fc3ac…` | 18 | 0 batch（空 chunk） | 无 → 无 NMT | ✅ |

---

## 四、不符合预期情况汇总

### ❌ Job `job-25c9d9ee…`（Utterance 17）

| 阶段 | 预期 | 实际 | 问题 |
|------|------|------|------|
| **AudioAggregator** | 2 个 batch 都归属当前 job（job-25c9...） | batch0 → `job-ee8e...`，batch1 → `job-25c9...` | 头部对齐导致跨 job 分割 |
| **Utterance** | 2 个 batch 合并后送 NMT | batch0 → job-ee8e... 单独处理；batch1 → job-25c9... 单独处理 | **文本无法合并，ASR #1 丢失** |

**根本原因**:
- **AudioAggregator 头部对齐实现正确**，但**设计意图与实现存在冲突**：
  - 设计意图：同一 utterance（当前 job finalize）的所有 batch 应该合并到同一个 originalJob。
  - 实际实现：每个 batch 按**第一个片段**所属的 job 分配，如果第一个片段来自 pendingMaxDurationAudio（属于前一个 job），则归属前一个 job。
- **结果**：当 mergePendingMaxDurationAudio 时，如果 pending 音频的第一个片段属于前一个 job，会导致 batch 被分配到前一个 job，无法与当前 job 的 batch 合并。

---

## 五、结论

### ✅ 符合预期的部分

1. **AudioAggregator 头部对齐**：实现正确，每个 batch 使用第一个片段对应的 jobId。
2. **单 job 多 batch 合并**：如 job-bc09...、job-66d6...，2 个 batch 都归属同一 job，正确合并。
3. **空音频处理**：&lt;5s 或空 chunk 不送 ASR，符合预期。

### ❌ 不符合预期的部分

1. **跨 job 合并场景**：job-25c9... 中，mergePendingMaxDurationAudio 导致 2 个 batch 被分配到不同的 originalJob，无法合并。
   - **设计意图**：同一 utterance finalize 的所有 batch 应该合并。
   - **实际实现**：按第一个片段所属 job 分配，导致跨 job 分割。

### ⚠️ 需要优化的部分

1. **MaxDuration + pending 合并**：job-6d13... 的 batch 被分配到前一个 job（job-66d6...），但该 job 可能已 finalize，导致 NMT 未调用。
2. **有聚合无 ASR/NMT**：部分 job 有 AudioAggregator 处理但无 ASR/NMT，需排查是否为空音频、过滤或合并到其他 job。

---

## 六、建议

1. **修复跨 job 合并问题**：
   - 当 mergePendingMaxDurationAudio 时，如果 pending 音频属于前一个 job，但当前是 manual/timeout finalize，**应该将 pending 音频的 batch 也归属到当前 job**，而不是前一个 job。
   - 或者：在 mergePendingMaxDurationAudio 时，**统一使用当前 job 作为所有 batch 的 originalJobId**。

2. **验证 expectedSegmentCount 计算**：
   - 确保 `batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length` 正确计算了属于同一 originalJob 的 batch 数量。

3. **排查有聚合无 ASR/NMT**：
   - 检查日志中的 `EMPTY_INPUT`、`shouldReturnEmpty`、`NO_TEXT_ASSIGNED` 等标识。

---

*本报告基于 `electron-main.log` 中的 `originalJobIds`、`TextMerge`、`expectedSegmentCount` 等日志字段分析。*
