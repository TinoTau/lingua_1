# 最新集成测试分析报告

**日期**: 2026-01-28  
**测试文本**: "现在我们开始进行一次语音识别稳定性测试。我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。"

---

## 一、测试结果概览

### 1.1 原文与识别结果对比

**原文**:
```
现在我们开始进行一次语音识别稳定性测试。
我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。
接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。
如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。
否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。
```

**识别结果** (utteranceIndex):
- [0] 我们开始进行一次语音时别稳定性测试
- [1] 我会先读一下 要注意两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有
- [2] 必要的时候提前结束本次识别
- [3] 接下来最 我会尽量连续的说的尝一些中间只把
- [4] 留自然的呼吸节奏不做刻意的停顿看看在超过10秒钟之后系统会不会因为超时或者进音判定而挑释把这句话阶段从而导致
- [5] 前半句和后半句在节点端被拆成两个不同的任务甚至出现于异伤不完整独起来前后不连贯的情况
- [7] 这次的长距能够被完整的识别出来而且不会出现半句话被提前发送或者直接丢失的现象那就说明了
- [8] 我们当前的切分策略和超市规则是基本可用的
- [9] 法则我们 我们还需要继续分析日治找出到底是在哪一个环节把我的语音给吃掉了

**问题**:
- 识别质量较差（错别字、语义不完整）
- 缺少utteranceIndex 6
- 文本顺序混乱（job3和job4的内容不连贯）

---

## 二、日志分析结果

### 2.1 Job处理流程统计

**找到的Job数量**: 11个（utteranceIndex 0-10，但实际有效的是0-9）

**关键发现**:
1. **语义修复未启用**: 所有job的pipeline配置显示`"use_semantic":false`
2. **语义修复未调用**: 虽然`shouldSendToSemanticRepair:true`，但由于`use_semantic:false`，语义修复步骤被跳过
3. **Audio聚合正常**: 所有job都有audio聚合日志
4. **Utterance聚合正常**: 所有job都有utterance聚合日志

---

## 三、各Job详细分析

### 3.1 Job 0 (utteranceIndex: 0)

**ASR结果**: "我们开始进行一次语音时别稳定性测试" (17字符)

**问题**: 
- "时别"应该是"识别"
- 缺少"现在"开头

**Audio聚合**: ✅ 正常
- 音频时长: 3120ms
- 切分: 1个segment
- 处理: 手动finalize

**Utterance聚合**: ✅ 正常
- `shouldSendToSemanticRepair: true`
- `action: NEW_STREAM`

**语义修复**: ❌ **未调用**
- Pipeline配置: `"use_semantic":false`
- 虽然`shouldSendToSemanticRepair:true`，但语义修复步骤被跳过

**后续处理**: 
- 直接进入NMT翻译
- 翻译结果: "We start to do a voice without stability testing."

---

### 3.2 Job 1 (utteranceIndex: 1)

**ASR结果**: 
- Batch1: "我会先读一下" (6字符)
- Batch2: "要注意两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有" (36字符)

**合并后**: "我会先读一下 要注意两句比较短的话用来确认系统不会在句子之间随意的把语音切断或者在没有" (43字符)

**问题**:
- 缺少"一两句"（识别为"要注意两句"）
- 缺少"用来"（识别为"用来"但位置不对）
- 缺少"或者在没有必要的时候提前结束本次识别"的后半部分

**Audio聚合**: ✅ 正常
- 2个batch
- 处理: 手动finalize

**Utterance聚合**: ✅ 正常
- `shouldSendToSemanticRepair: true`
- `action: NEW_STREAM`

**语义修复**: ❌ **未调用**
- Pipeline配置: `"use_semantic":false`

---

### 3.3 Job 2 (utteranceIndex: 2)

**ASR结果**: "必要的时候提前结束本次识别" (13字符)

**问题**:
- 这是Job1的后半部分，但被单独识别为一个job
- 缺少上下文

**Audio聚合**: ✅ 正常
- 1个segment
- 处理: 手动finalize

**Utterance聚合**: ✅ 正常
- `shouldSendToSemanticRepair: true`
- `action: NEW_STREAM`

**语义修复**: ❌ **未调用**
- Pipeline配置: `"use_semantic":false`

---

### 3.4 Job 3 (utteranceIndex: 3)

**ASR结果**: 
- Batch1: "接下来最" (4字符)
- Batch2: "我会尽量连续的说的尝一些中间只把" (16字符)

**合并后**: "接下来最 我会尽量连续的说的尝一些中间只把" (21字符)

**问题**:
- "接下来最"应该是"接下来这一句"
- "说的尝一些"应该是"说得长一些"
- "中间只把"应该是"中间只保留"

**Audio聚合**: ✅ 正常
- 2个batch
- 处理: 手动finalize

**Utterance聚合**: ⚠️ **异常**
- `shouldSendToSemanticRepair: false`
- `shouldWaitForMerge: true`
- `action: NEW_STREAM`

**语义修复**: ❌ **未调用**
- `shouldSendToSemanticRepair: false`，所以不会发送到语义修复

---

### 3.5 Job 4 (utteranceIndex: 4)

**ASR结果**: "留自然的呼吸节奏不做刻意的停顿看看在超过10秒钟之后系统会不会因为超时或者进音判定而挑释把这句话阶段从而导致" (54字符)

**问题**:
- "留"应该是"保留"（缺少"保"）
- "进音"应该是"静音"
- "挑释"应该是"强行"
- "阶段"应该是"截断"

**Audio聚合**: ✅ 正常
- 处理: MaxDuration finalize
- `action: MERGE`（与Job3合并）

**Utterance聚合**: ✅ 正常
- `shouldSendToSemanticRepair: true`
- `action: MERGE`

**语义修复**: ❌ **未调用**
- Pipeline配置: `"use_semantic":false`

---

### 3.6 Job 5 (utteranceIndex: 5)

**ASR结果**: "前半句和后半句在节点端被拆成两个不同的任务甚至出现于异伤不完整独起来前后不连贯的情况" (42字符)

**问题**:
- "于异伤"应该是"语义上"
- "独起来"应该是"读起来"

**Audio聚合**: ✅ 正常
- 处理: 手动finalize

**Utterance聚合**: ✅ 正常
- `shouldSendToSemanticRepair: true`
- `action: NEW_STREAM`

**语义修复**: ❌ **未调用**
- Pipeline配置: `"use_semantic":false`

---

### 3.7 Job 6 (utteranceIndex: 6)

**状态**: ⚠️ **未找到ASR结果**

**问题**: 
- 日志中未找到Job6的ASR结果
- 可能是空job或处理失败

---

### 3.8 Job 7 (utteranceIndex: 7)

**ASR结果**: "这次的长距能够被完整的识别出来而且不会出现半句话被提前发送或者直接丢失的现象那就说明了" (43字符)

**问题**:
- "长距"应该是"长句"
- 缺少"如果"开头

**Audio聚合**: ✅ 正常
- 处理: 手动finalize

**Utterance聚合**: ✅ 正常
- `shouldSendToSemanticRepair: true`
- `action: NEW_STREAM`

**语义修复**: ❌ **未调用**
- Pipeline配置: `"use_semantic":false`

---

### 3.9 Job 8 (utteranceIndex: 8)

**ASR结果**: "我们当前的切分策略和超市规则是基本可用的" (20字符)

**问题**:
- "超市"应该是"超时"

**Audio聚合**: ✅ 正常
- 处理: 手动finalize

**Utterance聚合**: ✅ 正常
- `shouldSendToSemanticRepair: true`
- `action: NEW_STREAM`

**语义修复**: ❌ **未调用**
- Pipeline配置: `"use_semantic":false`

---

### 3.10 Job 9 (utteranceIndex: 9)

**ASR结果**: "法则我们 我们还需要继续分析日治找出到底是在哪一个环节把我的语音给吃掉了" (36字符)

**问题**:
- "法则"应该是"否则"
- "日治"应该是"日志"

**Audio聚合**: ✅ 正常
- 处理: 手动finalize

**Utterance聚合**: ✅ 正常
- `shouldSendToSemanticRepair: true`
- `action: NEW_STREAM`

**语义修复**: ❌ **未调用**
- Pipeline配置: `"use_semantic":false`

---

## 四、关键问题分析

### 4.1 语义修复未生效

**问题**: 所有job的pipeline配置显示`"use_semantic":false`，导致语义修复步骤被跳过

**证据**:
```json
"pipeline":{"use_asr":true,"use_nmt":true,"use_tts":true,"use_semantic":false,"use_tone":false}
```

**影响**:
- 虽然`shouldSendToSemanticRepair:true`，但由于`use_semantic:false`，语义修复步骤被跳过
- ASR识别错误（如"时别"、"超市"、"日治"等）无法被语义修复服务纠正

**需要检查**:
- 为什么pipeline配置中`use_semantic:false`？
- 这是配置问题还是代码逻辑问题？

---

### 4.2 Audio聚合过程

**状态**: ✅ **正常**

**观察**:
- 所有job都有audio聚合日志
- 音频切分和batch分配正常
- 没有发现异常或错误

**Job3的特殊情况**:
- `shouldWaitForMerge: true`
- 与Job4合并（`action: MERGE`）
- 这是正常的设计行为

---

### 4.3 Utterance聚合过程

**状态**: ✅ **基本正常**

**观察**:
- 所有job都有utterance聚合日志
- 大部分job的`shouldSendToSemanticRepair: true`
- Job3的`shouldSendToSemanticRepair: false`（因为`shouldWaitForMerge: true`）

**问题**:
- 虽然`shouldSendToSemanticRepair: true`，但由于`use_semantic:false`，语义修复步骤被跳过

---

### 4.4 ASR识别质量问题

**主要错误类型**:
1. **同音字错误**: "时别"→"识别"、"超市"→"超时"、"日治"→"日志"、"法则"→"否则"
2. **语义不完整**: 缺少开头词（"现在"、"如果"等）
3. **文本截断**: Job1和Job2的内容被拆分
4. **识别错误**: "长距"→"长句"、"进音"→"静音"、"挑释"→"强行"

**可能原因**:
1. ASR服务本身的识别质量问题
2. 音频质量问题（但RMS检查通过）
3. **缺少语义修复**: 由于`use_semantic:false`，识别错误无法被纠正

---

## 五、问题总结

### 5.1 主要问题

1. **语义修复未启用**: ⚠️ **关键问题**
   - 所有job的pipeline配置显示`"use_semantic":false`
   - 导致语义修复步骤被跳过
   - ASR识别错误无法被纠正

2. **ASR识别质量差**: 
   - 大量同音字错误
   - 语义不完整
   - 文本截断

3. **Job6缺失**: 
   - 未找到Job6的ASR结果
   - 可能是空job或处理失败

### 5.2 正常的部分

1. **Audio聚合**: ✅ 正常
   - 所有job都有audio聚合日志
   - 音频切分和batch分配正常

2. **Utterance聚合**: ✅ 基本正常
   - 所有job都有utterance聚合日志
   - 聚合逻辑正常

---

## 六、建议

### 6.1 立即检查

1. **检查pipeline配置**: 为什么`use_semantic:false`？
   - 是配置问题还是代码逻辑问题？
   - 需要检查pipeline配置的生成逻辑

2. **检查语义修复服务**: 
   - 语义修复服务是否正常运行？
   - 服务发现是否正常？

### 6.2 进一步分析

1. **ASR识别质量**: 
   - 检查音频质量（RMS值）
   - 检查ASR服务的识别结果
   - 可能需要调整ASR参数

2. **Job6缺失**: 
   - 检查Job6的完整处理流程
   - 确认是否是空job或处理失败

---

*详细日志分析完成。关键发现：语义修复未启用（`use_semantic:false`），导致ASR识别错误无法被纠正。*
