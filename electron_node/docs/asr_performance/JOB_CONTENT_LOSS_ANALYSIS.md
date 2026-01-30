# Job内容丢失问题分析报告

**日期**: 2026-01-28  
**问题**: 集成测试中发现多个job的后半句或中间内容丢失  
**测试文本**: 语音识别稳定性测试长文本

---

## 一、问题描述

### 1.1 测试结果

**原文**:
```
现在我们开始进行一次语音识别稳定性测试。
我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。

接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。

如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。
否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。
```

**识别结果**:
- [0] 開始進行一次語音識別穩定性測試 ✅
- [1] 我會先讀音 一兩句比較短的話用來確認系統不會在句子之間所以的把語音切斷或者在沒有 ❌ **后半句丢失**
- [3] [音频丢失] 接下來這一句 我會盡量連續地說的長一些中間只保留自然的呼吸節奏不做刻意的停盾看看在 ❌ **后半句丢失**
- [4] 超過10秒鐘之後系統會不會因為超時或者經營判定而強行把這句話解斷 ✅
- [5] 與異傷的不安整都起來瞧乎不臉罐的情況 ❌ **前半句丢失，与job4之间内容丢失**
- [7] 這次的長距能夠被完整的識別出來而且不會出現半句話被提前發送或者直接丟失的現象那就說明我們 ❌ **后半句丢失**
- [9] 否則我們看 還是要繼續分析日治找出到底是在哪一個環節把我的語音給吃掉了 ✅

### 1.2 问题总结

| Job ID | 问题类型 | 描述 |
|--------|----------|------|
| job1 | 后半句丢失 | "用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别" 丢失 |
| job3 | 后半句丢失 | "看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断" 丢失 |
| job4-5 | 中间内容丢失 | "从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况" 丢失 |
| job7 | 后半句丢失 | "那就说明我们当前的切分策略和超时规则是基本可用的" 丢失 |

---

## 二、日志检查指南

### 2.1 日志文件位置

#### Electron主进程日志
```
electron_node/electron-node/logs/electron-main.log
```

#### ASR服务日志
```
electron_node/services/faster_whisper_vad/logs/asr-service.log
或
electron_node/services/node-inference/logs/node-inference.log
```

#### 语义修复服务日志
```
electron_node/services/semantic_repair_zh/logs/semantic-repair-zh.log
或
electron_node/services/semantic_repair_en/logs/semantic-repair-en.log
```

#### NMT服务日志
```
electron_node/services/nmt_m2m100/logs/nmt-service.log
```

#### 调度服务器日志
```
central_server/scheduler/logs/scheduler.log
```

### 2.2 关键日志搜索关键词

#### 搜索特定Job的处理过程

**按job_id搜索**:
```bash
# 搜索job1的处理过程
grep -i "job1\|job_1" electron-main.log

# 搜索job3的处理过程
grep -i "job3\|job_3" electron-main.log

# 搜索job4的处理过程
grep -i "job4\|job_4" electron-main.log

# 搜索job5的处理过程
grep -i "job5\|job_5" electron-main.log

# 搜索job7的处理过程
grep -i "job7\|job_7" electron-main.log
```

**按session_id搜索**:
```bash
# 搜索整个会话的处理过程
grep -i "session_id=<你的session_id>" electron-main.log
```

#### 搜索ASR结果

**ASR输入输出**:
```bash
# 搜索ASR服务接收的音频和返回的文本
grep -i "ASR.*INPUT\|ASR.*OUTPUT\|asrText\|text_asr" electron-main.log
```

**ASR批次处理**:
```bash
# 搜索ASR批次累积和finalize
grep -i "addASRSegment\|finalize\|accumulatedSegments" electron-main.log
```

#### 搜索聚合处理

**聚合阶段**:
```bash
# 搜索聚合阶段的处理
grep -i "runAggregationStep\|AggregationStage\|processUtterance\|MERGE\|NEW_STREAM" electron-main.log
```

**聚合结果**:
```bash
# 搜索聚合后的文本
grep -i "aggregatedText\|aggregationResult" electron-main.log
```

#### 搜索语义修复处理

**语义修复输入输出**:
```bash
# 搜索语义修复服务的输入输出
grep -i "SEMANTIC_REPAIR.*INPUT\|SEMANTIC_REPAIR.*OUTPUT\|routeSemanticRepairTask" electron-main.log
```

**语义修复结果**:
```bash
# 搜索修复后的文本
grep -i "repairedText\|semanticDecision" electron-main.log
```

#### 搜索翻译处理

**NMT输入输出**:
```bash
# 搜索NMT服务的输入输出
grep -i "NMT.*INPUT\|NMT.*OUTPUT\|translatedText" electron-main.log
```

### 2.3 日志分析检查清单

对于每个有问题的job（job1, job3, job4, job5, job7），需要检查以下内容：

#### ✅ 检查项1: ASR服务输入输出

**检查位置**: ASR服务日志或Electron主进程日志

**需要确认**:
- [ ] ASR服务接收到的音频长度（字节数或时长）
- [ ] ASR服务返回的完整文本（`text_asr`）
- [ ] ASR服务返回的segments数量和内容
- [ ] 是否有ASR批次（batch）处理，每个batch的文本是什么

**关键日志格式**:
```
[ASRService] Calling ASR service for batch X/Y
[ASRService] ASR batch X/Y completed | asrTextLength=xxx | asrTextPreview=xxx
```

#### ✅ 检查项2: ASR结果聚合和分发

**检查位置**: Electron主进程日志

**需要确认**:
- [ ] `addASRSegment()` 被调用的次数和每次的文本
- [ ] `finalize()` 是否被正确调用
- [ ] 合并后的完整文本（`fullText`）
- [ ] 是否有missing segment（ASR失败/超时）

**关键日志格式**:
```
OriginalJobResultDispatcher: [Accumulate] Added ASR segment to accumulation
OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text | mergedTextLength=xxx
```

#### ✅ 检查项3: 聚合阶段处理

**检查位置**: Electron主进程日志

**需要确认**:
- [ ] `runAggregationStep()` 接收到的ASR文本（`ctx.asrText`）
- [ ] 聚合后的文本（`ctx.aggregatedText`）
- [ ] 聚合动作（MERGE/NEW_STREAM）
- [ ] 是否被去重（`isDuplicate()`）
- [ ] 是否被边界裁剪（`forwardMergeManager.processText()`）

**关键日志格式**:
```
runAggregationStep: Aggregation completed | aggregatedTextLength=xxx | originalTextLength=xxx
AggregationStage: Processing completed with forward merge | aggregatedTextLength=xxx
```

#### ✅ 检查项4: 语义修复阶段处理

**检查位置**: 语义修复服务日志或Electron主进程日志

**需要确认**:
- [ ] 语义修复服务接收到的文本（`text_in`）
- [ ] 语义修复服务返回的文本（`text_out`）
- [ ] 修复决策（PASS/REPAIR/REJECT）
- [ ] 文本是否被修改（`changed`）

**关键日志格式**:
```
SEMANTIC_REPAIR_ZH INPUT: Received repair request | text_in='xxx' | text_in_length=xxx
SEMANTIC_REPAIR_ZH OUTPUT: Repair completed | text_out='xxx' | text_out_length=xxx | changed=xxx
```

#### ✅ 检查项5: 翻译阶段处理

**检查位置**: NMT服务日志或Electron主进程日志

**需要确认**:
- [ ] NMT服务接收到的文本（`text_in`）
- [ ] NMT服务返回的文本（`text_out`）
- [ ] 翻译是否完整

**关键日志格式**:
```
NMT INPUT: Received translation request | text_in='xxx' | text_in_length=xxx
NMT OUTPUT: Translation completed | text_out='xxx' | text_out_length=xxx
```

#### ✅ 检查项6: 最终结果发送

**检查位置**: Electron主进程日志或调度服务器日志

**需要确认**:
- [ ] 发送到调度服务器的最终文本（`text_asr`）
- [ ] 发送到调度服务器的翻译文本（`text_translated`）
- [ ] 是否有去重或过滤（`shouldSend`）

**关键日志格式**:
```
resultSender.sendJobResult | text_asr='xxx' | text_translated='xxx' | shouldSend=xxx
```

---

## 三、可能原因分析

### 3.1 Job1后半句丢失

**可能原因**:

1. **ASR批次处理问题**
   - ASR可能返回了多个batch，但只有第一个batch被处理
   - 后续batch可能被标记为missing或丢失

2. **聚合阶段MERGE问题**
   - 如果job1被MERGE到后续job，可能只返回了部分文本
   - `isLastInMergedGroup` 判断可能有问题

3. **边界裁剪过度**
   - `forwardMergeManager.processText()` 可能过度裁剪了文本
   - 与上一个已提交文本的重叠部分被错误裁剪

**检查重点**:
- ASR返回的完整文本（包括所有batch）
- 聚合阶段的MERGE决策
- 边界裁剪的日志

### 3.2 Job3后半句丢失

**可能原因**:

1. **ASR超时或静音判定**
   - 长句可能被ASR服务判定为超时或静音，提前截断
   - 后半句可能被分配到下一个job（job4）

2. **音频聚合问题**
   - `AudioAggregator` 可能在处理长句时出现问题
   - `pendingMaxDurationAudio` 或 `pendingTimeoutAudio` 可能丢失了部分音频

3. **OriginalJobResultDispatcher问题**
   - 如果job3有多个batch，可能只有部分batch被处理
   - `expectedSegmentCount` 可能设置错误

**检查重点**:
- ASR服务的超时/静音判定日志
- AudioAggregator的finalize日志
- OriginalJobResultDispatcher的batch累积日志

### 3.3 Job4-5之间内容丢失

**可能原因**:

1. **Job分配问题**
   - 中间内容可能被分配到了不存在的job（如job6）
   - 或者被分配到了job4但被错误处理

2. **ASR批次丢失**
   - 某些ASR batch可能被标记为missing
   - 或者ASR服务返回了空结果

3. **聚合MERGE问题**
   - 如果job4和job5被MERGE，中间内容可能在合并过程中丢失
   - `mergeGroupManager` 可能有问题

**检查重点**:
- 所有job的ASR结果（包括job6）
- 聚合阶段的MERGE决策
- 是否有missing segment

### 3.4 Job7后半句丢失

**可能原因**:

1. **与Job1类似的问题**
   - ASR批次处理问题
   - 聚合MERGE问题
   - 边界裁剪过度

2. **去重问题**
   - 后半句可能被 `deduplicationHandler` 判定为重复并丢弃
   - `isDuplicate()` 可能误判

**检查重点**:
- ASR返回的完整文本
- 去重检查的日志
- 聚合阶段的处理

---

## 四、日志分析脚本

### 4.1 提取特定Job的完整处理流程

创建脚本 `analyze_job.sh`:

```bash
#!/bin/bash

JOB_ID=$1
LOG_FILE="electron_node/electron-node/logs/electron-main.log"

if [ -z "$JOB_ID" ]; then
    echo "Usage: ./analyze_job.sh <job_id>"
    exit 1
fi

echo "=== Analyzing Job: $JOB_ID ==="
echo ""

echo "--- ASR Processing ---"
grep -i "$JOB_ID" "$LOG_FILE" | grep -i "ASR\|asrText\|addASRSegment\|finalize" | head -20

echo ""
echo "--- Aggregation Processing ---"
grep -i "$JOB_ID" "$LOG_FILE" | grep -i "Aggregation\|aggregatedText\|processUtterance\|MERGE\|NEW_STREAM" | head -20

echo ""
echo "--- Semantic Repair Processing ---"
grep -i "$JOB_ID" "$LOG_FILE" | grep -i "SemanticRepair\|repairedText\|routeSemanticRepairTask" | head -20

echo ""
echo "--- Translation Processing ---"
grep -i "$JOB_ID" "$LOG_FILE" | grep -i "NMT\|translatedText\|Translation" | head -20

echo ""
echo "--- Final Result ---"
grep -i "$JOB_ID" "$LOG_FILE" | grep -i "sendJobResult\|JobResult" | head -10
```

### 4.2 提取ASR批次信息

创建脚本 `extract_asr_batches.sh`:

```bash
#!/bin/bash

JOB_ID=$1
LOG_FILE="electron_node/electron-node/logs/electron-main.log"

if [ -z "$JOB_ID" ]; then
    echo "Usage: ./extract_asr_batches.sh <job_id>"
    exit 1
fi

echo "=== ASR Batches for Job: $JOB_ID ==="
echo ""

grep -i "$JOB_ID" "$LOG_FILE" | grep -i "addASRSegment\|ASR batch\|accumulatedSegments" | while read line; do
    echo "$line"
done
```

### 4.3 提取聚合决策信息

创建脚本 `extract_aggregation_decisions.sh`:

```bash
#!/bin/bash

SESSION_ID=$1
LOG_FILE="electron_node/electron-node/logs/electron-main.log"

if [ -z "$SESSION_ID" ]; then
    echo "Usage: ./extract_aggregation_decisions.sh <session_id>"
    exit 1
fi

echo "=== Aggregation Decisions for Session: $SESSION_ID ==="
echo ""

grep -i "$SESSION_ID" "$LOG_FILE" | grep -i "AggregationStage\|processUtterance\|MERGE\|NEW_STREAM\|isLastInMergedGroup" | while read line; do
    echo "$line"
done
```

---

## 五、问题排查步骤

### 步骤1: 确认ASR服务返回的完整文本

1. 在日志中搜索每个job的ASR结果
2. 确认ASR服务是否返回了完整的文本
3. 如果有多个batch，确认所有batch都被正确处理

**如果ASR返回完整但最终结果不完整**:
- 问题在聚合或后续处理阶段

**如果ASR返回就不完整**:
- 问题在ASR服务或音频处理阶段

### 步骤2: 检查ASR批次聚合

1. 检查 `addASRSegment()` 的调用次数
2. 检查 `finalize()` 是否被正确调用
3. 检查合并后的完整文本

**如果批次聚合有问题**:
- 检查 `expectedSegmentCount` 是否正确
- 检查是否有missing segment
- 检查 `pendingMaxDurationAudio` 或 `pendingTimeoutAudio` 的处理

### 步骤3: 检查聚合阶段处理

1. 检查聚合阶段的输入文本（`ctx.asrText`）
2. 检查聚合阶段的输出文本（`ctx.aggregatedText`）
3. 检查聚合决策（MERGE/NEW_STREAM）
4. 检查是否被去重或边界裁剪

**如果聚合阶段有问题**:
- 检查 `isLastInMergedGroup` 的判断
- 检查 `forwardMergeManager.processText()` 的裁剪逻辑
- 检查 `deduplicationHandler.isDuplicate()` 的去重逻辑

### 步骤4: 检查语义修复阶段

1. 检查语义修复服务的输入文本
2. 检查语义修复服务的输出文本
3. 检查文本是否被修改

**如果语义修复有问题**:
- 检查修复服务的处理逻辑
- 检查是否有文本被错误修改或截断

### 步骤5: 检查最终结果发送

1. 检查发送到调度服务器的最终文本
2. 检查是否有去重或过滤

**如果最终结果有问题**:
- 检查 `shouldSend` 标志
- 检查去重逻辑

---

## 六、建议的修复方向

### 6.1 如果问题在ASR批次聚合

**可能修复**:
- 检查 `expectedSegmentCount` 的计算逻辑
- 确保所有batch都被正确处理
- 检查 `pendingMaxDurationAudio` 和 `pendingTimeoutAudio` 的处理

### 6.2 如果问题在聚合阶段

**可能修复**:
- 检查 `isLastInMergedGroup` 的判断逻辑
- 检查 `forwardMergeManager.processText()` 的边界裁剪逻辑
- 检查 `deduplicationHandler.isDuplicate()` 的去重逻辑

### 6.3 如果问题在语义修复阶段

**可能修复**:
- 检查语义修复服务的处理逻辑
- 确保文本不会被错误修改或截断

---

## 七、下一步行动

1. **立即行动**:
   - [ ] 提取所有问题job（job1, job3, job4, job5, job7）的完整日志
   - [ ] 按照检查清单逐项检查每个job的处理过程
   - [ ] 确认问题发生在哪个阶段

2. **分析阶段**:
   - [ ] 对比ASR返回的文本和最终发送的文本
   - [ ] 找出文本丢失的具体位置
   - [ ] 分析丢失的原因

3. **修复阶段**:
   - [ ] 根据分析结果修复问题
   - [ ] 重新测试验证修复效果

---

*请按照本指南检查日志，并将分析结果补充到本文档中。*
