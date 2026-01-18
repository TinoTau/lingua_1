/**
 * runAsrStep - ASR 步骤
 * 处理音频聚合、ASR识别、Gate-A上下文重置
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext, initJobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { PartialResultCallback } from '../../inference/inference-service';
import { ASRTask, ASRResult, SegmentInfo } from '../../task-router/types';
import { SessionContextResetRequest } from '../../pipeline-orchestrator/session-context-manager';
import { PipelineOrchestratorAudioProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-audio-processor';
import { PipelineOrchestratorASRResultProcessor } from '../../pipeline-orchestrator/pipeline-orchestrator-asr-result-processor';
import { PipelineOrchestratorASRHandler } from '../../pipeline-orchestrator/pipeline-orchestrator-asr';
import { OriginalJobResultDispatcher, OriginalJobASRData } from '../../pipeline-orchestrator/original-job-result-dispatcher';
import { OriginalJobInfo } from '../../pipeline-orchestrator/audio-aggregator-types';
import { withGpuLease } from '../../gpu-arbiter';
import { runJobPipeline } from '../job-pipeline';
import { JobResult } from '../../inference/inference-service';
import logger from '../../logger';

export interface AsrStepOptions {
  partialCallback?: PartialResultCallback;
  asrCompletedCallback?: (done: boolean) => void;
}

// 全局OriginalJobResultDispatcher实例（单例）
let originalJobResultDispatcher: OriginalJobResultDispatcher | null = null;

function getOriginalJobResultDispatcher(): OriginalJobResultDispatcher {
  if (!originalJobResultDispatcher) {
    originalJobResultDispatcher = new OriginalJobResultDispatcher();
  }
  return originalJobResultDispatcher;
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

  // 如果存在originalJobIds，按原始job_id分组处理
  const dispatcher = getOriginalJobResultDispatcher();
  
  // 检查当前job是否是finalize（手动截断、pause截断或超时截断）
  const isManualCut = (job as any).is_manual_cut || (job as any).isManualCut || false;
  const isPauseTriggered = (job as any).is_pause_triggered || (job as any).isPauseTriggered || false;
  const isTimeoutTriggered = (job as any).is_timeout_triggered || (job as any).isTimeoutTriggered || false;
  const isFinalize = isManualCut || isPauseTriggered || isTimeoutTriggered;
  
  if (originalJobIds.length > 0) {
    // 按原始job_id分组处理ASR结果
    const uniqueOriginalJobIds = Array.from(new Set(originalJobIds));
    
    for (const originalJobId of uniqueOriginalJobIds) {
      // 从originalJobInfo中查找原始job的utteranceIndex
      const jobInfo = originalJobInfo.find(info => info.jobId === originalJobId);
      const originalUtteranceIndex = jobInfo?.utteranceIndex ?? job.utterance_index;
      
      // 创建原始job的副本，使用原始job的utteranceIndex（符合LONG_UTTERANCE_JOB_CONTAINER_POLICY要求）
      const originalJob: JobAssignMessage = {
        ...job,
        job_id: originalJobId,
        utterance_index: originalUtteranceIndex,
      };
      
      logger.info(
        {
          originalJobId,
          originalUtteranceIndex,
          currentJobUtteranceIndex: job.utterance_index,
          note: 'Using original job utterance_index (LONG_UTTERANCE_JOB_CONTAINER_POLICY)',
        },
        'runAsrStep: Created original job with original utterance_index'
      );

      // 注册原始job
      // 关键修复：对于独立utterance（手动发送或pause finalize），应该等待所有batch都添加完成后再处理
      // 否则，每个batch会被立即处理，导致每个batch都被单独发送，而不是累积
      // 期望片段数量：
      // - 如果是finalize，计算该originalJobId对应的batch数量，等待所有batch添加完成
      // - 否则，期望片段数量为undefined（累积，等待finalize）
      const batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length;
      const expectedSegmentCount = isFinalize 
        ? batchCountForThisJob // 等待所有batch添加完成
        : undefined; // 非finalize时累积等待
      
      logger.info(
        {
          originalJobId,
          isFinalize,
          batchCountForThisJob,
          expectedSegmentCount,
          totalBatches: audioSegments.length,
          note: isFinalize 
            ? `Waiting for ${batchCountForThisJob} batches before processing (independent utterance)` 
            : 'Accumulating segments until finalize',
        },
        'runAsrStep: Registering original job with expected segment count'
      );
      
      dispatcher.registerOriginalJob(
        job.session_id,
        originalJobId,
        expectedSegmentCount,
        originalJob,
        async (asrData: OriginalJobASRData, originalJobMsg: JobAssignMessage) => {
          // 处理回调：为原始job执行后续处理（聚合、语义修复、翻译、TTS）
          logger.info(
            {
              originalJobId,
              sessionId: job.session_id,
              asrTextLength: asrData.asrText.length,
              segmentCount: asrData.asrSegments.length,
            },
            'runAsrStep: Processing original job from dispatcher'
          );

          // 创建JobContext，并设置ASR结果
          const originalCtx = initJobContext(originalJobMsg);
          originalCtx.asrText = asrData.asrText;
          originalCtx.asrSegments = asrData.asrSegments;
          originalCtx.languageProbabilities = asrData.languageProbabilities;
          
          // 双向模式：根据检测到的语言自动确定目标语言
          if (originalJobMsg.lang_a && originalJobMsg.lang_b) {
            const detectedLang = determineDetectedLanguage(
              asrData.languageProbabilities,
              originalJobMsg.lang_a,
              originalJobMsg.lang_b
            );
            if (detectedLang) {
              originalCtx.detectedSourceLang = detectedLang;
              originalCtx.detectedTargetLang = detectedLang === originalJobMsg.lang_a 
                ? originalJobMsg.lang_b 
                : originalJobMsg.lang_a;
            } else {
              originalCtx.detectedSourceLang = originalJobMsg.lang_a;
              originalCtx.detectedTargetLang = originalJobMsg.lang_b;
            }
          }

          // 执行后续处理（跳过ASR步骤，因为ASR结果已经准备好）
          try {
            const result = await runJobPipeline({
              job: originalJobMsg,
              services,
              ctx: originalCtx, // 提供预初始化的JobContext，跳过ASR步骤
            });
            
            // 关键修复：发送原始job的结果到调度服务器
            // 如果services中有resultSender，使用它发送结果
            if (services.resultSender) {
              const startTime = Date.now(); // 使用当前时间作为处理开始时间
              services.resultSender.sendJobResult(
                originalJobMsg,
                result,
                startTime,
                result.should_send ?? true,
                result.dedup_reason
              );
              
              logger.info(
                {
                  originalJobId,
                  sessionId: job.session_id,
                  textAsrLength: result.text_asr?.length || 0,
                  textTranslatedLength: result.text_translated?.length || 0,
                  ttsAudioLength: result.tts_audio?.length || 0,
                  shouldSend: result.should_send ?? true,
                },
                'runAsrStep: Original job result sent to scheduler'
              );
            } else {
              logger.warn(
                {
                  originalJobId,
                  sessionId: job.session_id,
                  note: 'ResultSender not available, original job result not sent',
                },
                'runAsrStep: Original job pipeline completed but result not sent (ResultSender not available)'
              );
            }
            
            logger.info(
              { originalJobId, sessionId: job.session_id },
              'runAsrStep: Original job pipeline completed'
            );
          } catch (error: any) {
            logger.error(
              {
                originalJobId,
                sessionId: job.session_id,
                error: error instanceof Error ? error.message : String(error),
              },
              'runAsrStep: Original job pipeline failed'
            );
            throw error;
          }
        }
      );
    }
    
    // 关键修复：检测空容器并发送空结果核销
    // 在容器分配时，可能出现某些job容器没有被分配到任何batch
    // 这些空容器需要立即发送空结果，否则调度会一直等待
    if (originalJobIds.length > 0 && originalJobInfo.length > 0) {
      const assignedJobIds = Array.from(new Set(originalJobIds));
      const allJobIds = originalJobInfo.map(info => info.jobId);
      const emptyJobIds = allJobIds.filter(jobId => !assignedJobIds.includes(jobId));
      
      if (emptyJobIds.length > 0 && services.resultSender) {
        logger.info(
          {
            emptyJobIds,
            assignedJobIds,
            totalJobInfoCount: originalJobInfo.length,
            assignedJobCount: assignedJobIds.length,
            emptyJobCount: emptyJobIds.length,
            reason: 'Empty containers detected, will send empty results for acknowledgment',
          },
          'runAsrStep: Empty containers detected, sending empty results for acknowledgment'
        );
        
        for (const emptyJobId of emptyJobIds) {
          const emptyJobInfo = originalJobInfo.find(info => info.jobId === emptyJobId);
          if (emptyJobInfo) {
            // 创建空job消息，使用原始job的utteranceIndex
            const emptyJob: JobAssignMessage = {
              ...job,
              job_id: emptyJobInfo.jobId,
              utterance_index: emptyJobInfo.utteranceIndex,
            };
            
            // 创建空结果
            const emptyResult: JobResult = {
              text_asr: '',
              text_translated: '',
              tts_audio: '',
              should_send: true,
              extra: {
                reason: 'NO_TEXT_ASSIGNED',
              },
            };
            
            // 发送空结果核销
            const startTime = Date.now();
            services.resultSender.sendJobResult(
              emptyJob,
              emptyResult,
              startTime,
              true,
              'NO_TEXT_ASSIGNED'
            );
            
            logger.info(
              {
                emptyJobId: emptyJobInfo.jobId,
                utteranceIndex: emptyJobInfo.utteranceIndex,
                sessionId: job.session_id,
                reason: 'Empty container detected, sent empty result for acknowledgment',
              },
              'runAsrStep: Sent empty result for empty container job'
            );
          }
        }
      }
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

      // 如果存在originalJobIds，通过dispatcher分发
      if (originalJobIds.length > 0 && i < originalJobIds.length) {
        const originalJobId = originalJobIds[i];
        
        const asrData: OriginalJobASRData = {
          originalJobId,
          asrText: asrResult.text || '',
          asrSegments: asrResult.segments || [],
          languageProbabilities: asrResult.language_probabilities,
          // ✅ 记录批次索引（用于排序）
          batchIndex: i,
        };
        
        await dispatcher.addASRSegment(job.session_id, originalJobId, asrData);
        
        logger.info(
          {
            originalJobId,
            segmentIndex: i,
            asrTextLength: asrResult.text?.length || 0,
            segmentCount: asrResult.segments?.length || 0,
          },
          `runAsrStep: Added ASR batch ${i + 1} to original job ${originalJobId}`
        );
      } else {
        // 没有originalJobIds，使用当前job_id（向后兼容）
        // 更新JobContext（使用第一个批次的结果，或合并所有批次）
        if (i === 0) {
          ctx.asrText = asrResult.text;
          ctx.asrResult = asrResult;
          ctx.asrSegments = asrResult.segments;
          ctx.languageProbabilities = asrResult.language_probabilities;
          ctx.qualityScore = asrResult.badSegmentDetection?.qualityScore;
          ctx.rerunCount = (job as any).rerun_count || 0;
        } else {
          // 合并多个批次的结果
          ctx.asrText = (ctx.asrText || '') + ' ' + (asrResult.text || '');
          ctx.asrSegments = [...(ctx.asrSegments || []), ...(asrResult.segments || [])];
        }
        
        // Gate-A: 检查是否需要重置上下文（只对第一个批次检查）
        if (i === 0 && (asrResult as any).shouldResetContext && services.sessionContextManager) {
          const sessionId = job.session_id || job.job_id || 'unknown';
          const resetRequest: SessionContextResetRequest = {
            sessionId,
            reason: 'consecutive_low_quality',
            jobId: job.job_id,
          };

          logger.info(
            {
              sessionId,
              jobId: job.job_id,
              qualityScore: asrResult.badSegmentDetection?.qualityScore,
            },
            'Gate-A: Detected shouldResetContext flag, triggering context reset'
          );

          // 异步重置上下文（不阻塞主流程）
          services.sessionContextManager
            .resetContext(resetRequest, services.taskRouter)
            .then((resetResult: any) => {
              logger.info(
                { sessionId, jobId: job.job_id, resetResult },
                'Gate-A: Context reset completed'
              );
            })
            .catch((error: any) => {
              logger.error(
                { sessionId, jobId: job.job_id, error: error.message },
                'Gate-A: Context reset failed'
              );
            });
        }
        
        // 处理ASR结果：空文本检查、无意义文本检查（只对第一个批次处理）
        if (i === 0) {
          const asrResultProcessResult = asrResultProcessor.processASRResult(job, asrResult);
          if (asrResultProcessResult.shouldReturnEmpty) {
            logger.info(
              { jobId: job.job_id },
              'runAsrStep: ASR result is empty or meaningless, skipping further processing'
            );
            // 保持 ctx.asrText 为空，后续步骤会跳过
          }
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
      throw error;
    }
  }

  // 如果所有ASR结果都属于其他原始job（originalJobId !== job.job_id），
  // 当前job的结果应该为空（因为这些结果已经通过dispatcher作为原始job的结果发送）
  if (originalJobIds.length > 0 && !originalJobIds.includes(job.job_id)) {
    // 清空当前job的ASR结果
    ctx.asrText = '';
    ctx.asrResult = undefined;
    ctx.asrSegments = [];
    
    // 标记为"核销"情况：所有结果都归并到其他job，需要发送空结果核销当前job
    (ctx as any).isConsolidated = true;
    (ctx as any).consolidatedToJobIds = Array.from(new Set(originalJobIds));
    
    logger.info(
      {
        jobId: job.job_id,
        originalJobIds: Array.from(new Set(originalJobIds)),
        note: 'All ASR results belong to other original jobs, current job result is empty (will send empty result to acknowledge)',
      },
      'runAsrStep: All ASR results dispatched to original jobs, current job result is empty (will send empty result to acknowledge)'
    );
    
    // ASR完成回调
    options?.asrCompletedCallback?.(true);
    // 注意：不直接return，继续执行后续pipeline步骤，最终会返回空结果用于核销
  }

  // 如果是finalize，强制完成所有累积的原始job
  if (isFinalize && originalJobIds.length > 0) {
    const uniqueOriginalJobIds = Array.from(new Set(originalJobIds));
    for (const originalJobId of uniqueOriginalJobIds) {
      await dispatcher.forceComplete(job.session_id, originalJobId).catch((error) => {
        logger.error(
          {
            originalJobId,
            sessionId: job.session_id,
            error: error instanceof Error ? error.message : String(error),
          },
          'runAsrStep: Failed to force complete original job'
        );
      });
    }
    
    logger.info(
      {
        jobId: job.job_id,
        originalJobIds: uniqueOriginalJobIds,
        isFinalize,
      },
      'runAsrStep: Force completed all original jobs (finalize)'
    );
  }

  // 双向模式：根据检测到的语言自动确定目标语言（如果没有originalJobIds，使用当前job的结果）
  if (!originalJobIds.length && ctx.languageProbabilities && job.lang_a && job.lang_b) {
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
