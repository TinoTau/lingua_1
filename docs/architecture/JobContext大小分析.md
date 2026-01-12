# JobContext 大小分析

## 问题：为什么 JobContext 会变得很大？

让我详细分析当前代码中传递的所有数据，看看 `JobContext` 到底需要包含哪些字段。

## 当前数据传递分析

### 1. JobResult 接口（当前 PipelineOrchestrator 返回的）

```typescript
export interface JobResult {
  // 基础文本字段（字符串，通常 < 1000 字符）
  text_asr: string;                    // ~100-500 字符
  text_translated: string;             // ~100-500 字符
  tts_audio: string;                   // base64 编码，可能很大（几KB到几十KB）
  tts_format?: string;                 // 小字符串
  
  // 元数据（小对象）
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    language_probability?: number | null;
    language_probabilities?: Record<string, number> | null;  // 字典，通常 < 10 个键
    [key: string]: unknown;
  };
  
  // ASR 质量信息（小对象）
  asr_quality_level?: 'good' | 'suspect' | 'bad';
  reason_codes?: string[];             // 数组，通常 < 10 个元素
  quality_score?: number;
  rerun_count?: number;
  
  // Segments 信息（可能较大）
  segments_meta?: {
    count: number;
    max_gap: number;
    avg_duration: number;
  };
  segments?: Array<{                   // 数组，可能包含多个元素
    text: string;                       // 每个 segment 的文本
    start?: number;
    end?: number;
    no_speech_prob?: number;
  }>;
  
  // 聚合相关字段（小对象）
  aggregation_applied?: boolean;
  aggregation_action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  is_last_in_merged_group?: boolean;
  aggregation_metrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
  
  // 语义修复相关字段（小对象）
  semantic_repair_applied?: boolean;
  semantic_repair_confidence?: number;
  text_asr_repaired?: string;          // ~100-500 字符
  
  // 去重相关字段（小对象）
  should_send?: boolean;
  dedup_reason?: string;               // 小字符串
}
```

### 2. ASRResult（ASR 服务返回的）

```typescript
interface ASRResult {
  text: string;                        // ~100-500 字符
  segments?: Array<{                   // 数组，可能包含多个元素
    text: string;                      // 每个 segment 的文本
    start: number;
    end: number;
    no_speech_prob?: number;
  }>;
  language_probability?: number;        // 单个数字
  language_probabilities?: Record<string, number>;  // 字典
  quality_score?: number;
  // ... 其他字段
}
```

### 3. AggregationStageResult

```typescript
export interface AggregationStageResult {
  aggregatedText: string;               // ~100-500 字符
  aggregationChanged: boolean;
  action: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  isLastInMergedGroup: boolean;
  shouldDiscard: boolean;
  shouldWaitForMerge: boolean;
  shouldSendToSemanticRepair: boolean;
  metrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
}
```

### 4. SemanticRepairStageResult

```typescript
export interface SemanticRepairStageZHResult {
  decision: 'PASS' | 'REPAIR' | 'REJECT';
  textOut: string;                     // ~100-500 字符
  confidence: number;
  semanticRepairApplied: boolean;
  reasonCodes?: string[];              // 数组，通常 < 5 个元素
}
```

### 5. TranslationStageResult

```typescript
export interface TranslationStageResult {
  translatedText: string;               // ~100-500 字符
  fromCache?: boolean;
}
```

### 6. TTSStageResult

```typescript
export interface TTSStageResult {
  ttsAudio: string;                    // base64 编码，可能很大（几KB到几十KB）
  ttsFormat: string;                    // 小字符串
}
```

### 7. TONEStageResult

```typescript
export interface TONEStageResult {
  toneAudio: string;                   // base64 编码，可能很大（几KB到几十KB）
  toneFormat: string;                   // 小字符串
  speakerId?: string;                  // 小字符串
}
```

## JobContext 完整定义（如果包含所有数据）

```typescript
export interface JobContext {
  // ========== 输入数据 ==========
  audio?: Buffer;                      // 音频数据，可能很大（几KB到几十KB）
  audioFormat?: 'pcm16' | 'opus';
  
  // ========== ASR 相关 ==========
  asrText?: string;                    // ~100-500 字符
  asrResult?: ASRResult;                // 包含 segments、language_probability 等
  asrSegments?: Array<{                 // 数组，可能包含多个元素
    text: string;
    start?: number;
    end?: number;
    no_speech_prob?: number;
  }>;
  languageProbabilities?: Record<string, number>;  // 字典
  qualityScore?: number;
  asrQualityLevel?: 'good' | 'suspect' | 'bad';
  reasonCodes?: string[];
  
  // ========== 聚合相关 ==========
  aggregatedText?: string;             // ~100-500 字符
  aggregationAction?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  aggregationChanged?: boolean;
  isLastInMergedGroup?: boolean;
  shouldDiscard?: boolean;
  shouldWaitForMerge?: boolean;
  shouldSendToSemanticRepair?: boolean;
  aggregationMetrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
  
  // ========== 语义修复相关 ==========
  repairedText?: string;               // ~100-500 字符
  semanticDecision?: 'PASS' | 'REPAIR' | 'REJECT';
  semanticRepairApplied?: boolean;
  semanticRepairConfidence?: number;
  semanticRepairReasonCodes?: string[];
  
  // ========== 翻译相关 ==========
  translatedText?: string;              // ~100-500 字符
  translationFromCache?: boolean;
  
  // ========== TTS 相关 ==========
  ttsAudio?: string;                   // base64 编码，可能很大（几KB到几十KB）
  ttsFormat?: string;
  
  // ========== TONE 相关 ==========
  toneAudio?: string;                  // base64 编码，可能很大（几KB到几十KB）
  toneFormat?: string;
  speakerId?: string;
  
  // ========== 控制流 ==========
  shouldSend?: boolean;
  dedupReason?: string;
  error?: string;
  
  // ========== 其他元数据 ==========
  rerunCount?: number;
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    language_probability?: number | null;
    language_probabilities?: Record<string, number> | null;
    [key: string]: unknown;
  };
}
```

## 大小估算

### 小数据字段（< 1KB）
- 所有字符串字段（text_asr、text_translated 等）：~2-3KB
- 所有数字和布尔字段：~100 bytes
- 所有小对象（metrics、extra 等）：~500 bytes
- **小计：~3-4KB**

### 中等数据字段（1-10KB）
- `segments` 数组：如果包含 10 个 segment，每个 segment 约 100 字符，约 1-2KB
- `language_probabilities` 字典：通常 < 10 个键，约 200 bytes
- **小计：~1-2KB**

### 大数据字段（> 10KB）
- `audio` Buffer：音频数据，可能几KB到几十KB（取决于音频长度）
- `ttsAudio` base64 字符串：TTS 音频，可能几KB到几十KB（取决于文本长度）
- `toneAudio` base64 字符串：TONE 音频，可能几KB到几十KB（取决于文本长度）
- **小计：可能 20-100KB 或更大**

### 总大小估算

**最坏情况**（包含所有数据）：
- 小数据：~4KB
- 中等数据：~2KB
- 大数据：~50-100KB（音频 + TTS + TONE）
- **总计：~60-110KB**

**典型情况**（只包含必要数据）：
- 小数据：~3KB
- 中等数据：~1KB
- 大数据：~20-30KB（只有 TTS 音频）
- **总计：~25-35KB**

## 为什么说 JobContext 会"变得很大"？

### 1. **音频数据占用空间大**
- `audio` Buffer：原始音频数据，可能几十KB
- `ttsAudio` base64 字符串：TTS 音频，可能几十KB
- `toneAudio` base64 字符串：TONE 音频，可能几十KB

### 2. **数据冗余**
- `asrText` 和 `aggregatedText` 和 `repairedText` 可能包含相似的文本
- `text_asr` 和 `text_asr_repaired` 可能包含相似的文本
- 如果所有字段都保留，会有数据冗余

### 3. **数组和对象嵌套**
- `segments` 数组可能包含多个元素
- `extra` 对象可能包含多个字段
- 嵌套结构增加了内存占用

## 优化建议

### 方案1：只保留必要的数据（推荐）✅

```typescript
export interface JobContext {
  // 只保留最终需要的数据，不保留中间状态
  audio?: Buffer;                      // 只在 ASR 步骤需要，之后可以清除
  asrText?: string;                    // ASR 结果
  aggregatedText?: string;             // 聚合后的文本（覆盖 asrText）
  repairedText?: string;               // 修复后的文本（覆盖 aggregatedText）
  translatedText?: string;             // 翻译后的文本
  ttsAudio?: string;                   // TTS 音频
  toneAudio?: string;                   // TONE 音频
  
  // 只保留必要的元数据
  shouldSend?: boolean;
  dedupReason?: string;
  
  // 不保留 segments、language_probabilities 等中间数据
  // 这些数据只在特定步骤需要，不需要在整个流程中传递
}
```

**优化效果**：
- 大小从 ~60-110KB 降低到 ~25-35KB
- 减少数据冗余
- 更清晰的数据流

### 方案2：按需传递数据

```typescript
// 不在 JobContext 中存储大数据，而是按需获取
export interface JobContext {
  // 只保留文本数据
  asrText?: string;
  aggregatedText?: string;
  repairedText?: string;
  translatedText?: string;
  
  // 音频数据不存储在 JobContext 中
  // 而是在需要时从服务返回，直接传递给下一个步骤
  // 或者存储在外部缓存中，JobContext 只保存引用
}
```

**优化效果**：
- 大小从 ~60-110KB 降低到 ~3-5KB
- 需要额外的缓存机制
- 增加了一些复杂度

### 方案3：分阶段清理数据

```typescript
export async function runJobPipeline(options) {
  const ctx = initJobContext(job);
  
  // ASR 步骤
  if (job.pipeline?.use_asr !== false) {
    await runAsrStep(job, ctx, services);
    // ASR 完成后，清除 audio 数据
    ctx.audio = undefined;
  }
  
  // 聚合步骤
  await runAggregationStep(job, ctx, services);
  // 聚合完成后，清除 asrText（已被 aggregatedText 覆盖）
  ctx.asrText = undefined;
  
  // 语义修复步骤
  await runSemanticRepairStep(job, ctx, services);
  // 修复完成后，清除 aggregatedText（已被 repairedText 覆盖）
  ctx.aggregatedText = undefined;
  
  // ... 其他步骤类似
}
```

**优化效果**：
- 每个阶段只保留必要的数据
- 总大小保持在 ~25-35KB
- 需要仔细管理数据清理时机

## 结论

### JobContext 会"变得很大"的原因：

1. **音频数据占用空间大**：`audio`、`ttsAudio`、`toneAudio` 可能占用几十KB
2. **数据冗余**：多个文本字段可能包含相似的内容
3. **数组和对象嵌套**：`segments`、`extra` 等增加了内存占用

### 优化建议：

1. **只保留必要的数据**：不保留中间状态，只保留最终需要的数据
2. **分阶段清理数据**：每个步骤完成后，清除不再需要的数据
3. **避免数据冗余**：使用覆盖策略，而不是同时保留多个版本的文本

### 实际大小：

- **优化前**：~60-110KB（包含所有数据）
- **优化后**：~25-35KB（只保留必要数据）
- **进一步优化**：~3-5KB（音频数据不存储在 JobContext 中）

**结论**：通过合理的优化，`JobContext` 的大小是可以接受的（~25-35KB），不会"变得很大"。
