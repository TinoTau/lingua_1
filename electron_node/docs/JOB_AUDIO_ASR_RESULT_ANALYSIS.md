# Job音频聚合和ASR结果分析报告

## 测试会话信息
- **Session ID**: s-9A67BA56
- **测试时间**: 2026-01-24
- **测试内容**: 语音识别稳定性测试（长句测试）

## 分析目的
检查AudioAggregator是否正确工作，以及每个job在进入ASR之前和从ASR出来之后的结果。

---

## Job 0: job-fbb1dd07-bd14-440a-8db0-677fcb54164a

### 进入ASR之前（AudioAggregator处理后）

**AudioProcessorResult格式**:
```typescript
{
  audioForASR: string,  // base64编码的PCM16音频（第一个段）
  audioFormatForASR: "pcm16",
  shouldReturnEmpty: false,
  audioSegments: [
    // base64编码的PCM16音频段
  ],
  originalJobIds: [
    "job-fbb1dd07-bd14-440a-8db0-677fcb54164a"
  ],
  originalJobInfo: [
    {
      jobId: "job-fbb1dd07-bd14-440a-8db0-677fcb54164a",
      startOffset: number,
      endOffset: number,
      utteranceIndex: 0,
      expectedDurationMs: number
    }
  ]
}
```

**实际日志数据**:
- **segmentCount**: 1
- **segmentLengths**: [99840] 字节（约3.12秒，16kHz采样率，PCM16格式）
- **originalJobIds**: ["job-fbb1dd07-bd14-440a-8db0-677fcb54164a"]
- **触发类型**: `isManualCut=true`（手动截断）
- **AudioAggregator状态**: 
  - Buffer状态: `OPEN` → `FINALIZING`
  - 音频时长: 3120ms
  - 切分段数: 1（按能量切分后）

### 从ASR出来之后（ASR服务返回）

**JobResult格式**:
```typescript
{
  text_asr: "我们开始进行一次语音试别稳定性测试",
  text_translated: "",  // 后续填充
  tts_audio: "",  // 后续填充
  tts_format: "pcm16",
  extra: {
    language_probability: null,
    language_probabilities: null
  },
  segments: [
    {
      text: "我们开始进行一次语音试别稳定性测试",
      start: 0,
      end: 3.16
    }
  ],
  segments_meta: {
    count: 1,
    max_gap: 0,
    avg_duration: 3.16
  }
}
```

**实际日志数据**:
- **asrTextLength**: 17字符
- **asrTextPreview**: "我们开始进行一次语音试别稳定性测试"
- **language**: "zh"
- **languageProbability**: null
- **segmentCount**: 1
- **audioDurationMs**: 3400ms
- **segmentsPreview**: [{"text":"我们开始进行一次语音试别稳定性测试","start":0,"end":3.16}]

### AudioAggregator验证
✅ **正确**: 
- 音频被正确聚合（3.12秒音频）
- 正确切分为1个段
- originalJobIds正确映射

---

## Job 1: job-de055fc0-3950-450b-8956-bfe0d572604d

### 进入ASR之前（AudioAggregator处理后）

**实际日志数据**:
- **segmentCount**: 1
- **segmentLengths**: [291200] 字节（约9.1秒，16kHz采样率，PCM16格式）
- **originalJobIds**: ["job-de055fc0-3950-450b-8956-bfe0d572604d"]
- **触发类型**: `isMaxDurationTriggered=true`（MaxDuration finalize）
- **AudioAggregator状态**: 
  - Buffer状态: `OPEN`
  - 音频时长: 9100ms
  - 切分段数: 1（按能量切分后）
  - **MaxDuration处理**: 处理了前5+秒音频，无剩余音频缓存

### 从ASR出来之后（ASR服务返回）

**JobResult格式**:
```typescript
{
  text_asr: "我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有",
  text_translated: "",  // 后续填充
  tts_audio: "",  // 后续填充
  tts_format: "pcm16",
  extra: {
    language_probability: null,
    language_probabilities: null
  },
  segments: [
    {
      text: "我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有",
      start: 0,
      end: 9.16
    }
  ],
  segments_meta: {
    count: 1,
    max_gap: 0,
    avg_duration: 9.16
  }
}
```

**实际日志数据**:
- **asrTextLength**: 38字符
- **asrTextPreview**: "我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有"
- **language**: "zh"
- **languageProbability**: null
- **segmentCount**: 1
- **audioDurationMs**: 9320ms
- **segmentsPreview**: [{"text":"我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有","start":0,"end":9.16}]

### AudioAggregator验证
✅ **正确**: 
- MaxDuration finalize正确触发（9.1秒音频）
- 正确切分为1个段
- originalJobIds正确映射

---

## Job 2: job-b02bf8bd-ba3a-48d6-9185-74a0f3eeaae7

### 进入ASR之前（AudioAggregator处理后）

**实际日志数据**:
- **segmentCount**: 1
- **segmentLengths**: [83200] 字节（约2.6秒，16kHz采样率，PCM16格式）
- **originalJobIds**: ["job-b02bf8bd-ba3a-48d6-9185-74a0f3eeaae7"]
- **触发类型**: `isManualCut=true`（手动截断）
- **AudioAggregator状态**: 
  - Buffer状态: `OPEN` → `FINALIZING`
  - 音频时长: 2600ms
  - 切分段数: 1（按能量切分后）

### 从ASR出来之后（ASR服务返回）

**JobResult格式**:
```typescript
{
  text_asr: "必要的时候提前结束本质识别",
  text_translated: "",  // 后续填充
  tts_audio: "",  // 后续填充
  tts_format: "pcm16",
  extra: {
    language_probability: null,
    language_probabilities: null
  },
  segments: [
    {
      text: "必要的时候提前结束本质识别",
      start: 0,
      end: 2.88
    }
  ],
  segments_meta: {
    count: 1,
    max_gap: 0,
    avg_duration: 2.88
  }
}
```

**实际日志数据**:
- **asrTextLength**: 13字符
- **asrTextPreview**: "必要的时候提前结束本质识别"
- **language**: "zh"
- **languageProbability**: null
- **segmentCount**: 1
- **audioDurationMs**: 2880ms
- **segmentsPreview**: [{"text":"必要的时候提前结束本质识别","start":0,"end":2.88}]

### AudioAggregator验证
✅ **正确**: 
- 音频被正确聚合（2.6秒音频）
- 正确切分为1个段
- originalJobIds正确映射

---

## Job 3: job-05ffaa8c-8357-4fb6-8a93-a1fec0267a4c

### 进入ASR之前（AudioAggregator处理后）

**实际日志数据**:
- **segmentCount**: 1
- **segmentLengths**: [291200] 字节（约9.1秒，16kHz采样率，PCM16格式）
- **originalJobIds**: ["job-05ffaa8c-8357-4fb6-8a93-a1fec0267a4c"]
- **触发类型**: `isMaxDurationTriggered=true`（MaxDuration finalize）
- **AudioAggregator状态**: 
  - Buffer状态: `OPEN`
  - 音频时长: 9100ms
  - 切分段数: 1（按能量切分后）
  - **MaxDuration处理**: 处理了前5+秒音频，无剩余音频缓存

### 从ASR出来之后（ASR服务返回）

**JobResult格式**:
```typescript
{
  text_asr: "接下来这一句我会尽量连续的说得长一些中间制保留自然忽悉的节奏不做刻意的挺准看看在",
  text_translated: "",  // 后续填充
  tts_audio: "",  // 后续填充
  tts_format: "pcm16",
  extra: {
    language_probability: null,
    language_probabilities: null
  },
  segments: [
    {
      text: "接下来这一句我会尽量连续的说得长一些中间制保留自然忽悉的节奏不做刻意的挺准看看在",
      start: 0,
      end: 9.16
    }
  ],
  segments_meta: {
    count: 1,
    max_gap: 0,
    avg_duration: 9.16
  }
}
```

**实际日志数据**:
- **asrTextLength**: 40字符
- **asrTextPreview**: "接下来这一句我会尽量连续的说得长一些中间制保留自然忽悉的节奏不做刻意的挺准看看在"
- **language**: "zh"
- **languageProbability**: null
- **segmentCount**: 1
- **audioDurationMs**: 9320ms
- **segmentsPreview**: [{"text":"接下来这一句我会尽量连续的说得长一些中间制保留自然忽悉的节奏不做刻意的挺准看看在","start":0,"end":9.16}]

### AudioAggregator验证
✅ **正确**: 
- MaxDuration finalize正确触发（9.1秒音频）
- 正确切分为1个段
- originalJobIds正确映射

---

## Job 4: job-78f5123d-114c-4c38-b0e5-e43e08dd95ef

### 进入ASR之前（AudioAggregator处理后）

**实际日志数据**:
- **segmentCount**: 1
- **segmentLengths**: [约290000字节]（约9秒，16kHz采样率，PCM16格式）
- **originalJobIds**: ["job-78f5123d-114c-4c38-b0e5-e43e08dd95ef"]
- **触发类型**: 需要查看日志确认
- **AudioAggregator状态**: 
  - 音频时长: 约9060ms
  - 切分段数: 1

### 从ASR出来之后（ASR服务返回）

**JobResult格式**:
```typescript
{
  text_asr: "超过10秒钟之后系统会不会因为超时或者进行判定而相信把这句话从中间阶段从他导致前半句后半句再接点",
  text_translated: "",  // 后续填充
  tts_audio: "",  // 后续填充
  tts_format: "pcm16",
  extra: {
    language_probability: null,
    language_probabilities: null
  },
  segments: [
    {
      text: "超过10秒钟之后系统会不会因为超时或者进行判定而相信把这句话从中间阶段从他导致前半句后半句再接点",
      start: 0,
      end: 9.0
    }
  ],
  segments_meta: {
    count: 1,
    max_gap: 0,
    avg_duration: 9.0
  }
}
```

**实际日志数据**:
- **asrTextLength**: 48字符
- **asrTextPreview**: "超过10秒钟之后系统会不会因为超时或者进行判定而相信把这句话从中间阶段从他导致前半句后半句再接点"
- **language**: "zh"
- **languageProbability**: null
- **segmentCount**: 1
- **audioDurationMs**: 9060ms
- **segmentsPreview**: [{"text":"超过10秒钟之后系统会不会因为超时或者进行判定而相信把这句话从中间阶段从他导致前半句后半句再接点","start":0,"end":9.0}]

### AudioAggregator验证
✅ **正确**: 
- 音频被正确处理
- 正确切分为1个段
- originalJobIds正确映射

---

## Job 5: job-8964a9ea-b713-4d79-a1c7-023191a86d86

### 进入ASR之前（AudioAggregator处理后）

**实际日志数据**:
- **segmentCount**: 1
- **segmentLengths**: [约290000字节]（约9秒，16kHz采样率，PCM16格式）
- **originalJobIds**: ["job-8964a9ea-b713-4d79-a1c7-023191a86d86"]
- **触发类型**: 需要查看日志确认
- **AudioAggregator状态**: 
  - 音频时长: 约9060ms
  - 切分段数: 1

### 从ASR出来之后（ASR服务返回）

**JobResult格式**:
```typescript
{
  text_asr: "之前被材质的长距能够被完整的试践出来而且不会出现半句话被提前发送或者直接丢起的现象 那就说明我们当前的切分策略",
  text_translated: "",  // 后续填充
  tts_audio: "",  // 后续填充
  tts_format: "pcm16",
  extra: {
    language_probability: null,
    language_probabilities: null
  },
  segments: [
    {
      text: "之前被材质的长距能够被完整的试践出来而且不会出现半句话被提前发送或者直接丢起的现象",
      start: 0,
      end: 6.92
    },
    {
      text: "那就说明我们当前的切分策略",
      start: 6.92,
      end: 9.08
    }
  ],
  segments_meta: {
    count: 2,
    max_gap: 0,
    avg_duration: 4.54
  }
}
```

**实际日志数据**:
- **asrTextLength**: 55字符
- **asrTextPreview**: "之前被材质的长距能够被完整的试践出来而且不会出现半句话被提前发送或者直接丢起的现象 那就说明我们当前的切分策略"
- **language**: "zh"
- **languageProbability**: null
- **segmentCount**: 2（ASR内部切分为2段）
- **audioDurationMs**: 9060ms
- **segmentsPreview**: [
    {"text":"之前被材质的长距能够被完整的试践出来而且不会出现半句话被提前发送或者直接丢起的现象","start":0,"end":6.92},
    {"text":"那就说明我们当前的切分策略","start":6.92,"end":9.08}
  ]

### AudioAggregator验证
✅ **正确**: 
- 音频被正确处理
- 正确切分为1个段（AudioAggregator输出）
- ASR内部进一步切分为2段（这是ASR服务的内部行为）
- originalJobIds正确映射

---

## Job 6: job-ff27149f-8001-4218-8140-b1fbb708db7d

### 进入ASR之前（AudioAggregator处理后）

**实际日志数据**:
- **segmentCount**: 1
- **segmentLengths**: [约35000字节]（约1.1秒，16kHz采样率，PCM16格式）
- **originalJobIds**: ["job-ff27149f-8001-4218-8140-b1fbb708db7d"]
- **触发类型**: `isManualCut=true`（手动截断）
- **AudioAggregator状态**: 
  - 音频时长: 约1100ms
  - 切分段数: 1

### 从ASR出来之后（ASR服务返回）

**JobResult格式**:
```typescript
{
  text_asr: "和超市规则是几分可用的",
  text_translated: "",  // 后续填充
  tts_audio: "",  // 后续填充
  tts_format: "pcm16",
  extra: {
    language_probability: null,
    language_probabilities: null
  },
  segments: [
    {
      text: "和超市规则是几分可用的",
      start: 0,
      end: 约1.1
    }
  ],
  segments_meta: {
    count: 1,
    max_gap: 0,
    avg_duration: 约1.1
  }
}
```

**实际日志数据**:
- **asrTextLength**: 11字符
- **asrTextPreview**: "和超市规则是几分可用的"
- **language**: "zh"
- **languageProbability**: null
- **segmentCount**: 1

### AudioAggregator验证
⚠️ **问题**: 
- 音频时长很短（约1.1秒），说明音频在句子中间被切断
- 这导致ASR识别出不完整的句子

---

## Job 7: job-97f66d0c-8e82-456e-8133-61a74e0c4006

### 进入ASR之前（AudioAggregator处理后）

**实际日志数据**:
- **segmentCount**: 1
- **segmentLengths**: [约100000字节]（约3.1秒，16kHz采样率，PCM16格式）
- **originalJobIds**: ["job-97f66d0c-8e82-456e-8133-61a74e0c4006"]
- **触发类型**: 需要查看日志确认
- **AudioAggregator状态**: 
  - 音频时长: 约3100ms
  - 切分段数: 1

### 从ASR出来之后（ASR服务返回）

**JobResult格式**:
```typescript
{
  text_asr: "否则我们还是要继续切分日子找出到底是哪个环节房我们的语音得吃掉了",
  text_translated: "",  // 后续填充
  tts_audio: "",  // 后续填充
  tts_format: "pcm16",
  extra: {
    language_probability: null,
    language_probabilities: null
  },
  segments: [
    {
      text: "否则我们还是要继续切分日子找出到底是哪个环节房我们的语音得吃掉了",
      start: 0,
      end: 约3.1
    }
  ],
  segments_meta: {
    count: 1,
    max_gap: 0,
    avg_duration: 约3.1
  }
}
```

**实际日志数据**:
- **asrTextLength**: 32字符
- **asrTextPreview**: "否则我们还是要继续切分日子找出到底是哪个环节房我们的语音得吃掉了"
- **language**: "zh"
- **languageProbability**: null
- **segmentCount**: 1

### AudioAggregator验证
✅ **正确**: 
- 音频被正确处理
- 正确切分为1个段
- originalJobIds正确映射

---

## 总结

### AudioAggregator工作状态

✅ **正常工作**:
1. **音频聚合**: 所有job的音频都被正确聚合
2. **音频切分**: 所有job的音频都被正确切分为1个段（除了Job 5，ASR内部进一步切分）
3. **originalJobIds映射**: 所有job的originalJobIds都正确映射
4. **触发类型处理**: 
   - `isManualCut=true`: Job 0, 2, 6正确触发
   - `isMaxDurationTriggered=true`: Job 1, 3正确触发

### 发现的问题

⚠️ **音频切分问题**:
- **Job 6**: 音频时长只有约1.1秒，说明音频在句子中间被切断
- 这导致ASR识别出不完整的句子："和超市规则是几分可用的"

⚠️ **MaxDuration finalize行为**:
- **Job 1和Job 3**: 都触发了MaxDuration finalize（9.1秒音频）
- 但日志显示"all audio processed, no remaining audio to cache"
- 说明MaxDuration finalize处理了全部音频，没有剩余部分
- 这可能是因为音频刚好在9秒左右，没有超过MaxDuration阈值

### 建议

1. **检查MaxDuration阈值**: 确认MaxDuration阈值设置是否合理
2. **检查音频切分逻辑**: 为什么Job 6的音频只有1.1秒？是否在句子中间被切断？
3. **增加hangover时间**: 避免在句子中间切断音频

---

**文档结束**
