# Job 结果保证与 TTS 格式问题分析

## 问题 1: 某些语音输入没有收到返回结果

### 问题分析

**当前行为**:
- 如果 `PostProcessCoordinator` 返回 `shouldSend: false`（去重检查失败），`NodeAgent` 会直接 `return`，不发送结果
- 这会导致某些 job 没有返回结果，即使它们应该被核销

**修复方案**:
- 即使去重检查失败，仍然发送空结果，确保每个 job 都有返回结果
- 这样调度服务器可以将其转换为 `MissingResult`，确保任务核销

### 修复后的行为

```typescript
// PostProcessCoordinator 决定不发送（可能是重复文本）
// 但为了确保每个 job 都有返回结果（核销需要），仍然发送空结果
if (!postProcessResult.shouldSend) {
  logger.debug('PostProcessCoordinator filtered result, but sending empty result for job verification');
  // 发送空结果，确保 job 被核销
  finalResult = {
    ...result,
    text_asr: postProcessResult.aggregatedText || '',
    text_translated: postProcessResult.translatedText || '',
    tts_audio: '',
    tts_format: 'pcm16',
  };
}
```

### 检查方法

在节点端日志中搜索：
- `PostProcessCoordinator filtered result, but sending empty result` - 去重过滤但仍发送空结果
- `Aggregator filtered result, but sending empty result` - 去重过滤但仍发送空结果
- `Sending job_result to scheduler` - 确认所有 job 都有发送结果

## 问题 2: TTS 格式仍为 pcm16 而不是 opus

### 问题分析

**可能的原因**:

1. **Opus 编码器不可用**:
   - `isOpusEncoderAvailable()` 返回 `false`
   - 可能原因：
     - 环境变量 `OPUS_ENCODING_ENABLED=false` 被设置
     - Opus 编码器初始化失败

2. **Opus 编码失败**:
   - 编码过程中抛出异常，回退到 PCM16

3. **TTS 音频为空**:
   - 如果翻译文本为空，`TTSStage` 会返回默认格式 `pcm16`

### 修复方案

1. **添加日志记录**:
   - 在 `TaskRouter.routeTTSTask` 中记录 Opus 编码器可用性
   - 在 `TTSStage` 中记录实际返回的格式

2. **检查 Opus 编码器状态**:
   - 检查环境变量 `OPUS_ENCODING_ENABLED`
   - 检查 Opus 编码器初始化日志

### 检查方法

在节点端日志中搜索：
- `TTS: Checking Opus encoder availability` - Opus 编码器可用性检查
- `TTS audio encoded to Opus successfully` - Opus 编码成功
- `Opus encoding failed, falling back to PCM16` - Opus 编码失败
- `TTS: Opus encoder not available, using PCM16` - Opus 编码器不可用
- `TTSStage: TaskRouter returned empty audio_format` - TaskRouter 返回空格式

### 调试步骤

1. **检查环境变量**:
   ```bash
   # 确保没有设置 OPUS_ENCODING_ENABLED=false
   echo $OPUS_ENCODING_ENABLED
   ```

2. **检查 Opus 编码器初始化**:
   - 在日志中搜索 `Opus encoder initialized`
   - 如果未找到，说明编码器初始化失败

3. **检查 TTS 任务日志**:
   - 查看 `TTS: Checking Opus encoder availability` 日志
   - 查看 `opusAvailable` 的值

4. **检查编码过程**:
   - 查看是否有 `Opus encoding failed` 错误
   - 查看是否有编码相关的异常

## 总结

### 问题 1 修复

✅ **已修复**: 即使去重检查失败，仍然发送空结果，确保每个 job 都有返回结果

### 问题 2 诊断

需要检查：
1. Opus 编码器是否可用（`isOpusEncoderAvailable()`）
2. Opus 编码是否成功
3. 环境变量是否禁用了 Opus 编码

**已添加日志**:
- `TTS: Checking Opus encoder availability` - 记录 Opus 编码器状态
- `TTS audio encoded to Opus successfully` - 记录 Opus 编码成功
- `TTSStage: TaskRouter returned empty audio_format` - 记录格式为空的情况

请查看日志，确认 Opus 编码器的实际状态。

