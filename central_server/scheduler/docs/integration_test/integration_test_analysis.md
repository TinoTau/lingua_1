# 集成测试 Job 处理过程分析

**日期**: 2026-01-24  
**测试结果**: 前半句丢失，utteranceIndex 不连续（0, 2, 5, 7, 9）

---

## 一、测试结果

### 1.1 原文

```
"现在我们开始进行一次语音识别稳定性测试。
我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。

接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。

如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。
否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。"
```

### 1.2 返回结果

**原文 (ASR)**:
```
[0] 开始进行一次语音识别稳低性测试
[2] 后提前结束本次识别
[5] 拆成两个不同的任务甚至出现与医生不完整都起来前后不连贯的情况
[7] 是长距能够被完整的识别出来而且不会出现半句话被提前发送或者直接丢失的现象说明我们的切分策略和超市规则是基本可用的
[9] 我们还要继续分析日治找出到底是在哪个环节包的原因吃掉了
```

**问题**:
- ❌ **丢失了前半句**："现在我们开始进行" → 只识别出 "开始进行一次语音识别稳低性测试"
- ❌ **utteranceIndex 不连续**：0, 2, 5, 7, 9（缺少 1, 3, 4, 6, 8）
- ❌ **多个短句丢失前半部分**

---

## 二、关键发现

### 2.1 BufferKey 检查（最关键）✅

**发现**: ✅ **BufferKey 没有变化**

从日志中可以看到，所有 job 的 `bufferKey` 都是 `"s-88B12A94"`：

```json
{"bufferKey":"s-88B12A94","utteranceIndex":0,...}
{"bufferKey":"s-88B12A94","utteranceIndex":2,...}
{"bufferKey":"s-88B12A94","utteranceIndex":5,...}
{"bufferKey":"s-88B12A94","utteranceIndex":7,...}
{"bufferKey":"s-88B12A94","utteranceIndex":9,...}
```

**结论**: ✅ **同一句话期间 key 没有变化**（这是好的）

### 2.2 Buffer 删除原因 ⚠️

**发现**: ⚠️ **每个 job 都删除了 buffer**

从日志中可以看到，每个 job 都显示：
```json
{
  "decisionBranch":"DELETE_BUFFER_NO_PENDING",
  "pendingTimeoutAudioLength":0,
  "pendingSmallSegmentsCount":0,
  "reason":"Buffer deleted because no pendingTimeoutAudio exists"
}
```

**问题分析**:
- ❌ **每个 job 的 `pendingTimeoutAudioLength` 都是 0**
- ❌ **说明 timeout finalize 的音频没有被缓存到 `pendingTimeoutAudio`**

### 2.3 为什么 pendingTimeoutAudio 长度为 0？

**从调度服务器日志发现**:
- 所有的 finalize 都是 `"reason":"IsFinal"`，而不是 `"Timeout"`
- 所有的 job 都显示 `"is_timeout_triggered":false`

**结论**: ⚠️ **没有 timeout finalize 的 job**

**可能原因**:
1. **客户端提前发送 `is_final=true`**: 客户端在检测到静音时立即发送 `is_final=true`，导致所有 finalize 都是 `IsFinal`（手动 finalize）
2. **调度服务器没有触发 timeout finalize**: 调度服务器的 timeout 机制没有触发

**影响**:
- 因为没有 timeout finalize，所以没有音频被缓存到 `pendingTimeoutAudio`
- 每个 job 都删除了 buffer，无法合并

---

## 三、各 Job 处理过程详细分析

### 3.1 UtteranceIndex 0

**BufferKey**: `s-88B12A94` ✅（没有变化）

**AudioAggregator 处理**:
- **输入音频时长**: 2860ms (2.86秒)
- **Buffer状态**: ⚠️ "Buffer not found, creating new buffer"
- **是否合并pending音频**: ❌ false
- **输出段数**: 1

**Buffer 删除原因**:
- **判定分支**: `DELETE_BUFFER_NO_PENDING`
- **pendingTimeoutAudio 长度**: 0 bytes
- **删除原因**: "Buffer deleted because no pendingTimeoutAudio exists"

**音频质量检查**:
- **RMS值**: 0.0629
- **阈值**: 0.015
- **结果**: ✅ **通过** (0.0629 > 0.015)

**ASR 服务处理**:
- **输入**: 91520 bytes (2860ms, PCM16格式)
- **输出**: "开始进行一次语音识别稳低性测试"
- **问题**: 丢失了 "现在我们开始进行"

### 3.2 UtteranceIndex 2

**BufferKey**: `s-88B12A94` ✅（没有变化）

**AudioAggregator 处理**:
- **输入音频时长**: 1820ms (1.82秒)
- **Buffer状态**: ⚠️ "Buffer not found, creating new buffer"
- **是否合并pending音频**: ❌ false

**Buffer 删除原因**:
- **判定分支**: `DELETE_BUFFER_NO_PENDING`
- **pendingTimeoutAudio 长度**: 0 bytes

**ASR 服务处理**:
- **输出**: "后提前结束本次识别"
- **问题**: 丢失了大部分内容，应该是 "用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别"

### 3.3 UtteranceIndex 5

**BufferKey**: `s-88B12A94` ✅（没有变化）

**AudioAggregator 处理**:
- **输入音频时长**: 5200ms (5.2秒)
- **Buffer状态**: ⚠️ "Buffer not found, creating new buffer"
- **是否合并pending音频**: ❌ false

**ASR 服务处理**:
- **输出**: "拆成两个不同的任务甚至出现与医生不完整都起来前后不连贯的情况"
- **问题**: 丢失了前半句 "从而导致前半句和后半句在节点端被拆成两个不同的 job"

### 3.4 UtteranceIndex 7

**BufferKey**: `s-88B12A94` ✅（没有变化）

**AudioAggregator 处理**:
- **输入音频时长**: 8580ms (8.58秒)
- **Buffer状态**: ⚠️ "Buffer not found, creating new buffer"
- **是否合并pending音频**: ❌ false

**ASR 服务处理**:
- **输出**: "是长距能够被完整的识别出来而且不会出现半句话被提前发送或者直接丢失的现象说明我们的切分策略和超市规则是基本可用的"
- **问题**: 丢失了前半句 "如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的"

### 3.5 UtteranceIndex 9

**BufferKey**: `s-88B12A94` ✅（没有变化）

**AudioAggregator 处理**:
- **输入音频时长**: 4420ms (4.42秒)
- **Buffer状态**: ⚠️ "Buffer not found, creating new buffer"
- **是否合并pending音频**: ❌ false

**ASR 服务处理**:
- **输出**: "我们还要继续分析日治找出到底是在哪个环节包的原因吃掉了"
- **问题**: 丢失了前半句 "否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音"

---

## 四、问题根源

### 4.1 调度服务器端问题

**问题**: 所有 finalize 都是 `IsFinal`（手动 finalize），没有 `Timeout` finalize

**原因**:
- 客户端在检测到静音时立即发送 `is_final=true`
- 调度服务器收到 `is_final=true` 后立即 finalize，导致所有 finalize 都是 `IsFinal`

**影响**:
- 因为没有 timeout finalize，所以没有音频被缓存到 `pendingTimeoutAudio`
- 每个 job 都删除了 buffer，无法合并

### 4.2 节点端问题

**问题**: 每个 job 都创建新 buffer，无法合并

**原因**:
- 每个 job 处理完成后，如果没有 pending 音频，buffer 被删除
- 下一个 job 到达时，找不到 buffer，创建新 buffer
- 无法利用之前的 buffer 进行合并

**修复状态**: ✅ **已修复**（Buffer 清除逻辑已修复，与备份代码保持一致）

### 4.3 UtteranceIndex 不连续

**问题**: utteranceIndex 不连续（0, 2, 5, 7, 9）

**可能原因**:
1. **某些 finalize 失败或被跳过**: 导致 `utterance_index` 不连续
2. **ASR 结果为空**: 某些 job 的 ASR 结果为空，没有返回给用户
3. **音频质量检查失败**: 某些 job 的音频质量检查失败，被拒绝处理

---

## 五、解决方案

### 5.1 修复 Buffer 清除逻辑（✅ 已完成）

**修改**: 与备份代码保持一致，只要有 pending 音频就保留 buffer

**效果**:
- ✅ 即使合并失败，只要 pending 音频存在，buffer 就不会被删除
- ✅ 下一个 job 能找到 buffer，可以继续合并

### 5.2 优化客户端静音检测（建议）

**建议**:
- 调整静音检测参数，避免在句子中间误触发
- 增加最小音频时长检查，避免短音频片段触发 `is_final=true`

### 5.3 优化调度服务器 finalize 逻辑（建议）

**建议**:
- 增加最小音频时长检查
- 延迟 finalize，等待更多音频累积
- 确保 `utterance_index` 连续

---

## 六、相关文档

- [前半句丢失问题分析](./missing_first_half_analysis.md)
- [任务管理](../job/README.md)
- [音频处理](../audio/README.md)
- [Finalize 处理机制](../finalize/README.md)

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24
