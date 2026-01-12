# JobContext 音频数据传递方案

## 问题

如果音频内容不保留在 JobContext 里，怎么确保 jobResult 返回时能附上音频结果呢？

## 当前架构中的音频数据传递

### 当前流程

```
TTSStage.process()
  ↓ 返回 TTSStageResult { ttsAudio, ttsFormat }
PostProcessCoordinator.process()
  ↓ 返回 PostProcessResult { ttsAudio, ttsFormat, ... }
JobProcessor.processJob()
  ↓ 从 PostProcessResult 提取 ttsAudio，构建 JobResult
JobResult { tts_audio, tts_format }
```

### 关键点

1. **音频数据在步骤中生成**：TTS/TONE 步骤生成音频后，通过返回值传递
2. **数据在流程中传递**：从步骤返回值 → PostProcessResult → JobResult
3. **最终包含在 JobResult 中**：JobResult 包含 `tts_audio` 和 `tts_format`

## 解决方案

### 方案1：音频数据存储在 JobContext 中（推荐）✅

**这是最简单、最直接的方式。**

```typescript
export interface JobContext {
  // 文本数据
  asrText?: string;
  aggregatedText?: string;
  repairedText?: string;
  translatedText?: string;
  
  // 音频数据（存储在 JobContext 中）
  ttsAudio?: string;      // base64 编码的 TTS 音频
  ttsFormat?: string;     // 'opus' | 'wav' | 'pcm16'
  toneAudio?: string;     // base64 编码的 TONE 音频
  toneFormat?: string;    // 'opus' | 'wav' | 'pcm16'
  
  // 控制流
  shouldSend?: boolean;
  dedupReason?: string;
}

// TTS 步骤
export async function runTtsStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
) {
  if (!ctx.translatedText || ctx.translatedText.trim().length === 0) {
    return;  // 跳过
  }
  
  // 生成 TTS 音频
  const ttsResult = await services.taskRouter.routeTTSTask({
    text: ctx.translatedText,
    lang: job.tgt_lang,
    // ...
  });
  
  // 存储到 JobContext
  ctx.ttsAudio = ttsResult.audio;
  ctx.ttsFormat = ttsResult.format;
}

// TONE 步骤
export async function runToneStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
) {
  if (!ctx.ttsAudio || ctx.ttsAudio.trim().length === 0) {
    return;  // 跳过
  }
  
  // 生成 TONE 音频
  const toneResult = await services.taskRouter.routeTONETask({
    audio: ctx.ttsAudio,
    format: ctx.ttsFormat,
    speaker_id: (job as any).speaker_id,
    // ...
  });
  
  // 存储到 JobContext（覆盖 TTS 音频）
  ctx.toneAudio = toneResult.audio;
  ctx.toneFormat = toneResult.format;
}

// 构建 JobResult
export function buildJobResult(
  job: JobAssignMessage,
  ctx: JobContext
): JobResult {
  return {
    text_asr: ctx.repairedText || ctx.aggregatedText || ctx.asrText || '',
    text_translated: ctx.translatedText || '',
    tts_audio: ctx.toneAudio || ctx.ttsAudio || '',  // 优先使用 TONE 音频
    tts_format: ctx.toneFormat || ctx.ttsFormat || 'opus',
    should_send: ctx.shouldSend ?? true,
    dedup_reason: ctx.dedupReason,
    // ... 其他字段
  };
}
```

**优势**：
- ✅ 简单直接，数据流清晰
- ✅ 所有数据都在 JobContext 中，易于访问
- ✅ 不需要额外的缓存机制

**劣势**：
- ⚠️ JobContext 会包含音频数据（~20-50KB），但这是可以接受的

---

### 方案2：音频数据通过步骤返回值传递（不推荐）❌

**这种方式会增加复杂度，不推荐。**

```typescript
// 步骤函数返回音频数据
export async function runTtsStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<{ ttsAudio: string; ttsFormat: string } | null> {
  if (!ctx.translatedText || ctx.translatedText.trim().length === 0) {
    return null;  // 跳过
  }
  
  const ttsResult = await services.taskRouter.routeTTSTask({
    text: ctx.translatedText,
    lang: job.tgt_lang,
    // ...
  });
  
  return {
    ttsAudio: ttsResult.audio,
    ttsFormat: ttsResult.format,
  };
}

// 主流程需要收集返回值
export async function runJobPipeline(options) {
  const ctx = initJobContext(job);
  
  // ... 其他步骤 ...
  
  // TTS 步骤
  let ttsResult: { ttsAudio: string; ttsFormat: string } | null = null;
  if (job.pipeline?.use_tts !== false) {
    ttsResult = await runTtsStep(job, ctx, services);
  }
  
  // TONE 步骤
  let toneResult: { toneAudio: string; toneFormat: string } | null = null;
  if (job.pipeline?.use_tone === true && ttsResult) {
    toneResult = await runToneStep(job, ctx, services, ttsResult);
  }
  
  // 构建 JobResult 时需要传递音频数据
  return buildJobResult(job, ctx, ttsResult, toneResult);
}

// buildJobResult 需要额外的参数
export function buildJobResult(
  job: JobAssignMessage,
  ctx: JobContext,
  ttsResult?: { ttsAudio: string; ttsFormat: string } | null,
  toneResult?: { toneAudio: string; toneFormat: string } | null
): JobResult {
  return {
    text_asr: ctx.repairedText || ctx.aggregatedText || ctx.asrText || '',
    text_translated: ctx.translatedText || '',
    tts_audio: toneResult?.toneAudio || ttsResult?.ttsAudio || '',
    tts_format: toneResult?.toneFormat || ttsResult?.ttsFormat || 'opus',
    // ... 其他字段
  };
}
```

**劣势**：
- ❌ 增加了复杂度：需要管理多个返回值
- ❌ 步骤函数签名不一致：有些返回 void，有些返回数据
- ❌ 主流程需要收集和管理返回值
- ❌ 容易出错：忘记处理返回值会导致数据丢失

---

### 方案3：音频数据存储在外部缓存（过度设计）❌

**这种方式过于复杂，不推荐。**

```typescript
// 使用外部缓存存储音频数据
const audioCache = new Map<string, { ttsAudio: string; ttsFormat: string }>();

export async function runTtsStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
) {
  if (!ctx.translatedText || ctx.translatedText.trim().length === 0) {
    return;
  }
  
  const ttsResult = await services.taskRouter.routeTTSTask({
    text: ctx.translatedText,
    lang: job.tgt_lang,
    // ...
  });
  
  // 存储到外部缓存
  audioCache.set(job.job_id, {
    ttsAudio: ttsResult.audio,
    ttsFormat: ttsResult.format,
  });
}

// 构建 JobResult 时从缓存获取
export function buildJobResult(
  job: JobAssignMessage,
  ctx: JobContext
): JobResult {
  const audioData = audioCache.get(job.job_id);
  
  return {
    text_asr: ctx.repairedText || ctx.aggregatedText || ctx.asrText || '',
    text_translated: ctx.translatedText || '',
    tts_audio: audioData?.ttsAudio || '',
    tts_format: audioData?.ttsFormat || 'opus',
    // ... 其他字段
  };
  
  // 清理缓存
  audioCache.delete(job.job_id);
}
```

**劣势**：
- ❌ 过度设计：增加了不必要的复杂度
- ❌ 需要管理缓存的生命周期
- ❌ 容易出现内存泄漏（如果忘记清理）
- ❌ 增加了调试难度

---

## 推荐方案：方案1（音频数据存储在 JobContext 中）

### 理由

1. **简单直接**：
   - 所有数据都在 JobContext 中，数据流清晰
   - 不需要额外的缓存机制
   - 不需要管理返回值

2. **符合设计原则**：
   - JobContext 作为数据传递的载体，音频数据也是数据的一部分
   - 步骤函数通过修改 JobContext 来传递数据，这是最自然的方式

3. **易于维护**：
   - 所有数据都在一个地方，易于调试
   - 不需要额外的缓存管理
   - 代码更简洁

4. **性能可接受**：
   - JobContext 包含音频数据后，大小约为 ~25-35KB
   - 这在现代系统中是可以接受的
   - 音频数据只在内存中存在很短时间（处理完成后立即发送）

### 实施建议

```typescript
// JobContext 定义（包含音频数据）
export interface JobContext {
  // 文本数据
  asrText?: string;
  aggregatedText?: string;
  repairedText?: string;
  translatedText?: string;
  
  // 音频数据（存储在 JobContext 中）
  ttsAudio?: string;      // base64 编码的 TTS 音频
  ttsFormat?: string;     // 'opus' | 'wav' | 'pcm16'
  toneAudio?: string;     // base64 编码的 TONE 音频
  toneFormat?: string;    // 'opus' | 'wav' | 'pcm16'
  speakerId?: string;     // TONE 音色ID
  
  // 控制流
  shouldSend?: boolean;
  dedupReason?: string;
  error?: string;
}

// 主流程
export async function runJobPipeline(options) {
  const ctx = initJobContext(job);
  
  // ASR 步骤
  if (job.pipeline?.use_asr !== false) {
    await runAsrStep(job, ctx, services, { partialCallback, asrCompletedCallback });
    // ASR 完成后，可以清除 audio 数据（如果不再需要）
    // ctx.audio = undefined;
  }
  
  // 聚合步骤
  await runAggregationStep(job, ctx, services);
  
  // 语义修复步骤
  await runSemanticRepairStep(job, ctx, services);
  
  // 去重步骤
  await runDedupStep(job, ctx, services);
  
  // 翻译步骤
  if (job.pipeline?.use_nmt !== false) {
    await runTranslationStep(job, ctx, services);
  }
  
  // TTS 步骤（音频数据存储到 ctx.ttsAudio）
  if (job.pipeline?.use_tts !== false) {
    await runTtsStep(job, ctx, services);
  }
  
  // TONE 步骤（音频数据存储到 ctx.toneAudio，覆盖 ctx.ttsAudio）
  if (job.pipeline?.use_tone === true) {
    await runToneStep(job, ctx, services);
  }
  
  // 构建 JobResult（从 JobContext 中提取所有数据，包括音频）
  return buildJobResult(job, ctx);
}

// 构建 JobResult
export function buildJobResult(
  job: JobAssignMessage,
  ctx: JobContext
): JobResult {
  return {
    text_asr: ctx.repairedText || ctx.aggregatedText || ctx.asrText || '',
    text_translated: ctx.translatedText || '',
    tts_audio: ctx.toneAudio || ctx.ttsAudio || '',  // 优先使用 TONE 音频
    tts_format: ctx.toneFormat || ctx.ttsFormat || 'opus',
    should_send: ctx.shouldSend ?? true,
    dedup_reason: ctx.dedupReason,
    // ... 其他字段
  };
}
```

## 总结

**推荐方案：音频数据存储在 JobContext 中**

- ✅ 简单直接，数据流清晰
- ✅ 所有数据都在一个地方，易于访问和调试
- ✅ 不需要额外的缓存机制
- ✅ 性能可接受（~25-35KB）

**不推荐**：
- ❌ 通过返回值传递（增加复杂度）
- ❌ 外部缓存（过度设计）

**关键点**：
- JobContext 作为数据传递的载体，音频数据也是数据的一部分
- 步骤函数通过修改 JobContext 来传递数据，这是最自然的方式
- 音频数据只在内存中存在很短时间，性能影响可接受
