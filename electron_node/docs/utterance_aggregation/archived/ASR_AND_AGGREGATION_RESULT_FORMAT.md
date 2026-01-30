# ASR结果和聚合结果格式说明

## ⚠️ 文档状态：已归档

**归档日期**: 2026-01-24  
**归档原因**: 部分内容已过期（shouldCommit 字段已移除，长度阈值信息已过时）  
**当前有效文档**: `../SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

**注意**: 
- 结果格式说明仍然有效，但 shouldCommit 字段已移除
- 第150行的 `shouldWaitForMerge` 注释中的 `6-10字符` 已过时，实际应为 `6-20字符或20-40字符`

---

## 1. ASR服务返回的结果格式

### 1.1 ASRResult 接口定义

```typescript
interface ASRResult {
  text: string;                    // ASR识别的文本（主要输出）
  confidence?: number;              // 置信度（可选）
  language?: string;               // 检测到的语言代码（如 "zh", "en"）
  language_probability?: number;   // 检测到的语言的概率（0.0-1.0）
  language_probabilities?: Record<string, number>;  // 所有语言的概率信息
  segments?: SegmentInfo[];         // Segment 元数据（包含时间戳）
  is_final?: boolean;               // 是否是最终结果
  badSegmentDetection?: {           // 坏段检测结果（可选）
    isBad: boolean;
    reasonCodes: string[];
    qualityScore: number;          // 质量分数（0.0-1.0）
  };
}
```

### 1.2 SegmentInfo 接口定义

```typescript
interface SegmentInfo {
  text: string;                    // 该段的文本
  start?: number;                  // 开始时间（秒）
  end?: number;                    // 结束时间（秒）
  no_speech_prob?: number;         // 无语音概率
}
```

### 1.3 实际示例

#### 示例1：简单的ASR结果

```json
{
  "text": "我们开始进行一次语音试别稳定性测试",
  "language": "zh",
  "language_probability": 0.95,
  "language_probabilities": {
    "zh": 0.95,
    "en": 0.03,
    "ja": 0.02
  },
  "segments": [
    {
      "text": "我们开始进行一次语音试别稳定性测试",
      "start": 0.0,
      "end": 2.5,
      "no_speech_prob": 0.01
    }
  ],
  "is_final": true,
  "badSegmentDetection": {
    "isBad": false,
    "reasonCodes": [],
    "qualityScore": 0.92
  }
}
```

#### 示例2：包含多个segments的ASR结果

```json
{
  "text": "我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有",
  "language": "zh",
  "language_probability": 0.93,
  "segments": [
    {
      "text": "我会先多一两句比较短的话",
      "start": 0.0,
      "end": 2.1,
      "no_speech_prob": 0.02
    },
    {
      "text": "用来确认系统会不会在句子之间随意的把语音切断",
      "start": 2.3,
      "end": 5.8,
      "no_speech_prob": 0.01
    },
    {
      "text": "或者没有",
      "start": 6.0,
      "end": 6.8,
      "no_speech_prob": 0.03
    }
  ],
  "is_final": true,
  "badSegmentDetection": {
    "isBad": false,
    "reasonCodes": [],
    "qualityScore": 0.88
  }
}
```

#### 示例3：质量较差的ASR结果

```json
{
  "text": "必要的时候提前结束本质识别",
  "language": "zh",
  "language_probability": 0.75,
  "segments": [
    {
      "text": "必要的时候提前结束本质识别",
      "start": 0.0,
      "end": 1.8,
      "no_speech_prob": 0.15
    }
  ],
  "is_final": true,
  "badSegmentDetection": {
    "isBad": true,
    "reasonCodes": ["LOW_CONFIDENCE", "HIGH_NO_SPEECH_PROB"],
    "qualityScore": 0.45
  }
}
```

---

## 2. 聚合阶段处理后的结果格式

### 2.1 AggregationStageResult 接口定义

```typescript
interface AggregationStageResult {
  aggregatedText: string;          // 聚合后的文本（可能包含多个utterance的合并）
  aggregationChanged: boolean;     // 文本是否被聚合（与原始 ASR 文本不同）
  action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';  // 聚合动作
  isFirstInMergedGroup?: boolean;  // 是否是合并组中的第一个 utterance（已废弃）
  isLastInMergedGroup?: boolean;   // 是否是合并组中的最后一个 utterance
  shouldDiscard?: boolean;          // 是否应该丢弃（< 6字符）
  shouldWaitForMerge?: boolean;    // 是否应该等待合并（6-10字符）
  shouldSendToSemanticRepair?: boolean;  // 是否应该发送给语义修复（> 10字符）
  mergedFromUtteranceIndex?: number;  // 如果合并了前一个utterance，存储前一个utterance的索引
  mergedFromPendingUtteranceIndex?: number;  // 如果合并了待合并的文本，存储待合并文本的utterance索引
  metrics?: {
    dedupCount?: number;            // 去重次数
    dedupCharsRemoved?: number;     // 去重移除的字符数
  };
}
```

### 2.2 实际示例

#### 示例1：NEW_STREAM（新流，无聚合）

**ASR原始结果**:
```json
{
  "text": "我们开始进行一次语音试别稳定性测试"
}
```

**聚合后结果**:
```json
{
  "aggregatedText": "我们开始进行一次语音试别稳定性测试",
  "aggregationChanged": false,
  "action": "NEW_STREAM",
  "isLastInMergedGroup": false,
  "shouldDiscard": false,
  "shouldWaitForMerge": false,
  "shouldSendToSemanticRepair": true,
  "metrics": {
    "dedupCount": 0,
    "dedupCharsRemoved": 0
  }
}
```

**说明**:
- `aggregationChanged: false` - 文本没有被聚合，与原始ASR文本相同
- `action: "NEW_STREAM"` - 这是一个新的流，没有与之前的utterance合并
- `shouldSendToSemanticRepair: true` - 文本长度 > 10字符，发送给语义修复

---

#### 示例2：MERGE（合并，多个utterance合并）

**场景**: Job 0, 1, 2 被合并到 Job 3

**Job 0 的ASR结果**:
```json
{
  "text": "我会先多一两句比较短的话"
}
```

**Job 1 的ASR结果**:
```json
{
  "text": "用来确认系统会不会在句子之间"
}
```

**Job 2 的ASR结果**:
```json
{
  "text": "随意的把语音切断"
}
```

**Job 3 的ASR结果**:
```json
{
  "text": "或者没有"
}
```

**Job 0, 1, 2 的聚合结果**（被合并的utterance）:
```json
{
  "aggregatedText": "",  // 空文本，因为不是合并组中的最后一个
  "aggregationChanged": true,
  "action": "MERGE",
  "isLastInMergedGroup": false,
  "shouldDiscard": false,
  "shouldWaitForMerge": true,
  "shouldSendToSemanticRepair": false,
  "mergedFromUtteranceIndex": undefined
}
```

**Job 3 的聚合结果**（合并组中的最后一个）:
```json
{
  "aggregatedText": "我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有",
  "aggregationChanged": true,
  "action": "MERGE",
  "isLastInMergedGroup": true,
  "shouldDiscard": false,
  "shouldWaitForMerge": false,
  "shouldSendToSemanticRepair": true,
  "mergedFromUtteranceIndex": 2,  // 合并了前一个utterance（Job 2）
  "metrics": {
    "dedupCount": 0,
    "dedupCharsRemoved": 0
  }
}
```

**说明**:
- `aggregationChanged: true` - 文本被聚合，包含了多个utterance的文本
- `action: "MERGE"` - 这是一个合并操作
- `isLastInMergedGroup: true` - 这是合并组中的最后一个utterance
- `aggregatedText` - 包含了所有被合并的utterance的文本

---

#### 示例3：去重处理后的结果

**ASR原始结果**:
```json
{
  "text": "我们开始进行一次语音试别稳定性测试"
}
```

**前一个utterance的文本**:
```
"我们开始进行一次语音试别稳定性测试"
```

**聚合后结果**（检测到重复）:
```json
{
  "aggregatedText": "",
  "aggregationChanged": false,
  "action": "NEW_STREAM",
  "shouldDiscard": true,
  "shouldWaitForMerge": false,
  "shouldSendToSemanticRepair": false,
  "metrics": {
    "dedupCount": 1,
    "dedupCharsRemoved": 17
  }
}
```

**说明**:
- `shouldDiscard: true` - 文本被丢弃（因为与之前的文本重复）
- `dedupCount: 1` - 检测到1次重复
- `dedupCharsRemoved: 17` - 移除了17个重复字符

---

#### 示例4：短文本等待合并

**ASR原始结果**:
```json
{
  "text": "和超市规则"
}
```

**聚合后结果**:
```json
{
  "aggregatedText": "和超市规则",
  "aggregationChanged": false,
  "action": "NEW_STREAM",
  "shouldDiscard": false,
  "shouldWaitForMerge": true,  // 6-10字符，等待合并
  "shouldSendToSemanticRepair": false,
  "metrics": {
    "dedupCount": 0,
    "dedupCharsRemoved": 0
  }
}
```

**说明**:
- `shouldWaitForMerge: true` - 文本长度在6-10字符范围内，等待与下一个utterance合并
- `shouldSendToSemanticRepair: false` - 不发送给语义修复，等待合并

---

## 3. 最终JobResult格式（发送给调度服务器）

### 3.1 JobResult 接口定义

```typescript
interface JobResult {
  text_asr: string;                 // 最终ASR文本（优先使用修复后的文本，然后是聚合后的文本，最后是原始ASR文本）
  text_translated: string;          // 翻译后的文本
  tts_audio: string;                // TTS音频（base64编码）
  tts_format?: string;              // TTS格式（如 "opus"）
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    language_probability?: number | null;
    language_probabilities?: Record<string, number> | null;
    [key: string]: unknown;
  };
  asr_quality_level?: 'good' | 'suspect' | 'bad';  // ASR质量等级
  reason_codes?: string[];         // 质量原因代码
  quality_score?: number;          // 质量分数（0.0-1.0）
  rerun_count?: number;             // 重跑次数
  segments_meta?: {
    count: number;                  // segments数量
    max_gap: number;                // 最大间隔（秒）
    avg_duration: number;           // 平均时长（秒）
  };
  segments?: Array<{
    text: string;
    start?: number;
    end?: number;
    no_speech_prob?: number;
  }>;
  aggregation_applied?: boolean;     // 是否应用了文本聚合
  aggregation_action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';  // 聚合动作
  is_last_in_merged_group?: boolean;  // 是否是合并组中的最后一个utterance
  aggregation_metrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
  semantic_repair_applied?: boolean;  // 是否应用了语义修复
  semantic_repair_confidence?: number;  // 语义修复置信度
  text_asr_repaired?: string;       // 语义修复后的ASR文本
  should_send?: boolean;            // 是否应该发送（去重检查结果）
  dedup_reason?: string;           // 去重原因
}
```

### 3.2 实际示例

#### 示例1：正常处理的JobResult

```json
{
  "text_asr": "我们开始进行一次语音识别稳定性测试",
  "text_translated": "We started a voice recognition stability test.",
  "tts_audio": "base64_encoded_audio_data...",
  "tts_format": "opus",
  "extra": {
    "language_probability": 0.95,
    "language_probabilities": {
      "zh": 0.95,
      "en": 0.03
    }
  },
  "asr_quality_level": "good",
  "quality_score": 0.92,
  "reason_codes": [],
  "rerun_count": 0,
  "segments_meta": {
    "count": 1,
    "max_gap": 0,
    "avg_duration": 2.5
  },
  "segments": [
    {
      "text": "我们开始进行一次语音识别稳定性测试",
      "start": 0.0,
      "end": 2.5,
      "no_speech_prob": 0.01
    }
  ],
  "aggregation_applied": false,
  "aggregation_action": "NEW_STREAM",
  "is_last_in_merged_group": false,
  "semantic_repair_applied": true,
  "semantic_repair_confidence": 0.88,
  "text_asr_repaired": "我们开始进行一次语音识别稳定性测试",
  "should_send": true
}
```

#### 示例2：合并后的JobResult

```json
{
  "text_asr": "我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有",
  "text_translated": "I will first say a few short sentences to confirm whether the system will arbitrarily cut off the voice between sentences or not.",
  "tts_audio": "base64_encoded_audio_data...",
  "tts_format": "opus",
  "extra": {
    "language_probability": 0.93
  },
  "asr_quality_level": "good",
  "quality_score": 0.88,
  "segments_meta": {
    "count": 4,
    "max_gap": 0.2,
    "avg_duration": 2.3
  },
  "aggregation_applied": true,
  "aggregation_action": "MERGE",
  "is_last_in_merged_group": true,
  "aggregation_metrics": {
    "dedupCount": 0,
    "dedupCharsRemoved": 0
  },
  "semantic_repair_applied": true,
  "semantic_repair_confidence": 0.85,
  "should_send": true
}
```

#### 示例3：被去重的JobResult（空结果）

```json
{
  "text_asr": "",
  "text_translated": "",
  "tts_audio": "",
  "tts_format": "opus",
  "asr_quality_level": "good",
  "aggregation_applied": false,
  "aggregation_action": "NEW_STREAM",
  "aggregation_metrics": {
    "dedupCount": 1,
    "dedupCharsRemoved": 17
  },
  "should_send": false,
  "dedup_reason": "EXACT_DUPLICATE"
}
```

---

## 4. 数据流转过程

### 4.1 完整流程

```
ASR服务
  ↓
ASRResult {
  text: "原始ASR文本",
  segments: [...],
  language_probability: 0.95,
  ...
}
  ↓
AggregationStage.process()
  ↓
AggregationStageResult {
  aggregatedText: "聚合后的文本（可能包含多个utterance）",
  aggregationChanged: true/false,
  action: "MERGE" | "NEW_STREAM" | "COMMIT",
  ...
}
  ↓
SemanticRepairStage.process() (可选)
  ↓
修复后的文本（如果有修复）
  ↓
buildJobResult()
  ↓
JobResult {
  text_asr: "最终ASR文本（优先使用修复后的，然后是聚合后的，最后是原始的）",
  text_translated: "翻译后的文本",
  aggregation_applied: true/false,
  ...
}
  ↓
发送给调度服务器
```

### 4.2 关键字段说明

1. **text_asr** (JobResult):
   - 优先级：`repairedText` > `aggregatedText` > `asrText`
   - 如果应用了语义修复，使用修复后的文本
   - 如果应用了聚合，使用聚合后的文本
   - 否则使用原始ASR文本

2. **aggregationChanged** (AggregationStageResult):
   - `true`: 文本被聚合（与原始ASR文本不同）
   - `false`: 文本未被聚合（与原始ASR文本相同）

3. **action** (AggregationStageResult):
   - `NEW_STREAM`: 新流，没有与之前的utterance合并
   - `MERGE`: 合并，与之前的utterance合并
   - `COMMIT`: 提交，触发提交操作

4. **isLastInMergedGroup** (AggregationStageResult):
   - `true`: 这是合并组中的最后一个utterance，返回聚合后的完整文本
   - `false`: 不是最后一个，返回空文本（被合并的utterance）

---

## 5. 日志中的关键信息

在节点端日志中，你可以看到以下关键信息：

### 5.1 ASR阶段日志

```
ASR result received: {
  text: "我们开始进行一次语音试别稳定性测试",
  textLength: 17,
  segmentCount: 1,
  language: "zh",
  languageProbability: 0.95
}
```

### 5.2 聚合阶段日志

```
AggregationStage: Processing utterance
  - Original ASR text: "我们开始进行一次语音试别稳定性测试"
  - Action: NEW_STREAM
  - Aggregated text: "我们开始进行一次语音试别稳定性测试"
  - Aggregation changed: false
  - Should send to semantic repair: true
```

### 5.3 合并操作日志

```
AggregationStage: MERGE action
  - Original ASR text: "或者没有"
  - Merged from utterance index: 2
  - Aggregated text: "我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有"
  - Is last in merged group: true
  - Should commit: true
```

---

**文档结束**
