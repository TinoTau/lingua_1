# 节点端 Job 处理完整流程

## 概述

本文档描述一个 job 从调度服务器接收到最终返回结果的完整处理流程。

---

## 完整流程图

```
调度服务器
    ↓ (WebSocket: job_assign)
NodeAgent.handleJob()
    ↓
JobProcessor.processJob()
    ├─ 按需启动服务（如 speaker_embedding）
    ├─ 设置流式 ASR 部分结果回调（如果启用）
    ↓
InferenceService.processJob()
    ├─ 首次任务检查（等待服务就绪）
    ├─ 刷新服务端点（带缓存，TTL 1000ms）
    ↓
PipelineOrchestrator.processJob()  [ASR阶段]
    ├─ 检查 use_asr（如果 false，返回空结果）
    ├─ AudioAggregator (音频聚合)
    │   └─ 8秒阈值判断，延迟3秒等待合并
    ├─ ASRHandler (ASR识别)
    │   └─ TaskRouter.routeASRTask()
    ├─ ASRResultProcessor (ASR结果处理)
    │   ├─ 空文本检查
    │   └─ 无意义文本检查
    ├─ AggregationStage (文本聚合) ← 已迁移
    │   ├─ AggregatorManager.processUtterance()
    │   ├─ TextForwardMergeManager (向前合并)
    │   └─ DeduplicationHandler (去重)
    ├─ MergeHandler (合并处理) ← 已迁移
    │   └─ 取消被合并的 GPU 任务
    ├─ TextFilter (文本过滤) ← 已迁移
    │   ├─ shouldDiscard (< 6字符)
    │   └─ shouldWaitForMerge (6-16字符)
    ├─ detectInternalRepetition (内部重复检测)
    ├─ SemanticRepairStage (语义修复)
    │   └─ TaskRouter.routeSemanticRepairTask()
    └─ DedupStage (job_id去重) ← 已迁移
        └─ 基于 job_id，30秒 TTL
    ↓
PostProcessCoordinator.process()  [后处理阶段]
    ├─ 检查 should_send（如果 false，直接返回）
    ├─ 检查文本是否为空（如果为空，返回空结果）
    ├─ TranslationStage (NMT翻译)
    │   ├─ 检查 use_nmt
    │   ├─ 如果 use_asr=false，使用 job.input_text
    │   └─ TaskRouter.routeNMTTask()
    ├─ TTSStage (TTS语音生成)
    │   ├─ 检查 use_tts
    │   └─ TaskRouter.routeTTSTask()
    └─ TONEStage (TONE音色配音)
        ├─ 检查 use_tone
        └─ TaskRouter.routeTONETask()
    ↓
ResultSender.sendJobResult()
    ├─ lastSentText检查 (文本去重，最终防线)
    ├─ 更新 lastSentText（通过 DeduplicationHandler）
    ├─ 标记 job_id 为已发送（通过 DedupStage）
    └─ 发送到调度服务器
```

---

## 详细流程说明

### 阶段1：消息接收（NodeAgent）

**文件**：`electron_node/electron-node/main/src/agent/node-agent.ts`

#### 1.1 接收消息
```typescript
handleMessage(data: string)
```
- 接收 WebSocket 消息
- 解析 JSON
- 根据 `message.type` 分发：
  - `job_assign` → 调用 `handleJob()`

#### 1.2 处理 Job
```typescript
handleJob(job: JobAssignMessage)
```
**检查项**：
- ✅ WebSocket 连接状态（`ws.readyState === WebSocket.OPEN`）
- ✅ `nodeId` 是否已设置
- ✅ 检查是否与最近处理的 `job_id` 重复（快速过滤，检查最近2个）

**操作**：
- 记录任务接收时间
- 调用 `jobProcessor.processJob(job, startTime)`
- 根据 `processResult.shouldSend` 决定是否发送结果

---

### 阶段2：任务处理（JobProcessor）

**文件**：`electron_node/electron-node/main/src/agent/node-agent-job-processor.ts`

#### 2.1 按需启动服务
```typescript
processJob(job: JobAssignMessage, startTime: number)
```
- 如果 `job.features?.speaker_identification` 为 `true`，启动 `speaker_embedding` 服务

#### 2.2 设置流式 ASR 回调
- 如果 `job.enable_streaming_asr` 为 `true`，创建 `partialCallback`
- `partialCallback` 会发送 `asr_partial` 消息到调度服务器

#### 2.3 调用推理服务
```typescript
const result = await this.inferenceService.processJob(job, partialCallback);
```

#### 2.4 后处理协调
```typescript
const postProcessResult = await this.postProcessCoordinator.process(job, result);
```
- 如果启用 `enablePostProcessTranslation`，调用 `PostProcessCoordinator`
- 处理 TTS Opus 编码（如果是 WAV 格式，编码为 Opus）

#### 2.5 返回结果
- 返回 `{ finalResult, shouldSend, reason }`

---

### 阶段3：推理服务（InferenceService）

**文件**：`electron_node/electron-node/main/src/inference/inference-service.ts`

#### 3.1 首次任务检查
```typescript
processJob(job: JobAssignMessage, partialCallback?: PartialResultCallback)
```
- 如果是第一个任务，调用 `waitForServicesReady()` 等待服务就绪
- 调用 `onTaskStartCallback()` 启动 GPU 跟踪

#### 3.2 服务端点刷新（带缓存）
```typescript
await this.taskRouter.refreshServiceEndpoints();
```
- **缓存机制**：TTL 1000ms（1秒）
- 如果缓存未过期，跳过刷新
- 如果缓存已过期或强制刷新，刷新所有服务端点状态

#### 3.3 流水线编排
```typescript
const result = await this.pipelineOrchestrator.processJob(
  job, 
  partialCallback, 
  asrCompletedCallback
);
```
- `asrCompletedCallback`：ASR 完成后从 `currentJobs` 中移除任务

#### 3.4 返回结果
- 返回 `JobResult`（包含 `text_asr`, `text_translated`, `tts_audio`）

---

### 阶段4：流水线编排（PipelineOrchestrator）- ASR阶段

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

#### 4.1 构建 Prompt（如果启用）
```typescript
const contextText = this.asrHandler.buildPrompt(job) || job.context_text;
```
- 使用 `AggregatorManager` 获取历史文本，构建 prompt

#### 4.2 音频处理
```typescript
const audioProcessResult = await this.audioProcessor.processAudio(job);
```

**AudioAggregator（音频聚合）**：
- **目的**：保证语音断句完整（在ASR之前）
- **判断标准**：音频时长（8秒阈值）
- **逻辑**：
  - 如果音频 < 8秒且非手动截断，延迟3秒等待合并
  - 如果手动截断、3秒静音、超时触发，立即处理
  - 如果音频 ≥ 10秒，自动处理

**音频格式转换**：
- Opus → PCM16（如果音频格式是 Opus）

#### 4.3 ASR 任务路由
```typescript
const asrTask: ASRTask = {
  audio: audioForASR,
  audio_format: audioFormatForASR,
  sample_rate: job.sample_rate || 16000,
  src_lang: job.src_lang,
  context_text: contextText,
  // ...
};

const asrResult = await this.taskRouter.routeASRTask(asrTask);
```

**TaskRouter.routeASRTask()**：
- 选择 ASR 服务端点（轮询策略）
- 调用 ASR 服务进行语音识别
- 返回 `ASRResult`（包含 `text`, `segments`, `language_probability`）

#### 4.4 ASR 结果处理
```typescript
const asrResultProcessResult = this.asrResultProcessor.processASRResult(job, asrResult);
```

**ASRResultProcessor**：
- 检查空文本（`isEmptyText()`）
- 检查无意义文本（`isMeaninglessWord()`）
- **注意**：文本聚合已移除，现在由 PostProcessCoordinator 统一处理

#### 4.4 文本聚合（AggregationStage）
```typescript
const aggregationResult = this.aggregationStage.process(job, tempResult);
```
- 调用 `AggregatorManager.processUtterance()` 进行文本聚合
- 决定 MERGE / NEW_STREAM / COMMIT
- 使用 `TextForwardMergeManager` 处理向前合并和去重

#### 4.5 合并处理（MergeHandler）
```typescript
const mergeResult = this.mergeHandler.process(job, aggregationResult);
```
- 处理合并逻辑，取消被合并的 GPU 任务
- 如果被合并但不是最后一个，返回空结果

#### 4.6 文本过滤（TextFilter）
```typescript
const filterResult = this.textFilter.process(job, aggregationResult);
```
- 处理文本过滤逻辑（shouldDiscard、shouldWaitForMerge）
- 如果文本太短或等待合并，返回空结果

#### 4.7 语义修复（SemanticRepairStage）
```typescript
const repairResult = await semanticRepairStage.process(...);
```
- 调用语义修复服务修复文本
- 返回修复后的文本

#### 4.8 去重检查（DedupStage）
```typescript
const dedupResult = this.dedupStage.process(job, finalText, '');
```
- 基于 job_id 进行去重检查（30秒 TTL）
- 如果重复，返回 `should_send: false`

#### 4.9 构建结果
```typescript
const result = this.resultBuilder.buildResult(finalTextForNMT, asrResult, rerunCount);
```
- 返回 `JobResult`（包含 `text_asr`、`should_send`、`dedup_reason` 等）

---

### 阶段5：后处理协调（PostProcessCoordinator）

**文件**：`electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

**注意**：聚合和去重逻辑已迁移到 PipelineOrchestrator，PostProcessCoordinator 现在只负责翻译、TTS 和 TONE。

#### 5.1 检查是否应该处理
```typescript
if (result.should_send === false) {
  return { shouldSend: false, ... };
}
```
- 如果 PipelineOrchestrator 已决定不发送（去重失败），直接返回空结果

#### 5.2 翻译（TranslationStage）
```typescript
const translationResult = await this.translationStage.process(
  job,
  textForTranslation,
  result
);
```

**TranslationStage**：
- 调用 NMT 服务进行翻译
- 使用翻译缓存（LRU Cache，200条，10分钟TTL）
- 返回 `translatedText`

#### 5.3 TTS 语音生成（TTSStage）
```typescript
const ttsResult = await this.ttsStage.process(
  job,
  translationResult.translatedText,
  result
);
```

**TTSStage**：
- 调用 TTS 服务生成语音
- 返回 `ttsAudio` 和 `ttsFormat`

#### 5.4 TONE 音色配音（TONEStage）
```typescript
const toneResult = await this.toneStage.process(job, ttsAudio, ttsFormat, speakerId);
```
- 如果 `use_tone === true`，生成音色配音
- 返回 `toneAudio` 和 `toneFormat`

#### 5.5 返回结果
```typescript
return {
  shouldSend: result.should_send ?? true,
  aggregatedText: textForTranslation,
  translatedText: translationResult.translatedText,
  ttsAudio: toneResult.toneAudio || ttsResult.ttsAudio,
  ttsFormat: toneResult.toneFormat || ttsResult.ttsFormat,
  // ...
};
```

---

### 阶段6：结果发送（ResultSender）

**文件**：`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts`

#### 6.1 文本去重检查（最终防线）
```typescript
sendJobResult(job: JobAssignMessage, finalResult: JobResult, ...)
```

**lastSentText 检查**：
- **目的**：防止重复发送相同的文本内容
- **判断标准**：文本内容（规范化后比较，10分钟 TTL）
- **逻辑**：
  - 检查是否与上次发送的文本完全相同
  - 如果重复，不发送，但会记录 job_id（通过 `dedupStage.markJobIdAsSent()`）

#### 6.2 构建响应消息
```typescript
const response: JobResultMessage = {
  type: 'job_result',
  job_id: job.job_id,
  session_id: job.session_id,
  utterance_index: job.utterance_index,
  text_asr: finalResult.text_asr,
  text_translated: finalResult.text_translated,
  tts_audio: finalResult.tts_audio,
  tts_format: finalResult.tts_format,
  // ...
};
```

#### 6.3 发送到调度服务器
```typescript
this.ws.send(JSON.stringify(response));
```

#### 6.4 更新状态
```typescript
// 更新 lastSentText
this.aggregatorMiddleware.setLastSentText(job.session_id, finalResult.text_asr.trim());

// 记录 job_id（用于去重）
this.dedupStage.markJobIdAsSent(job.session_id, job.job_id);
```

---

## 关键组件说明

### 1. AudioAggregator（音频聚合）
- **位置**：PipelineOrchestrator 之前（ASR之前）
- **目的**：保证语音断句完整
- **判断标准**：音频时长（8秒阈值）
- **功能**：将多个音频块聚合成完整句子，提高ASR识别准确率

### 2. AggregationStage（文本聚合）
- **位置**：PipelineOrchestrator 中（ASR之后）
- **目的**：保证上下文完整
- **判断标准**：文本长度（6-16字符）
- **功能**：处理跨utterance的边界重复，合并连续句子

### 3. MergeHandler（合并处理）
- **位置**：PipelineOrchestrator 中（聚合之后）
- **目的**：处理合并逻辑，取消被合并的 GPU 任务
- **功能**：如果 utterance 被合并但不是最后一个，返回空结果并取消后续任务

### 4. TextFilter（文本过滤）
- **位置**：PipelineOrchestrator 中（合并处理之后）
- **目的**：处理文本过滤逻辑
- **功能**：处理 shouldDiscard（< 6字符）和 shouldWaitForMerge（6-16字符）

### 5. SemanticRepairStage（语义修复）
- **位置**：PipelineOrchestrator 中（文本过滤之后）
- **目的**：修复 ASR 识别错误
- **功能**：调用语义修复服务修复文本

### 6. DedupStage（job_id去重）
- **位置**：PipelineOrchestrator 中（语义修复之后）
- **目的**：防止同一个 job 被重复处理
- **判断标准**：job_id（30秒 TTL）

### 4. lastSentText（文本去重，最终防线）
- **位置**：ResultSender 中（发送之前）
- **目的**：防止重复发送相同的文本内容
- **判断标准**：文本内容（10分钟 TTL）

---

## 数据流

### 输入
- `JobAssignMessage`：包含 `audio`, `session_id`, `src_lang`, `tgt_lang`, `job_id`, `utterance_index` 等

### 中间数据
- `ASRResult`：`text`, `segments`, `language_probability`, `quality_score`
- `AggregationStageResult`：`aggregatedText`, `action`, `shouldDiscard`, `shouldWaitForMerge`
- `TranslationStageResult`：`translatedText`, `fromCache`
- `TTSStageResult`：`ttsAudio`, `ttsFormat`

### 输出
- `JobResultMessage`：包含 `text_asr`, `text_translated`, `tts_audio`, `tts_format` 等

---

## 顺序执行保证

### SequentialExecutor
- **作用**：确保同一 session 的多个 job 按 `utterance_index` 顺序执行
- **机制**：每个阶段（ASR、NMT、TTS、SemanticRepair）都有独立的顺序保证
- **支持**：流水线并行处理（不同 job 的不同阶段可以并发执行）

---

## 缓存机制

### 1. Service Endpoints 刷新缓存
- **位置**：`TaskRouter.refreshServiceEndpoints()`
- **TTL**：1000ms（1秒）
- **作用**：减少重复刷新，提高性能

### 2. 翻译缓存
- **位置**：`TranslationStage`
- **大小**：200条
- **TTL**：10分钟
- **作用**：提高翻译性能

### 3. lastSentText 缓存
- **位置**：`AggregatorMiddleware.DeduplicationHandler`
- **TTL**：10分钟
- **作用**：文本去重

### 4. job_id 去重缓存
- **位置**：`DedupStage`
- **TTL**：30秒
- **作用**：job_id 去重

---

## 总结

一个 job 的完整处理流程：

1. **消息接收**：NodeAgent 接收 `job_assign` 消息
2. **任务处理**：JobProcessor 按需启动服务，设置回调
3. **推理服务**：InferenceService 刷新服务端点（带缓存），调用 PipelineOrchestrator
4. **ASR阶段**：PipelineOrchestrator 进行音频聚合、ASR识别、文本聚合、合并处理、文本过滤、语义修复、去重检查
5. **后处理阶段**：PostProcessCoordinator 进行翻译、TTS、TONE
6. **结果发送**：ResultSender 进行文本去重检查，发送到调度服务器

**关键特点**：
- ✅ 音频聚合和文本聚合职责不同，互补而非冲突
- ✅ 聚合和去重逻辑统一在 PipelineOrchestrator 中处理，避免重复
- ✅ 三处去重逻辑职责清晰，互补而非冲突
- ✅ 顺序执行保证支持流水线并行处理
- ✅ 多层缓存机制提高性能
