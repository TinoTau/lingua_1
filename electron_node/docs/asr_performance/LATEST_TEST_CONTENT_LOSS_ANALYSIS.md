# 最新集成测试内容丢失分析报告

**日期**: 2026-01-27  
**测试文本**: "现在我们开始进行一次语音识别稳定性测试。我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。"

**问题**: Job1、Job3、Job4、Job7 丢失了最后半句

---

## 一、各 Job 处理流程分析

### 1.1 Job 1 (`job-c68a7283-2135-43a9-a272-2df00c2dd8b8`，Utterance 1)

| 阶段 | 输入 | 输出 | 问题 |
|------|------|------|------|
| **AudioAggregator** | MaxDuration 触发；音频 8.84s，切分后：batch0 (1.8s) + batch1 (5.9s) + **remaining (1.14s → pendingMaxDurationAudio)** | 2 个 batch 送 ASR，剩余 1.14s 进 pending | ⚠️ **剩余 1.14s 未处理** |
| **ASR #1** | batch0 (1.8s) | 「我会先读一语音时别稳定性测试」（14 字） | ✅ |
| **ASR #2** | batch1 (5.9s) | 「两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有」（33 字） | ✅ |
| **TextMerge** | 2 个 batch 合并 | 「我会先读一语音时别稳定性测试 两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有」（48 字） | ✅ |
| **NMT** | 上述 48 字 | 「I will read a voice first and do not test stability. two short words are used to confirm that the system does not arbitrarily cut the sound between the sentences or in no way.」 | ✅ |
| **后续处理** | Job2 (utterance 2) 尝试合并 pending (1.14s) + 当前音频 (1.3s) = 2.44s | **合并后 <5s，继续等待**，但后续没有 job 再处理这个 pending | ❌ **pending 丢失** |

**丢失内容**: "必要的时候提前结束本次识别。"（约 12 字）

**根因**: pendingMaxDurationAudio (1.14s) 与后续 job 合并后 <5s，继续等待，但后续没有 job 再处理，且 TTL (10s) 未超时，导致 pending 丢失。

---

### 1.2 Job 3 (`job-a239101c-58a0-4f6a-8d91-64cf69bdb0fb`，Utterance 3)

| 阶段 | 输入 | 输出 | 问题 |
|------|------|------|------|
| **AudioAggregator** | MaxDuration 触发；音频 9.1s，切分后：batch0 (2.5s) + batch1 (6.6s) + **remaining (0s，但实际有 pendingBufferBytes)** | 2 个 batch 送 ASR，剩余进 pending | ⚠️ **剩余音频未处理** |
| **ASR #1** | batch0 (2.5s) | 「接下来这一句」（6 字） | ✅ |
| **ASR #2** | batch1 (6.6s) | 「我会尽量地延续地说的长一些中间只保留自然的呼吸节奏不做刻意的挺顿看看在超过」（37 字） | ✅ |
| **TextMerge** | 2 个 batch 合并 | 「接下来这一句 我会尽量地延续地说的长一些中间只保留自然的呼吸节奏不做刻意的挺顿看看在超过」（44 字） | ✅ |
| **NMT** | 上述 44 字 | 「Next this phrase I will try to say as long as possible in the middle only retain a natural breathing rate not do intentionally and look at it over.」 | ✅ |
| **后续处理** | Job5 (utterance 5) 处理 pending + 当前音频 → 2 个 batch：batch0 归属 job-a239101c，batch1 归属 job-12e3c695 | batch0 (25字) → job-a239101c，但 **NMT 未收到**（SequentialExecutor index 问题） | ❌ **batch0 丢失** |

**丢失内容**: "十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现"（约 50 字）

**根因**: 
1. Job3 的 pending 音频在 Job5 时被处理，batch0 被分配到 job-a239101c
2. 但 NMT 阶段，SequentialExecutor 的 index 问题导致 batch0 的 NMT 请求被拒绝（"Task index 3 is less than or equal to current index 4"）

---

### 1.3 Job 4 (`job-216f2ebc-a312-471c-893e-a1bc29cac3fa`，Utterance 4)

| 阶段 | 输入 | 输出 | 问题 |
|------|------|------|------|
| **AudioAggregator** | MaxDuration 触发；音频 8.58s，切分后：batch0 (6.2s) + **remaining (2.38s → pendingMaxDurationAudio)** | 1 个 batch 送 ASR，剩余 2.38s 进 pending | ⚠️ **剩余 2.38s 未处理** |
| **ASR #1** | batch0 (6.2s) | 「或是没有终之后系统会不会因为超时或者经营判定而下心法这句话阶段从而导致前」（36 字） | ✅ |
| **TextMerge** | 1 个 batch | 「或是没有终之后系统会不会因为超时或者经营判定而下心法这句话阶段从而导致前」（36 字） | ✅ |
| **NMT** | 上述 36 字 | 「Or without the end of the system will not be due to overtime or business judgment and this phase of phrase thereby lead to the first.」 | ✅ |
| **后续处理** | Job6 (utterance 6) 尝试合并 pending (2.38s) + 当前音频 (1.04s) = 3.42s | **合并后 <5s，继续等待**，但 Job6 的 ASR 返回空文本（RMS 太低，被拒绝） | ❌ **pending 丢失** |

**丢失内容**: "半句和后半句在节点端被拆成两个不同的 job，甚至出现"（约 20 字）

**根因**: 
1. pendingMaxDurationAudio (2.38s) 与 Job6 的音频 (1.04s) 合并后只有 3.42s (<5s)，继续等待
2. Job6 的 ASR 返回空文本（RMS=0.0009 < 0.015，被拒绝）
3. 后续没有 job 再处理这个 pending，且 TTL 未超时，导致 pending 丢失

---

### 1.4 Job 7 (`job-da2a764e-dcbe-4aa0-b457-b7c527c7c2f1`，Utterance 7)

| 阶段 | 输入 | 输出 | 问题 |
|------|------|------|------|
| **AudioAggregator** | MaxDuration 触发；音频 8.58s，切分后：batch0 (7.0s) + **remaining (1.58s → pendingMaxDurationAudio)** | 1 个 batch 送 ASR，剩余 1.58s 进 pending | ⚠️ **剩余 1.58s 未处理** |
| **ASR #1** | batch0 (7.0s) | 「这次的长距能够被完整的试炼出来而且不会出现半句话被提前发送或者直接丢失的现象那就说明我们」（44 字） | ✅ |
| **TextMerge** | 1 个 batch | 「这次的长距能够被完整的试炼出来而且不会出现半句话被提前发送或者直接丢失的现象那就说明我们」（44 字） | ✅ |
| **NMT** | 上述 44 字 | 「This long distance can be tested in full and there is no half-word phenomenon that is sent in advance or lost directly, which shows us.」 | ✅ |
| **后续处理** | Job8 (utterance 8) 尝试合并 pending (1.58s) + 当前音频 (1.82s) = 3.4s | **合并后 <5s，继续等待**，但后续没有 job 再处理这个 pending | ❌ **pending 丢失** |

**丢失内容**: "当前的切分策略和超时规则是基本可用的。"（约 16 字）

**根因**: pendingMaxDurationAudio (1.58s) 与 Job8 的音频 (1.82s) 合并后只有 3.4s (<5s)，继续等待，但后续没有 job 再处理，且 TTL 未超时，导致 pending 丢失。

---

## 二、问题根因

### 2.1 问题 1：pendingMaxDurationAudio 未处理（主要问题）

**现象**:
- Job1、Job4、Job7 的 pendingMaxDurationAudio 没有被后续 job 处理
- 原因：合并后 <5s，继续等待，但后续没有 job 再处理，且 TTL (10s) 未超时

**根因**:
- `PENDING_MAXDUR_TTL_MS = 10000ms` (10秒)
- 当 pending 与后续 job 合并后 <5s 时，继续等待下一个 job
- 但如果后续没有 job，且 TTL 未超时，pending 会一直等待，最终丢失

**日志证据**:
```json
// Job1: pending (1.14s) + Job2 (1.3s) = 2.44s (<5s)，继续等待
{"mergedDurationMs":2440,"shouldMerge":false,"mergeReason":"PENDING_MAXDUR_HOLD"}

// Job4: pending (2.38s) + Job6 (1.04s) = 3.42s (<5s)，继续等待，但Job6 ASR返回空文本
{"mergedDurationMs":3420,"shouldMerge":false,"mergeReason":"PENDING_MAXDUR_HOLD"}

// Job7: pending (1.58s) + Job8 (1.82s) = 3.4s (<5s)，继续等待
{"mergedDurationMs":3400,"shouldMerge":false,"mergeReason":"PENDING_MAXDUR_HOLD"}
```

---

### 2.2 问题 2：SequentialExecutor index 问题（Job3）

**现象**:
- Job3 的 pending 在 Job5 时被处理，batch0 被分配到 job-a239101c，ASR 返回 25 字
- 但 NMT 阶段，SequentialExecutor 拒绝处理（"Task index 3 is less than or equal to current index 4"）

**根因**:
- SequentialExecutor 的 index 检查过于严格，导致已完成的 utterance 的后续 batch 无法处理

**日志证据**:
```json
{"level":50,"error":"SequentialExecutor: Task index 3 is less than or equal to current index 4, task may have arrived too late","utteranceIndex":3,"currentIndex":4}
```

---

### 2.3 问题 3：ASR 返回空文本（Job4）

**现象**:
- Job6 的 ASR 返回空文本（RMS=0.0009 < 0.015，被拒绝）

**根因**:
- 音频质量检查（RMS 阈值）过于严格，导致有效音频被拒绝

**日志证据**:
```json
{"rms":"0.0009","minRmsThreshold":0.015,"rejectionReason":"RMS (0.0009) below minimum threshold (0.015)"}
```

---

## 三、关于小于6字符过滤的检查

**检查结果**: **不是小于6字符过滤导致的问题**

**证据**:
- 日志中没有找到 "Text too short" 或 "shouldDiscard: true" 的记录
- 所有 job 的 ASR 输出都 >= 6 字符，没有被丢弃

**实际过滤逻辑**:
- `< 6字符`: 直接丢弃（`shouldDiscard: true`）
- `6-20字符`: 等待合并（`shouldWaitForMerge: true`）
- `> 20字符`: 直接发送（`shouldSendToSemanticRepair: true`）

**结论**: 内容丢失不是由小于6字符的过滤导致的，而是由 pendingMaxDurationAudio 未处理、SequentialExecutor index 问题、ASR 返回空文本等原因导致的。

---

## 四、修复建议

### 4.1 修复 pendingMaxDurationAudio 未处理问题

**问题**: 当 pending 与后续 job 合并后 <5s 时，继续等待，但后续没有 job 时，pending 会丢失。

**修复方案**:
- 当 manual/timeout finalize 时，即使合并后 <5s，也应该强制处理 pending（避免丢失）
- 或者：降低 TTL 阈值，确保 pending 能及时被处理

**代码位置**: `audio-aggregator-finalize-handler.ts:391-431`

---

### 4.2 修复 SequentialExecutor index 问题

**问题**: SequentialExecutor 的 index 检查过于严格，导致已完成的 utterance 的后续 batch 无法处理。

**修复方案**:
- 调整 SequentialExecutor 的 index 检查逻辑，允许处理已完成的 utterance 的后续 batch

**代码位置**: `electron_node/electron-node/main/src/agent/postprocess/sequential-executor.ts`

---

### 4.3 优化 ASR 质量检查

**问题**: RMS 阈值 (0.015) 过于严格，导致有效音频被拒绝。

**修复方案**:
- 调整 RMS 阈值，或增加其他质量检查指标

**代码位置**: `electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`

---

*本报告基于 `electron-main.log` 中的日志分析。*
