# ASR Result数据结构及其在Utterance聚合和语义修复中的处理流程

根据实际代码分析ASR结果的数据结构及其在各个阶段的处理。

---

## 1. ASR Result数据结构

### 1.1 ASRResult接口定义

**位置**：`electron_node/electron-node/main/src/task-router/types.ts:52-66`

```typescript
export interface ASRResult {
  text: string;                                    // ASR识别的完整文本
  confidence?: number;                             // 置信度（可选）
  language?: string;                               // 检测到的语言代码（如"zh", "en"）
  language_probability?: number;                   // 检测到的语言的概率（0.0-1.0）
  language_probabilities?: Record<string, number>; // 所有语言的概率信息（字典：语言代码 -> 概率）
  segments?: SegmentInfo[];                        // Segment元数据（包含时间戳）
  is_final?: boolean;                              // 是否为最终结果
  badSegmentDetection?: {                          // 坏段检测结果（可选）
    isBad: boolean;
    reasonCodes: string[];
    qualityScore: number;
  };
}
```

### 1.2 SegmentInfo接口定义

**位置**：`electron_node/electron-node/main/src/task-router/types.ts:19-24`

```typescript
export interface SegmentInfo {
  text: string;          // Segment的文本
  start?: number;        // 开始时间（秒）
  end?: number;          // 结束时间（秒）
  no_speech_prob?: number; // 无语音概率（可选）
}
```

---

## 2. Utterance聚合过程中的处理

### 2.1 ASR Step → OriginalJobResultDispatcher

**位置**：`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts:252-330`

#### 处理流程

1. **每个ASR批次处理**（第252行）
   ```typescript
   for (let i = 0; i < audioSegments.length; i++) {
     const audioSegment = audioSegments[i];
     
     // 调用ASR服务
     const asrResult: ASRResult = await services.taskRouter.routeASRTask(asrTask);
     
     // 如果存在originalJobIds，通过dispatcher分发
     if (originalJobIds.length > 0 && i < originalJobIds.length) {
       const originalJobId = originalJobIds[i];
       
       const asrData: OriginalJobASRData = {
         originalJobId,
         asrText: asrResult.text || '',              // 提取text字段
         asrSegments: asrResult.segments || [],       // 提取segments字段
         languageProbabilities: asrResult.language_probabilities, // 提取language_probabilities字段
       };
       
       await dispatcher.addASRSegment(job.session_id, originalJobId, asrData);
     }
   }
   ```

2. **数据结构转换**
   - `ASRResult` → `OriginalJobASRData`
   - 提取字段：`text` → `asrText`，`segments` → `asrSegments`，`language_probabilities` → `languageProbabilities`

---

### 2.2 OriginalJobResultDispatcher累积

**位置**：`electron_node/electron-node/main/src/pipeline-orchestrator/original-job-result-dispatcher.ts:107-179`

#### 累积逻辑

```typescript
async addASRSegment(
  sessionId: string,
  originalJobId: string,
  asrData: OriginalJobASRData
): Promise<boolean> {
  const registration = sessionRegistrations.get(originalJobId);
  
  // 累积ASR结果
  registration.accumulatedSegments.push(asrData);                    // 累积每个batch的ASR数据
  registration.accumulatedText += (registration.accumulatedText ? ' ' : '') + asrData.asrText; // 累积文本（用空格连接）
  registration.accumulatedSegmentsList.push(...asrData.asrSegments); // 累积segments（展开数组合并）
  
  // 检查是否应该立即处理
  const shouldProcess = this.shouldProcessNow(registration);
  
  if (shouldProcess) {
    // 触发处理回调
    const finalAsrData: OriginalJobASRData = {
      originalJobId,
      asrText: registration.accumulatedText,              // 累积后的完整文本
      asrSegments: registration.accumulatedSegmentsList,  // 累积后的所有segments
      languageProbabilities: this.mergeLanguageProbabilities(registration.accumulatedSegments), // 合并语言概率
    };
    
    await registration.callback(finalAsrData, registration.originalJob);
  }
}
```

#### 关键处理

1. **文本累积**（第132行）
   - 多个batch的文本用空格连接：`"batch1" + " " + "batch2" + " " + "batch3"`

2. **Segments累积**（第133行）
   - 使用展开运算符合并所有segments：`[...segments1, ...segments2, ...segments3]`
   - 保持每个segment的原始结构（text, start, end, no_speech_prob）

3. **语言概率合并**（第156行）
   - 使用最后一个segment的语言概率（或合并所有segment的概率）

---

### 2.3 OriginalJobResultDispatcher → JobContext

**位置**：`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts:163-167`

#### 数据结构转换

```typescript
// 创建JobContext，并设置ASR结果
const originalCtx = initJobContext(originalJobMsg);
originalCtx.asrText = asrData.asrText;                    // 累积后的完整文本
originalCtx.asrSegments = asrData.asrSegments;            // 累积后的所有segments
originalCtx.languageProbabilities = asrData.languageProbabilities; // 合并后的语言概率
```

#### JobContext结构

**位置**：`electron_node/electron-node/main/src/pipeline/context/job-context.ts:8-59`

```typescript
export interface JobContext {
  // ASR相关
  asrText?: string;                                      // 累积后的完整ASR文本
  asrSegments?: any[];                                   // 累积后的所有segments（SegmentInfo[]）
  asrResult?: ASRResult;                                 // 原始ASR结果（可选）
  languageProbabilities?: Record<string, number>;        // 合并后的语言概率
  qualityScore?: number;                                 // ASR质量分数
  
  // 聚合相关
  aggregatedText?: string;                               // 聚合后的文本（经过Aggregator处理）
  // ... 其他字段
}
```

---

### 2.4 Aggregator处理（可选）

**位置**：`electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

如果启用了Aggregator，会对ASR结果进行进一步处理：

1. **文本聚合**（去重、合并等）
2. **Segments保持不变**
   - Aggregator主要处理文本，segments信息保留在`ctx.asrSegments`中

---

## 3. 语义修复服务接收的数据结构

### 3.1 调用入口

**位置**：`electron_node/electron-node/main/src/pipeline/steps/semantic-repair-step.ts:98-109`

```typescript
// 执行语义修复
const repairResult = await semanticRepairStage.process(
  jobWithDetectedLang as any,
  textToRepair,                    // ctx.aggregatedText || ctx.asrText
  ctx.qualityScore,
  {
    segments: ctx.asrSegments,                           // 传递segments
    language_probability: ctx.asrResult?.language_probability, // 传递语言概率
    micro_context: microContext,                          // 微上下文（上一句尾部）
  }
);
```

### 3.2 SemanticRepairStage.process()

**位置**：`electron_node/electron-node/main/src/agent/postprocess/semantic-repair-stage.ts:74-111`

```typescript
async process(
  job: JobAssignMessage,
  text: string,                    // 要修复的文本（ctx.aggregatedText || ctx.asrText）
  qualityScore?: number,           // ASR质量分数
  meta?: any                       // 元数据
): Promise<SemanticRepairStageResult>
```

**meta参数结构**：
```typescript
{
  segments?: SegmentInfo[];        // ASR segments信息
  language_probability?: number;    // 语言检测概率
  micro_context?: string;          // 微上下文（上一句尾部）
}
```

---

### 3.3 SemanticRepairTask构建

**位置**：`electron_node/electron-node/main/src/agent/postprocess/semantic-repair-stage-zh.ts:105-120`

```typescript
// 构建修复任务
const repairTask: SemanticRepairTask = {
  job_id: job.job_id,
  session_id: job.session_id || '',
  utterance_index: job.utterance_index || 0,
  lang: 'zh',
  text_in: text,                   // 要修复的文本
  quality_score: qualityScore,     // ASR质量分数
  micro_context: microContext,      // 微上下文
  meta: {
    segments: meta?.segments,       // 传递segments（从ctx.asrSegments）
    language_probability: meta?.language_probability, // 传递语言概率
    reason_codes: scoreResult.reasonCodes,
    score: scoreResult.score,
    score_details: scoreResult.details,
  },
};
```

### 3.4 SemanticRepairTask接口定义

**位置**：`electron_node/electron-node/main/src/task-router/types.ts:134-149`

```typescript
export interface SemanticRepairTask {
  job_id: string;
  session_id: string;
  utterance_index: number;
  lang: 'zh' | 'en';
  text_in: string;                 // 聚合后的ASR文本
  quality_score?: number;           // ASR质量分数
  micro_context?: string;           // 上一句尾部（80-150字）
  meta?: {
    segments?: any[];               // ASR segments信息（SegmentInfo[]）
    language_probability?: number;   // 语言检测概率
    reason_codes?: string[];        // 质量检测原因码
    score?: number;                  // 综合评分
    score_details?: any;            // 评分详情
  };
}
```

---

## 4. 语义修复服务使用的字段

### 4.1 主要使用的字段

语义修复服务主要使用以下字段：

1. **text_in**（必需）
   - 来源：`ctx.aggregatedText || ctx.asrText`
   - 用途：要修复的文本内容

2. **meta.segments**（可选）
   - 来源：`ctx.asrSegments`
   - 用途：提供时间戳信息，帮助语义修复服务理解文本的时间结构
   - 结构：`SegmentInfo[]`，每个segment包含：
     - `text`: segment的文本
     - `start`: 开始时间（秒）
     - `end`: 结束时间（秒）
     - `no_speech_prob`: 无语音概率

3. **meta.language_probability**（可选）
   - 来源：`ctx.asrResult?.language_probability`
   - 用途：提供语言检测的置信度信息

4. **micro_context**（可选）
   - 来源：从`aggregatorManager.getLastCommittedText()`获取
   - 用途：提供上一句的尾部文本（80-150字），帮助理解上下文

5. **quality_score**（可选）
   - 来源：`ctx.qualityScore`
   - 用途：ASR质量分数，用于判断是否需要修复

---

## 5. 数据流总结

### 5.1 完整数据流

```
ASR服务
  ↓
ASRResult {
  text: "batch1",
  segments: [SegmentInfo, ...],
  language_probabilities: {...}
}
  ↓
OriginalJobResultDispatcher.addASRSegment()
  ↓
累积多个batch：
  accumulatedText: "batch1 batch2 batch3"
  accumulatedSegmentsList: [SegmentInfo, SegmentInfo, SegmentInfo, ...]
  ↓
OriginalJobASRData {
  asrText: "batch1 batch2 batch3",
  asrSegments: [SegmentInfo, ...],
  languageProbabilities: {...}
}
  ↓
JobContext {
  asrText: "batch1 batch2 batch3",
  asrSegments: [SegmentInfo, ...],
  languageProbabilities: {...}
}
  ↓
（可选）Aggregator处理
  aggregatedText: "聚合后的文本"
  asrSegments: [SegmentInfo, ...]  // 保持不变
  ↓
SemanticRepairStep
  ↓
SemanticRepairTask {
  text_in: "聚合后的文本",
  meta: {
    segments: [SegmentInfo, ...],  // 从ctx.asrSegments传递
    language_probability: number
  }
}
  ↓
语义修复服务
```

---

## 6. 关键代码位置总结

| 组件 | 文件位置 | 关键行数 |
|------|---------|---------|
| ASRResult定义 | `task-router/types.ts` | 52-66 |
| SegmentInfo定义 | `task-router/types.ts` | 19-24 |
| ASR结果分发 | `pipeline/steps/asr-step.ts` | 252-330 |
| 结果累积 | `pipeline-orchestrator/original-job-result-dispatcher.ts` | 107-179 |
| JobContext定义 | `pipeline/context/job-context.ts` | 8-59 |
| 语义修复调用 | `pipeline/steps/semantic-repair-step.ts` | 98-109 |
| SemanticRepairTask定义 | `task-router/types.ts` | 134-149 |
| 语义修复Stage | `agent/postprocess/semantic-repair-stage-zh.ts` | 105-120 |

---

## 7. 注意事项

1. **Segments累积**
   - 多个batch的segments会展开合并成一个数组
   - 每个segment保持原始结构（text, start, end, no_speech_prob）

2. **文本累积**
   - 多个batch的文本用空格连接
   - 最终文本：`"batch1" + " " + "batch2" + " " + "batch3"`

3. **语言概率合并**
   - 使用最后一个segment的语言概率（或合并所有segment的概率）

4. **语义修复服务使用segments**
   - segments主要用于提供时间戳信息
   - 语义修复服务可以根据segments的时间结构更好地理解文本
