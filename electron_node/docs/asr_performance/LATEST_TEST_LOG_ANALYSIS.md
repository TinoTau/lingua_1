# 最新测试日志分析报告

**日期**: 2026-01-28  
**日志文件**: `electron-node/logs/electron-main.log`  
**SessionId**: `s-03C5761E`

---

## 一、Job处理流程分析

### 1.1 Job0 (utteranceIndex: 0)

**JobId**: `job-4bd4049b-2e9c-4828-b8cb-11c9ce3bc77a`

**处理流程**:
1. ✅ ASR批次: 1个批次
2. ✅ TextMerge: 合并成功，文本长度14字符
3. ✅ 最终文本: "開始進行次語音識別穩定性測試"

**问题**:
- ❌ **缺少前半句**: 原文应该是"現在我們開始進行一次語音識別穩定性測試"，但只识别出"開始進行次語音識別穩定性測試"
- ❌ **缺少"現在我們"**: 可能是音频切分问题，或者ASR服务没有识别出开头部分

**日志关键信息**:
```json
{
  "utteranceIndex": 0,
  "batchCount": 1,
  "mergedTextPreview": "開始進行次語音識別穩定性測試",
  "mergedTextLength": 14
}
```

---

### 1.2 Job1 (utteranceIndex: 1)

**JobId**: `job-48b44de3-d07b-42f8-a7db-0cfed330f0c5`

**处理流程**:
1. ✅ ASR批次: 2个批次
   - Batch0: "我會先讀音樂" (6字符)
   - Batch1: "一兩句比較短的話,通來確認系統會不會在句子之間隨意的把語音切斷或者在沒有?" (37字符)
2. ⚠️ **TTL超时**: 通过`forceFinalizePartial`触发finalize
3. ✅ TextMerge: 合并成功，文本长度44字符
4. ✅ 最终文本: "我會先讀音樂 一兩句比較短的話,通來確認系統會不會在句子之間隨意的把語音切斷或者在沒有?"

**问题**:
- ⚠️ **TTL超时**: 通过`forceFinalizePartial`触发，标记为`isPartial: true`
- ❌ **文本不完整**: 原文应该是"我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。"，但只识别到"或者在沒有?"，缺少"必要的时候提前结束本次识别。"

**日志关键信息**:
```json
{
  "utteranceIndex": 1,
  "batchCount": 2,
  "triggerPath": "forceFinalizePartial",
  "reason": "registration_ttl",
  "isPartial": true,
  "mergedTextPreview": "我會先讀音樂 一兩句比較短的話,通來確認系統會不會在句子之間隨意的把語音切斷或者在沒有?"
}
```

---

### 1.3 Job2 (utteranceIndex: 2)

**JobId**: `job-895d2ba7-109a-47c3-9f91-8e40a7bd9858`

**处理流程**:
1. ✅ ASR批次: 1个批次
2. ✅ TextMerge: 合并成功，文本长度14字符
3. ✅ 最终文本: "第二的時候,提前結束本次識別"

**问题**:
- ❌ **文本错误**: 原文应该是"接下来这一句我会尽量连续地说得长一些..."，但识别出"第二的時候,提前結束本次識別"
- ❌ **Job顺序混乱**: Job2的文本应该是Job1的后续部分，但被识别为独立的句子

**日志关键信息**:
```json
{
  "utteranceIndex": 2,
  "batchCount": 1,
  "mergedTextPreview": "第二的時候,提前結束本次識別",
  "mergedTextLength": 14
}
```

---

### 1.4 Job3 (utteranceIndex: 3)

**JobId**: `job-ddc93d65-bc50-4236-9311-1fc575799d60`

**处理流程**:
1. ✅ ASR批次: 3个批次
   - Batch0: "接下來最." (5字符)
   - Batch1: "一句,我會盡量連續的說的長一些中間直報" (19字符)
   - Batch2: "留自然的呼吸節奏不做刻意的停頓看看在超過10秒鐘之後系統會不會因為超市或者經營判定而詳細把這句話解斷" (54字符)
2. ✅ TextMerge: 合并成功，文本长度80字符
3. ✅ 最终文本: "接下來最. 一句,我會盡量連續的說的長一些中間直報 留自然的呼吸節奏不做刻意的停頓看看在超過10秒鐘之後系統會不會因為超市或者經營判定而詳細把這句話解斷雖然導致"

**问题**:
- ❌ **文本不完整**: 缺少"虽然导致"后面的内容："从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。"

**日志关键信息**:
```json
{
  "utteranceIndex": 3,
  "batchCount": 3,
  "mergedTextPreview": "接下來最. 一句,我會盡量連續的說的長一些中間直報 留自然的呼吸節奏不做刻意的停頓看看在超過10秒鐘之後系統會不會因為超市或者經營判定而詳細把這句話解斷雖然導致"
}
```

**关键发现**:
- Batch2被分配到了Job3的`originalJobId`，但实际上Batch2的音频可能属于Job4
- Job4被标记为"Empty container"，说明Job4没有收到任何batch

---

### 1.5 Job4 (utteranceIndex: 4)

**JobId**: `job-93255353-59c8-4184-9471-b27f36333084`

**处理流程**:
1. ⚠️ **空容器检测**: 被标记为"Empty container (NO_TEXT_ASSIGNED)"
2. ❌ **发送空结果**: 发送了空的`job_result`来确认空容器

**问题**:
- ❌ **空容器**: Job4没有收到任何batch，被标记为空容器
- ❌ **文本丢失**: Job4应该包含"虽然导致"后面的内容，但被标记为空容器

**日志关键信息**:
```json
{
  "utteranceIndex": 4,
  "reason": "Empty container (NO_TEXT_ASSIGNED), sending empty result to acknowledge",
  "msg": "NodeAgent: Sending empty job_result to acknowledge empty container (NO_TEXT_ASSIGNED)"
}
```

**关键发现**:
- Job4的音频可能被分配到了Job3的Batch2
- 这违反了"头部对齐"策略

---

### 1.6 Job5 (utteranceIndex: 5)

**JobId**: `job-fcc9a92c-e3a5-49b0-a6bd-77cf3413dcd4`

**处理流程**:
1. ✅ ASR批次: 2个批次
   - Batch0: "前半句和後半句的解點端被插翻成不同的任務,甚至出現" (25字符)
   - Batch1: "與意義上不完整,讀起來前後不連貫的情況" (19字符)
2. ✅ TextMerge: 合并成功，文本长度45字符
3. ✅ 最终文本: "前半句和後半句的解點端被插翻成不同的任務,甚至出現 與意義上不完整,讀起來前後不連貫的情況"

**问题**:
- ✅ **文本完整**: Job5的文本看起来是完整的

**日志关键信息**:
```json
{
  "utteranceIndex": 5,
  "batchCount": 2,
  "mergedTextPreview": "前半句和後半句的解點端被插翻成不同的任務,甚至出現 與意義上不完整,讀起來前後不連貫的情況"
}
```

---

### 1.7 Job7 (utteranceIndex: 7)

**JobId**: `job-9200cb3c-c248-4ba2-a305-a75a6d8b6706`

**处理流程**:
1. ⚠️ **TTL超时**: 通过`forceFinalizePartial`触发finalize
2. ✅ ASR批次: 1个批次
   - Batch0: "下次的長距能夠被完整的識別出來,而且不會出現半句話被提前發送" (45字符)
3. ⚠️ **TextMerge**: 合并成功，但标记为`isPartial: true`
4. ✅ 最终文本: "下次的長距能夠被完整的識別出來,而且不會出現半句話被提前發送或者直接丟失的性向,那就說明我"

**问题**:
- ❌ **文本不完整**: 缺少"那就说明我们当前的切分策略和超时规则是基本可用的。"
- ⚠️ **TTL超时**: 通过`forceFinalizePartial`触发，说明有pendingMaxDurationAudio但没有被处理

**日志关键信息**:
```json
{
  "utteranceIndex": 7,
  "batchCount": 1,
  "triggerPath": "forceFinalizePartial",
  "reason": "registration_ttl",
  "isPartial": true,
  "mergedTextPreview": "下次的長距能夠被完整的識別出來,而且不會出現半句話被提前發送或者直接丟失的性向,那就說明我"
}
```

---

### 1.8 Job8 (utteranceIndex: 8)

**JobId**: `job-3f8db765-7b6c-4d72-9966-a8c7b7150ba4`

**处理流程**:
1. ✅ ASR批次: 1个批次
   - Batch0: **空结果** (0字符) - "Empty result (audio quality rejection or ASR returned empty)"
2. ✅ TextMerge: 合并成功，但文本为空
3. ❌ 最终文本: 空

**问题**:
- ❌ **空结果**: ASR返回空结果，可能是音频质量被拒绝，或者ASR服务返回空
- ❌ **文本丢失**: Job8应该包含"我们当前的切分策略和超时规则是基本可用的。"，但ASR返回空结果

**日志关键信息**:
```json
{
  "utteranceIndex": 8,
  "batchCount": 1,
  "batchTexts": [{
    "batchIndex": 0,
    "textLength": 0,
    "textPreview": "",
    "note": "Empty result (audio quality rejection or ASR returned empty) - included in final text but will be empty"
  }],
  "mergedTextLength": 0
}
```

---

### 1.9 Job9 (utteranceIndex: 9)

**JobId**: `job-1483ed17-7868-472e-b1aa-1e2a3944560d`

**处理流程**:
1. ✅ ASR批次: 2个批次
   - Batch0: "否則我們按." (6字符)
   - Batch1: "還需要繼續分析日誌找出到底是哪一個環節把我的語音給吃掉了" (28字符)
2. ✅ TextMerge: 合并成功，文本长度35字符
3. ✅ 最终文本: "否則我們按. 還需要繼續分析日誌找出到底是哪一個環節把我的語音給吃掉了"

**问题**:
- ✅ **文本完整**: Job9的文本看起来是完整的

**日志关键信息**:
```json
{
  "utteranceIndex": 9,
  "batchCount": 2,
  "mergedTextPreview": "否則我們按. 還需要繼續分析日誌找出到底是哪一個環節把我的語音給吃掉了"
}
```

---

## 二、关键问题分析

### 2.1 顺序混乱问题

**问题**:
- Job顺序是 [0, 1, 2, 3, 4, 5, 7, 8, 9]，但返回结果是 [0, 2, 1, 3, 5, 8, 7, 9]
- Job2的文本应该是Job1的后续部分，但被识别为独立的句子

**可能原因**:
1. **batch分配错误**: batch被分配到了错误的originalJobId
2. **TextMerge顺序错误**: TextMerge时没有按batchIndex排序
3. **调度服务器顺序**: 调度服务器发送job的顺序可能有问题

### 2.2 文本丢失问题

**问题**:
1. **Job0**: 缺少"現在我們"
2. **Job1**: 缺少"必要的时候提前结束本次识别。"
3. **Job3**: 缺少"虽然导致"后面的内容
4. **Job4**: 被标记为空容器，文本完全丢失
5. **Job7**: 缺少"那就说明我们当前的切分策略和超时规则是基本可用的。"
6. **Job8**: ASR返回空结果，文本完全丢失

**可能原因**:
1. **音频切分错误**: 音频被错误切分，导致部分内容丢失
2. **batch分配错误**: batch被分配到了错误的job
3. **空容器检测错误**: job被错误标记为空容器
4. **ASR服务问题**: ASR服务返回空结果或文本不完整
5. **pendingMaxDurationAudio处理错误**: pending音频没有被正确处理

### 2.3 空容器问题

**问题**:
- Job4被标记为"Empty container (NO_TEXT_ASSIGNED)"
- Job4的音频可能被分配到了Job3的Batch2

**可能原因**:
1. **头部对齐策略错误**: batch被分配到了错误的job
2. **originalJobInfo不一致**: `originalJobInfo`和`originalJobIds`不一致
3. **pendingMaxDurationAudio合并错误**: 合并pending音频时，归属错误

### 2.4 TTL超时问题

**问题**:
- Job1和Job7都通过`forceFinalizePartial`触发finalize
- 标记为`isPartial: true`，说明有pendingMaxDurationAudio但没有被处理

**可能原因**:
1. **pendingMaxDurationAudio没有被处理**: TTL超时时，只处理了已收到的batch，没有处理pendingMaxDurationAudio
2. **5秒阈值限制**: 合并后仍然 < 5秒，继续hold，等待下一个job
3. **手动或timeout finalize处理错误**: 虽然我们刚刚修复了这个问题，但可能还有其他问题

---

## 三、建议的修复方案

### 3.1 修复pendingMaxDurationAudio处理

**问题**: TTL超时时，pendingMaxDurationAudio没有被处理

**修复**: 已修复 - 如果当前job是手动或timeout finalize，应该强制处理pendingMaxDurationAudio，即使 < 5秒

### 3.2 修复空容器检测

**问题**: Job4被错误标记为空容器

**修复**: 需要检查`originalJobInfo`和`originalJobIds`的一致性，特别是在合并pendingMaxDurationAudio时

### 3.3 修复batch分配

**问题**: batch被分配到了错误的job

**修复**: 需要检查"头部对齐"策略的实现，确保batch被分配到正确的job

### 3.4 修复ASR空结果

**问题**: Job8的ASR返回空结果

**修复**: 需要检查音频质量检查逻辑，确保不会错误拒绝音频

---

## 四、下一步行动

1. **检查pendingMaxDurationAudio处理**: 验证刚刚的修复是否生效
2. **检查空容器检测逻辑**: 找出为什么Job4被标记为空容器
3. **检查batch分配逻辑**: 找出为什么batch被分配到错误的job
4. **检查ASR服务**: 找出为什么Job8的ASR返回空结果

---

*本分析基于日志数据，发现了多个问题，需要进一步调查和修复。*
