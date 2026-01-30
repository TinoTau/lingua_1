/**
 * runAsrStep - ASR 步骤
 * 处理音频聚合、ASR识别、Gate-A上下文重置
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { PartialResultCallback } from '../../inference/inference-service';
import { ASRTask, ASRResult, SegmentInfo } from '../../task-router/types';
import { SessionContextResetRequest } from '../../pipeline-orchestrator/session-context-manager';
import { PipelineOrchestratorAudioProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-audio-processor';
import { PipelineOrchestratorASRResultProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-asr-result-processor';
import { PipelineOrchestratorASRHandler } from '../../pipeline-orchestrator/pipeline-orchestrator-asr';
import { OriginalJobInfo } from '../../pipeline-orchestrator/audio-aggregator-types';
import { withGpuLease } from '../../gpu-arbiter';
import logger from '../../logger';

export interface AsrStepOptions {
  partialCallback?: PartialResultCallback;
  asrCompletedCallback?: (done: boolean) => void;
}

export async function runAsrStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle,
  options?: AsrStepOptions
): Promise<void> {
  // 获取音频聚合器（从 services bundle 注入，支持热插拔场景）
  if (!services.audioAggregator) {
    throw new Error('AudioAggregator must be provided in services bundle');
  }
  const audioAggregator = services.audioAggregator;
  // 注意：nodeId已通过SessionAffinityManager管理，不需要单独设置
  
  const audioProcessor = new PipelineOrchestratorAudioProcessor(audioAggregator);
  const asrResultProcessor = new PipelineOrchestratorASRResultProcessor();
  const asrHandler = new PipelineOrchestratorASRHandler(
    services.taskRouter,
    services.aggregatorManager
  );

  // 构建 prompt（如果启用）
  const contextText = asrHandler.buildPrompt(job) || (job as any).context_text;

  // 处理音频：聚合和格式转换
  const audioProcessResult = await audioProcessor.processAudio(job);
  if (audioProcessResult?.shouldReturnEmpty) {
    logger.info(
      { jobId: job.job_id, sessionId: job.session_id },
      'runAsrStep: Audio buffered, returning empty'
    );
    (ctx as any).audioBuffered = true;
    return;
  }

  if (!audioProcessResult) {
    throw new Error('Failed to process audio');
  }

  // ============================================================
  // 流式批次处理：支持多个audioSegments和originalJobIds
  // ============================================================
  const audioSegments = audioProcessResult.audioSegments || [audioProcessResult.audioForASR];
  const originalJobIds = audioProcessResult.originalJobIds || [];
  const originalJobInfo = audioProcessResult.originalJobInfo || [];
  
  // 将所有段合并后的音频存储到 JobContext（供后续步骤使用，如 Embedding）
  const allAudioBuffers = audioSegments.map(seg => Buffer.from(seg, 'base64'));
  const allAudio = Buffer.concat(allAudioBuffers);
  ctx.audio = allAudio;
  ctx.audioFormat = 'pcm16';

  // 空容器记入 ctx.pendingEmptyJobs，由 node-agent 唯一出口发送；本步骤不发送。
  if (originalJobInfo.length > 0) {
    const assignedJobIds = Array.from(new Set(originalJobIds));
    const allJobIds = originalJobInfo.map(info => info.jobId);
    const emptyJobIds = allJobIds.filter(jobId => !assignedJobIds.includes(jobId));
    if (emptyJobIds.length > 0) {
      const pendingEmptyJobs = emptyJobIds
        .map((jobId) => originalJobInfo.find((info) => info.jobId === jobId))
        .filter(Boolean)
        .map((info) => ({
          job_id: info!.jobId,
          utterance_index: info!.utteranceIndex,
        }));
      (ctx as any).pendingEmptyJobs = pendingEmptyJobs;
      logger.info(
        { emptyJobIds, reason: 'Empty containers recorded in ctx for node-agent to send' },
        'runAsrStep: Empty containers recorded in ctx'
      );
    }
  }

  // 处理每个ASR批次
  const asrStartTime = Date.now();
  
  for (let i = 0; i < audioSegments.length; i++) {
    const audioSegment = audioSegments[i];
    
    try {
      // 构建ASR任务
      const asrTask: ASRTask = {
        audio: audioSegment,
        audio_format: 'pcm16',
        sample_rate: job.sample_rate || 16000,
        src_lang: job.src_lang,
        enable_streaming: job.enable_streaming_asr || false,
        context_text: contextText,
        job_id: job.job_id,
        utterance_index: job.utterance_index,
        padding_ms: job.padding_ms,
        rerun_count: (job as any).rerun_count || 0,
      } as any;
      (asrTask as any).session_id = job.session_id;

      // 调用ASR服务
      const audioSegmentBuffer = Buffer.from(audioSegment, 'base64');
      const audioSegmentDurationMs = (audioSegmentBuffer.length / 2 / (job.sample_rate || 16000)) * 1000;
      
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          segmentIndex: i,
          totalSegments: audioSegments.length,
          operation: 'callASRService',
          audioSizeBytes: audioSegmentBuffer.length,
          audioDurationMs: audioSegmentDurationMs,
          audioFormat: 'pcm16',
          sampleRate: job.sample_rate || 16000,
          srcLang: job.src_lang,
          enableStreaming: job.enable_streaming_asr || false,
          hasContextText: !!contextText,
        },
        `runAsrStep: [ASRService] Calling ASR service for batch ${i + 1}/${audioSegments.length}`
      );
      
      let asrResult: ASRResult;
      const asrServiceStartTime = Date.now();
      
      if (job.enable_streaming_asr && options?.partialCallback) {
        // 流式ASR
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            segmentIndex: i,
            asrType: 'streaming',
          },
          'runAsrStep: [ASRService] Using streaming ASR'
        );
        asrResult = await asrHandler.processASRStreaming(asrTask, options.partialCallback);
      } else {
        // 非流式ASR（使用GPU租约）
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            segmentIndex: i,
            asrType: 'non-streaming',
          },
          'runAsrStep: [ASRService] Using non-streaming ASR with GPU lease'
        );
        asrResult = await withGpuLease(
          'ASR',
          async () => {
            return await services.taskRouter.routeASRTask(asrTask);
          },
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            stage: 'ASR',
          } as any
        );
      }
      
      const asrServiceDurationMs = Date.now() - asrServiceStartTime;

      const asrDuration = Date.now() - asrStartTime;
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          segmentIndex: i,
          totalSegments: audioSegments.length,
          operation: 'asrServiceCompleted',
          asrServiceDurationMs,
          totalDurationMs: asrDuration,
          asrTextLength: asrResult.text?.length || 0,
          asrTextPreview: asrResult.text?.substring(0, 50),
          segmentCount: asrResult.segments?.length || 0,
          hasLanguageProbabilities: !!asrResult.language_probabilities,
        },
        `runAsrStep: [ASRService] ASR batch ${i + 1}/${audioSegments.length} completed`
      );

      // 单一路径：所有 segment 结果写入当前 job 的 ctx，只跑一次后续步骤
      if (i === 0) {
        ctx.asrText = asrResult.text;
        ctx.asrResult = asrResult;
        ctx.asrSegments = asrResult.segments;
        ctx.languageProbabilities = asrResult.language_probabilities;
        ctx.qualityScore = asrResult.badSegmentDetection?.qualityScore;
        ctx.rerunCount = (job as any).rerun_count || 0;
      } else {
        ctx.asrText = (ctx.asrText || '') + ' ' + (asrResult.text || '');
        ctx.asrSegments = [...(ctx.asrSegments || []), ...(asrResult.segments || [])];
      }

      // Gate-A：仅对第一个批次检查
      if (i === 0 && (asrResult as any).shouldResetContext && services.sessionContextManager) {
        const sessionId = job.session_id || job.job_id || 'unknown';
        const resetRequest: SessionContextResetRequest = {
          sessionId,
          reason: 'consecutive_low_quality',
          jobId: job.job_id,
        };
        logger.info(
          { sessionId, jobId: job.job_id, qualityScore: asrResult.badSegmentDetection?.qualityScore },
          'Gate-A: Detected shouldResetContext flag, triggering context reset'
        );
        services.sessionContextManager
          .resetContext(resetRequest, services.taskRouter)
          .then((resetResult: any) => logger.info({ sessionId, jobId: job.job_id, resetResult }, 'Gate-A: Context reset completed'))
          .catch((error: any) => logger.error({ sessionId, jobId: job.job_id, error: error.message }, 'Gate-A: Context reset failed'));
      }

      // 空文本/无意义文本检查：仅第一个批次
      if (i === 0) {
        const asrResultProcessResult = asrResultProcessor.processASRResult(job, asrResult);
        if (asrResultProcessResult.shouldReturnEmpty) {
          logger.info({ jobId: job.job_id }, 'runAsrStep: ASR result is empty or meaningless, skipping further processing');
        }
      }
    } catch (error: any) {
      const asrDuration = Date.now() - asrStartTime;
      logger.error(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          segmentIndex: i,
          stage: 'ASR',
          durationMs: asrDuration,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        `runAsrStep: ASR batch ${i + 1} failed`
      );
      // 单一路径：失败 segment 记空，继续后续 segment，不抛错
      ctx.asrText = (ctx.asrText || '') + (ctx.asrText ? ' ' : '');
      ctx.asrSegments = [...(ctx.asrSegments || [])];
    }
  }

  // 双向模式：根据检测到的语言自动确定目标语言
  if (ctx.languageProbabilities && job.lang_a && job.lang_b) {
    const detectedLang = determineDetectedLanguage(ctx.languageProbabilities, job.lang_a, job.lang_b);
    if (detectedLang) {
      ctx.detectedSourceLang = detectedLang;
      ctx.detectedTargetLang = detectedLang === job.lang_a ? job.lang_b : job.lang_a;
    } else {
      ctx.detectedSourceLang = job.lang_a;
      ctx.detectedTargetLang = job.lang_b;
    }
  }

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      segmentCount: audioSegments.length,
      originalJobIdsCount: originalJobIds.length,
      asrTextLength: ctx.asrText?.length || 0,
      qualityScore: ctx.qualityScore,
    },
    'runAsrStep: ASR completed'
  );

  // ASR 完成回调
  options?.asrCompletedCallback?.(true);
}

/**
 * 确定检测到的语言（双向模式）
 * 从语言概率中找出最可能是 lang_a 或 lang_b 的语言
 */
function determineDetectedLanguage(
  languageProbabilities?: Record<string, number>,
  langA?: string,
  langB?: string
): string | null {
  if (!languageProbabilities || !langA || !langB) {
    return null;
  }

  // 获取概率最高的语言
  let maxProb = 0;
  let detectedLang: string | null = null;

  for (const [lang, prob] of Object.entries(languageProbabilities)) {
    if (prob > maxProb) {
      maxProb = prob;
      detectedLang = lang;
    }
  }

  // 检查检测到的语言是否是 lang_a 或 lang_b
  if (detectedLang === langA || detectedLang === langB) {
    return detectedLang;
  }

  // 如果检测到的语言不在 lang_a 或 lang_b 中，尝试匹配（处理语言代码变体）
  // 例如：'zh-CN' vs 'zh', 'en-US' vs 'en'
  const normalizeLang = (lang: string) => lang.split('-')[0].toLowerCase();
  const normalizedDetected = normalizeLang(detectedLang || '');
  const normalizedLangA = normalizeLang(langA);
  const normalizedLangB = normalizeLang(langB);

  if (normalizedDetected === normalizedLangA) {
    return langA;
  }
  if (normalizedDetected === normalizedLangB) {
    return langB;
  }

  return null;
}
