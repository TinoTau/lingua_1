# AudioAggregator 流程决策审议文档

**范围**：节点端收到 job_assign 到送入 ASR 的完整调用链  
**目的**：逐方法列出调用顺序，识别重复调用或错误调用导致的不必要开销，供决策部门审议。

---

## 1. 调用链（按执行顺序）

### 1.1 入口：节点收到 job_assign

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 1 | WebSocket onMessage | `NodeAgent.handleMessage(message)` | node-agent-simple.ts |
| 2 | handleMessage | `NodeAgent.handleJob(job)` | node-agent-simple.ts |
| 3 | handleJob | `JobProcessor.processJob(job, startTime)` | node-agent-job-processor.ts |
| 4 | processJob | `InferenceService.processJob(job, partialCallback)` | inference-service.ts |
| 5 | processJob | `runJobPipeline({ job, services, ... })` | job-pipeline.ts |
| 6 | runJobPipeline | `inferPipelineMode(job)` | job-pipeline.ts |
| 7 | runJobPipeline | `executeStep('ASR', job, ctx, services, stepOptions)` | job-pipeline.ts → pipeline-step-registry.ts |
| 8 | executeStep | `runAsrStep(job, ctx, services, options)` | pipeline-step-registry.ts → asr-step.ts |

### 1.2 runAsrStep 内：音频处理到 ASR

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 9 | runAsrStep | `asrHandler.buildPrompt(job)` | asr-step.ts → pipeline-orchestrator-asr.ts |
| 10 | runAsrStep | `audioProcessor.processAudio(job)` | asr-step.ts |
| 11 | processAudio | `this.audioAggregator.processAudioChunk(job)` | pipeline-orchestrator-audio-processor.ts |
| 12 | processAudio（当 shouldReturnEmpty） | `this.audioAggregator.getBufferStatus(job.session_id)` | pipeline-orchestrator-audio-processor.ts（仅用于日志） |

**processAudioChunk 内部（AudioAggregator）**：

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 13 | processAudioChunk | `buildBufferKey(job)` | audio-aggregator.ts → audio-aggregator-buffer-key.ts |
| 14 | processAudioChunk | `decodeAudioChunk(job, SAMPLE_RATE, BYTES_PER_SAMPLE)` | audio-aggregator.ts → audio-aggregator-decoder.ts |
| 15 | processAudioChunk | `this.buffers.get(bufferKey)` / `this.buffers.set(bufferKey, buffer)` | audio-aggregator.ts |
| 16 | processAudioChunk（可选） | `this.timeoutHandler.checkTimeoutTTL(currentBuffer, job, currentAudio, nowMs)` | audio-aggregator.ts → audio-aggregator-timeout-handler.ts |
| 17 | processAudioChunk（isMaxDurationTriggered） | `this.maxDurationHandler.handleMaxDurationFinalize(..., aggregateAudioChunks, createStreamingBatchesWithPending)` | audio-aggregator.ts → audio-aggregator-maxduration-handler.ts |
| 18 | processAudioChunk（shouldProcessNow） | `this.aggregateAudioChunks(currentBuffer.audioChunks)` → `this.audioMerger.aggregateAudioChunks(chunks)` | audio-aggregator.ts → audio-aggregator-merger.ts |
| 19 | processAudioChunk（shouldProcessNow） | `this.finalizeHandler.handleFinalize(currentBuffer, job, currentAggregated, ...)` | audio-aggregator.ts → audio-aggregator-finalize-handler.ts |
| 20 | processAudioChunk（shouldProcessNow） | `this.audioUtils.splitAudioByEnergy(audioToProcess, 5000, 2000, SPLIT_HANGOVER_MS)` | audio-aggregator.ts → audio-aggregator-utils.ts |
| 21 | processAudioChunk（shouldProcessNow） | `this.createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, shouldCacheRemaining)` → `this.streamBatcher.createStreamingBatchesWithPending(...)` | audio-aggregator.ts → audio-aggregator-stream-batcher.ts |
| 22 | processAudioChunk（可选） | `this.sessionAffinityManager.recordTimeoutFinalize(job.session_id)` | audio-aggregator.ts |
| 23 | processAudioChunk（可选） | `this.deleteBuffer(bufferKey, currentBuffer, reason, nowMs)` | audio-aggregator.ts |

**回到 runAsrStep**：

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 24 | runAsrStep | `Buffer.from(seg, 'base64')` × N、`Buffer.concat(allAudioBuffers)` | asr-step.ts（写 ctx.audio） |
| 25 | runAsrStep | 空容器检测：`originalJobInfo` / `originalJobIds` 计算，写 `ctx.pendingEmptyJobs` | asr-step.ts |
| 26 | runAsrStep | **循环每个 audioSegment**：`services.taskRouter.routeASRTask(asrTask)`（或 `asrHandler.processASRStreaming`） | asr-step.ts（经 withGpuLease 或直接调用） |
| 27 | runAsrStep | `asrResultProcessor.processASRResult(job, asrResult)`（仅首段） | asr-step.ts |
| 28 | runAsrStep | 写 `ctx.asrText`、`ctx.asrSegments`、`ctx.languageProbabilities` 等 | asr-step.ts |

**ASR 路由**：

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 29 | routeASRTask | `TaskRouter.routeASRTask(task)` → `this.asrHandler.routeASRTask(task)` | task-router.ts → task-router-asr.ts |

---

## 2. 重复调用与潜在开销

| 问题 | 位置 | 说明 | 建议 |
|------|------|------|------|
| **getBufferStatus 仅用于日志** | PipelineOrchestratorAudioProcessor.processAudio，当 `chunkResult.shouldReturnEmpty` 时 | 每次“音频被缓冲”返回时都会调用 `getBufferStatus(job.session_id)` 仅用于打日志，会访问 Map 并构造状态对象 | 可选：将 bufferStatus 改为 debug 级别或按需采样，减少高频路径开销 |
| **无重复 processAudioChunk** | 单次 job 只触发一次 processAudio → 一次 processAudioChunk | 无同一 job 下重复进入 AudioAggregator | 无需改动 |
| **decodeAudioChunk 每 job 一次** | processAudioChunk 入口 | 每个 job 解码一次当前音频块，符合设计 | 无需改动 |
| **aggregateAudioChunks 可能被调用的路径** | ① maxDurationHandler 内部（若走 MaxDuration finalize）② shouldProcessNow 时手动/finalize 路径 | 两条路径不同时发生；同一次 processAudioChunk 内同一条路径可能调用 1～2 次（如 finalize 合并后再切分） | 属业务分支，无重复调用同一逻辑 |

---

## 3. 结论与审议要点

1. **单次 job 的 AudioAggregator 路径**：从 `handleJob` 到 `routeASRTask` 为单链路，无同一 job 的重复 processAudio 或 processAudioChunk。
2. **唯一可优化点**：`getBufferStatus` 仅在“缓冲返回”时用于日志，若会话很多且经常缓冲，可考虑降日志级别或按需采样。
3. **与 ASR 的边界**：送入 ASR 的仅为 `processAudioChunk` 返回的 `audioSegments`（base64），每个 segment 在 runAsrStep 的循环里调用一次 `routeASRTask`，调用次数 = segment 数量，无多余调用。

**提请决策**：是否同意将 `getBufferStatus` 在“缓冲返回”分支中改为 debug 级别或采样输出，以降低高并发下的日志与微小 CPU 开销？
