# 节点端任务处理流程文档

## 文档说明

本文档详细描述节点端从收到调度服务器任务开始到生成语音结果返回的完整流程，按模块分开，列举每个具体方法及其缓存使用情况，供决策部门审议。

## 一、整体架构

节点端采用**分层架构**，主要模块包括：
- **消息接收层**：接收调度服务器消息
- **任务处理层**：任务分发与协调
- **推理服务层**：核心推理逻辑
- **流水线编排层**：ASR/NMT/TTS 流水线编排
- **后处理协调层**：文本聚合、语义修复、翻译、TTS
- **任务路由层**：服务选择与路由
- **结果发送层**：结果发送与去重

## 二、完整流程（从收到任务到返回结果）

### 2.1 消息接收层：NodeAgent

**模块文件**：`electron_node/electron-node/main/src/agent/node-agent.ts`

#### 2.1.1 消息接收

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `handleMessage(data: string)` | 接收 WebSocket 消息，解析 JSON | ❌ 无缓存 |
| `handleJob(job: JobAssignMessage)` | 处理 `job_assign` 消息 | ❌ 无缓存 |

**流程**：
1. 接收 WebSocket 消息
2. 解析 JSON 消息
3. 根据 `message.type` 分发：
   - `node_register_ack` → 更新 `nodeId`
   - `job_assign` → 调用 `handleJob()`
   - `job_cancel` → 调用 `cancelJob()`

#### 2.1.2 任务处理入口

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `handleJob(job: JobAssignMessage)` | 任务处理入口，检查连接状态和重复任务 | ❌ 无缓存 |

**关键逻辑**：
- 检查 WebSocket 连接状态（`ws.readyState === WebSocket.OPEN`）
- 检查 `nodeId` 是否已设置
- 检查是否与最近处理的 `job_id` 重复（防重复处理）
- 记录任务接收时间
- 调用 `jobProcessor.processJob()`

---

### 2.2 任务处理层：JobProcessor

**模块文件**：`electron_node/electron-node/main/src/agent/node-agent-job-processor.ts`

#### 2.2.1 任务处理

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `processJob(job: JobAssignMessage, startTime: number)` | 处理任务（服务启动、推理、后处理） | ❌ 无缓存 |

**流程**：
1. **按需启动服务**：
   - 如果 `job.features?.speaker_identification` 为 `true`，启动 `speaker_embedding` 服务
   - 调用 `pythonServiceManager.startService('speaker_embedding')`

2. **设置流式 ASR 回调**（如果 `job.enable_streaming_asr`）：
   - 创建 `partialCallback`，发送 `asr_partial` 消息到调度服务器

3. **调用推理服务**：
   - 调用 `inferenceService.processJob(job, partialCallback)`

4. **后处理协调**（如果启用 `enablePostProcessTranslation`）：
   - 调用 `postProcessCoordinator.process(job, result)`
   - 处理 TTS Opus 编码（如果是 WAV 格式，编码为 Opus）

5. **返回结果**：
   - 如果 `postProcessResult.shouldSend === true`，返回最终结果
   - 否则返回空结果（但仍发送给调度服务器，防止超时）

---

### 2.3 推理服务层：InferenceService

**模块文件**：`electron_node/electron-node/main/src/inference/inference-service.ts`

#### 2.3.1 任务处理

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `processJob(job: JobAssignMessage, partialCallback?: PartialResultCallback)` | 推理服务入口 | ❌ 无缓存 |

**流程**：
1. **首次任务检查**：
   - 如果是第一个任务，调用 `waitForServicesReady()` 等待服务就绪
   - 调用 `onTaskStartCallback()` 启动 GPU 跟踪

2. **服务端点刷新**（**每个任务都执行**）：
   - 调用 `taskRouter.refreshServiceEndpoints()`
   - **注意**：此操作会检查所有服务的运行状态，无缓存

3. **流水线编排**：
   - 调用 `pipelineOrchestrator.processJob(job, partialCallback, asrCompletedCallback)`
   - `asrCompletedCallback`：ASR 完成后从 `currentJobs` 中移除任务

4. **返回结果**：
   - 返回 `JobResult`（包含 `text_asr`, `text_translated`, `tts_audio`）

#### 2.3.2 服务就绪等待

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `waitForServicesReady(maxWaitMs?: number)` | 等待服务就绪（首次任务调用） | ❌ 无缓存 |

**流程**：
1. 调用 `taskRouter.refreshServiceEndpoints()`（先刷新一次）
2. 循环检查（每 200ms）：
   - 调用 `taskRouter.refreshServiceEndpoints()`
   - 调用 `checkServiceTypeReady('ASR')`
   - 调用 `checkServiceTypeReady('NMT')`
   - 调用 `checkServiceTypeReady('TTS')`
   - 如果所有服务就绪，返回
   - 如果超时（默认 5 秒），记录警告

---

### 2.4 流水线编排层：PipelineOrchestrator

**模块文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

#### 2.4.1 流水线编排

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `processJob(job: JobAssignMessage, partialCallback?: PartialResultCallback, asrCompletedCallback?: (asrCompleted: boolean) => void)` | 流水线编排（ASR → NMT → TTS） | ❌ 无缓存 |

**流程**：

##### 阶段 1：ASR（语音识别）

1. **构建 Prompt**（如果启用）：
   - 调用 `asrHandler.buildPrompt(job)` 或使用 `job.context_text`

2. **音频处理**：
   - 调用 `audioProcessor.processAudio(job)`
   - 处理音频格式转换（Opus → PCM16）
   - 处理音频聚合（多段音频合并）

3. **执行 ASR**：
   - 创建 `ASRTask` 对象
   - **顺序执行**：通过 `SequentialExecutor` 确保按 `utterance_index` 顺序执行
   - **GPU 仲裁**：通过 `withGpuLease('ASR')` 获取 GPU 租约
   - 调用 `taskRouter.routeASRTask(asrTask)`
   - 调用 `asrCompletedCallback(true)` 释放 ASR 服务容量

4. **ASR 结果处理**：
   - 调用 `asrResultProcessor.processASRResult(asrResult, job)`
   - 通过 `AggregatorMiddleware` 进行预-NMT 文本聚合（如果启用）

##### 阶段 2：后处理（由 PostProcessCoordinator 处理，见 2.5 节）

**注意**：NMT 和 TTS 不在 `PipelineOrchestrator` 中处理，而是由 `PostProcessCoordinator` 处理。

#### 2.4.2 音频处理

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `PipelineOrchestratorAudioProcessor.processAudio(job)` | 处理音频（格式转换、聚合） | ❌ 无缓存 |

**流程**：
1. **Opus 解码**：
   - 调用 `decodeOpusToPcm16(job.audio)` 将 Opus 音频解码为 PCM16

2. **音频聚合**：
   - 调用 `audioAggregator.aggregate(job.session_id, decodedAudio, job.sample_rate)`
   - 如果聚合结果为 `shouldReturnEmpty === true`，返回空结果

3. **返回处理结果**：
   - 返回 `audioForASR`（PCM16 格式）
   - 返回 `audioFormatForASR`（`'pcm16'`）

#### 2.4.3 ASR 结果处理

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `PipelineOrchestratorASRResultProcessor.processASRResult(asrResult, job)` | 处理 ASR 结果（预-NMT 聚合） | ✅ **使用缓存**：`AggregatorManager.states`（会话状态） |

**流程**：

1. **预-NMT 文本聚合**（如果启用 `AggregatorMiddleware`）：
   - 调用 `aggregatorMiddleware.processASRResult(job, asrResult)`
   - 内部调用 `aggregatorManager.processUtterance()`（见 Stage 1 说明）
   - 如果 `aggregatorResult.action === 'COMMIT'`，返回聚合后的文本
   - 否则返回原始文本（等待后续合并）

2. **返回处理后的 JobResult**：
   - 包含处理后的 `text_asr`（可能已被聚合）
   - 包含原始 `segments`、`quality_score`、`language_probabilities` 等元数据

**缓存机制**：
- **AggregatorManager.states**（会话状态缓存）：
  - 存储方式：Map（`sessionId` → `AggregatorState`）
  - TTL：默认 5 分钟（可配置，通过 `ttlMs`）
  - 用途：存储每个会话的聚合状态（`pendingText`、`lastUtterance` 等）

---

### 2.5 后处理协调层：PostProcessCoordinator

**模块文件**：`electron_node/electron-node/main/src/agent/postprocess/postprocess-coordinator.ts`

#### 2.5.1 后处理入口

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `process(job: JobAssignMessage, result: JobResult)` | 后处理入口（串联各 Stage） | ❌ 无缓存 |

**流程**：

##### Stage 1：文本聚合（AggregationStage）

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `aggregationStage.process(job, result)` | 文本聚合（调用 AggregatorManager） | ❌ 无缓存 |

**流程**：

1. **提取输入数据**：
   - 提取 `asrText`、`segments`、`language_probabilities`、`quality_score`
   - 提取 `isManualCut`、`isPauseTriggered`、`isTimeoutTriggered` 标志

2. **调用 AggregatorManager**：
   - 调用 `aggregatorManager.processUtterance(sessionId, text, segments, langProbs, qualityScore, isFinal, isManualCut, mode, isPauseTriggered, isTimeoutTriggered)`
   - 内部调用链：
     - `aggregatorManager.getOrCreateState(sessionId, mode)` - 获取或创建会话状态（使用 Map 存储，会话生命周期）
     - `aggregatorState.processUtterance(text, segments, langProbs, qualityScore, isFinal, isManualCut, isPauseTriggered, isTimeoutTriggered)`
       - `utteranceProcessor.processUtterance()` - 处理 utterance（去重、计算时间戳）
         - `detectInternalRepetition(text)` - 检测并移除内部重复
         - `calculateUtteranceTime(segments, sessionStartTimeMs, lastUtteranceEndTimeMs)` - 计算时间戳
       - `actionDecider.decideAction(lastUtterance, curr)` - 决定动作（`MERGE` / `NEW_STREAM` / `COMMIT`）
       - `mergeGroupManager.checkIsFirstInMergedGroup(action, pendingText, lastUtterance)` - 检查是否是合并组的第一个

3. **获取聚合结果**：
   - `aggregatedText` - 聚合后的文本（如果 `action === 'MERGE'`，则为合并后的文本；否则为当前文本）
   - `action` - 动作类型（`MERGE` / `NEW_STREAM` / `COMMIT`）
   - `metrics` - 指标（包括 `dedupCount`, `dedupCharsRemoved` 等）

4. **判断是否发送到语义修复**：
   - 调用 `forwardMergeManager.shouldSendToSemanticRepair(aggregatedText, isManualCut)`
   - 返回 `shouldSendToSemanticRepair` 布尔值

5. **返回 AggregationStageResult**：
   - `aggregatedText` - 聚合后的文本
   - `aggregationChanged` - 文本是否被聚合（与原始 ASR 文本不同）
   - `action` - 动作类型
   - `shouldSendToSemanticRepair` - 是否发送到语义修复

**关键逻辑**：
- **文本长度判断**：
  - < 6 字符：`shouldSendToSemanticRepair = false`（丢弃）
  - 6-16 字符：`shouldSendToSemanticRepair = true`（如果 `isManualCut=true`），否则 `false`（等待合并）
  - > 16 字符：`shouldSendToSemanticRepair = true`
- **会话状态管理**：
  - 使用 Map 存储每个会话的状态（`sessionId` → `AggregatorState`）
  - 会话状态在会话生命周期内保持（TTL：5 分钟，可配置）
  - 会话状态包含：`pendingText`、`lastUtterance`、`sessionStartTimeMs`、`lastUtteranceEndTimeMs` 等

##### Stage 2：去重（DedupStage）

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `dedupStage.process(job, aggregatedText, lastSentText)` | 去重检查 | ✅ **使用缓存**：`job_id` 去重记录 |

**流程**：
1. 检查 `job_id` 是否已处理过（使用内部 Map 缓存）
2. 如果已处理过，返回 `shouldSend = false`
3. 如果未处理过，记录 `job_id`，返回 `shouldSend = true`

**缓存机制**：
- 使用 Map 存储已处理的 `job_id`
- 成功发送后调用 `markJobIdAsSent(sessionId, jobId)` 标记

##### Stage 3：语义修复（SemanticRepairStage）

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `semanticRepairHandler.process(job, aggregationResult, result, currentVersion)` | 语义修复处理 | ✅ **使用缓存**：`SemanticRepairCache` |

**流程**：

1. **初始化检查**：
   - 调用 `semanticRepairInitializer.getInitPromise()` 等待初始化完成
   - 调用 `semanticRepairInitializer.getSemanticRepairStage()` 获取 Stage

2. **缓存检查**（**P2-1**）：
   - 调用 `semanticRepairHandler.cache.get(task.lang, task.text_in)`
   - 如果缓存命中，直接返回缓存结果

3. **语义修复执行**（如果缓存未命中）：
   - 调用 `semanticRepairStage.process(job, aggregatedText, qualityScore, meta)`
   - **中文修复**：调用 `semanticRepairStageZH.process()`
   - **英文修复**：调用 `semanticRepairStageEN.process()`
   - 返回修复结果：`textOut`, `decision`（`REPAIR` / `PASS` / `REJECT`）, `confidence`

4. **缓存存储**（**P2-1**）：
   - 调用 `semanticRepairHandler.cache.set(task.lang, task.text_in, result)`

**缓存机制**：
- **缓存类型**：LRU Cache
- **缓存大小**：默认 200 条（可配置）
- **TTL**：默认 5 分钟（可配置）
- **缓存键**：`${lang}:${normalizedText}`
- **缓存条件**：文本长度 3-500 字符
- **缓存策略**：仅缓存 `decision === 'REPAIR'` 的结果

##### Stage 4：翻译（TranslationStage）

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `translationStage.process(job, aggregatedText, qualityScore, dedupCharsRemoved, semanticRepairContext)` | 翻译处理 | ✅ **使用缓存**：`TranslationCache` |

**流程**：

1. **缓存键生成**：
   - 调用 `generateCacheKey(job.src_lang, job.tgt_lang, aggregatedText, contextText)`
   - 缓存键格式：`${srcLang}:${tgtLang}:${normalizedText}:${normalizedContext}`

2. **缓存检查**：
   - 调用 `translationCache.get(cacheKey)`
   - 如果缓存命中，直接返回缓存结果（`fromCache: true`）

3. **翻译执行**（如果缓存未命中）：
   - **顺序执行**：通过 `SequentialExecutor` 确保按 `utterance_index` 顺序执行
   - **GPU 仲裁**：通过 `withGpuLease('NMT')` 获取 GPU 租约
   - 调用 `taskRouter.routeNMTTask(nmtTask)`
   - 返回翻译结果：`translatedText`

4. **缓存存储**：
   - 调用 `translationCache.set(cacheKey, translatedText)`

**缓存机制**：
- **缓存类型**：LRU Cache
- **缓存大小**：默认 200 条（可配置）
- **TTL**：默认 10 分钟（可配置）
- **缓存条件**：文本长度 > 0（所有文本都缓存）
- **缓存键**：包含源语言、目标语言、文本、上下文

5. **异步重新翻译**（如果文本长度 > `asyncRetranslationThreshold`）：
   - 如果启用 `enableAsyncRetranslation`，在后台异步重新翻译
   - 更新缓存（使用相同的缓存键）

##### Stage 5：TTS（TTSStage）

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `ttsStage.process(job, translatedText)` | TTS 音频生成 | ❌ 无缓存 |

**流程**：
1. 检查是否需要生成 TTS（如果 `translatedText` 为空，跳过）
2. **顺序执行**：通过 `SequentialExecutor` 确保按 `utterance_index` 顺序执行
3. **GPU 仲裁**：通过 `withGpuLease('TTS')` 获取 GPU 租约
4. 调用 `taskRouter.routeTTSTask(ttsTask)`
5. 返回 TTS 结果：`ttsAudio`, `ttsFormat`

**注意**：TTS 不使用缓存（音频数据量大，缓存成本高）

#### 2.5.2 语义修复 Stage 初始化

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `semanticRepairInitializer.initialize()` | 初始化语义修复 Stage | ❌ 无缓存 |

**流程**：
1. 调用 `servicesHandler.getInstalledSemanticRepairServices()` 获取已安装的语义修复服务
2. 如果没有任何服务，跳过初始化
3. 读取配置：`nodeConfig.features?.semanticRepair`
4. 初始化 `SemanticRepairStage`（包含 `SemanticRepairStageZH` 和 `SemanticRepairStageEN`）

---

### 2.6 任务路由层：TaskRouter

**模块文件**：`electron_node/electron-node/main/src/task-router/task-router.ts`

#### 2.6.1 服务端点管理

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `refreshServiceEndpoints()` | 刷新服务端点列表 | ❌ **无缓存**（每个任务都执行） |

**流程**：
1. 调用 `serviceManager.refreshServiceEndpoints()`
2. 获取所有已安装的服务：`getInstalledServices()`
3. 检查每个服务的运行状态：`isServiceRunning(serviceId)`
   - **Python 服务**：调用 `pythonServiceManager.getServiceStatus()`
   - **Rust 服务**：调用 `rustServiceManager.getStatus()`
   - **语义修复服务**：调用 `semanticRepairServiceManager.getServiceStatus()`（优先）或检查服务注册表（降级）
4. 只添加 `status === 'running'` 的服务到端点列表
5. 为每个服务创建端点对象（包含 `serviceId`, `baseUrl`, `port`, `status`）

**关键点**：
- **每个任务之前都会执行**（无缓存）
- 检查所有服务类型：ASR、NMT、TTS、TONE、SEMANTIC
- 支持服务热插拔（通过检查实际运行状态）

#### 2.6.2 ASR 任务路由

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `routeASRTask(task: ASRTask)` | 路由 ASR 任务到 ASR 服务 | ❌ 无缓存 |

**流程**：
1. 调用 `selectServiceEndpoint(ServiceType.ASR)` 选择服务端点（轮询策略）
2. 调用 `asrHandler.routeASRTask(task, endpoint)`
3. 发送 HTTP 请求到 ASR 服务
4. 返回 ASR 结果：`text`, `language`, `quality_score`, `segments` 等

#### 2.6.3 NMT 任务路由

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `routeNMTTask(task: NMTTask)` | 路由 NMT 任务到 NMT 服务 | ❌ 无缓存 |

**流程**：
1. 调用 `selectServiceEndpoint(ServiceType.NMT)` 选择服务端点（轮询策略）
2. 调用 `nmtHandler.routeNMTTask(task, endpoint)`
3. 发送 HTTP 请求到 NMT 服务
4. 返回翻译结果：`text`

#### 2.6.4 TTS 任务路由

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `routeTTSTask(task: TTSTask)` | 路由 TTS 任务到 TTS 服务 | ❌ 无缓存 |

**流程**：
1. 调用 `selectServiceEndpoint(ServiceType.TTS)` 选择服务端点（轮询策略）
2. 调用 `ttsHandler.routeTTSTask(task, endpoint)`
3. 发送 HTTP 请求到 TTS 服务
4. 返回 TTS 结果：`audio`（base64 编码）, `format`

#### 2.6.5 语义修复任务路由

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `routeSemanticRepairTask(task: SemanticRepairTask)` | 路由语义修复任务到语义修复服务 | ✅ **使用缓存**：`SemanticRepairCache` 和 `SemanticRepairHealthChecker.healthCache` |

**流程**：

1. **缓存检查**（**P2-1**）：
   - 调用 `cache.get(task.lang, task.text_in)`
   - 如果缓存命中，直接返回缓存结果

2. **服务端点选择**：
   - 调用 `selectServiceEndpoint(ServiceType.SEMANTIC)` 或 `getServiceEndpointById(serviceId)`
   - 如果找不到端点，返回 `PASS` 结果

3. **健康检查**（**P0-1**）：
   - 调用 `isServiceRunningCallback(endpoint.serviceId)` 检查进程是否运行
   - 调用 `healthChecker.checkServiceHealth(endpoint.serviceId, endpoint.baseUrl, isProcessRunning)`
   - **健康检查缓存**（**P0-1**）：如果检查间隔内（默认 60 秒），使用缓存结果
   - 如果服务不健康（不是 `WARMED` 状态），返回 `PASS` 结果

4. **并发控制**（**P0-5**）：
   - 调用 `concurrencyManager.acquirePermit(endpoint.serviceId)` 获取并发许可
   - 如果超过最大并发数（默认 2），等待

5. **模型完整性检查**（**P2-2**，如果启用）：
   - 调用 `modelIntegrityChecker.checkModelIntegrity(serviceId, servicePath)`
   - **模型完整性检查缓存**：如果检查间隔内（默认 24 小时），使用缓存结果

6. **语义修复执行**：
   - 发送 HTTP 请求到语义修复服务
   - 返回修复结果：`text_out`, `decision`, `confidence`, `reason_codes`

7. **缓存存储**（**P2-1**）：
   - 如果 `decision === 'REPAIR'`，调用 `cache.set(task.lang, task.text_in, result)`

**缓存机制**：
- **语义修复结果缓存**（`SemanticRepairCache`）：
  - 缓存类型：LRU Cache
  - 缓存大小：默认 200 条（可配置）
  - TTL：默认 5 分钟（可配置）
  - 缓存条件：文本长度 3-500 字符
  - 缓存策略：仅缓存 `decision === 'REPAIR'` 的结果
- **健康检查缓存**（`SemanticRepairHealthChecker.healthCache`）：
  - 缓存类型：Map
  - TTL：默认 60 秒（可配置，通过 `healthCheckInterval`）
  - 缓存键：`${serviceId}:${baseUrl}`
- **模型完整性检查缓存**（`SemanticRepairModelIntegrityChecker`）：
  - 缓存类型：Map
  - TTL：默认 24 小时（可配置）
  - 缓存键：`${serviceId}`

---

### 2.7 结果发送层：ResultSender

**模块文件**：`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts`

#### 2.7.1 结果发送

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `sendJobResult(job: JobAssignMessage, finalResult: JobResult, startTime: number, shouldSend: boolean, reason?: string)` | 发送任务结果 | ✅ **使用缓存**：`AggregatorMiddleware.lastSentText` 和 `DedupStage.jobIdMap` |

**流程**：

1. **连接状态检查**：
   - 检查 WebSocket 连接状态（`ws.readyState === WebSocket.OPEN`）
   - 检查 `nodeId` 是否已设置

2. **重复文本检查**（**去重**）：
   - 调用 `aggregatorMiddleware.getLastSentText(job.session_id)` 获取上次发送的文本
   - 如果当前文本与上次发送的文本完全相同（标准化后），跳过发送（但仍记录 `job_id`）

3. **构建响应消息**：
   - 创建 `JobResultMessage` 对象
   - 包含：`text_asr`, `text_translated`, `tts_audio`, `tts_format`, `extra`, `processing_time_ms` 等

4. **发送消息**：
   - 通过 WebSocket 发送 `JSON.stringify(response)`

5. **记录状态**：
   - 调用 `aggregatorMiddleware.setLastSentText(job.session_id, finalResult.text_asr.trim())` 更新上次发送的文本
   - 调用 `dedupStage.markJobIdAsSent(job.session_id, job.job_id)` 标记 `job_id` 已发送

**缓存机制**：
- **上次发送文本缓存**（`AggregatorMiddleware.lastSentText`）：
  - 存储方式：Map（`session_id` → `text`）
  - 用途：防止重复发送相同文本
- **已发送 Job ID 缓存**（`DedupStage.jobIdMap`）：
  - 存储方式：Map（`session_id` → `Set<job_id>`）
  - 用途：防止重复处理相同的 `job_id`

#### 2.7.2 错误结果发送

| 方法 | 说明 | 缓存使用 |
|------|------|----------|
| `sendErrorResult(job: JobAssignMessage, error: any, startTime: number)` | 发送错误结果 | ❌ 无缓存 |

**流程**：
1. 检查是否是 `ModelNotAvailableError`，如果是，发送特殊错误码
2. 否则发送通用错误码 `PROCESSING_ERROR`
3. 通过 WebSocket 发送错误响应

---

## 三、缓存使用总结

### 3.1 使用的缓存

| 缓存位置 | 缓存类型 | 缓存内容 | 缓存大小 | TTL | 用途 |
|---------|---------|---------|---------|-----|------|
| **TranslationStage.translationCache** | LRU Cache | 翻译结果 | 200 条（可配置） | 10 分钟（可配置） | 缓存 NMT 翻译结果 |
| **SemanticRepairCache** | LRU Cache | 语义修复结果 | 200 条（可配置） | 5 分钟（可配置） | 缓存语义修复结果（仅 REPAIR 决策） |
| **SemanticRepairHealthChecker.healthCache** | Map | 健康检查结果 | 无限制 | 60 秒（可配置） | 缓存语义修复服务健康检查结果 |
| **SemanticRepairModelIntegrityChecker.lastCheckTime** | Map | 模型完整性检查时间戳 | 无限制 | 24 小时（可配置） | 缓存模型完整性检查结果 |
| **DedupStage.jobIdMap** | Map | 已处理的 job_id | 无限制 | 会话生命周期 | 防止重复处理相同的 job_id |
| **AggregatorMiddleware.lastSentText** | Map | 上次发送的文本 | 无限制 | 会话生命周期 | 防止重复发送相同文本 |
| **AggregatorManager.states** | Map | 会话聚合状态 | 无限制（受 `maxSessions` 限制，默认 500） | 5 分钟（可配置） | 存储每个会话的聚合状态（`pendingText`、`lastUtterance` 等） |

### 3.2 未使用缓存的操作

| 操作 | 频率 | 说明 |
|------|------|------|
| **refreshServiceEndpoints()** | **每个任务** | 检查所有服务的运行状态（支持热插拔） |
| **ASR 任务路由** | 每个任务 | 直接调用 ASR 服务，无缓存 |
| **NMT 任务路由** | 每个任务（缓存未命中时） | 直接调用 NMT 服务，结果缓存在 TranslationStage |
| **TTS 任务路由** | 每个任务 | 直接调用 TTS 服务，无缓存（音频数据量大） |
| **语义修复任务路由**（缓存未命中时） | 每个任务 | 直接调用语义修复服务，结果缓存在 SemanticRepairCache |
| **音频处理** | 每个任务 | Opus 解码、音频聚合，无缓存 |
| **文本聚合** | 每个任务 | 调用 AggregatorManager，无缓存 |

---

## 四、性能优化点

### 4.1 已有优化

1. **翻译缓存**：避免重复翻译相同文本（LRU Cache，200 条，10 分钟）
2. **语义修复缓存**：避免重复修复相同文本（LRU Cache，200 条，5 分钟，仅缓存 REPAIR 决策）
3. **健康检查缓存**：避免频繁检查服务健康状态（60 秒缓存）
4. **模型完整性检查缓存**：避免频繁检查模型完整性（24 小时缓存）
5. **去重机制**：防止重复处理相同的 `job_id` 和重复发送相同文本
6. **顺序执行**：确保 ASR/NMT/TTS 按 `utterance_index` 顺序执行（避免乱序）
7. **GPU 仲裁**：确保 GPU 资源正确分配，避免冲突
8. **ASR 容量释放优化**：ASR 完成后立即从 `currentJobs` 中移除，允许处理下一个任务

### 4.2 潜在优化点

1. **服务端点刷新缓存**：
   - **当前**：每个任务都刷新服务端点列表（检查所有服务状态）
   - **优化建议**：添加缓存机制（如 500ms 或 1s TTL），减少不必要的检查
   - **权衡**：需要平衡热插拔响应速度与性能开销

2. **TTS 结果缓存**（可选）：
   - **当前**：TTS 结果不缓存（音频数据量大）
   - **优化建议**：可以考虑缓存常见短语的 TTS 结果（如问候语、确认词等）
   - **权衡**：需要评估缓存成本与命中率

---

## 五、关键决策点

### 5.1 服务端点刷新频率

**当前实现**：
- **每个任务之前都刷新**服务端点列表
- 检查所有服务类型（ASR、NMT、TTS、TONE、SEMANTIC）的运行状态
- 支持服务热插拔（实时检测服务启动/停止）

**优点**：
- 实时检测服务状态变化
- 支持服务热插拔
- 避免使用已停止的服务

**缺点**：
- 每个任务都有一定的性能开销
- 对于高频任务，开销累积较大

**建议**：
- 如果服务状态变化不频繁，可以考虑添加缓存机制（如 500ms 或 1s TTL）
- 可以通过配置项控制缓存 TTL，在热插拔响应速度与性能之间权衡

### 5.2 缓存策略

**当前实现**：
- 翻译结果：LRU Cache，200 条，10 分钟
- 语义修复结果：LRU Cache，200 条，5 分钟，仅缓存 REPAIR 决策
- 健康检查结果：60 秒缓存
- 模型完整性检查：24 小时缓存

**建议**：
- 缓存策略已较为合理，可以根据实际使用情况调整缓存大小和 TTL
- 可以考虑监控缓存命中率，优化缓存配置

### 5.3 顺序执行机制

**当前实现**：
- ASR、NMT、TTS 都使用 `SequentialExecutor` 确保按 `utterance_index` 顺序执行
- 防止乱序导致的问题（如上下文丢失、翻译错误等）
- **每个阶段（ASR、NMT、TTS、SEMANTIC_REPAIR）都有独立的顺序队列**，支持流水线并行处理

**设计说明**：
- ✅ **SequentialExecutor 的设计是正确的**：每个 `taskType` 独立维护顺序队列
- ✅ **支持流水线并行处理**：多个 job 可以并发处理，不同 job 的不同阶段可以并行执行
- ✅ **不影响并发性能**：虽然单个 job 的流程是串行的，但多个 job 可以并发处理，提高了系统整体性能

**示例（流水线并行）**：
```
时间线：
Job1: ASR → NMT → TTS
Job2:      ASR → NMT → TTS
Job3:           ASR → NMT → TTS
```
- Job1 的 NMT 和 Job2 的 ASR 可以并行执行
- Job1 的 TTS 和 Job2 的 NMT 和 Job3 的 ASR 可以并行执行
- 每个阶段独立维护顺序队列，确保同一 session 的多个 job 按 `utterance_index` 顺序执行

**结论**：SequentialExecutor 的"层层叠加"（每个阶段独立维护顺序队列）不是问题，而是**必要的设计**，支持流水线并行处理。

---

## 六、流程图

```
调度服务器 (JobAssign)
    ↓
NodeAgent.handleMessage()
    ↓
NodeAgent.handleJob()
    ↓
JobProcessor.processJob()
    ↓
InferenceService.processJob()
    ├─→ refreshServiceEndpoints() [无缓存，每个任务]
    └─→ PipelineOrchestrator.processJob()
        ├─→ 音频处理 (Opus → PCM16) [无缓存]
        ├─→ ASR 任务路由 [无缓存]
        │   └─→ TaskRouter.routeASRTask()
        └─→ ASR 结果处理
    ↓
PostProcessCoordinator.process()
    ├─→ AggregationStage.process() [无缓存]
    ├─→ DedupStage.process() [job_id 缓存]
    ├─→ SemanticRepairStage.process()
    │   ├─→ SemanticRepairCache.get() [LRU Cache]
    │   ├─→ TaskRouter.routeSemanticRepairTask()
    │   │   ├─→ SemanticRepairHealthChecker [60s 缓存]
    │   │   └─→ SemanticRepairCache.set() [LRU Cache]
    │   └─→ 语义修复结果
    ├─→ TranslationStage.process()
    │   ├─→ TranslationCache.get() [LRU Cache]
    │   ├─→ TaskRouter.routeNMTTask() [无缓存]
    │   └─→ TranslationCache.set() [LRU Cache]
    └─→ TTSStage.process()
        └─→ TaskRouter.routeTTSTask() [无缓存]
    ↓
ResultSender.sendJobResult()
    ├─→ AggregatorMiddleware.getLastSentText() [文本缓存]
    ├─→ WebSocket.send(JobResult)
    ├─→ AggregatorMiddleware.setLastSentText() [文本缓存]
    └─→ DedupStage.markJobIdAsSent() [job_id 缓存]
    ↓
调度服务器 (JobResult)
```

---

## 七、总结

节点端任务处理流程采用分层架构，各模块职责清晰：
- **消息接收层**：接收和分发消息
- **任务处理层**：任务分发与协调
- **推理服务层**：核心推理逻辑与服务管理
- **流水线编排层**：ASR 任务编排
- **后处理协调层**：文本聚合、语义修复、翻译、TTS
- **任务路由层**：服务选择与路由
- **结果发送层**：结果发送与去重

**缓存使用情况**：
- ✅ 翻译结果：LRU Cache（200 条，10 分钟）
- ✅ 语义修复结果：LRU Cache（200 条，5 分钟，仅 REPAIR 决策）
- ✅ 健康检查结果：60 秒缓存
- ✅ 模型完整性检查：24 小时缓存
- ✅ 去重机制：`job_id` 和文本缓存
- ❌ 服务端点刷新：无缓存（每个任务都执行，支持热插拔）
- ❌ TTS 结果：无缓存（音频数据量大）
- ✅ 会话聚合状态：Map（`sessionId` → `AggregatorState`，TTL：5 分钟）

**性能优化建议**：
- 考虑为服务端点刷新添加缓存机制（如 500ms 或 1s TTL），在热插拔响应速度与性能之间权衡
- 监控缓存命中率，优化缓存配置

---

**文档版本**：v1.0  
**最后更新**：2025-01-XX  
**审核状态**：待决策部门审议
