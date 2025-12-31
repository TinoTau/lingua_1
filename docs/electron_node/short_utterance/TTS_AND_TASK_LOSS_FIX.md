# TTS 音频缺失和任务丢失问题修复

## 问题分析

### 1. 没有生成音频

**原因**:
- `PostProcessCoordinator` 中，只有当 `dedupResult.shouldSend` 为 `true` 时才会生成 TTS
- 如果去重检查失败（`shouldSend: false`），即使有翻译文本也不会生成 TTS

**修复**:
- 修改 TTS 生成条件：只要有翻译文本就生成 TTS，不再依赖 `dedupResult.shouldSend`
- 这样可以确保即使去重检查失败，任务仍然有音频返回

### 2. 丢失任务

**原因**:
- 当 Opus 编码失败时，`TaskRouter.routeTTSTask()` 会抛出错误
- `TTSStage.process()` 虽然捕获了错误，但如果格式检查失败会抛出新的错误
- 这些错误可能导致任务处理失败，没有返回结果

**修复**:
- `TTSStage.process()`: 当格式检查失败时，不再抛出错误，而是返回空音频
- `PostProcessCoordinator`: 添加 try-catch 包装 TTS 生成，确保即使 TTS 失败也继续处理
- 所有错误都被捕获并记录，但不会中断任务处理流程

### 3. 识别准确度非常低

**可能原因**:
- 与本次修改无关，可能是 S1/S2 的问题
- 需要查看日志确认 ASR 结果和聚合结果

## 修复内容

### 1. PostProcessCoordinator - TTS 生成条件

**修改前**:
```typescript
if (dedupResult.shouldSend && translationResult.translatedText && ...) {
  ttsResult = await this.ttsStage.process(job, translationResult.translatedText);
}
```

**修改后**:
```typescript
// 生成 TTS 音频（即使去重检查失败，只要有翻译文本就生成 TTS）
if (translationResult.translatedText && translationResult.translatedText.trim().length > 0 && this.ttsStage) {
  try {
    ttsResult = await this.ttsStage.process(job, translationResult.translatedText);
  } catch (ttsError) {
    // TTS 生成失败，记录错误但继续处理，返回空音频
    logger.error(...);
    ttsResult = { ttsAudio: '', ttsFormat: 'opus' };
  }
}
```

### 2. TTSStage - 格式检查错误处理

**修改前**:
```typescript
if (!audioFormat || audioFormat !== 'opus') {
  throw new Error(`TTS must use Opus format, but TaskRouter returned: ${audioFormat}`);
}
```

**修改后**:
```typescript
if (!audioFormat || audioFormat !== 'opus') {
  logger.error(...);
  // 不抛出错误，返回空音频，确保任务仍然返回结果
  return { ttsAudio: '', ttsFormat: 'opus', ttsTimeMs: ... };
}
```

### 3. TTSStage - 错误日志增强

**修改后**:
```typescript
catch (error) {
  logger.error({
    error,
    errorMessage: error instanceof Error ? error.message : String(error),
    ...
  }, 'TTSStage: TTS task failed (Opus encoding or other error), returning empty audio');
  return { ttsAudio: '', ttsFormat: 'opus', ... };
}
```

### 4. TaskRouter - Opus 编码错误日志增强

**修改后**:
```typescript
catch (opusError) {
  logger.error({
    error: opusError,
    errorMessage,
    errorStack: opusError instanceof Error ? opusError.stack : undefined,
    ...
  }, 'TTS: Opus encoding failed, cannot proceed without Opus format');
  throw new Error(...);
}
```

## 验证方法

### 1. 检查 TTS 生成

在节点端日志中搜索：
- `TTSStage: Starting TTS task` - 确认 TTS 任务开始
- `TTS audio encoded to Opus successfully` - 确认 Opus 编码成功
- `TTSStage: TTS task completed` - 确认 TTS 任务完成
- `PostProcessCoordinator: TTS generation failed` - 确认是否有 TTS 失败（应该返回空音频，但任务仍然返回）

### 2. 检查任务返回

在节点端日志中搜索：
- `Sending job_result to scheduler` - 确认所有任务都有返回结果
- `Job result sent successfully` - 确认任务成功发送
- `Failed to process job` - 确认是否有任务处理失败

### 3. 检查 Opus 编码

在节点端日志中搜索：
- `TTS: Opus encoder is not available` - 确认 Opus 编码器是否可用
- `TTS: Opus encoding failed` - 确认是否有 Opus 编码失败
- `TTSStage: TaskRouter must return Opus format` - 确认是否有格式问题

### 4. 检查识别准确度

在节点端日志中搜索：
- `AggregationStage: Processing completed` - 查看聚合结果
- `ASR result is empty` - 确认是否有空 ASR 结果
- `Job processing completed successfully` - 查看 ASR 和翻译文本

## 预期效果

1. **TTS 音频生成**:
   - 即使去重检查失败，只要有翻译文本就会生成 TTS
   - 即使 Opus 编码失败，也会返回空音频（格式为 opus），任务仍然返回结果

2. **任务不丢失**:
   - 所有任务都会返回结果（即使是空结果）
   - TTS 失败不会导致任务处理失败

3. **错误日志**:
   - 所有错误都会被记录，便于排查问题
   - 错误信息包含详细的上下文信息

## 识别准确度问题

如果识别准确度仍然很低，需要检查：
1. ASR 服务的配置和状态
2. S1 Prompt 是否正确注入
3. AggregationStage 的处理逻辑
4. 日志中的 ASR 原始结果和聚合结果

请查看日志，确认：
- ASR 原始文本是什么
- 聚合后的文本是什么
- 是否有 S1 Prompt 相关的日志

