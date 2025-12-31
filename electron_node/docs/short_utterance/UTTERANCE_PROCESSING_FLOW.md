# Utterance 处理流程详解

## 概述

本文档详细说明节点端在收到调度服务器的 `Utterance`（通过 `job_assign` 消息）后，整个识别-翻译的完整流程。

## 完整流程图

```
调度服务器 (Scheduler)
    ↓ (WebSocket: job_assign)
NodeAgent.handleMessage()
    ↓
NodeAgent.handleJob()
    ├─ 1. 检查 job_id 重复（recentJobIds）
    ├─ 2. 等待服务就绪（第一次任务）
    └─ 3. 调用 InferenceService.processJob()
        ↓
InferenceService.processJob()
    ├─ 等待服务就绪（第一次任务）
    └─ 调用 PipelineOrchestrator.processJob()
        ↓
PipelineOrchestrator.processJob()
    ├─ 步骤1: ASR 任务
    │   ├─ S1: 构建 Prompt（PromptBuilder）
    │   │   ├─ 获取最近提交的文本（recentCommittedText）
    │   │   ├─ 获取用户关键词（userKeywords）
    │   │   └─ 构建 context_text（注入到 ASR）
    │   ├─ 创建 ASRTask
    │   ├─ TaskRouter.routeASRTask()
    │   │   └─ 路由到 faster-whisper-vad 服务
    │   │       └─ HTTP POST /utterance
    │   │           └─ ASR 服务在 GPU 上执行识别
    │   └─ 返回 ASRResult（text, language, quality_score等）
    │
    ├─ 步骤2: NMT 任务（如果 ASR 结果非空）
    │   ├─ 创建 NMTTask
    │   ├─ TaskRouter.routeNMTTask()
    │   │   └─ 路由到 NMT 服务
    │   │       └─ HTTP POST /translate
    │   │           └─ NMT 服务在 GPU 上执行翻译
    │   └─ 返回 NMTResult（text_translated）
    │
    └─ 步骤3: TTS 任务（如果启用）
        ├─ 创建 TTSTask
        ├─ TaskRouter.routeTTSTask()
        │   └─ 路由到 TTS 服务
        │       └─ HTTP POST /synthesize
        │           └─ TTS 服务在 GPU 上执行合成
        └─ 返回 TTSResult（tts_audio）
            ↓
返回 JobResult
    ↓
NodeAgent.handleJob() 继续处理
    └─ 调用 AggregatorMiddleware.process()
        ↓
AggregatorMiddleware.process()
    ├─ 步骤1: 文本聚合（AggregatorManager）
    │   ├─ processUtterance()
    │   │   ├─ 去重（Dedup）
    │   │   ├─ 合并（Merge）
    │   │   └─ 决策（Commit/Merge/NewStream）
    │   └─ 返回聚合后的文本
    │
    ├─ 步骤2: S2 Rescoring（已禁用）
    │   └─ 不再进行二次解码和重新评分
    │
    ├─ 步骤3: NMT 重新翻译（如果文本被聚合）
    │   ├─ 检查缓存（TranslationCache）
    │   ├─ 如果未缓存，调用 TaskRouter.routeNMTTask()
    │   ├─ NMT Repair（可选，如果质量分数低）
    │   │   ├─ 检测同音字错误（HomophoneDetector）
    │   │   ├─ 生成多个候选（NMT candidates）
    │   │   ├─ 评分候选（CandidateScorer）
    │   │   └─ 选择最佳候选（selectBestCandidate）
    │   └─ 返回翻译后的文本
    │
    └─ 步骤4: 去重检查
        ├─ 检查是否与上次发送的文本相同
        └─ 如果相同，返回 shouldSend: false
            ↓
返回 AggregatorMiddlewareResult
    ↓
NodeAgent.handleJob() 继续处理
    ├─ 检查 shouldSend
    ├─ 更新 lastSentText
    └─ 发送 JobResultMessage 到调度服务器
        ↓
调度服务器 (Scheduler)
```

## 详细步骤说明

### 1. NodeAgent 接收消息

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

**入口**: `handleMessage()` → `handleJob()`

**操作**:
1. **检查 job_id 重复**:
   ```typescript
   // 检查是否已经处理过这个job（防止重复处理）
   if (this.recentJobIds.length > 0 && 
       this.recentJobIds[this.recentJobIds.length - 1] === job.job_id) {
     logger.warn('Skipping duplicate job_id');
     return;
   }
   ```

2. **等待服务就绪**（第一次任务）:
   ```typescript
   // 如果是第一个任务，等待服务就绪
   if (wasFirstJob) {
     await this.waitForServicesReady();
   }
   ```

3. **调用 InferenceService**:
   ```typescript
   const result = await this.inferenceService.processJob(job, partialCallback);
   ```

### 2. InferenceService 处理

**文件**: `electron_node/electron-node/main/src/inference/inference-service.ts`

**操作**:
1. **等待服务就绪**（第一次任务）:
   ```typescript
   if (wasFirstJob) {
     await this.waitForServicesReady();
   }
   ```

2. **调用 PipelineOrchestrator**:
   ```typescript
   const result = await this.pipelineOrchestrator.processJob(
     job,
     partialCallback,
     asrCompletedCallback
   );
   ```

### 3. PipelineOrchestrator 编排流程

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

#### 3.1 ASR 任务

**操作**:
1. **S1: 构建 Prompt**:
   ```typescript
   // 获取最近提交的文本和用户关键词
   const recentCommittedText = state.getRecentCommittedText();
   const userKeywords = state.getRecentKeywords();
   
   // 构建 prompt
   const prompt = this.promptBuilder.build({
     userKeywords,
     recentCommittedText,
     qualityScore: lastQuality,
   });
   
   // 注入到 ASR 的 context_text
   contextText = prompt;
   ```

2. **创建 ASRTask**:
   ```typescript
   const asrTask: ASRTask = {
     audio: job.audio,
     audio_format: job.audio_format || 'pcm16',
     sample_rate: job.sample_rate || 16000,
     src_lang: job.src_lang,
     enable_streaming: job.enable_streaming_asr || false,
     context_text: contextText,  // S1: 使用构建的prompt
     job_id: job.job_id,
   };
   ```

3. **路由到 ASR 服务**:
   ```typescript
   const asrResult = await this.taskRouter.routeASRTask(asrTask);
   ```
   - 通过 `TaskRouter` 路由到 `faster-whisper-vad` 服务
   - HTTP POST `/utterance`
   - ASR 服务在 GPU 上执行识别
   - 返回 `ASRResult`（text, language, quality_score等）

#### 3.2 NMT 任务

**操作**:
1. **检查 ASR 结果**:
   ```typescript
   if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
     // 跳过 NMT 和 TTS
     return;
   }
   ```

2. **创建 NMTTask**:
   ```typescript
   const nmtTask: NMTTask = {
     text: asrResult.text,
     src_lang: job.src_lang,
     tgt_lang: job.tgt_lang,
     context_text: contextText,
     job_id: job.job_id,
   };
   ```

3. **路由到 NMT 服务**:
   ```typescript
   const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
   ```
   - 通过 `TaskRouter` 路由到 NMT 服务
   - HTTP POST `/translate`
   - NMT 服务在 GPU 上执行翻译
   - 返回 `NMTResult`（text_translated）

#### 3.3 TTS 任务（可选）

**操作**:
1. **创建 TTSTask**（如果启用）:
   ```typescript
   const ttsTask: TTSTask = {
     text: nmtResult.text,
     src_lang: job.tgt_lang,
     voice: job.voice,
     emotion: job.emotion,
     job_id: job.job_id,
   };
   ```

2. **路由到 TTS 服务**:
   ```typescript
   const ttsResult = await this.taskRouter.routeTTSTask(ttsTask);
   ```
   - 通过 `TaskRouter` 路由到 TTS 服务
   - HTTP POST `/synthesize`
   - TTS 服务在 GPU 上执行合成
   - 返回 `TTSResult`（tts_audio）

### 4. AggregatorMiddleware 后处理

**文件**: `electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

#### 4.1 文本聚合

**操作**:
1. **调用 AggregatorManager**:
   ```typescript
   const aggregatorResult = this.manager.processUtterance(
     job.session_id,
     asrTextTrimmed,
     segments,
     langProbs,
     result.quality_score,
     true,  // isFinal
     false,  // isManualCut
     mode
   );
   ```

2. **处理决策**:
   - **MERGE**: 合并到 pending 文本
   - **NEW_STREAM**: 开始新流
   - **COMMIT**: 提交当前文本

3. **获取聚合后的文本**:
   ```typescript
   if (aggregatorResult.shouldCommit && aggregatorResult.text) {
     aggregatedText = aggregatorResult.text;
   } else if (aggregatorResult.action === 'MERGE') {
     // 如果是 final，强制 flush pending 文本
     const flushedText = this.manager?.flush(job.session_id) || '';
     aggregatedText = flushedText;
   }
   ```

#### 4.2 S2 Rescoring（已禁用）

**操作**:
- 不再进行二次解码和重新评分
- 直接使用聚合后的文本

#### 4.3 NMT 重新翻译

**操作**:
1. **检查文本是否被聚合**:
   ```typescript
   if (aggregatedText.trim() !== asrTextTrimmed.trim() && this.taskRouter) {
     // 需要重新翻译
   }
   ```

2. **检查缓存**:
   ```typescript
   const cacheKey = generateCacheKey(
     job.src_lang,
     job.tgt_lang,
     aggregatedText,
     contextText
   );
   const cachedTranslation = this.translationCache.get(cacheKey);
   ```

3. **如果未缓存，调用 NMT**:
   ```typescript
   const nmtTask: NMTTask = {
     text: aggregatedText,
     src_lang: job.src_lang,
     tgt_lang: job.tgt_lang,
     context_text: contextText,
     job_id: job.job_id,
   };
   const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
   ```

4. **NMT Repair**（可选）:
   ```typescript
   // 如果质量分数低，触发 NMT Repair
   if (shouldRepair) {
     // 检测同音字错误
     const hasHomophoneErrors = hasPossibleHomophoneErrors(aggregatedText);
     
     // 生成多个候选
     const nmtResult = await this.taskRouter.routeNMTTask({
       ...nmtTask,
       num_candidates: 5,
     });
     
     // 评分候选
     const scoredCandidates = scoreCandidates(...);
     
     // 选择最佳候选
     const bestCandidate = selectBestCandidate(...);
   }
   ```

#### 4.4 去重检查

**操作**:
1. **检查是否与上次发送的文本相同**:
   ```typescript
   const lastSent = this.lastSentText.get(job.session_id);
   if (lastSent) {
     const normalizedAggregated = normalizeText(aggregatedText);
     const normalizedLastSent = normalizeText(lastSent);
     if (normalizedAggregated === normalizedLastSent) {
       return { shouldSend: false, ... };
     }
   }
   ```

2. **更新 lastSentText**:
   ```typescript
   this.setLastSentText(job.session_id, aggregatedText);
   ```

### 5. 发送结果

**文件**: `electron_node/electron-node/main/src/agent/node-agent.ts`

**操作**:
1. **检查 shouldSend**:
   ```typescript
   if (!middlewareResult.shouldSend) {
     logger.info('Skipping send (duplicate or filtered)');
     return;
   }
   ```

2. **构建 JobResultMessage**:
   ```typescript
   const jobResult: JobResultMessage = {
     type: 'job_result',
     job_id: job.job_id,
     trace_id: job.trace_id,
     session_id: job.session_id,
     utterance_index: job.utterance_index,
     text_asr: middlewareResult.aggregatedText || result.text_asr,
     text_translated: middlewareResult.translatedText || result.text_translated,
     tts_audio: result.tts_audio,
     // ... 其他字段
   };
   ```

3. **发送到调度服务器**:
   ```typescript
   this.ws.send(JSON.stringify(jobResult));
   ```

## 关键组件说明

### 1. NodeAgent
- **职责**: WebSocket 通信、消息路由、结果发送
- **关键方法**: `handleJob()`, `handleMessage()`

### 2. InferenceService
- **职责**: 任务管理、服务就绪检查
- **关键方法**: `processJob()`, `waitForServicesReady()`

### 3. PipelineOrchestrator
- **职责**: ASR → NMT → TTS 流水线编排
- **关键方法**: `processJob()`
- **S1 功能**: 构建 Prompt 并注入到 ASR

### 4. TaskRouter
- **职责**: 任务路由、服务选择、负载均衡
- **关键方法**: `routeASRTask()`, `routeNMTTask()`, `routeTTSTask()`

### 5. AggregatorMiddleware
- **职责**: 文本聚合、去重、NMT 重新翻译
- **关键方法**: `process()`
- **功能**:
  - 文本聚合（AggregatorManager）
  - 去重检查（lastSentText）
  - NMT 重新翻译（如果文本被聚合）
  - NMT Repair（可选）

### 6. AggregatorManager
- **职责**: 文本聚合决策（MERGE/NEW_STREAM/COMMIT）
- **关键方法**: `processUtterance()`

## 数据流

### 输入
- `JobAssignMessage`: 包含 audio, session_id, src_lang, tgt_lang 等

### 中间数据
- `ASRResult`: text, language, quality_score, segments
- `NMTResult`: text_translated
- `TTSResult`: tts_audio
- `AggregatorResult`: shouldCommit, action, text, metrics
- `AggregatorMiddlewareResult`: shouldSend, aggregatedText, translatedText

### 输出
- `JobResultMessage`: 发送到调度服务器

## 当前状态（S2 已禁用）

### 已禁用的功能
- ❌ 二次解码（Secondary Decode）
- ❌ S2 Rescoring（重新评分）
- ❌ 音频缓存（Audio Ring Buffer）

### 仍然启用的功能
- ✅ S1 Prompt（提示词构建）
- ✅ 文本聚合（AggregatorManager）
- ✅ 去重检查（lastSentText）
- ✅ NMT 重新翻译（如果文本被聚合）
- ✅ NMT Repair（可选）

## 性能优化

### 1. 服务就绪检查
- 第一次任务时等待服务就绪（30秒超时）
- 避免服务未启动时处理任务

### 2. 任务去重
- 检查 `job_id` 重复（只检查最近2个）
- 检查文本重复（normalizeText + similarity）

### 3. 翻译缓存
- LRU 缓存（200条，10分钟TTL）
- 减少重复翻译

### 4. 批量处理
- 批量翻译（窗口500ms，最大5个）
- 限制并发（MAX_CONCURRENT_NMT=2）

### 5. 异步处理
- 长文本异步重新翻译（>50字符）
- 不阻塞主流程

## 总结

整个流程包括：
1. **接收消息**: NodeAgent 接收 `job_assign`
2. **ASR 识别**: PipelineOrchestrator 调用 ASR 服务（带 S1 Prompt）
3. **NMT 翻译**: PipelineOrchestrator 调用 NMT 服务
4. **TTS 合成**: PipelineOrchestrator 调用 TTS 服务（可选）
5. **文本聚合**: AggregatorMiddleware 聚合文本
6. **NMT 重新翻译**: 如果文本被聚合，重新翻译
7. **去重检查**: 检查是否与上次发送的文本相同
8. **发送结果**: NodeAgent 发送 `job_result` 到调度服务器

关键优化：
- S1 Prompt 提高 ASR 准确度
- 文本聚合减少碎片化
- 去重检查防止重复发送
- 翻译缓存减少重复翻译
- 批量处理减少 GPU 峰值

