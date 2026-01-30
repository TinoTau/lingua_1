# Job 结果发送架构 · 最小代码片段集（供方案设计）

**用途**：架构调整方案设计用，仅贴 6 段最小集合。  
**日期**：2026-01-28  

---

## 1. asr-step.ts：发送结果那段（sendJobResult 调用上下各 ~40 行）

**文件**：`electron-node/main/src/pipeline/steps/asr-step.ts`

```ts
      // 注册原始job
      // 关键修复：对于独立utterance（手动发送或pause finalize），应该等待所有batch都添加完成后再处理
      const batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length;
      const expectedSegmentCount = batchCountForThisJob;
      // ...
      const buffer = audioAggregator.getBuffer(job);
      const hasPendingMaxDurationAudio = buffer?.pendingMaxDurationAudio !== undefined 
        && buffer.pendingMaxDurationJobInfo?.some((info: OriginalJobInfo) => info.jobId === originalJobId) === true;

      dispatcher.registerOriginalJob(
        job.session_id,
        originalJobId,
        expectedSegmentCount,
        originalJob,
        async (asrData: OriginalJobASRData, originalJobMsg: JobAssignMessage) => {
          // 处理回调：为原始job执行后续处理（聚合、语义修复、翻译、TTS）
          logger.info(/* ... */ 'runAsrStep: Processing original job from dispatcher');

          const originalCtx = initJobContext(originalJobMsg);
          originalCtx.asrText = asrData.asrText;
          originalCtx.asrSegments = asrData.asrSegments;
          originalCtx.languageProbabilities = asrData.languageProbabilities;
          // 双向模式：根据检测到的语言自动确定目标语言
          if (originalJobMsg.lang_a && originalJobMsg.lang_b) { /* ... */ }

          try {
            const result = await runJobPipeline({
              job: originalJobMsg,
              services,
              ctx: originalCtx,
            });
            
            // 关键修复：发送原始job的结果到调度服务器
            if (services.resultSender) {
              const startTime = Date.now();
              services.resultSender.sendJobResult(
                originalJobMsg,
                result,
                startTime,
                result.should_send ?? true,
                result.dedup_reason
              );
              logger.info(/* ... */ 'runAsrStep: Original job result sent to scheduler');
            } else {
              logger.warn(/* ... */ 'runAsrStep: Original job pipeline completed but result not sent (ResultSender not available)');
            }
            logger.info({ originalJobId, sessionId: job.session_id }, 'runAsrStep: Original job pipeline completed');
          } catch (error: any) {
            logger.error(/* ... */ 'runAsrStep: Original job pipeline failed');
            throw error;
          }
        },
        hasPendingMaxDurationAudio
      );
    }
    
    // 空容器检测：emptyJobIds.length > 0 时对空容器发 NO_TEXT_ASSIGNED 空结果
    if (originalJobIds.length > 0 && originalJobInfo.length > 0) {
      const emptyJobIds = allJobIds.filter(jobId => !assignedJobIds.includes(jobId));
      if (emptyJobIds.length > 0 && services.resultSender) {
        for (const emptyJobId of emptyJobIds) {
          // ...
          services.resultSender.sendJobResult(emptyJob, emptyResult, startTime, true, 'NO_TEXT_ASSIGNED');
        }
      }
    }
```

---

## 2. node-agent-simple.ts：processJob 返回后发送 finalResult 那段（上下各 ~40 行）

**文件**：`electron-node/main/src/agent/node-agent-simple.ts`

```ts
    const startTime = Date.now();
    logger.info(
      { jobId: job.job_id, traceId: job.trace_id, sessionId: job.session_id, utteranceIndex: job.utterance_index },
      'Received job_assign, starting processing'
    );

    try {
      const processStartTime = Date.now();
      const processResult = await this.jobProcessor.processJob(job, startTime);
      const processDuration = Date.now() - processStartTime;

      if (processDuration > 30000) {
        logger.warn({ jobId: job.job_id, processDurationMs: processDuration, note: '...' }, 'Long job processing time detected');
      }

      // 结果已由 asr-step 内 original job 路径发送，此处不再发送
      if ((processResult.finalResult.extra as any)?.originalJobResultsAlreadySent === true) {
        return;
      }
      // 使用结果发送器发送结果
      if (!processResult.shouldSend) {
        this.resultSender.sendJobResult(job, processResult.finalResult, startTime, false, processResult.reason);
        return;
      }

      this.resultSender.sendJobResult(job, processResult.finalResult, startTime, true);
    } catch (error) {
      this.resultSender.sendErrorResult(job, error, startTime);
    }
  }
```

---

## 3. sendJobResult / 发送 payload 类型定义（JobResult）

**文件**：`electron-node/main/src/inference/inference-service.ts`

```ts
export interface JobResult {
  text_asr: string;
  text_translated: string;
  tts_audio: string; // base64 encoded TTS audio
  tts_format?: string;
  extra?: {
    emotion?: string | null;
    speech_rate?: string | null;
    voice_style?: string | null;
    language_probability?: number | null;
    language_probabilities?: Record<string, number> | null;
    [key: string]: unknown;
  };
  asr_quality_level?: 'good' | 'suspect' | 'bad';
  reason_codes?: string[];
  quality_score?: number;
  rerun_count?: number;
  segments_meta?: { count: number; max_gap: number; avg_duration: number };
  segments?: Array<{ text: string; start?: number; end?: number; no_speech_prob?: number }>;
  aggregation_applied?: boolean;
  aggregation_action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';
  is_last_in_merged_group?: boolean;
  aggregation_metrics?: { dedupCount?: number; dedupCharsRemoved?: number };
  semantic_repair_applied?: boolean;
  semantic_repair_confidence?: number;
  text_asr_repaired?: string;
  should_send?: boolean;
  dedup_reason?: string;
}
```

**sendJobResult 签名**（`node-agent-result-sender.ts`）：

```ts
sendJobResult(
  job: JobAssignMessage,
  finalResult: JobResult,
  startTime: number,
  shouldSend: boolean = true,
  reason?: string
): void
```

---

## 4. ASR_EMPTY 判定逻辑所在片段

**文件**：`electron-node/main/src/agent/node-agent-result-sender.ts`，`sendJobResult` 内

```ts
    // 检查ASR结果是否为空
    const asrTextTrimmed = (finalResult.text_asr || '').trim();
    const isEmpty = !asrTextTrimmed || asrTextTrimmed.length === 0;

    // 检查是否是"核销"情况：所有结果都归并到其他job
    const isConsolidated = (finalResult.extra as any)?.is_consolidated === true;
    // 检查是否是"空容器核销"情况：NO_TEXT_ASSIGNED
    const extraReason = (finalResult.extra as any)?.reason;
    const isNoTextAssigned = extraReason === 'NO_TEXT_ASSIGNED';

    // 音频被缓冲：不发送
    const isAudioBuffered = (finalResult.extra as any)?.audioBuffered === true;
    if (isAudioBuffered) { /* logger + return */ }

    // 空结果一律发送给调度器核销
    // - 核销：归并到其他 job（isConsolidated）
    // - 核销：空容器（NO_TEXT_ASSIGNED）
    // - 核销：ASR 结果为空，标记 reason=ASR_EMPTY
    if (isEmpty && (isConsolidated || isNoTextAssigned)) {
      logger.info(/* ... */);
    } else if (isEmpty) {
      logger.info(
        { jobId, traceId, sessionId, utteranceIndex, reason: 'ASR result is empty, sending empty result to acknowledge (ASR_EMPTY)' },
        'NodeAgent: Sending empty job_result to acknowledge (ASR_EMPTY)'
      );
      if (!(finalResult.extra as any)) (finalResult.extra as any) = {};
      (finalResult.extra as any).reason = 'ASR_EMPTY';
    }

    // 若 JobPipeline 决定不发送（去重失败），不发送任何结果
    if (!shouldSend) {
      logger.info(/* ... */);
      return;
    }
    // 有实际 ASR 结果，正常发送；否则上面已标记 ASR_EMPTY，仍会发空结果
```

---

## 5. OriginalJobResultDispatcher：finalize / forceFinalizePartial 核心逻辑

**文件**：`electron-node/main/src/pipeline-orchestrator/original-job-result-dispatcher.ts`

### 5.1 addASRSegment 中的“立即 finalize”路径（receivedCount >= expectedSegmentCount）

```ts
    // 累积后检查是否应该立即处理
    const shouldProcess = registration.receivedCount >= registration.expectedSegmentCount;

    if (shouldProcess) {
      if (registration.ttlTimerHandle) {
        clearTimeout(registration.ttlTimerHandle);
        registration.ttlTimerHandle = undefined;
      }
      registration.isFinalized = true;

      const sortedSegments = [...registration.accumulatedSegments].sort(/* by batchIndex */);
      const nonMissingSegments = sortedSegments.filter(s => !s.missing);
      const fullText = nonMissingSegments.map(s => s.asrText).join(' ');

      const finalAsrData: OriginalJobASRData = {
        originalJobId,
        asrText: fullText,
        asrSegments: registration.accumulatedSegmentsList,
        languageProbabilities: this.mergeLanguageProbabilities(nonMissingSegments),
      };

      await registration.callback(finalAsrData, registration.originalJob);

      sessionRegistrations.delete(originalJobId);
      if (sessionRegistrations.size === 0) this.registrations.delete(sessionId);
    }

    return shouldProcess;
```

### 5.2 forceFinalizePartial（TTL 或异常时强制 finalize）

```ts
  private async forceFinalizePartial(
    sessionId: string,
    originalJobId: string,
    reason: string
  ): Promise<void> {
    const registration = sessionRegistrations?.get(originalJobId);
    if (!registration) return;
    if (registration.isFinalized) return;

    if (registration.ttlTimerHandle) {
      clearTimeout(registration.ttlTimerHandle);
      registration.ttlTimerHandle = undefined;
    }
    registration.isFinalized = true;

    if (registration.accumulatedSegments.length > 0) {
      const sortedSegments = [...registration.accumulatedSegments].sort(/* by batchIndex */);
      const nonMissingSegments = sortedSegments.filter(s => !s.missing);
      const fullText = nonMissingSegments.map(s => s.asrText).join(' ');

      const finalAsrData: OriginalJobASRData = {
        originalJobId,
        asrText: fullText,
        asrSegments: registration.accumulatedSegmentsList,
        languageProbabilities: this.mergeLanguageProbabilities(nonMissingSegments),
      };

      await registration.callback(finalAsrData, registration.originalJob);
    }

    sessionRegistrations.delete(originalJobId);
    if (sessionRegistrations.size === 0) this.registrations.delete(sessionId);
  }
```

---

## 6. 正确行为时序（一次用户说话：chunk → ASR → utterance → 返回，应在哪些点发消息）

**约定**：  
- 每个调度下发的 **job_assign** 对应一个 `job_id`（及 utterance_index）。  
- 节点应保证**每个 job_id 至多向调度端发送一条 job_result**（有内容或核销空结果二选一）。

**正确时序（文字描述）**：

1. **调度端** 下发 `job_assign`（含 job_id、session_id、utterance_index、音频或触发信息）。
2. **节点** 收到后：  
   - 若走 **音频聚合 + 分片**：  
     - 音频进入 AudioAggregator，按策略 finalize 后得到若干 segment，并得到 `originalJobIds`（及可选的空容器列表）。  
     - 每个 segment 对应 ASR 调用；ASR 结果进入 **OriginalJobResultDispatcher.addASRSegment**。  
     - 当某 originalJobId 的 `receivedCount >= expectedSegmentCount` 时，dispatcher **触发一次 callback**：对该 originalJob 跑 pipeline（聚合→语义修复→翻译→TTS），得到一条 **JobResult**。  
   - **发送时机（应在且仅在一处发生）**：  
     - **方案 A（当前实现）**：在上述 **callback 内** 对该 originalJob 调用 `resultSender.sendJobResult(originalJobMsg, result, ...)`，**在这里发一条 job_result**；同一 job 对应的 container 在 processJob 返回后若带 `originalJobResultsAlreadySent` 则**不再发送**。  
     - **方案 B（单发送点）**：callback 内**不发送**，仅产出 result 并回填到 container；**仅在** processJob 返回后由 node-agent 对**该 job** 调用一次 `sendJobResult(job, finalResult, ...)`，**在这里发一条 job_result**。  
3. **空容器**：若存在未分配任何 segment 的 job_id（emptyJobIds），应在**空容器检测处**对该 job_id 发**一条**空结果（reason=NO_TEXT_ASSIGNED），且该 job_id 不再参与后续“有内容”发送。  
4. **TTL / 异常**：dispatcher 的 `forceFinalizePartial` 仅触发 callback（合并已有 segment 的 partial 结果），**不直接发消息**；发送仍由 callback 内逻辑或 node-agent 统一出口完成，且同一 job_id 仍只发一条。  
5. **去重**：若 JobPipeline 判定不应发送（如文本去重），则要么发一条“核销”空结果（当前策略），要么经决策明确“该 job 不向调度端回包”；一旦决定回包，该 job_id 只对应一条 job_result。

**总结**：  
- **有内容**：每个 job_id 在「original job pipeline 完成」或「container pipeline 完成（并回填）」后，**只在一个出口**发一条 job_result。  
- **空结果**：仅当该 job 确需核销（空容器、ASR 空、去重后空等）时发一条空 job_result，且不与“有内容”重复发送。

---

*以上 6 段为架构调整方案设计用最小集合，可直接用于出方案与评审。*
